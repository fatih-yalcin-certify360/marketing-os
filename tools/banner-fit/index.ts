import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';

/**
 * Does the text actually fit?
 *
 * The builder decides with characters per line, which is a stand-in for the
 * thing that matters: the rendered box. This measures the real one. It asks the
 * running API for a banner set, opens each size in a browser, waits for the
 * fonts, and asks every text element whether it overflows its own box, leaves
 * the banner, or overlaps something beside it.
 *
 * It goes through the API rather than calling the builder directly, so what is
 * measured is what the product serves — with the real brand fonts and the real
 * logo, which is where fit problems actually live. It therefore needs the dev
 * stack up.
 *
 * Deliberately a tool and not a test: it needs a browser and a running stack,
 * and its answer is a set of numbers to design against rather than a pass or a
 * fail. Run it after touching the type scale, the layout or the fit budgets.
 *
 *     npm run banner-fit -- <labelId> [apiBase]
 */

/** Copy at the length the fit budgets claim to allow, so the check is honest. */
const SCREENPLAY = {
  frames: [
    { kind: 'hook', lines: ['Vastgelopen in je dossier?'] },
    { kind: 'proof', lines: ['Word casemanager'] },
    { kind: 'usp', lines: ['Erkend door Hobéon', 'Blended learning', 'PE-punten beschikbaar'] },
  ],
  ctaText: 'Bekijk de data',
  stickerNl: 'Nieuwe start',
  legalNl: 'Actievoorwaarden van toepassing',
  backgroundBriefEn: null,
};

const SIZES = ['300x250', '336x280', '300x600', '160x600', '728x90', '320x50'] as const;
type Size = (typeof SIZES)[number];

const DIMENSIONS: Readonly<Record<Size, { width: number; height: number }>> = Object.freeze({
  '300x250': { width: 300, height: 250 },
  '336x280': { width: 336, height: 280 },
  '300x600': { width: 300, height: 600 },
  '160x600': { width: 160, height: 600 },
  '728x90': { width: 728, height: 90 },
  '320x50': { width: 320, height: 50 },
});

interface Build {
  size: Size;
  frameCount: number;
  gzipBytes: number;
  budgetGzipBytes: number;
  fontStrategy: string;
  droppedNl: string[];
  files: { name: string }[];
}

interface PreviewResponse {
  report: {
    builds: Build[];
    refusedNl: { size: Size; reasonNl: string }[];
    notesNl: string[];
  };
  previews: Record<string, string>;
}

interface Measured {
  scene: number;
  label: string;
  text: string;
  clippedX: number;
  clippedY: number;
  outside: number;
  rect: { x: number; y: number; w: number; h: number };
  fontSize: number;
}

interface Finding {
  size: Size;
  element: string;
  problem: string;
  detail: string;
}

/**
 * One scene, measured.
 *
 * `scene` is the index of the screen to show; the index past the last screen is
 * the endframe. Everything is put in its finished position first, so what is
 * measured is the layout rather than wherever an animation happens to be.
 */
async function measureScene(page: Page, scene: number): Promise<Measured[]> {
  return page.evaluate((index: number) => {
    const frames = [...document.querySelectorAll<HTMLElement>('.frame')];
    const endframe = document.getElementById('endframe');
    for (const [at, frame] of frames.entries()) {
      frame.style.opacity = at === index ? '1' : '0';
      frame.style.transform = 'none';
      for (const child of frame.querySelectorAll<HTMLElement>('.usp, .line')) {
        child.style.opacity = '1';
        child.style.transform = 'none';
      }
    }
    if (endframe !== null) {
      endframe.style.opacity = index >= frames.length ? '1' : '0';
      endframe.style.transform = 'none';
    }

    const banner = document.getElementById('banner')?.getBoundingClientRect();
    const visible = index >= frames.length ? endframe : (frames[index] ?? null);
    const items: {
      scene: number;
      label: string;
      text: string;
      clippedX: number;
      clippedY: number;
      outside: number;
      rect: { x: number; y: number; w: number; h: number };
      fontSize: number;
    }[] = [];
    if (visible === null) return items;

    const inScene = ['.line', '.endline', '.usp', '#cta', '#disclaimer'];
    const always = ['#sticker span'];
    const nodes: (readonly [string, HTMLElement])[] = [
      ...inScene.flatMap((selector) =>
        [...visible.querySelectorAll<HTMLElement>(selector)].map(
          (node) => [selector, node] as const,
        ),
      ),
      ...always.flatMap((selector) =>
        [...document.querySelectorAll<HTMLElement>(selector)].map(
          (node) => [selector, node] as const,
        ),
      ),
    ];

    for (const [selector, node] of nodes) {
      const rect = node.getBoundingClientRect();
      const fontSize = parseFloat(getComputedStyle(node).fontSize);

      /*
       * Whether anything between this element and the banner would cut it off.
       *
       * A tall glyph box is not a defect on its own: a face whose ascent and
       * descent exceed its line height overflows the content box and renders
       * perfectly, because nothing clips it. What matters is whether something
       * does — reporting the first without checking the second flagged twenty
       * healthy banners (2026-09-16).
       *
       * Written inline rather than as a named helper: this function is
       * serialised into the browser, and the bundler's name-preserving wrapper
       * does not exist there.
       */
      let clipped = false;
      let walker: HTMLElement | null = node;
      while (walker !== null && walker.id !== 'banner') {
        if (getComputedStyle(walker).overflow !== 'visible') {
          clipped = true;
          break;
        }
        walker = walker.parentElement;
      }
      items.push({
        scene: index,
        label: selector,
        text: (node.textContent ?? '').trim().slice(0, 36),
        clippedX: node.scrollWidth - node.clientWidth,
        clippedY: clipped ? node.scrollHeight - node.clientHeight : 0,
        outside:
          banner === undefined
            ? 0
            : Math.max(
                0,
                Math.round(rect.bottom - banner.bottom),
                Math.round(banner.top - rect.top),
                Math.round(rect.right - banner.right),
                Math.round(banner.left - rect.left),
              ),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
        fontSize,
      });
    }
    return items;
  }, scene);
}

async function main(): Promise<void> {
  const labelId = process.argv[2];
  const base = process.argv[3] ?? 'http://localhost:4000/api/v1';
  if (labelId === undefined) {
    process.stderr.write('usage: npm run banner-fit -- <labelId> [apiBase]\n');
    process.exit(2);
  }

  const response = await fetch(`${base}/labels/${labelId}/display-banners/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      platform: 'self_hosted',
      sizes: [...SIZES],
      motion: 'reveal',
      clickUrl: 'https://example.org/opleiding',
      screenplay: SCREENPLAY,
    }),
  });
  if (!response.ok) {
    process.stderr.write(`${String(response.status)} from the API: ${await response.text()}\n`);
    process.exit(1);
  }
  const { report, previews } = (await response.json()) as PreviewResponse;

  const workspace = await mkdtemp(join(tmpdir(), 'banner-fit-'));
  const browser = await chromium.launch();
  const findings: Finding[] = [];

  for (const build of report.builds) {
    const preview = previews[build.size];
    if (preview === undefined) continue;
    /*
     * The measured copy runs no script.
     *
     * SplitText wraps every word in its own inline-block before the first
     * measurement, which changes the box it is measured against — the first run
     * of this tool reported a constant "10px too tall" on every size, which was
     * the splitter and not the layout. Without the script the page rests in the
     * endframe, which is where the stylesheet puts it, and that is the thing
     * being checked.
     */
    const page_ = preview.replace(/<script>[\s\S]*?<\/script>/gu, '');
    await mkdir(join(workspace, build.size), { recursive: true });
    const file = join(workspace, build.size, 'index.html');
    await writeFile(file, page_, 'utf8');

    const dimension = DIMENSIONS[build.size];
    const page = await browser.newPage({
      viewport: { width: dimension.width, height: dimension.height },
    });
    await page.goto(`file://${file}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);

    /*
     * One screen at a time.
     *
     * Only ever one is on show, so measuring them all at once invents
     * collisions between screens that never share a moment — the first run of
     * this tool reported forty-eight problems, most of them that.
     */
    const scenes = await page.evaluate(() => document.querySelectorAll('.frame').length);
    const measured: Measured[] = [];
    for (let scene = 0; scene <= scenes; scene += 1) {
      measured.push(...(await measureScene(page, scene)));
    }

    for (const item of measured) {
      if (item.clippedX > 1)
        findings.push({ size: build.size, element: item.label, problem: 'wider than its box', detail: `${String(item.clippedX)}px over — "${item.text}"` });
      if (item.clippedY > 1)
        findings.push({ size: build.size, element: item.label, problem: 'taller than its box', detail: `${String(item.clippedY)}px over — "${item.text}"` });
      if (item.outside > 0)
        findings.push({ size: build.size, element: item.label, problem: 'outside the banner', detail: `${String(item.outside)}px — "${item.text}"` });
      if (item.fontSize < 12 && item.label !== '#disclaimer')
        findings.push({ size: build.size, element: item.label, problem: 'below the legible floor', detail: `${item.fontSize.toFixed(1)}px — "${item.text}"` });
    }

    // Overlapping boxes: the tell that a layout ran out of room. Compared only
    // inside one scene, because two screens never share a moment.
    const seen = new Set<string>();
    for (let a = 0; a < measured.length; a += 1) {
      for (let b = a + 1; b < measured.length; b += 1) {
        const first = measured[a];
        const second = measured[b];
        if (first === undefined || second === undefined) continue;
        if (first.scene !== second.scene) continue;
        const overlapX =
          Math.min(first.rect.x + first.rect.w, second.rect.x + second.rect.w) -
          Math.max(first.rect.x, second.rect.x);
        const overlapY =
          Math.min(first.rect.y + first.rect.h, second.rect.y + second.rect.h) -
          Math.max(first.rect.y, second.rect.y);
        const key = `${first.label}|${second.label}|${first.text}|${second.text}`;
        if (overlapX > 2 && overlapY > 2 && !seen.has(key)) {
          seen.add(key);
          findings.push({
            size: build.size,
            element: `${first.label} × ${second.label}`,
            problem: 'boxes overlap',
            detail: `${String(overlapX)}×${String(overlapY)}px — "${first.text}" / "${second.text}"`,
          });
        }
      }
    }

    const types = [...new Set(measured.map((item) => item.fontSize))].sort((x, y) => y - x);
    process.stdout.write(
      `${build.size.padEnd(9)} ${String(build.frameCount)} screen(s)  ` +
        `${(build.gzipBytes / 1024).toFixed(1)}/${(build.budgetGzipBytes / 1024).toFixed(0)} kB  ` +
        `${build.fontStrategy.padEnd(17)} type ${types.map((value) => value.toFixed(0)).join('/')}\n`,
    );
    await page.close();
  }

  await browser.close();
  await rm(workspace, { recursive: true, force: true });

  process.stdout.write('\n');
  for (const item of report.refusedNl) {
    process.stdout.write(`REFUSED ${item.size}: ${item.reasonNl}\n`);
  }
  if (findings.length === 0) {
    process.stdout.write('No fit problems found.\n');
    return;
  }
  for (const finding of findings) {
    process.stdout.write(
      `${finding.size.padEnd(9)} ${finding.problem.padEnd(24)} ${finding.element.padEnd(20)} ${finding.detail}\n`,
    );
  }
  process.stdout.write(`\n${String(findings.length)} fit problem(s).\n`);
}

await main();
