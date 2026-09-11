/**
 * SVG inspection.
 *
 * An SVG is not an image; it is an XML document that a browser will happily
 * execute. It can carry `<script>`, event-handler attributes, `<foreignObject>`
 * with arbitrary HTML, external references that fetch on render, and XML
 * entities that expand into a denial of service.
 *
 * This module **rejects** rather than sanitises. That is a deliberate choice:
 * a sanitiser has to enumerate everything dangerous and gets bypassed when it
 * misses one, whereas a rejection only has to be conservative. A brand that
 * cannot upload its logo because the file contains a tracking script is a
 * conversation worth having; a logo that executes on our origin is not.
 *
 * The check is a scan over the decoded text, not a parse. A parser would give
 * better precision and a much larger attack surface — and we do not need
 * precision to say no.
 *
 * Requirement 13: "SVG ve HTML'i güvenilir sayma" — do not treat SVG and HTML
 * as trusted. Threat T-07.
 */

export interface SvgVerdict {
  readonly safe: boolean;
  /** Dutch, user-facing, names what was found without echoing the payload. */
  readonly reasonNl?: string;
  /** For the audit record. Never returned to the client. */
  readonly finding?: string;
}

/**
 * Patterns that disqualify a file.
 *
 * Matched against text with comments removed and whitespace collapsed, so
 * `< script >` and `<!--x-->script` cannot slip through the gap.
 */
const DISQUALIFYING: readonly { pattern: RegExp; finding: string; reasonNl: string }[] = [
  {
    pattern: /<\s*script/iu,
    finding: 'script element',
    reasonNl: 'Dit SVG-bestand bevat een script. Verwijder het script of lever het logo als PNG aan.',
  },
  {
    // Any `on…=` attribute: onload, onclick, onbegin, onmouseover, …
    pattern: /\son[a-z]+\s*=/iu,
    finding: 'event handler attribute',
    reasonNl:
      'Dit SVG-bestand bevat interactieve code (een event handler). Lever het logo aan zonder scripts, of als PNG.',
  },
  {
    pattern: /<\s*foreignObject/iu,
    finding: 'foreignObject element',
    reasonNl:
      'Dit SVG-bestand bevat ingesloten HTML (foreignObject). Lever een eenvoudige vectorversie of een PNG aan.',
  },
  {
    // <!ENTITY …> — the billion-laughs family, and external entity loading.
    pattern: /<!\s*ENTITY/iu,
    finding: 'XML entity declaration',
    reasonNl:
      'Dit SVG-bestand bevat XML-entiteiten. Die worden niet geaccepteerd. Exporteer het logo opnieuw uit je ontwerpprogramma.',
  },
  {
    pattern: /<!\s*DOCTYPE/iu,
    finding: 'DOCTYPE declaration',
    reasonNl:
      'Dit SVG-bestand bevat een DOCTYPE-declaratie. Exporteer het logo opnieuw zonder DOCTYPE, of lever een PNG aan.',
  },
  {
    // Anything that would fetch at render time.
    pattern: /(?:href|xlink:href|src)\s*=\s*["']?\s*(?:https?:|\/\/)/iu,
    finding: 'external reference',
    reasonNl:
      'Dit SVG-bestand verwijst naar een externe bron. Sluit alle onderdelen in het bestand zelf in.',
  },
  {
    pattern: /(?:href|xlink:href|src)\s*=\s*["']?\s*(?:javascript|data)\s*:/iu,
    finding: 'javascript: or data: URI',
    reasonNl:
      'Dit SVG-bestand bevat een niet-toegestane verwijzing. Lever het logo aan zonder ingesloten scripts of data-URI’s.',
  },
  {
    pattern: /<\s*(?:iframe|embed|object|use\s[^>]*xlink:href\s*=\s*["']?\s*https?:)/iu,
    finding: 'embedding element',
    reasonNl: 'Dit SVG-bestand sluit externe inhoud in. Dat wordt niet geaccepteerd.',
  },
  {
    pattern: /<\s*(?:set|animate)[a-z]*\b[^>]*attributeName\s*=\s*["']?\s*(?:href|xlink:href)/iu,
    finding: 'animated href',
    reasonNl: 'Dit SVG-bestand wijzigt verwijzingen tijdens het weergeven. Dat wordt niet geaccepteerd.',
  },
];

/** An SVG must actually contain an `<svg>` root. */
const SVG_ROOT = /<\s*svg[\s>]/iu;

export function inspectSvg(bytes: Buffer): SvgVerdict {
  // A UTF-16 SVG would read as mostly NUL bytes to a UTF-8 decode and could
  // hide a payload from the scan. Refuse anything that is not UTF-8/ASCII.
  if (bytes.includes(0x00)) {
    return {
      safe: false,
      finding: 'NUL byte in SVG (possible UTF-16 or binary smuggling)',
      reasonNl: 'Dit SVG-bestand heeft een onverwachte tekencodering. Exporteer het opnieuw als UTF-8.',
    };
  }

  const raw = bytes.toString('utf8');

  // Strip comments before scanning: `<!--<script>-->` is harmless, but
  // `<!--x-->script` must not be reassembled into something that looks safe.
  // Removing comments and *then* matching is the conservative order.
  const text = raw.replace(/<!--[\s\S]*?-->/gu, ' ');

  if (!SVG_ROOT.test(text)) {
    return {
      safe: false,
      finding: 'no <svg> root element',
      reasonNl: 'Dit bestand is geen geldig SVG-bestand.',
    };
  }

  for (const rule of DISQUALIFYING) {
    if (rule.pattern.test(text)) {
      return { safe: false, finding: rule.finding, reasonNl: rule.reasonNl };
    }
  }

  return { safe: true };
}

/**
 * Whether a text file is safe to store as text.
 *
 * `text/plain` and `text/markdown` are served as attachments, so a browser will
 * not render them. The remaining risk is that markdown is later rendered
 * somewhere in the product, so an HTML payload is refused at the door rather
 * than relied on to be escaped everywhere downstream.
 */
export function inspectText(bytes: Buffer): SvgVerdict {
  if (bytes.includes(0x00)) {
    return {
      safe: false,
      finding: 'NUL byte in a text upload',
      reasonNl: 'Dit tekstbestand bevat binaire gegevens.',
    };
  }
  const text = bytes.toString('utf8');
  if (/<\s*(?:script|iframe|object|embed)\b/iu.test(text)) {
    return {
      safe: false,
      finding: 'active HTML element in a text upload',
      reasonNl: 'Dit tekstbestand bevat HTML-code. Lever platte tekst aan.',
    };
  }
  return { safe: true };
}
