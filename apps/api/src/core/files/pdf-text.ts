import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';

const resultSchema = z.object({
  ok: z.boolean(), text: z.string().max(40_000), pagesRead: z.number().int(),
  pageCount: z.number().int(), truncated: z.boolean(), reasonNl: z.string().optional(),
});
export type PdfText = z.infer<typeof resultSchema>;

/** A separate thread lets the parent terminate parsing even if one page or
 * document-open never yields. Limits are real wall time, pages, text and heap;
 * this is resource containment, not a security sandbox. No document JS is run. */
const PARSER = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { getDocument } = await import(require('node:url').pathToFileURL(workerData.modulePath).href);
  const task = getDocument({ data: new Uint8Array(workerData.bytes),
    disableFontFace: true, useSystemFonts: false, enableXfa: false,
    useWorkerFetch: false, useWasm: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    let text = '', pagesRead = 0, truncated = doc.numPages > 40;
    for (let n = 1; n <= Math.min(doc.numPages, 40); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let part = '';
      for (const item of content.items) {
        if (typeof item.str === 'string') part += item.str + (item.hasEOL ? '\n' : ' ');
      }
      await page.cleanup();
      part = part.split('\n').map(line => line.replace(/[\s\u200b]+/gu, ' ').trim())
        .filter(Boolean).join('\n');
      const addition = (text && part ? '\n\n' : '') + part;
      const remaining = 40000 - text.length;
      text += addition.slice(0, remaining);
      pagesRead++;
      if (addition.length > remaining) { truncated = true; break; }
    }
    parentPort.postMessage({ ok: !!text.trim(), text, pagesRead, pageCount: doc.numPages,
      truncated, ...(!text.trim() ? { reasonNl: 'Dit PDF-bestand bevat geen leesbare tekst. Lever een tekstversie aan.' } : {}) });
  } finally { await task.destroy(); }
})().catch(() => parentPort.postMessage({ ok: false, text: '', pagesRead: 0,
  pageCount: 0, truncated: false, reasonNl: 'Dit PDF-bestand kon niet worden gelezen. Het is mogelijk beveiligd of beschadigd.' }));
`;

export async function extractPdfText(bytes: Buffer, timeoutMs = 30_000): Promise<PdfText> {
  const failure = (reasonNl: string): PdfText => ({ ok: false, text: '', pagesRead: 0,
    pageCount: 0, truncated: false, reasonNl });
  if (bytes.length > 20 * 1_048_576 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return failure('Dit PDF-bestand overschrijdt de verwerkingslimiet.');
  }
  const modulePath = createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.mjs');
  return new Promise((resolve) => {
    const worker = new Worker(PARSER, { eval: true, stdout: true, stderr: true,
      workerData: { bytes, modulePath }, resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const finish = (value: PdfText): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().then(() => { resolve(value); }, () => { resolve(value); });
    };
    const timer = setTimeout(() => { finish(failure('Het lezen van dit PDF-bestand duurde te lang.')); }, timeoutMs);
    worker.once('message', (message: unknown) => {
      const parsed = resultSchema.safeParse(message);
      finish(parsed.success ? parsed.data : failure('Dit PDF-bestand kon niet worden gelezen.'));
    });
    worker.once('error', () => { finish(failure('Dit PDF-bestand kon niet worden gelezen.')); });
    worker.once('exit', () => { finish(failure('Het lezen van dit PDF-bestand is gestopt.')); });
  });
}
