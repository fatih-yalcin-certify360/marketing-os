import { gzipSync } from 'node:zlib';
import JSZip from 'jszip';
import {
  BANNER_PLATFORM_RULES,
  BANNER_SIZES,
  BANNER_SIZE_ORDER,
  type BannerBuild,
  type BannerEngine,
  type BannerFrame,
  type BannerSetInput,
  type BannerSetReport,
  type BannerSize,
} from '@c360/contracts';
import { bannerParts, inlinedPreview } from './template.js';
import { resolveBannerFont, SYSTEM_STACK } from './fonts.js';
import { preflight } from './preflight.js';
import { gsapRuntime, splitTextRuntime } from './gsap-runtime.js';

/**
 * Building a banner set.
 *
 * One message, several fixed sizes, and for each size the files a banner is
 * made of: `index.html`, `style.css`, `main.js`, the libraries it uses and the
 * images it shows. Each size is its own uploadable ZIP inside the package,
 * because that is how a display ad is actually delivered — one creative per
 * placement, not one archive holding six.
 *
 * The build is deterministic: no model call happens here, so the same
 * screenplay and the same brand produce byte-identical banners, and a change in
 * the output is a change somebody made on purpose. The model's contribution
 * arrives as a screenplay — strings — and is proposed elsewhere.
 *
 * The rule that shapes the result is **tier, then drop**. Each size declares
 * how much text it can carry at a legible size; screens and lines a size cannot
 * carry are removed and named in the report. What we deliberately do not do is
 * Google Web Designer's default of shrinking to a ten-pixel floor and then
 * truncating with an ellipsis, because in Dutch that produces
 * "Herkansingsmogelijk…" — and a line that is absent reads better than a line
 * cut in half.
 */

/** One brand font file, ready to travel inside the package. */
export interface BannerFontFile {
  /** The name it takes inside the package. */
  name: string;
  bytes: Buffer;
  /**
   * Every family name the file declares.
   *
   * A list, not one name, because a font often declares several: the file for
   * the semibold weight of this brand's display face calls itself both
   * "Behind The Nineties Semibold" and "Behind The Nineties". Taking the first
   * one meant a file matched or missed the brand family by accident.
   */
  families: readonly string[];
  weight: number;
  style: 'normal' | 'italic';
}

export interface BannerBrand {
  headingFamily: string;
  /**
   * The family the brand sets running text in.
   *
   * Separate from the heading family and used for everything that is not the
   * statement — the support line, the bullets, the small print. Missing it was
   * why the first version set an entire banner in a display serif: the
   * stylesheet put the heading family on `body` and nothing ever overrode it.
   */
  bodyFamily: string;
  /**
   * The approved brand fonts, where we have them.
   *
   * Only used where the destination accepts a font file. On Google Ads it never
   * is: a font is not on the accepted list at all and "using non-Google fonts"
   * is a named disapproval reason, so there the answer is outlines.
   */
  fonts: readonly BannerFontFile[];
  /** The logo as raw bytes plus its file extension, or null. */
  logo: { bytes: Buffer; extension: 'png' | 'svg' | 'jpg' } | null;
  /** A background image, when one was generated or uploaded. */
  background: { bytes: Buffer; extension: 'jpg' | 'png' } | null;
}

/** One size's folder: the file name inside it to its contents. */
export type BannerFiles = Readonly<Record<string, Buffer>>;

export interface BannerSetResult {
  report: BannerSetReport;
  /** Per size, the files that size's ZIP contains. */
  files: Readonly<Record<string, BannerFiles>>;
  /** Per size, the same banner folded into one document for the preview frame. */
  previews: Readonly<Record<string, string>>;
}

/**
 * The engine for a size.
 *
 * GSAP plus SplitText costs 32 kB gzipped. At 320x50 the IAB budget is 50 kB,
 * so two thirds of the file would be library — and the right design for a strip
 * is one crossfade, which plain CSS transitions do for nothing. Everywhere else
 * the library is a fifth of the budget and buys real control over timing.
 */
function engineFor(size: BannerSize): BannerEngine {
  return BANNER_SIZES[size].initialLoadGzipBytes < 100_000 ? 'css' : 'gsap';
}

/**
 * Whether a string fits a box, in lines and characters.
 *
 * Two questions, and the second is the one that matters in Dutch. A string can
 * be short enough overall and still be impossible, because one word in it is
 * longer than a line: `herkansingsmogelijkheid` is twenty-three characters that
 * cannot break, and no average over the sentence sees that. So the longest word
 * is checked against the width of a single line, not against the total.
 *
 * Hyphenation is not the way out. Chromium ships a Dutch dictionary but fetches
 * it through the component updater on most platforms, so an ad iframe cannot
 * count on it at first paint — and an automatic break inside a compound reads
 * as a typo in a headline even when it is linguistically correct.
 */
function fitsIn(text: string, budget: { lines: number; perLine: number }): boolean {
  if (budget.lines === 0 || text.length === 0) return false;
  const longestWord = Math.max(...text.split(/\s+/u).map((word) => word.length));
  return text.length <= budget.lines * budget.perLine && longestWord <= budget.perLine;
}

/**
 * How many screens a size can hold.
 *
 * A strip is one screen and an endframe: it is on the page for the same few
 * seconds as a rectangle but has a fifth of the area, and a sequence in it
 * reads as a flicker. The tall formats get the whole sequence.
 */
function framesFor(size: BannerSize, frames: readonly BannerFrame[]): number {
  const spec = BANNER_SIZES[size];
  if (spec.family === 'horizontal') return Math.min(1, frames.length);
  return Math.min(spec.heightPx >= 500 ? 3 : 2, frames.length);
}

/**
 * One weight per family, and no more.
 *
 * Every weight is another whole font file — a commercial OTF is 35-50 kB
 * gzipped, against 146 kB for a medium rectangle. This brand ships seven faces
 * across two families; carrying them all put a 300x250 at 359 kB and the weight
 * check failed, correctly.
 *
 * So the design uses the display face at one weight for the statement and the
 * text face at one weight for everything else. Two files. It also removes a
 * subtler fault: asking for a weight that is not in the package makes the
 * browser synthesise it, and faux bold in a display serif looks like a mistake.
 */
const HEADING_WEIGHT = 700;
const BODY_WEIGHT = 400;

/**
 * The file that best serves a family at a weight.
 *
 * Matched on any of the names the file declares, and on the nearest weight
 * rather than an exact one, because a brand that ships 300 and 600 should still
 * get its own letter instead of a system fallback.
 */
function faceFor(
  files: readonly BannerFontFile[],
  family: string,
  weight: number,
): (BannerFontFile & { family: string }) | null {
  const wanted = family.trim().toLowerCase();
  const candidates = files.filter(
    (file) =>
      file.style === 'normal' &&
      file.families.some((name) => name.trim().toLowerCase() === wanted),
  );
  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) =>
    Math.abs(a.weight - weight) <= Math.abs(b.weight - weight) ? a : b,
  );
  // Registered under the name the stylesheet asks for, not under whichever
  // name the file happens to list first.
  const family_ =
    best.families.find((name) => name.trim().toLowerCase() === wanted) ?? family;
  return { ...best, family: family_ };
}

export function buildBannerSet(input: BannerSetInput, brand: BannerBrand): BannerSetResult {
  const rules = BANNER_PLATFORM_RULES[input.platform];
  const font = resolveBannerFont(brand.headingFamily, input.platform, brand.fonts);

  /*
   * The faces worth carrying: the heading family, upright, in the two weights
   * the stylesheet asks for. Anything else is bytes nobody will see.
   */
  const heading =
    font.strategy === 'embedded_webfont'
      ? faceFor(brand.fonts, brand.headingFamily, HEADING_WEIGHT)
      : null;
  const body =
    font.strategy === 'embedded_webfont'
      ? faceFor(brand.fonts, brand.bodyFamily, BODY_WEIGHT)
      : null;
  const faces = [heading, body].filter(
    (face): face is BannerFontFile & { family: string } => face !== null,
  );
  // Two different roles can land on the same file when a brand sets both in one
  // family; the package must not then carry it twice.
  const packaged = [...new Map(faces.map((face) => [face.name, face])).values()];
  const faceCost = packaged.reduce(
    (sum, file) => sum + gzipSync(file.bytes, { level: 9 }).byteLength,
    0,
  );
  const builds: BannerBuild[] = [];
  const refusedNl: { size: BannerSize; reasonNl: string }[] = [];
  const files: Record<string, BannerFiles> = {};
  const previews: Record<string, string> = {};
  const notesNl: string[] = [];

  const play = input.screenplay;
  // Asked-for order is not display order; the report reads best in one order.
  const sizes = BANNER_SIZE_ORDER.filter((size) => input.sizes.includes(size));

  for (const size of sizes) {
    const spec = BANNER_SIZES[size];
    const engine = input.motion === 'none' ? 'css' : engineFor(size);
    const droppedNl: string[] = [];

    /*
     * What the endframe says.
     *
     * The offer, not the opener. A hook is a question — "Vast in een
     * verzuimdossier?" — and a banner that rests on a question for the rest of
     * the impression never gets round to saying what it sells. So the endframe
     * takes the proof line where there is one, and only falls back to the hook
     * when the screenplay has nothing else.
     *
     * It has to fit at every size, because it is the part that stays: a size
     * that cannot hold this line cannot hold the banner.
     */
    const proof = play.frames.find((frame) => frame.kind === 'proof');
    const endline = proof?.lines[0] ?? play.frames[0]?.lines[0] ?? '';
    if (!fitsIn(endline, spec.fits.headline)) {
      refusedNl.push({
        size,
        reasonNl: `"${endline}" is de regel die op het eindbeeld blijft staan, en die past niet op ${size}: er is ruimte voor ${String(spec.fits.headline.lines)} regel(s) van ${String(spec.fits.headline.perLine)} tekens, en geen woord mag langer zijn dan ${String(spec.fits.headline.perLine)} tekens. Kort hem in of laat dit formaat weg.`,
      });
      continue;
    }
    if (play.ctaText.length > spec.fits.cta) {
      refusedNl.push({
        size,
        reasonNl: `De knoptekst is ${String(play.ctaText.length)} tekens; op ${size} passen er ${String(spec.fits.cta)}.`,
      });
      continue;
    }

    /* Tier: how many screens, and which lines inside them. */
    const allowed = framesFor(size, play.frames);
    if (allowed < play.frames.length)
      droppedNl.push(
        `${size} toont ${String(allowed)} van ${String(play.frames.length)} schermen; een reeks in dit formaat leest als geflikker.`,
      );

    const frames: BannerFrame[] = [];
    for (const frame of play.frames.slice(0, allowed)) {
      const budget = frame.kind === 'usp' ? spec.fits.support : spec.fits.headline;
      const lines = frame.lines.filter((line) => fitsIn(line, budget));
      if (lines.length < frame.lines.length)
        droppedNl.push(
          `Op ${size} zijn ${String(frame.lines.length - lines.length)} regel(s) uit het scherm "${frame.kind}" weggelaten in plaats van afgekapt.`,
        );
      if (lines.length > 0) frames.push({ kind: frame.kind, lines });
    }
    if (frames.length === 0) {
      refusedNl.push({
        size,
        reasonNl: `Geen enkel scherm past op ${size}. Schrijf kortere regels of laat dit formaat weg.`,
      });
      continue;
    }

    const legalNl = spec.carries.legal ? play.legalNl : null;
    if (play.legalNl !== null && legalNl === null)
      droppedNl.push(`De kleine lettertjes passen niet op ${size} en zijn weggelaten.`);
    const stickerNl = spec.family === 'horizontal' ? null : play.stickerNl;
    if (play.stickerNl !== null && stickerNl === null)
      droppedNl.push(`De sticker past niet op een liggend formaat en is weggelaten op ${size}.`);

    /*
     * Whether this size can afford the brand letter.
     *
     * Per size, because the answer differs: a 300x600 has 244 kB to spend and a
     * mobile strip has 49 kB, and a pair of commercial faces is the better part
     * of a hundred. Where it does not fit the banner falls back and the report
     * says so — better a banner in the wrong letter than a banner nobody will
     * accept. Subsetting the faces to the glyphs a banner actually uses is what
     * removes the trade-off; that is DB-1.
     */
    const engineCost = engine === 'gsap' ? 32_000 : 0;
    // Only an embedded file can be too heavy. A Google Fonts reference weighs
    // nothing here and a system stack weighs nothing anywhere, so neither is
    // ever downgraded by this.
    const carriesFont =
      packaged.length > 0 && engineCost + faceCost + 4_000 <= spec.initialLoadGzipBytes;
    const downgraded = font.strategy === 'embedded_webfont' && !carriesFont;
    if (font.strategy === 'embedded_webfont' && !carriesFont)
      droppedNl.push(
        `De merkletter past niet binnen het bestandsgewicht van ${size} (${(faceCost / 1024).toFixed(0)} kB aan fontbestanden op een budget van ${(spec.initialLoadGzipBytes / 1024).toFixed(0)} kB). Dit formaat gebruikt een systeemletter.`,
      );

    const backgroundFile = brand.background === null ? null : `bg.${brand.background.extension}`;
    const logoFile = brand.logo === null ? null : `logo.${brand.logo.extension}`;

    const parts = bannerParts({
      size,
      platform: input.platform,
      engine,
      fontStrategy: downgraded ? 'system_stack' : font.strategy,
      fontStack: downgraded ? SYSTEM_STACK : font.stack,
      bodyStack: downgraded || body === null ? SYSTEM_STACK : `"${body.family}", ${SYSTEM_STACK}`,
      googleFontFamily: downgraded ? null : font.googleFamily,
      fontFaces: carriesFont ? packaged : [],
      frames,
      endlineNl: endline,
      ctaText: play.ctaText,
      stickerNl,
      legalNl,
      backgroundFile,
      logoFile,
      colors: input.colors,
      clickUrl: rules.clickThrough === 'click_tag' ? input.clickUrl : null,
    });

    const folder: Record<string, Buffer> = {
      'index.html': Buffer.from(parts.html, 'utf8'),
      'style.css': Buffer.from(parts.css, 'utf8'),
      'main.js': Buffer.from(parts.js, 'utf8'),
    };
    if (engine === 'gsap') {
      folder['gsap.min.js'] = Buffer.from(gsapRuntime().source, 'utf8');
      folder['SplitText.min.js'] = Buffer.from(splitTextRuntime().source, 'utf8');
    }
    if (carriesFont) for (const file of packaged) folder[file.name] = file.bytes;
    if (brand.background !== null && backgroundFile !== null)
      folder[backgroundFile] = brand.background.bytes;
    if (brand.logo !== null && logoFile !== null) folder[logoFile] = brand.logo.bytes;

    const listed = Object.entries(folder).map(([name, bytes]) => ({
      name,
      bytes: bytes.byteLength,
      gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    }));
    const bytes = listed.reduce((sum, file) => sum + file.bytes, 0);
    // Summed per file, because that is how a server transfers them: each
    // response is compressed on its own, not the folder as one stream.
    const gzipBytes = listed.reduce((sum, file) => sum + file.gzipBytes, 0);

    files[size] = folder;
    /*
     * The preview frame has no origin, so a relative `src` cannot resolve in
     * it. The images become data URIs for that one purpose only — the package
     * itself keeps them as files, which is what an ad platform wants.
     */
    const inlineAssets: Record<string, string> = {};
    if (brand.background !== null && backgroundFile !== null) {
      const type = brand.background.extension === 'jpg' ? 'jpeg' : 'png';
      inlineAssets[backgroundFile] =
        `data:image/${type};base64,${brand.background.bytes.toString('base64')}`;
    }
    if (brand.logo !== null && logoFile !== null) {
      const type =
        brand.logo.extension === 'svg'
          ? 'image/svg+xml'
          : `image/${brand.logo.extension === 'jpg' ? 'jpeg' : 'png'}`;
      inlineAssets[logoFile] = `data:${type};base64,${brand.logo.bytes.toString('base64')}`;
    }
    // The font travels the same way, or the preview shows a system letter while
    // the package shows the brand one — a preview of something else.
    if (carriesFont)
      for (const file of packaged)
        inlineAssets[file.name] =
          `data:font/${file.name.endsWith('.otf') ? 'otf' : 'ttf'};base64,${file.bytes.toString('base64')}`;
    previews[size] = inlinedPreview(
      parts,
      engine === 'gsap' ? [gsapRuntime().source, splitTextRuntime().source] : [],
      inlineAssets,
    );

    builds.push({
      size,
      engine,
      motion: input.motion,
      fontStrategy: downgraded ? 'system_stack' : font.strategy,
      frameCount: frames.length,
      files: listed,
      bytes,
      gzipBytes,
      budgetGzipBytes: spec.initialLoadGzipBytes,
      droppedNl,
      checks: preflight({
        html: parts.html,
        js: parts.js,
        gzipBytes,
        totalBytes: bytes,
        fileCount: listed.length,
        fileNames: listed.map((file) => file.name),
        size,
        platform: input.platform,
      }),
    });
  }

  notesNl.push(
    `Gebouwd voor ${rules.labelNl}. De regels waaraan is gemeten staan op ${rules.sourceUrl} en zijn op ${rules.checkedOn} gelezen.`,
  );
  notesNl.push(
    'Elk formaat is een eigen map met index.html, style.css, main.js en de bestanden die daarbij horen, en wordt als eigen ZIP geleverd — zo levert een mediabureau een banner aan.',
  );
  if (builds.some((build) => build.engine === 'gsap'))
    notesNl.push(
      `Animatie met GSAP ${gsapRuntime().version} en SplitText, meegeleverd in het pakket onder de standaardlicentie zonder kosten; de licentievermelding in beide bestanden blijft staan.`,
    );
  if (builds.some((build) => build.engine === 'css' && build.motion !== 'none'))
    notesNl.push(
      'De smalste formaten animeren met CSS in plaats van GSAP: de bibliotheek zou daar twee derde van het toegestane bestandsgewicht kosten.',
    );
  if (brand.background === null)
    notesNl.push(
      'Geen achtergrondbeeld: de banners staan op een merkvlak. Zet beeldgeneratie aan of upload een achtergrond om dat te veranderen.',
    );
  if (builds.some((build) => build.fontStrategy === 'embedded_webfont'))
    notesNl.push(
      `De merkletters reizen mee als fontbestand: ${heading === null ? '' : `${heading.family} voor de koppen`}${heading !== null && body !== null ? ' en ' : ''}${body === null ? '' : `${body.family} voor de lopende tekst`}, in één snede elk. Controleer of jullie fontlicentie het insluiten in advertentiemateriaal toestaat — dat weten wij niet.`,
    );
  if (font.noteNl !== null) notesNl.push(font.noteNl);
  notesNl.push(
    'De reeks loopt één keer en eindigt in een stilstaand eindbeeld; er is geen herhaling. Wie in zijn systeem minder beweging heeft gevraagd, krijgt meteen dat eindbeeld.',
  );
  notesNl.push(
    'Deze controles meten de bestanden tegen de gepubliceerde regels. Ze zijn geen goedkeuring: of het platform de banner accepteert, beslist het platform.',
  );

  return { report: { platform: input.platform, screenplay: play, builds, notesNl, refusedNl }, files, previews };
}

/**
 * The package a person downloads.
 *
 * One uploadable ZIP per size, plus a readme that says what the checks did and
 * did not establish. The per-size ZIP is the unit an ad platform takes, so
 * nesting them is what makes the download usable without unpacking and
 * repacking by hand.
 */
export async function bannerSetZip(result: BannerSetResult): Promise<Buffer> {
  const outer = new JSZip();

  for (const [size, folder] of Object.entries(result.files)) {
    const inner = new JSZip();
    for (const [name, bytes] of Object.entries(folder)) inner.file(name, bytes);
    outer.file(
      `${size}.zip`,
      await inner.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    );
    // Also unpacked, so somebody can read and edit the files without unzipping
    // twice — the reference banner in this repo is how people expect to see one.
    for (const [name, bytes] of Object.entries(folder)) outer.file(`${size}/${name}`, bytes);
  }

  const lines = [
    'Display banners',
    '',
    `Gebouwd voor: ${BANNER_PLATFORM_RULES[result.report.platform].labelNl}`,
    '',
    'Per formaat staat er een ZIP klaar om te uploaden, en dezelfde bestanden',
    'uitgepakt in een map ernaast om te lezen of aan te passen.',
    '',
    'Formaten in dit pakket:',
    ...result.report.builds.map(
      (build) =>
        `  ${build.size} — ${String(build.frameCount)} scherm(en), ${(build.gzipBytes / 1024).toFixed(1)} kB gzip van ${(build.budgetGzipBytes / 1024).toFixed(0)} kB; animatie: ${build.engine}`,
    ),
    '',
    ...(result.report.refusedNl.length
      ? [
          'Niet gemaakt:',
          ...result.report.refusedNl.map((item) => `  ${item.size} — ${item.reasonNl}`),
          '',
        ]
      : []),
    'Notities:',
    ...result.report.notesNl.map((note) => `  - ${note}`),
    '',
    `GSAP ${gsapRuntime().version} en SplitText zijn meegeleverd onder de standaardlicentie zonder`,
    'kosten (https://gsap.com/community/standard-license/). De licentievermelding staat',
    'bovenaan beide bestanden en mag daar niet uit worden verwijderd.',
    '',
  ];
  outer.file('LEESMIJ.txt', lines.join('\n'));

  return outer.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
