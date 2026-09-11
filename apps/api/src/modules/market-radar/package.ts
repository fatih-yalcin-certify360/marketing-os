import JSZip from 'jszip';
import type { PackageDeliverable, RadarRun } from '@c360/contracts';
import { AppError } from '../../core/errors/app-error.js';
const escape = (s: string): string => s.replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const style = `*{box-sizing:border-box}body{margin:0;padding:24px;background:#f3f6f8;color:#132d3c;font:17px/1.6 system-ui,sans-serif}main{max-width:780px;margin:auto;background:white;padding:32px;border-radius:20px}h1{font-size:clamp(26px,5vw,40px);line-height:1.2}h2{line-height:1.3}button,.cta{display:block;text-align:left;font:inherit;cursor:pointer;border:1px solid #acc1cb;border-radius:10px;padding:12px 18px;margin:10px 0;background:white;color:#132d3c;text-decoration:none}button:hover,button:focus-visible,.cta{background:#173f51;color:white}.hint{font-size:14px;color:#506570}blockquote{border-left:3px solid #acc1cb;padding-left:15px}a{color:#174f72}button:focus-visible,a:focus-visible{outline:3px solid #dc9700;outline-offset:3px}@media(prefers-reduced-motion:no-preference){main{animation:appear .35s ease-out}@keyframes appear{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}}`;
function document(title: string, body: string, script = ''): string {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><link rel="stylesheet" href="style.css"></head><body><main>${body}</main>${script}</body></html>`;
}
export async function buildMarketPackage(run: RadarRun, selected: PackageDeliverable[], courseName = 'Opleiding', ctaLabel = 'Bekijk de opleiding'): Promise<Buffer> {
  const bundle = run.report.package;
  if (selected.some((item) => !bundle?.selected.includes(item)) || (selected.length && !bundle?.content))
    throw new AppError('conflict', { publicMessage: 'Dit onderdeel is niet gegenereerd in deze scan. Kies het vóór een nieuwe scan.' });
  const zip = new JSZip();
  const files: { path: string; bytes: number }[] = [];
  const put = (file: string, value: string): void => { zip.file(file, value); files.push({ path: file, bytes: Buffer.byteLength(value) }); };
  put('LEESMIJ.txt', `CONCEPT — inhoudelijke en merkcontrole vereist.\n${run.report.isMock ? 'DEMODATA — geen echt onderzoek.\n' : ''}Radar-run: ${run.id}\nOnderzocht: ${run.createdAt}\nGekozen onderdelen: ${selected.join(', ') || 'alleen onderzoek'}\n\nBronvragen zijn geen gemeten zoekvolume. Zoekvoorstellen zijn hypothesen. Externe claims zijn geen eigen opleidingsfeiten.\nKeuzehulp is zelfreflectie, geen toelatingstest. Geen persoonsgegevens, cookies of tracking.\nSite-banner is uitsluitend voor de eigen website, niet gevalideerd voor Google Ads of Studio.\n\nHosting: upload de gekozen map inclusief style.css en widget.js naar dezelfde HTTPS-locatie. Open index.html voor een lokale preview. Gebruik embed.html als iframe-voorbeeld en vervang het pad door de eigen hostinglocatie. De TypeScript-bron in src/widget.ts is ook geldige JavaScript en wordt identiek geleverd in widget.js; geen externe bibliotheken nodig.\nDit pakket gaat niet door de publicatiegoedkeuring van reguliere social-content. Het blijft concept.\n`);
  put('onderzoek/vragen.json', JSON.stringify(run.report.keywords ?? { items: [], notes: ['Geen vragenonderzoek in deze scan.'] }, null, 2));
  put('onderzoek/doelgroepen.json', JSON.stringify(run.report.audience, null, 2));
  put('onderzoek/kansen.json', JSON.stringify(run.report.cards, null, 2));
  put('onderzoek/advertenties.json', JSON.stringify(run.report.advertising, null, 2));
  // Images remain in their authorized preview endpoint; no copying third-party creative into our site assets.
  const c = bundle?.content;
  if (c) {
    const cta = bundle.courseUrl ? `<a class="cta" href="${escape(bundle.courseUrl)}" target="_blank" rel="noopener noreferrer">${escape(ctaLabel)} ↗</a>` : '<p>Vul vóór gebruik een gecontroleerde opleidings-URL in.</p>';
    const draft = `<p class="hint">CONCEPT · controleer inhoud en merkstijl vóór gebruik</p><p><strong>${escape(courseName)}</strong></p>`;
    if (selected.includes('blog_faq')) {
      const sections = c.sections.map((s) => `<h2>${escape(s.heading)}</h2><p>${escape(s.text)}</p>`).join('');
      const faq = c.faq.map((f) => `<h3>${escape(f.question)}</h3><p>${escape(f.answer)}</p>`).join('');
      put('blog/index.html', document(c.title, `${draft}<article><h1>${escape(c.title)}</h1><p>${escape(c.intro)}</p>${sections}<h2>Veelgestelde vragen</h2>${faq}${cta}</article>`));
      put('blog/style.css', style);
      put('blog/artikel.md', `CONCEPT\n\n# ${c.title}\n\n${c.intro}\n\n${c.sections.map((s) => `## ${s.heading}\n\n${s.text}`).join('\n\n')}\n\n## Veelgestelde vragen\n\n${c.faq.map((f) => `### ${f.question}\n\n${f.answer}`).join('\n\n')}\n\n${ctaLabel}: ${bundle.courseUrl ?? 'nog in te vullen'}`);
    }
    if (selected.includes('fit_check')) {
      const model = JSON.stringify(c.reflection).replace(/</gu, '\\u003c');
      // Valid TypeScript using inferred types, shipped as identical browser-ready JavaScript.
      const script = `"use strict";\n(() => {\nconst questions = ${model};\nconst host = document.getElementById('questions');\nif (!host) return;\nconst answers = [-1, -1, -1];\nfunction show(index = 0) {\nif (!host) return;\nhost.replaceChildren();\nconst heading = document.createElement('h2'); heading.tabIndex = -1;\nheading.textContent = index < questions.length ? 'Vraag ' + (index + 1) + ' van ' + questions.length : 'Jouw overwegingen'; host.append(heading);\nif (index < questions.length) { const question = questions[index]; if (!question) return; const text = document.createElement('p'); text.textContent = question.question; host.append(text); question.options.forEach((option, choice) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = option.label; button.addEventListener('click', () => { answers[index] = choice; show(index + 1); }); host.append(button); }); }\nelse { questions.forEach((question, i) => { const option = question.options[answers[i] ?? -1]; if (!option) return; const title = document.createElement('h3'); title.textContent = question.question; const text = document.createElement('p'); text.textContent = option.label + ' — ' + option.guidance; host.append(title, text); }); }\nif (index > 0) { const back = document.createElement('button'); back.type = 'button'; back.textContent = index === questions.length ? 'Opnieuw beginnen' : 'Vorige vraag'; back.addEventListener('click', () => { if(index === questions.length) answers.fill(-1); show(index === questions.length ? 0 : index - 1); }); host.append(back); }\nheading.focus();\n}\nshow();\n})();\n`;
      put('keuzehulp/index.html', document(c.title, `${draft}<h1>${escape(c.title)}</h1><p>Verken drie herkenbare situaties en ontdek jouw volgende stap. Dit is geen toelatingstest en geeft geen score of garantie.</p><div id="questions" aria-live="polite"></div>${cta}`, '<script src="widget.js" defer></script>'));
      put('keuzehulp/style.css', style);
      put('keuzehulp/widget.js', script);
      put('keuzehulp/src/widget.ts', script);
      put('keuzehulp/embed.html', '<iframe src="./index.html" title="Opleidingskeuze verkennen" width="100%" height="850" loading="lazy" style="border:0"></iframe>');
    }
    if (selected.includes('site_banner')) {
      put('site-banner/index.html', document(c.banner.headline, `${draft}<h1>${escape(c.banner.headline)}</h1><p>${escape(c.banner.body)}</p>${cta}`));
      put('site-banner/style.css', style);
      put('site-banner/embed.html', '<iframe src="./index.html" title="Opleiding ontdekken" width="100%" height="420" loading="lazy" style="border:0"></iframe>');
    }
    if (selected.length) put('controle.json', JSON.stringify({ status: 'draft', courseName, courseVersionId: run.courseVersionId, brandProfileVersionId: bundle.brandProfileVersionId, confirmedFacts: bundle.confirmedFacts, courseUrl: bundle.courseUrl, evidence: run.report.keywords?.items.filter((item) => c.evidenceIds.includes(item.id)), reviewNotes: c.reviewNotes, notes: bundle.notes }, null, 2));
  }
  put('manifest.json', JSON.stringify({ runId: run.id, status: 'draft', selected, files }, null, 2));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
