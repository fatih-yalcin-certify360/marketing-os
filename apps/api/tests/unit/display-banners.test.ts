import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { BANNER_SIZES, BANNER_SIZE_ORDER, bannerSetInput } from '@c360/contracts';
import {
  buildBannerSet,
  bannerSetZip,
  type BannerBrand,
} from '../../src/modules/display-banners/build.js';
import { preflight } from '../../src/modules/display-banners/preflight.js';
import { gsapRuntime, splitTextRuntime } from '../../src/modules/display-banners/gsap-runtime.js';

/**
 * Banner sets.
 *
 * The tests that matter here are the ones about what the builder refuses to do:
 * ship a line it had to cut, hide a font substitution, put an exit in a creative
 * whose destination owns the exit, let copy reach the animation script, or leave
 * an empty rectangle when the script does not run. A banner runs inside someone
 * else's page, so "it rendered" is a low bar.
 */

const brand: BannerBrand = {
  headingFamily: 'Plus Jakarta Sans',
  bodyFamily: 'Plus Jakarta Sans',
  fonts: [],
  logo: null,
  background: null,
};
const colors = {
  background: '#ffffff',
  foreground: '#10233b',
  accent: '#00806a',
  onAccent: '#ffffff',
};

/*
 * Copy short enough for the narrowest format, so the fixture exercises all six.
 * What a size refuses has its own test; here the subject is everything else.
 */
const screenplay = {
  frames: [
    { kind: 'hook' as const, lines: ['Vast in je dossier?'] },
    { kind: 'proof' as const, lines: ['Word casemanager'] },
    { kind: 'usp' as const, lines: ['Landelijk examen', 'Praktijkgericht', 'Vier starts per jaar'] },
  ],
  ctaText: 'Bekijk de data',
  stickerNl: 'Nieuwe start',
  legalNl: null,
  backgroundBriefEn: null,
};

const build = (over: Record<string, unknown> = {}, withBrand = brand) =>
  buildBannerSet(
    bannerSetInput.parse({
      platform: 'self_hosted',
      sizes: ['300x250', '336x280', '300x600', '160x600', '728x90', '320x50'],
      motion: 'reveal',
      clickUrl: 'https://certify360.nl/opleiding',
      screenplay,
      colors,
      ...over,
    }),
    withBrand,
  );

const text = (folder: Readonly<Record<string, Buffer>> | undefined, name: string): string =>
  folder?.[name]?.toString('utf8') ?? '';

/** Frame counts per size: the tiering decision, made visible. */
const frameCounts = (result: ReturnType<typeof buildBannerSet>): Record<string, number> =>
  Object.fromEntries(result.report.builds.map((entry) => [entry.size, entry.frameCount]));

describe('display banner sets', () => {
  it('makes the files a banner is made of, not one blob', () => {
    const { report, files } = build();
    expect(report.builds.map((entry) => entry.size)).toEqual([
      '300x250', '336x280', '300x600', '160x600', '728x90', '320x50',
    ]);
    // The shape of every hand-built banner, and of the reference in this repo.
    expect(Object.keys(files['300x250'] ?? {}).sort()).toEqual([
      'SplitText.min.js', 'gsap.min.js', 'index.html', 'main.js', 'style.css',
    ]);
    expect(text(files['300x250'], 'index.html')).toContain(
      '<link rel="stylesheet" href="style.css">',
    );
    expect(text(files['300x250'], 'index.html')).toContain('<script src="main.js"></script>');
    for (const entry of report.builds) {
      expect(entry.gzipBytes).toBeLessThanOrEqual(entry.budgetGzipBytes);
      expect(entry.budgetGzipBytes).toBe(BANNER_SIZES[entry.size].initialLoadGzipBytes);
      expect(entry.checks.every((item) => item.passed)).toBe(true);
    }
  });

  it('plays a sequence: loader, screens, then an endframe that stays', () => {
    const { report, files } = build();
    const html = text(files['300x600'], 'index.html');
    const js = text(files['300x600'], 'main.js');
    expect(report.builds.find((entry) => entry.size === '300x600')?.frameCount).toBe(3);
    expect(html).toContain('id="loaderWrapper"');
    expect(html).toContain('data-kind="hook"');
    expect(html).toContain('data-kind="usp"');
    expect(html).toContain('id="endframe"');
    // One pass. A loop would need a pause control and would keep the CPU busy.
    expect(js).not.toMatch(/\brepeat\s*:/u);
    expect(js).not.toMatch(/\byoyo\b/u);
    expect(js).toContain("window.addEventListener('load'");
  });

  it('rests on the offer, not on the opening question', () => {
    const { files } = build();
    const html = text(files['300x600'], 'index.html');
    // The hook opens; a banner that ends on a question never says what it sells.
    expect(html).toContain('<p class="endline">Word casemanager</p>');
    expect(html).toContain('data-kind="hook"');

    // With nothing but a hook, that is what stays — there is nothing else.
    const hookOnly = build({
      screenplay: { ...screenplay, frames: [{ kind: 'hook', lines: ['Vast in je dossier?'] }] },
    });
    expect(text(hookOnly.files['300x600'], 'index.html')).toContain(
      '<p class="endline">Vast in je dossier?</p>',
    );
  });

  it('rests in the endframe, so a script that never runs still leaves a banner', () => {
    const { files } = build();
    const css = text(files['300x250'], 'style.css');
    const js = text(files['300x250'], 'main.js');
    // The stylesheet's resting state is the finished banner…
    expect(css).toContain('#endframe{opacity:1}');
    // …and only the script hides it, having first announced that it runs.
    expect(css).toContain('.js #endframe{opacity:0}');
    expect(js).toContain("root.className = 'js'");
    expect(js).toContain('function stand()');
  });

  it('gives the tall formats the whole sequence and the strips one screen', () => {
    const counts = frameCounts(build());
    expect(counts['300x600']).toBe(3);
    expect(counts['300x250']).toBe(2);
    // A sequence inside a strip reads as a flicker, whatever the copy says.
    expect(counts['728x90']).toBe(1);
    expect(counts['320x50']).toBe(1);
  });

  it('keeps the engine reachable from the production bundle', async () => {
    /*
     * The image ships `dist/` and no `node_modules`, so reading the library
     * through `createRequire` alone worked everywhere it was tried and would
     * have thrown on the first banner in a container. The build copies it next
     * to the bundle; this asserts that step is still wired, because the failure
     * it prevents only appears in production (2026-09-17).
     */
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts.build).toContain('vendor-gsap');
  });

  it('ships the animation library as a file, with its licence notice intact', () => {
    const { report, files } = build();
    expect(text(files['300x250'], 'gsap.min.js')).toMatch(/\/\*!\s*\n?\s*\*\s*GSAP/u);
    expect(text(files['300x250'], 'SplitText.min.js')).toMatch(/\/\*!\s*\n?\s*\*\s*SplitText/u);
    expect(text(files['300x250'], 'main.js')).toContain('SplitText');
    expect(report.builds.find((entry) => entry.size === '300x250')?.engine).toBe('gsap');

    // 50 kB gzip budget, 32 kB of library: the strip animates without one.
    expect(Object.keys(files['320x50'] ?? {})).not.toContain('gsap.min.js');
    expect(report.builds.find((entry) => entry.size === '320x50')?.engine).toBe('css');
    expect(gsapRuntime().version.length).toBeGreaterThan(0);
    expect(splitTextRuntime().version.length).toBeGreaterThan(0);
  });

  it('gives Google Ads no exit of its own, and every other destination a click tag', () => {
    const google = build({ platform: 'google_ads' });
    const html = text(google.files['300x250'], 'index.html');
    expect(html).toContain('<meta name="ad.size" content="width=300,height=250">');
    // Google takes the destination from the campaign and refuses a second exit.
    expect(html).not.toContain('clickTag');
    expect(text(google.files['300x250'], 'main.js')).not.toContain('clickTag');

    const own = build({ platform: 'self_hosted' });
    expect(text(own.files['300x250'], 'index.html')).toContain('var clickTag = ');
    expect(text(own.files['300x250'], 'main.js')).toContain('window.open(clickTag)');
    expect(text(own.files['300x250'], 'index.html')).not.toContain('name="ad.size"');
  });

  it('drops what a size cannot carry and says so, instead of truncating it', () => {
    const { report, files } = build();
    const strip = report.builds.find((entry) => entry.size === '320x50');
    expect(strip?.droppedNl.join(' ')).toContain('schermen');
    expect(text(files['320x50'], 'index.html')).not.toContain('Landelijk examen');
    expect(text(files['320x50'], 'index.html')).not.toContain('…');
    // The sticker is a portrait device; a strip has no corner to put it in.
    expect(text(files['320x50'], 'index.html')).not.toContain('Nieuwe start');
    expect(text(files['300x600'], 'index.html')).toContain('Nieuwe start');
  });

  it('refuses a size whose opening line does not fit, and keeps the ones that do', () => {
    const { report, files } = build({
      screenplay: {
        ...screenplay,
        frames: [
          {
            kind: 'hook',
            lines: ['Word gecertificeerd casemanager regie op verzuim in één opleiding'],
          },
        ],
      },
    });
    // A line of sixty-five characters fits nowhere once the budgets are
    // measured against the rendered box rather than guessed at — and saying so
    // is more useful than a banner with the sentence hanging out of it.
    expect(report.refusedNl.map((item) => item.size)).toEqual([...BANNER_SIZE_ORDER]);
    expect(report.builds).toEqual([]);
    expect(report.refusedNl[0]?.reasonNl).toContain('Kort hem in');
    // A refused size is a smaller set, not a failed build.
    expect(report.builds.length + report.refusedNl.length).toBe(6);
    for (const item of report.refusedNl) expect(files[item.size]).toBeUndefined();
  });

  it('escapes copy into the markup and keeps a click URL out of the script', () => {
    const { files } = build({
      screenplay: {
        ...screenplay,
        frames: [{ kind: 'hook', lines: ['<b>alert(1)</b>'] }],
        ctaText: 'Meer "info"',
      },
      clickUrl: "https://example.org/x';alert(1);//",
    });
    const html = text(files['300x250'], 'index.html');
    expect(html).toContain('&lt;b&gt;alert(1)&lt;/b&gt;');
    expect(html).toContain('Meer &quot;info&quot;');
    expect(html).toContain("var clickTag = 'https://example.org/x\\';alert(1);//'");
  });

  it('never substitutes the brand letter quietly', () => {
    const { report } = build({}, { headingFamily: 'TT Firs Neue', bodyFamily: 'TT Firs Neue', fonts: [], logo: null, background: null });
    expect(report.builds[0]?.fontStrategy).toBe('system_stack');
    expect(report.notesNl.join(' ')).toContain('TT Firs Neue');
    expect(report.notesNl.join(' ')).toContain('niet de merkletter');

    const google = build();
    expect(google.report.builds[0]?.fontStrategy).toBe('google_font');
    expect(text(google.files['300x250'], 'index.html')).toContain('fonts.googleapis.com');
  });

  it('carries the brand letter as a file where that is allowed, and says whose licence question it is', () => {
    const withFont = build({}, {
      headingFamily: 'Certify Sans',
      bodyFamily: 'Certify Text',
      fonts: [
        { name: 'font-0.ttf', bytes: Buffer.from('fake-display-bytes'), families: ['Certify Sans'], weight: 700, style: 'normal' },
        { name: 'font-1.ttf', bytes: Buffer.from('fake-text-bytes'), families: ['Certify Text Regular', 'Certify Text'], weight: 400, style: 'normal' },
      ],
      logo: null,
      background: null,
    });
    expect(withFont.report.builds[0]?.fontStrategy).toBe('embedded_webfont');
    expect(Object.keys(withFont.files['300x250'] ?? {})).toContain('font-0.ttf');
    expect(text(withFont.files['300x250'], 'style.css')).toContain('@font-face');
    expect(text(withFont.files['300x250'], 'style.css')).toContain('url(font-0.ttf)');
    // We do not know what licence the customer holds, and do not pretend to.
    expect(withFont.report.notesNl.join(' ')).toContain('fontlicentie');

    // Google Ads accepts no font file at all, so the same brand falls back and
    // the report says why rather than quietly using another letter.
    const google = build({ platform: 'google_ads' }, {
      headingFamily: 'Certify Sans',
      bodyFamily: 'Certify Text',
      fonts: [
        { name: 'font-0.ttf', bytes: Buffer.from('fake-display-bytes'), families: ['Certify Sans'], weight: 700, style: 'normal' },
        { name: 'font-1.ttf', bytes: Buffer.from('fake-text-bytes'), families: ['Certify Text Regular', 'Certify Text'], weight: 400, style: 'normal' },
      ],
      logo: null,
      background: null,
    });
    expect(google.report.builds[0]?.fontStrategy).toBe('system_stack');
    expect(Object.keys(google.files['300x250'] ?? {})).not.toContain('font-0.ttf');
    expect(google.report.notesNl.join(' ')).toContain('accepteert geen fontbestanden');
  });

  it('sets running text in the text face and only the statement in the display face', () => {
    const twoFamilies = {
      headingFamily: 'Certify Display',
      bodyFamily: 'Certify Text',
      fonts: [
        { name: 'font-0.ttf', bytes: Buffer.from('display-400'), families: ['Certify Display'], weight: 400, style: 'normal' as const },
        { name: 'font-1.ttf', bytes: Buffer.from('display-700'), families: ['Certify Display Bold', 'Certify Display'], weight: 700, style: 'normal' as const },
        { name: 'font-2.ttf', bytes: Buffer.from('text-400'), families: ['Certify Text'], weight: 400, style: 'normal' as const },
      ],
      logo: null,
      background: null,
    };
    const { report, files } = build({}, twoFamilies);
    const css = text(files['300x250'], 'style.css');

    // The display face is a statement device, not a body letter. Putting the
    // heading family on the body element set bullets and small print in it too.
    expect(css).toContain('body{font-family:"Certify Text"');
    expect(css).toContain('.line{font-family:"Certify Display"');
    expect(css).toMatch(/\.usp\{font-size:\d+px/u);
    expect(css).not.toContain('.usp{font-family:"Certify Display"');

    // One weight per family: an extra weight is an extra whole file, and a
    // weight that is asked for but not shipped is synthesised by the browser.
    const packaged = Object.keys(files['300x250'] ?? {}).filter((n) => n.startsWith('font'));
    expect(packaged.sort()).toEqual(['font-1.ttf', 'font-2.ttf']);
    expect(report.notesNl.join(' ')).toContain('Certify Display voor de koppen');
    expect(report.notesNl.join(' ')).toContain('Certify Text voor de lopende tekst');
  });

  it('matches a font on any name it declares, not on whichever comes first', () => {
    // This brand's semibold file calls itself both "… Semibold" and the plain
    // family name; taking the first name made a file match or miss by accident.
    const { files } = build({}, {
      headingFamily: 'Certify Display',
      bodyFamily: 'Certify Display',
      fonts: [
        { name: 'font-0.ttf', bytes: Buffer.from('bold'), families: ['Certify Display Bold', 'Certify Display'], weight: 700, style: 'normal' as const },
      ],
      logo: null,
      background: null,
    });
    const css = text(files['300x250'], 'style.css');
    // Registered under the name the stylesheet asks for.
    expect(css).toContain('@font-face{font-family:"Certify Display";src:url(font-0.ttf)');
    expect(css).not.toContain('"Certify Display Bold"');
  });

  it('gives a screen the time it takes to read it, and a way to stop it', () => {
    const { files } = build();
    const js = text(files['300x600'], 'main.js');
    const html = text(files['300x600'], 'index.html');
    // Three screens at reading speed run past five seconds, so WCAG 2.2.2
    // engages and the control has to be there.
    expect(html).toContain('id="pauseButton"');
    expect(js).toContain('tl.paused()');

    // A strip is one short screen and needs none.
    expect(text(files['320x50'], 'index.html')).not.toContain('pauseButton');
  });

  it('stacks the bullets and keeps them, instead of replacing them', () => {
    const { files } = build();
    const css = text(files['300x600'], 'style.css');
    const js = text(files['300x600'], 'main.js');

    // They used to sit on top of each other and take turns, so a reader who
    // looked up mid-list had missed the earlier ones with no way back.
    expect(css).toContain('.uspList{list-style:none;display:flex;flex-direction:column');
    expect(css).not.toContain('.usp{position:absolute');
    // One tween over the set, staggered; none of them leave.
    expect(js).toContain('stagger:');
    expect(js).not.toContain('uAt + slot');
  });

  it('says plainly that there is no background image rather than implying one failed', () => {
    expect(build().report.notesNl.join(' ')).toContain('Geen achtergrondbeeld');
  });

  it('measures the rules on our own files, not on the library we bundled', () => {
    // A library naturally mentions every option it supports. Judging the ad by
    // the library's vocabulary would fail every banner that animates.
    const clean = preflight({
      html: '<html><head><meta name="ad.size" content="width=300,height=250"></head><body></body></html>',
      js: 'var t = 1;',
      gzipBytes: 1_000,
      totalBytes: 2_000,
      fileCount: 5,
      fileNames: ['index.html', 'style.css', 'main.js', 'gsap.min.js', 'SplitText.min.js'],
      size: '300x250',
      platform: 'google_ads',
    });
    expect(clean.every((item) => item.passed)).toBe(true);

    const failed = preflight({
      html: '<html><body><iframe src="https://elders.nl/x"></iframe><video></video><img src="https://tracker.example/pixel.gif"></body></html>',
      js: 'var clickTag="x";localStorage.setItem("a","b");document.write("c")',
      gzipBytes: 900_000,
      totalBytes: 2_000_000,
      fileCount: 90,
      fileNames: ['index.html', 'bg.mp4'],
      size: '300x250',
      platform: 'google_ads',
    })
      .filter((item) => !item.passed)
      .map((item) => item.id);
    expect(failed).toEqual(
      expect.arrayContaining([
        'zip_size', 'file_count', 'file_weight', 'ad_size_meta', 'no_own_exit', 'no_iframe',
        'no_media', 'no_storage', 'no_document_write', 'no_external_refs', 'file_types',
      ]),
    );
  });

  it('states that a passing check is not an approval', () => {
    expect(build({ platform: 'google_ads' }).report.notesNl.join(' ')).toContain('geen goedkeuring');
  });

  it('packages each size as its own uploadable ZIP, and unpacked beside it', async () => {
    const result = build();
    const zip = await JSZip.loadAsync(await bannerSetZip(result));
    const names = Object.keys(zip.files);
    // One creative per placement is the unit an ad platform takes.
    expect(names).toContain('300x250.zip');
    expect(names).toContain('320x50.zip');
    // …and readable without unzipping twice.
    expect(names).toContain('300x600/index.html');
    expect(names).toContain('300x600/style.css');

    const packed = await zip.file('300x250.zip')?.async('nodebuffer');
    const inner = await JSZip.loadAsync(packed ?? Buffer.alloc(0));
    expect(Object.keys(inner.files).sort()).toEqual([
      'SplitText.min.js', 'gsap.min.js', 'index.html', 'main.js', 'style.css',
    ]);
    const readme = await zip.file('LEESMIJ.txt')?.async('string');
    expect(readme).toContain('standaardlicentie');
    expect(readme).toContain(gsapRuntime().version);
  });

  it('previews from the very bytes it packages', () => {
    const { files, previews } = build();
    const preview = previews['300x250'] ?? '';
    // The frame has no origin, so the parts are folded in — but they are the
    // same parts, not a second rendering.
    expect(preview).toContain(text(files['300x250'], 'style.css'));
    expect(preview).toContain(text(files['300x250'], 'main.js'));
    expect(preview).not.toContain('href="style.css"');
    expect(preview).not.toContain('src="main.js"');
  });

  it('produces the same bytes for the same input', () => {
    expect(text(build().files['300x250'], 'index.html')).toBe(
      text(build().files['300x250'], 'index.html'),
    );
  });
});
