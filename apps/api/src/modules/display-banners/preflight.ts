import {
  BANNER_PLATFORM_RULES,
  BANNER_SIZES,
  type BannerCheck,
  type BannerPlatform,
  type BannerSize,
} from '@c360/contracts';

/**
 * What we can check ourselves, before anyone uploads anything.
 *
 * Every rule here was read off the destination's own documentation and is
 * measured against the produced file — not asserted about it. The templates are
 * built so that these pass by construction; the checks exist because a template
 * can drift, and because a claim is worth more when something measures it.
 *
 * What this is not: approval. Passing every check says the file obeys the rules
 * we could find and verify. It does not say the destination will accept it —
 * account eligibility, brand policy and human review all sit outside anything
 * we can see from here, and a package that passes can still be rejected. The
 * report says so in those words.
 */

export interface PreflightInput {
  html: string;
  /** The banner's own script, checked apart from the bundled libraries. */
  js: string;
  gzipBytes: number;
  totalBytes: number;
  fileCount: number;
  /** Every file in this size's folder, so the extension check is real. */
  fileNames: readonly string[];
  size: BannerSize;
  platform: BannerPlatform;
}

function check(id: string, titleNl: string, passed: boolean, detailNl: string): BannerCheck {
  return { id, titleNl, passed, detailNl };
}

export function preflight(input: PreflightInput): BannerCheck[] {
  const rules = BANNER_PLATFORM_RULES[input.platform];
  const spec = BANNER_SIZES[input.size];
  const checks: BannerCheck[] = [];
  /*
   * What we wrote, apart from what we bundled.
   *
   * GSAP's source mentions every option it supports, including words on the
   * forbidden list below, and a library that merely contains the string
   * `localStorage` is not an ad that uses it. So the rules are measured on the
   * markup and our own script, never on the vendored files.
   */
  const ours = `${input.html}\n${input.js}`;

  if (rules.maxZipBytes !== null) {
    const kb = (value: number): string => `${(value / 1024).toFixed(1)} kB`;
    checks.push(
      check(
        'zip_size',
        'Pakketgrootte',
        input.totalBytes <= rules.maxZipBytes,
        `${kb(input.totalBytes)} van maximaal ${kb(rules.maxZipBytes)}.`,
      ),
    );
  }

  if (rules.maxFiles !== null) {
    checks.push(
      check(
        'file_count',
        'Aantal bestanden',
        input.fileCount <= rules.maxFiles,
        `${String(input.fileCount)} van maximaal ${String(rules.maxFiles)}.`,
      ),
    );
  }

  /*
   * The file-weight budget is a different number from the platform's ZIP limit
   * and is measured differently: the IAB specification says weights are counted
   * after gzip. A file can sit well inside Google's 600 kB and still be twice
   * what a publisher will accept for that placement.
   */
  checks.push(
    check(
      'file_weight',
      'Bestandsgewicht (gzip)',
      input.gzipBytes <= spec.initialLoadGzipBytes,
      `${(input.gzipBytes / 1024).toFixed(1)} kB van de ${(spec.initialLoadGzipBytes / 1024).toFixed(0)} kB die IAB voor ${input.size} aanhoudt.`,
    ),
  );

  if (rules.requiresAdSizeMeta) {
    const expected = `content="width=${String(spec.widthPx)},height=${String(spec.heightPx)}"`;
    checks.push(
      check(
        'ad_size_meta',
        'Formaat staat in de head',
        input.html.includes('name="ad.size"') && input.html.includes(expected),
        `<meta name="ad.size"> met ${String(spec.widthPx)}×${String(spec.heightPx)}.`,
      ),
    );
  }

  if (rules.clickThrough === 'click_tag') {
    checks.push(
      check(
        'click_tag',
        'Klikdoel',
        input.html.includes('var clickTag = '),
        'var clickTag staat onverkleind in de head, zoals de netwerken vragen.',
      ),
    );
  } else {
    /*
     * Google Ads takes the destination from the campaign's Final URL and
     * refuses multiple exits. A click tag or an exit script in the file is at
     * best ignored and at worst a reason for rejection, so its absence is the
     * thing to check.
     */
    checks.push(
      check(
        'no_own_exit',
        'Geen eigen uitgang',
        !ours.includes('clickTag') && !ours.includes('Enabler'),
        'Het klikdoel komt van de campagne (Final URL); de creative bevat er zelf geen.',
      ),
    );
  }

  const forbidden: [RegExp, string, string][] = [
    [/<iframe\b/iu, 'no_iframe', 'Geen <iframe>'],
    [/<(?:audio|video)\b/iu, 'no_media', 'Geen <audio> of <video>'],
    [/\b(?:localStorage|sessionStorage|indexedDB|openDatabase)\b/u, 'no_storage', 'Geen opslag-API'],
    [/\bdocument\.write\b/u, 'no_document_write', 'Geen document.write'],
  ];
  for (const [pattern, id, titleNl] of forbidden) {
    checks.push(
      check(id, titleNl, !pattern.test(ours), 'Door het sjabloon uitgesloten, hier gemeten.'),
    );
  }

  /*
   * The only external reference the templates ever make is a Google Fonts
   * stylesheet, which every destination in the matrix allows. Anything else
   * would be a bug, and on Google Ads a resource "from unapproved third-party
   * sources" is a named disapproval reason.
   */
  const externals = [...input.html.matchAll(/\b(?:src|href)\s*=\s*"(https?:\/\/[^"]+)"/giu)]
    .map((match) => match[1] ?? '')
    .filter((url) => !url.startsWith('https://fonts.googleapis.com/'));
  checks.push(
    check(
      'no_external_refs',
      'Geen externe verwijzingen',
      externals.length === 0,
      externals.length === 0
        ? 'Alles zit in het bestand; alleen Google Fonts mag extern zijn.'
        : `Gevonden: ${externals.slice(0, 3).join(', ')}`,
    ),
  );

  /*
   * Inline SVG in a Google Ads creative needs explicit end tags — `<path>` and
   * `<path />` are both rejected, only `<path></path>` passes — so a
   * self-closing tag inside an inline SVG is a real rejection, not a nicety.
   */
  if (input.html.includes('<svg')) {
    checks.push(
      check(
        'svg_end_tags',
        'SVG met expliciete sluittags',
        !/<(?:path|rect|circle|line|polygon|polyline|ellipse|use|stop)\b[^>]*\/>/iu.test(input.html),
        'Google weigert <path/> en <path>; alleen <path></path> wordt geaccepteerd.',
      ),
    );
  }

  const extensions = input.fileNames.map((name) => name.slice(name.lastIndexOf('.')));
  checks.push(
    check(
      'file_types',
      'Bestandstypen',
      extensions.every((extension) => rules.allowedExtensions.includes(extension)),
      `${extensions.join(', ')} — toegestaan door ${rules.labelNl}.`,
    ),
  );

  return checks;
}
