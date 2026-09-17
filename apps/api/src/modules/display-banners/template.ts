import {
  BANNER_MAX_DURATION_MS,
  BANNER_PAUSE_THRESHOLD_MS,
  BANNER_PLATFORM_RULES,
  BANNER_SIZES,
  type BannerEngine,
  type BannerFontStrategy,
  type BannerFrame,
  type BannerPlatform,
  type BannerSize,
} from '@c360/contracts';

/**
 * The banner, as the files a banner is actually made of.
 *
 * `index.html`, `style.css`, `main.js` and the assets beside them — the shape
 * every hand-built banner in this trade has, and the shape of the shipped
 * example kept in `reference-banners/`. The first version of this module
 * emitted one self-contained document because that made the file-weight
 * arithmetic easy; it also made the output something no one could open, edit or
 * hand to a media agency. Weight is measured after gzip anyway, and a ZIP
 * compresses four files as well as it compresses one.
 *
 * What the files do is a sequence, not a picture: a loader while the assets
 * arrive, one to three screens that each say a single thing, then an endframe
 * with the call to action that stays for the rest of the impression. The
 * endframe is written into the HTML as the resting state, so a script that
 * never runs leaves a correct still banner rather than an empty rectangle.
 *
 * The model writes the strings. Everything here — the markup, the styles, the
 * timeline — is ours, because this is code that runs on a stranger's page.
 */

/*
 * Type sizes per size. Craft, not specification — no standards body publishes
 * these, and `tools/banner-fit` is what they were checked against.
 *
 * Line height is 1.18: tight enough for a display face to read as deliberate,
 * loose enough that two lines of a serif with deep descenders do not touch.
 * A face whose glyph box exceeds its line box is fine here — nothing in the
 * banner clips, which `tools/banner-fit` checks rather than assumes.
 */
const TYPE: Readonly<
  Record<BannerSize, { line: number; usp: number; cta: number; legal: number; sticker: number }>
> = Object.freeze({
  '300x250': { line: 25, usp: 14, cta: 14, legal: 10, sticker: 12 },
  '336x280': { line: 27, usp: 15, cta: 14, legal: 10, sticker: 12 },
  '300x600': { line: 30, usp: 15, cta: 15, legal: 11, sticker: 13 },
  '160x600': { line: 16, usp: 12, cta: 13, legal: 10, sticker: 0 },
  '728x90': { line: 23, usp: 13, cta: 14, legal: 10, sticker: 11 },
  '320x50': { line: 15, usp: 0, cta: 12, legal: 0, sticker: 0 },
});

/*
 * How long things stay on screen.
 *
 * Set from reading speed, not from a duration target. A Dutch sentence of six
 * to eight words needs somewhere near two seconds to be read rather than
 * glimpsed, and a bullet in a rotating list needs about a second. The first
 * version gave a screen 1,150 ms and then split that between three bullets —
 * 383 ms each, which nobody can read (reported 2026-09-16).
 *
 * The total is what it is; above five seconds the banner ships a pause control,
 * which is the honest way to buy the time.
 */
const LOADER_MS = 400;
/** A screen carrying one or two written lines. */
const TEXT_MS = 1_900;
/*
 * A list of bullets.
 *
 * They stack and stay, rather than replacing each other. Rotating them meant a
 * reader who looked up mid-list had missed what came before and could not get
 * it back; stacked, the screen builds into something you can read in one go
 * (2026-09-16). So the screen needs the time to read the whole list, not the
 * time to read one line.
 */
const USP_ARRIVAL_MS = 420;
const USP_HOLD_MS = 1_300;

/** How long the whole sequence runs, in milliseconds, before the endframe. */
export function sequenceMs(frames: readonly BannerFrame[]): number {
  return frames.reduce((total, frame) => total + frameMs(frame), LOADER_MS);
}

/** How long one screen stays, from what it holds. */
function frameMs(frame: BannerFrame): number {
  return frame.kind === 'usp'
    ? Math.max(1, frame.lines.length) * USP_ARRIVAL_MS + USP_HOLD_MS
    : TEXT_MS;
}

export interface BannerTemplateInput {
  size: BannerSize;
  platform: BannerPlatform;
  engine: BannerEngine;
  fontStrategy: BannerFontStrategy;
  /** The stack for the statement: the display face, where the brand has one. */
  fontStack: string;
  /** The stack for running text — support lines, bullets, small print. */
  bodyStack: string;
  googleFontFamily: string | null;
  /** Brand font files travelling in this package, for the @font-face rules. */
  fontFaces: readonly { name: string; family: string; weight: number; style: 'normal' | 'italic' }[];
  /** The screens before the endframe, already tiered for this size. */
  frames: readonly BannerFrame[];
  /** The line that stays on the endframe beside the button. */
  endlineNl: string;
  ctaText: string;
  stickerNl: string | null;
  legalNl: string | null;
  /** File name of the background image inside the package, or null. */
  backgroundFile: string | null;
  /** File name of the logo inside the package, or null. */
  logoFile: string | null;
  colors: { background: string; foreground: string; accent: string; onAccent: string };
  clickUrl: string | null;
}

export interface BannerParts {
  html: string;
  css: string;
  js: string;
}

/** HTML text and attribute values, escaped. */
function esc(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}

/**
 * A string safe inside a single-quoted JavaScript literal.
 *
 * The click URL is the one piece of caller-supplied text that reaches the
 * script; a URL that closed the literal would be script injection into a file
 * we hand to an ad network. `<` is escaped too, so the value can never end the
 * surrounding `</script>`.
 */
function jsString(value: string): string {
  const escapes: Readonly<Record<string, string>> = {
    '\\': '\\\\',
    "'": "\\'",
    '\n': '\\n',
    '\r': '\\r',
    '<': '\\u003c',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  };
  return `'${value.replace(/[\\'\n\r<\u2028\u2029]/gu, (character) => escapes[character] ?? character)}'`;
}

/** Two colours mixed, as a plain hex, so the file needs nothing from the browser. */
function mix(from: string, to: string, amount: number): string {
  const channels = (hex: string): number[] => {
    const raw = hex.slice(1);
    const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;
    return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
  };
  const a = channels(from);
  const b = channels(to);
  return `#${a
    .map((value, index) => Math.round(value + ((b[index] ?? 0) - value) * amount))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

function frameMarkup(frame: BannerFrame, index: number, uspSize: number): string {
  const body =
    frame.kind === 'usp' && uspSize > 0
      ? `<ul class="uspList">${frame.lines
          .map((line) => `<li class="usp">${esc(line)}</li>`)
          .join('')}</ul>`
      : frame.lines.map((line) => `<p class="line">${esc(line)}</p>`).join('');
  return `<div class="frame" data-kind="${frame.kind}" data-index="${String(index)}">${body}</div>`;
}

export function bannerHtml(input: BannerTemplateInput): string {
  const spec = BANNER_SIZES[input.size];
  const type = TYPE[input.size];
  const rules = BANNER_PLATFORM_RULES[input.platform];

  const adSize = rules.requiresAdSizeMeta
    ? `\n  <meta name="ad.size" content="width=${String(spec.widthPx)},height=${String(spec.heightPx)}">`
    : '';

  /*
   * The click.
   *
   * Google Ads takes the destination from the campaign's Final URL and refuses
   * multiple exits — after the exit script is removed "your entire ad will be
   * clickable" — so for that destination the creative carries no URL at all.
   * Every other network wants `var clickTag` declared in the head, unminified.
   */
  const clickTag =
    rules.clickThrough === 'click_tag' && input.clickUrl !== null
      ? `\n  <script>var clickTag = ${jsString(input.clickUrl)};</script>`
      : '';

  const googleFont =
    input.googleFontFamily === null
      ? ''
      : `\n  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(
          input.googleFontFamily,
        ).replace(/%20/gu, '+')}:wght@400;700&display=swap">`;

  const background =
    input.backgroundFile === null
      ? ''
      : `\n    <img id="bg" src="${esc(input.backgroundFile)}" alt="">\n    <div id="scrim"></div>`;
  const logo =
    input.logoFile === null
      ? ''
      : `\n    <div class="logoPlate"><img id="logo" src="${esc(input.logoFile)}" alt=""></div>`;
  const sticker =
    input.stickerNl === null || type.sticker === 0
      ? ''
      : `\n    <div id="sticker"><span>${esc(input.stickerNl)}</span></div>`;
  const legal =
    input.legalNl === null || type.legal === 0
      ? ''
      : `\n      <p id="disclaimer">${esc(input.legalNl)}</p>`;

  const frames = input.frames
    .map((frame, index) => `\n      ${frameMarkup(frame, index, type.usp)}`)
    .join('');

  /*
   * The arrow is inline SVG with explicit end tags. Google rejects both
   * `<path>` and `<path />` inside an HTML file; only `<path></path>` passes.
   */
  const arrow =
    '<svg class="ctaArrow" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
    '<path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>' +
    '</svg>';

  /*
   * The stop control, where the sequence earns one.
   *
   * WCAG 2.2.2 asks for it once self-starting motion beside other content runs
   * past five seconds. It sits above the click layer so pausing does not also
   * open the advertiser's page, and it is a real button so a keyboard reaches
   * it.
   */
  const pauseControl =
    sequenceMs(input.frames) > BANNER_PAUSE_THRESHOLD_MS
      ? `\n    <button id="pauseButton" type="button" aria-label="Pauzeer de animatie"><span></span></button>`
      : '';

  const scripts =
    input.engine === 'gsap'
      ? '\n  <script src="gsap.min.js"></script>\n  <script src="SplitText.min.js"></script>'
      : '';

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="utf-8">${adSize}
  <title>${esc(input.endlineNl)}</title>
  <link rel="stylesheet" href="style.css">${googleFont}${clickTag}
</head>
<body>
  <div id="banner">${background}${logo}
    <div id="stage">${frames}
      <div id="endframe">
        <p class="endline">${esc(input.endlineNl)}</p>
        <div id="cta"><span class="ctaText">${esc(input.ctaText)}</span>${arrow}</div>${legal}
      </div>
    </div>${sticker}
    <div id="mainExit"></div>${pauseControl}
    <div id="loaderWrapper"><div id="loader"></div></div>
  </div>${scripts}
  <script src="main.js"></script>
</body>
</html>
`;
}

export function bannerCss(input: BannerTemplateInput): string {
  const spec = BANNER_SIZES[input.size];
  const type = TYPE[input.size];
  const { background, foreground, accent, onAccent } = input.colors;
  const horizontal = spec.family === 'horizontal';
  const photo = input.backgroundFile !== null;
  /*
   * The button has to separate from what is behind it.
   *
   * On a photograph that is the accent on a darkened scene. On a brand field
   * the accent *is* the field, so the button inverts to the surface colour —
   * the same two colours, the other way round, rather than a third one nobody
   * approved.
   */
  const ctaFill = photo ? accent : background;
  const ctaInk = photo ? onAccent : accent;
  const pad = spec.paddingPx;
  const logoHeight = Math.round(Math.min(spec.widthPx, spec.heightPx) * 0.13);
  /** The share of a strip's width the logo may take, and the text must leave. */
  const logoShare = 14;
  /** Where the text starts on a strip, clear of the logo. */
  const textLeft = `calc(${String(logoShare)}% + ${String(pad * 2)}px)`;

  /*
   * The brand letter, carried in the package.
   *
   * `font-display: swap` rather than `block`: a banner that shows nothing while
   * a font loads has spent part of its few seconds on a blank rectangle, and
   * the fallback stack is metric-adjacent enough that the swap is not a jolt.
   */
  const faces = input.fontFaces
    .map(
      (face) =>
        `@font-face{font-family:${JSON.stringify(face.family)};src:url(${face.name});font-weight:${String(face.weight)};font-style:${face.style};font-display:swap}`,
    )
    .join('\n');

  return `/* ${input.size} — generated. Edit the campaign, not this file. */
${faces}${faces.length > 0 ? '\n' : ''}*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${String(spec.widthPx)}px;height:${String(spec.heightPx)}px;overflow:hidden}
/* Running text takes the brand's text face; only the statement takes the
   display face. Setting the heading family on the body element put an entire
   banner in a display serif, bullets and small print included (2026-09-16). */
body{font-family:${input.bodyStack};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}

#banner{position:relative;width:${String(spec.widthPx)}px;height:${String(spec.heightPx)}px;
  /* Publishers ask for a contrasting hairline so an ad does not bleed into a
     white page; inside the box, so it cannot push the layout out of bounds. */
  border:1px solid ${mix(background, foreground, 0.22)};
  /*
   * With no photograph the frame is its own field.
   *
   * The first version left the surface colour showing, and on a tall format
   * that is two thirds of a white rectangle with a sentence at the bottom —
   * which reads as a banner that did not finish loading. A brand field fills
   * it, and the text sits on the pair the brand already approved for it.
   */
  background:${photo ? background : `linear-gradient(${horizontal ? '100deg' : '165deg'}, ${accent} 0%, ${mix(accent, foreground, 0.35)} 100%)`};
  color:${photo ? foreground : onAccent};overflow:hidden}

#bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
/* Type over a photograph needs its own ground, or contrast is whatever the
   picture happens to be at that pixel. */
#scrim{position:absolute;inset:0;background:linear-gradient(${horizontal ? '90deg' : '180deg'},
  ${mix(background, foreground, 0.02)}f2 0%, ${mix(background, foreground, 0.02)}d9 55%, ${mix(background, foreground, 0.02)}8c 100%)}

/*
 * The logo, and the room the text has to leave for it.
 *
 * On a strip the gutter used to be reserved from the logo's *height*, and a
 * wordmark is four to six times wider than it is tall — so the headline ran
 * straight over the logo on 728x90. The reservation is now a share of the
 * width and the image is bound by that same share, so the two cannot disagree
 * whatever shape the logo turns out to be (2026-09-16).
 */
.logoPlate{position:absolute;left:${String(pad)}px;z-index:3;
  ${horizontal ? `top:50%;transform:translateY(-50%);width:${String(logoShare)}%;display:flex;align-items:center` : `top:${String(pad)}px`}}
#logo{display:block;${horizontal
  ? `max-width:100%;max-height:${String(Math.round(spec.heightPx * 0.44))}px;width:auto;height:auto`
  : `height:${String(logoHeight)}px;width:auto`}}

#stage{position:absolute;inset:0;padding:${String(pad)}px;z-index:2;
  display:flex;flex-direction:${horizontal ? 'row' : 'column'};
  align-items:${horizontal ? 'center' : 'flex-start'};
  justify-content:${horizontal ? 'space-between' : 'flex-end'};
  ${horizontal && input.logoFile !== null ? `padding-left:${textLeft};` : ''}
  ${!horizontal && input.logoFile !== null ? `padding-top:${String(pad * 2 + logoHeight)}px;` : ''}}

/* Every screen occupies the same box; only one is visible at a time. The
   endframe is the one the document rests in when no script runs. */
.frame{position:absolute;left:${String(pad)}px;right:${String(pad)}px;
  ${horizontal ? 'top:50%;transform:translateY(-50%);' : `bottom:${String(pad + Math.round(type.cta * 3.2))}px;`}
  ${horizontal && input.logoFile !== null ? `left:${textLeft};` : ''}
  ${horizontal ? `right:${String(pad * 2 + Math.round(type.cta * 9))}px;` : ''}
  opacity:0;pointer-events:none}

.line{font-family:${input.fontStack};font-size:${String(type.line)}px;line-height:1.18;font-weight:700;letter-spacing:-0.01em;text-wrap:balance}
.line + .line{font-family:${input.bodyStack};margin-top:${String(Math.round(type.line * 0.22))}px;font-weight:400;font-size:${String(Math.round(type.line * 0.62))}px;line-height:1.3}

.uspList{list-style:none;display:flex;flex-direction:column;gap:${String(Math.round(type.usp * 0.45))}px}
.usp{font-size:${String(type.usp)}px;line-height:1.28;font-weight:400;opacity:0;
  display:flex;align-items:baseline;gap:${String(Math.round(type.usp * 0.45))}px}
.usp::before{content:"";flex:0 0 auto;width:${String(Math.round(type.usp * 0.42))}px;height:${String(Math.round(type.usp * 0.42))}px;
  border-radius:50%;background:${photo ? accent : onAccent};transform:translateY(-0.1em)}

#endframe{position:absolute;left:${String(pad)}px;right:${String(pad)}px;
  ${horizontal ? 'top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:' + String(pad) + 'px;justify-content:space-between;' : `bottom:${String(pad)}px;`}
  ${horizontal && input.logoFile !== null ? `left:${textLeft};` : ''}
  opacity:0}
.endline{font-family:${input.fontStack};font-size:${String(type.line)}px;line-height:1.18;font-weight:700;letter-spacing:-0.01em;text-wrap:balance;
  ${horizontal ? 'flex:1 1 auto;min-width:0;' : `margin-bottom:${String(Math.round(type.cta * 0.9))}px;`}}

#cta{display:inline-flex;align-items:center;gap:${String(Math.round(type.cta * 0.45))}px;flex:0 0 auto;
  font-family:${input.fontStack};background:${ctaFill};color:${ctaInk};font-size:${String(type.cta)}px;line-height:1;font-weight:700;
  padding:${String(Math.round(type.cta * 0.72))}px ${String(Math.round(type.cta * 1.05))}px;white-space:nowrap}
.ctaArrow{width:${String(Math.round(type.cta * 1.05))}px;height:${String(Math.round(type.cta * 1.05))}px;display:block}

#disclaimer{font-size:${String(type.legal)}px;line-height:1.2;opacity:.75;margin-top:${String(Math.round(type.legal * 0.5))}px}

#sticker{position:absolute;right:${String(pad)}px;top:${String(pad)}px;z-index:3;
  background:${ctaFill};color:${ctaInk};border-radius:50%;
  width:${String(Math.round(type.sticker * 5))}px;height:${String(Math.round(type.sticker * 5))}px;
  display:flex;align-items:center;justify-content:center;text-align:center;
  font-family:${input.fontStack};font-size:${String(type.sticker)}px;line-height:1.3;font-weight:700;padding:4px}

/* One click layer over the whole ad, the way every hand-built banner does it. */
#mainExit{position:absolute;inset:0;z-index:5}

/*
 * The stop control. Above the click layer, so pausing is not also a click
 * through to the advertiser, and sized to stay reachable by a finger.
 */
#pauseButton{position:absolute;right:${String(pad)}px;bottom:${String(pad)}px;z-index:6;
  width:20px;height:20px;padding:0;border:0;border-radius:50%;cursor:pointer;
  background:${photo ? background : onAccent};opacity:.75;
  display:flex;align-items:center;justify-content:center}
#pauseButton:hover,#pauseButton:focus-visible{opacity:1}
#pauseButton:focus-visible{outline:2px solid ${photo ? accent : background};outline-offset:2px}
#pauseButton span{display:block;width:7px;height:8px;
  border-left:2.5px solid ${photo ? foreground : accent};border-right:2.5px solid ${photo ? foreground : accent}}
#pauseButton.is-paused span{width:0;height:0;border:0;
  border-left:8px solid ${photo ? foreground : accent};border-top:5px solid transparent;border-bottom:5px solid transparent;
  margin-left:2px}
.js #pauseButton{display:flex}
#pauseButton{display:none}
@media (prefers-reduced-motion:reduce){.js #pauseButton{display:none}}

#loaderWrapper{position:absolute;inset:0;z-index:6;background:${photo ? background : accent};
  display:flex;align-items:center;justify-content:center;pointer-events:none}
#loader{width:${String(Math.round(Math.min(spec.widthPx, spec.heightPx) * 0.14))}px;
  height:${String(Math.round(Math.min(spec.widthPx, spec.heightPx) * 0.14))}px;
  border:3px solid ${photo ? mix(background, foreground, 0.16) : mix(accent, onAccent, 0.3)};
  border-top-color:${photo ? accent : onAccent};
  border-radius:50%;animation:spin .9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/*
 * No script, no problem: the endframe is visible and the loader is gone. The
 * script hides the endframe itself before the first paint, so this is also the
 * state a thrown exception leaves behind.
 */
#endframe{opacity:1}
#loaderWrapper{display:none}
.js #endframe{opacity:0}
.js #loaderWrapper{display:flex}

@media (prefers-reduced-motion:reduce){
  .js #endframe{opacity:1}
  .js #loaderWrapper{display:none}
  #loader{animation:none}
}
`;
}

export function bannerJs(input: BannerTemplateInput): string {
  const rules = BANNER_PLATFORM_RULES[input.platform];
  const exit =
    rules.clickThrough === 'click_tag' && input.clickUrl !== null
      ? `  var exit = document.getElementById('mainExit');
  exit.style.cursor = 'pointer';
  exit.addEventListener('click', function () { window.open(clickTag); });
`
      : `  // This destination owns the click: the whole ad is the exit and a URL
  // inside the creative would be a second one, which it refuses.
`;

  /*
   * The schedule, worked out here rather than in the banner.
   *
   * Each screen gets the time its content needs — a written line about two
   * seconds, a bullet in a rotating list about one — so the arithmetic depends
   * on what the screenplay says. Doing it server-side keeps the shipped script
   * to walking a list, and lets the builder know the total before it decides
   * whether a pause control is required.
   */
  let at = LOADER_MS;
  const plan = input.frames.map((frame) => {
    const duration = frameMs(frame);
    const entry = { at: at / 1000, duration: duration / 1000 };
    at += duration;
    return entry;
  });
  const endAt = at / 1000;
  const needsPause = at > BANNER_PAUSE_THRESHOLD_MS;

  const planLiteral = `[${plan
    .map((entry) => `{at:${entry.at.toFixed(2)},dur:${entry.duration.toFixed(2)}}`)
    .join(',')}]`;

  const pause = needsPause
    ? `
  /*
   * A way to stop it.
   *
   * Required by WCAG 2.2.2 once motion that starts by itself runs past five
   * seconds beside other content, which a banner in a page always is. Cheap,
   * and the alternative is copy nobody has time to read.
   */
  var pauseButton = document.getElementById('pauseButton');
  if (pauseButton) {
    pauseButton.addEventListener('click', function (event) {
      event.stopPropagation();
      if (tl.paused()) { tl.play(); pauseButton.setAttribute('aria-label', 'Pauzeer de animatie'); }
      else { tl.pause(); pauseButton.setAttribute('aria-label', 'Hervat de animatie'); }
      pauseButton.classList.toggle('is-paused', tl.paused());
    });
  }
`
    : '';

  const timeline =
    input.engine === 'gsap'
      ? `  gsap.registerPlugin(SplitText);
  var plan = ${planLiteral};
  var tl = gsap.timeline({ paused: true });
  tl.to('#loaderWrapper', { opacity: 0, duration: 0.25, onComplete: function () {
    document.getElementById('loaderWrapper').style.display = 'none';
  } }, ${(LOADER_MS / 1000).toFixed(2)});

  var frames = document.querySelectorAll('.frame');
  for (var i = 0; i < frames.length; i += 1) {
    var frame = frames[i];
    var step = plan[i];
    var usps = frame.querySelectorAll('.usp');
    tl.to(frame, { opacity: 1, duration: 0.01 }, step.at);
    if (usps.length > 0) {
      /*
       * The list builds and stays.
       *
       * Each bullet arrives under the last and none of them leave, so the
       * screen ends as a list somebody can read in one go. They used to
       * replace each other, which meant a reader who looked up had missed the
       * earlier ones with no way back.
       */
      tl.fromTo(usps, { opacity: 0, y: 6 }, {
        opacity: 1, y: 0, duration: 0.34, ease: 'power2.out',
        stagger: ${(USP_ARRIVAL_MS / 1000).toFixed(2)},
      }, step.at);
    } else {
      // Word by word, which is what separates a banner that was made from a
      // banner that was filled in.
      var lines = frame.querySelectorAll('.line');
      for (var l = 0; l < lines.length; l += 1) {
        var split = new SplitText(lines[l], { type: 'words' });
        tl.fromTo(split.words, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.07, ease: 'power2.out' }, step.at + l * 0.18);
      }
    }
    if (i < frames.length - 1) tl.to(frame, { opacity: 0, duration: 0.25 }, step.at + step.dur - 0.25);
  }

  if (frames.length > 0) tl.to(frames[frames.length - 1], { opacity: 0, duration: 0.25 }, ${endAt.toFixed(2)} - 0.25);
  tl.to('#endframe', { opacity: 1, duration: 0.35, ease: 'power2.out' }, ${endAt.toFixed(2)});

  // A ceiling whatever the screenplay asks for: scaled down as a whole, so the
  // last screen is never the one that gets cut off.
  var budget = ${String(BANNER_MAX_DURATION_MS)} / 1000;
  if (tl.duration() > budget) tl.timeScale(tl.duration() / budget);
${pause}  tl.play();
`
      : `  // No library at this size: the file-weight budget is smaller than the
  // library, and one crossfade is the right design for a strip anyway.
  var plan = ${planLiteral};
  var loader = document.getElementById('loaderWrapper');
  var endframe = document.getElementById('endframe');
  var frames = document.querySelectorAll('.frame');
  loader.style.transition = 'opacity .25s linear';
  endframe.style.transition = 'opacity .35s ease-out';
  for (var i = 0; i < frames.length; i += 1) frames[i].style.transition = 'opacity .3s ease-out';
  setTimeout(function () { loader.style.opacity = '0'; }, ${String(LOADER_MS)});
  setTimeout(function () { loader.style.display = 'none'; }, ${String(LOADER_MS + 250)});
  for (var f = 0; f < frames.length; f += 1) {
    (function (frame, step, last) {
      setTimeout(function () { frame.style.opacity = '1'; }, step.at * 1000);
      if (!last) setTimeout(function () { frame.style.opacity = '0'; }, (step.at + step.dur) * 1000 - 250);
    })(frames[f], plan[f], f === frames.length - 1);
  }
  setTimeout(function () {
    if (frames.length > 0) frames[frames.length - 1].style.opacity = '0';
    endframe.style.opacity = '1';
  }, ${(endAt * 1000).toFixed(0)});
`;

  return `/* ${input.size} — generated. ${String(input.frames.length)} screen(s), then the endframe. */
(function () {
  'use strict';

  /*
   * Hide the endframe before the first paint.
   *
   * The stylesheet rests in the finished state, so a browser that never runs
   * this file still shows a correct banner. Adding the class is what makes the
   * animation possible; removing it again is what a thrown exception does.
   */
  var root = document.documentElement;
  root.className = 'js';

  function stand() { root.className = ''; }

  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stand();
      return;
    }
  } catch (e) { stand(); return; }

${exit}
  // IAB asks an in-page banner to wait for the load event before it animates,
  // so the animation does not compete with the page for the same milliseconds.
  window.addEventListener('load', function () {
    try {
${timeline
  .split('\n')
  .map((line) => (line.length > 0 ? `  ${line}` : line))
  .join('\n')}
    } catch (e) {
      stand();
    }
  });
})();
`;
}

/**
 * The three files for one size.
 *
 * Kept together because they are written against each other: the script looks
 * for the class names the markup carries and the stylesheet's resting state is
 * what the script suppresses.
 */
export function bannerParts(input: BannerTemplateInput): BannerParts {
  return { html: bannerHtml(input), css: bannerCss(input), js: bannerJs(input) };
}

/**
 * The same banner as one document, for the preview frame.
 *
 * A preview runs in a sandboxed `srcdoc` frame, which has no origin and
 * therefore cannot resolve `style.css` next to it. So the parts are folded into
 * one document — from exactly the same strings the package contains, never a
 * second rendering path, because a preview built differently is a preview of
 * something else.
 */
export function inlinedPreview(
  parts: BannerParts,
  libraries: readonly string[],
  assets: Readonly<Record<string, string>>,
): string {
  let html = parts.html
    .replace('<link rel="stylesheet" href="style.css">', `<style>\n${parts.css}\n</style>`)
    .replace(
      '<script src="main.js"></script>',
      `<script>\n${libraries.join('\n')}\n${parts.js}\n</script>`,
    )
    .replace(/\n\s*<script src="(?:gsap|SplitText)\.min\.js"><\/script>/gu, '');
  for (const [file, dataUri] of Object.entries(assets)) {
    html = html.replaceAll(`src="${file}"`, `src="${dataUri}"`);
    // Fonts arrive through `url(...)` in an @font-face rule, not through src.
    html = html.replaceAll(`url(${file})`, `url(${dataUri})`);
  }
  return html;
}
