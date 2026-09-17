# Certify360 Design System

The design system for **Certify360 EdTech Group** — a Rotterdam-based education-technology company specialising in mandatory professional education, certification and examination (Continuing Professional Education / CPE). The group unites several accredited Dutch academies under one brand and runs an **AI-powered certification-prep platform**.

> "Certify with confidence." Personalised learning that tracks progress, identifies gaps, and gets professionals exam-ready.

## Products represented
- **certify360.ai** — the AI-powered personalised learning platform (dashboard, courses, practice exams, progress). Modelled in `ui_kits/learning-platform/`.
- **certify360.com** — the corporate group marketing site housing the brand family. Modelled in `ui_kits/marketing-site/`.
- **Sub-brands (the group):** Learncare Academy, Examenadviesburo, WWZ Academie, CS Opleidingen, Nederlands Compliance Instituut.

## Sources provided
- `uploads/Certify360-diap.png` — the primary logo, supplied as a **single white ("diap"/reversed) master** on transparency. Copied to `assets/logo-certify360-white.png`; ink and violet variants were derived programmatically (see Iconography → Logo).
- Brand colours supplied directly: `#9784fa`, `#7a69d3`, `#183037`.
- Public product copy referenced from certify360.com / certify360.ai for tone and content (no codebase or Figma was attached).

⚠️ **No codebase or Figma file was provided.** Components and UI kits are an original, faithful interpretation built from the logo, the three brand colours and public product copy — not a pixel recreation of a live product. Treat values as a considered starting point, not measured truth. **Fonts are the real brand faces** (At Gambit, TT Firs Neue, Plus Jakarta Sans — supplied and self-hosted under `assets/fonts/`).

---

## CONTENT FUNDAMENTALS
How Certify360 writes.

- **Voice:** confident, professional, reassuring — an expert peer, not a hype machine. The register is British-European English ("programmes", "specialised", "recognised").
- **Person:** speaks to the reader as **"you"** ("prove your expertise", "take the learning journey with you"); refers to the company as **"we" / "our"** ("our mission", "we analyse your skills").
- **Casing:** sentence case everywhere — headlines, buttons, nav. Reserve ALL-CAPS for small eyebrow/overline labels only (with letter-spacing).
- **Tone words:** *confident, capable, impactful, measurable, personalised, accredited, compliant, end-to-end.* Trust and rigour lead; "AI-powered" is the modern edge.
- **Signature phrases:** "Certify with confidence", "end-to-end certification through education & examination", "mandatory professional education", "become confident, capable, and impactful".
- **Emoji:** none. This is a compliance-and-certification brand; emoji would undercut credibility. Use icons instead (see Iconography).
- **Numbers & proof:** concrete and credible — pass rates ("94%"), people certified ("72,000+"), CPE points, accreditations (NRTO, CRKBO, KIWA). Don't invent vanity metrics.
- **CTAs:** short, action-first verbs — "Start free", "Get started", "Take practice exam", "Sign in". Often paired with a right-arrow icon.
- **Examples of good copy:**
  - Hero: *"Certify with confidence. End-to-end professional education and examination — one platform that keeps you compliant, certified and ready."*
  - AI nudge: *"You scored 61% here. 15 targeted questions should close the gap."*
  - Feature: *"AI analyses your answers, finds knowledge gaps and adapts the path to your exam date."*

---

## VISUAL FOUNDATIONS

**Colour.** Two brand pillars: **violet** (`--brand` #7a69d3, light accent #9784fa) and **deep teal ink** (`--ink` #183037). Violet is the action/energy colour (buttons, progress, highlights, the "360" motif); teal ink is authority — body text, dark surfaces, sidebars, footers. Neutrals are cool, subtly shifted toward teal. Semantic set: green success, amber warning, red danger, blue info. Backgrounds are predominantly light (`--surface-page` near-white, `--surface-card` white); dark teal is used deliberately for anchoring panels (sidebar, footer, login art). See `tokens/colors.css`.

**Type.** Three self-hosted brand faces (`tokens/fonts.css`). Display = **At Gambit** (refined display serif) — the primary face, used *only* as the main headline in external communications and always at a commanding scale (H1–H4); it carries authority and credibility. Title = **TT Firs Neue** (modern, technical sans) — the secondary face for smaller headings, labels, tags and interactive elements such as buttons, and the lead face inside the digital products (H5–H6, UI). Body = **Plus Jakarta Sans** (open humanist sans) — all body and long-form reading copy. Mono = **JetBrains Mono** (a functional addition for codes/scores/tabular data — not a brand face). Hierarchy: H1 76/92 · H2 64/78 · H3 40/48 · H4 28/34 (At Gambit) · H5 24/30 · H6 18/22 (TT Firs Neue) · Body XL 22/34 · Body 18/28 · Body small 16/24 (Plus Jakarta Sans). Eyebrows are 12px bold, uppercase, +0.08em, TT Firs Neue in brand violet. Families: `--font-display`, `--font-title`, `--font-body`, `--font-mono`; role tokens `--h1-size`…`--body-sm-lh` in `tokens/typography.css`.

**Spacing & layout.** 4px base grid (`--space-*`). Generous section padding (~88px vertical on marketing). Content maxes out around 1320px (`--container-xl`). Cards and grids use `gap`, never ad-hoc margins.

**Corner radii.** The brand leans **generously rounded** — a direct echo of the outlined "360" pill in the logo. Inputs/buttons 12px, cards 16px, feature tiles & modals 24–32px, and full **pill** (999px) for primary CTAs, badges, tags and progress tracks.

**Backgrounds.** Mostly flat light surfaces. The signature decorative treatment is a **violet→teal diagonal gradient** (`linear-gradient(~150deg, violet, teal-ink)`) used on the hero, login art, course video posters and the closing CTA panel. No photography is shipped with this system (none was provided); UI kits use gradient panels and `image-slot`-style placeholders where imagery would go. No repeating patterns or grain.

**Shadows.** Soft and **teal-tinted** (shadow colour derived from #183037, not pure black), climbing xs→xl. A dedicated `--shadow-brand` violet glow sits under primary CTAs and gradient panels. Elevation is used sparingly — cards rest on `sm`, lift to `lg` on hover.

**Borders.** Hairline 1px `--border-subtle`/`--border-default` (cool grey). Selected/active states switch the border to brand violet. Dividers inside cards are 1px subtle rules.

**Corners of interaction — states.**
- **Hover:** buttons lift 1px (`translateY(-1px)`) and darken one step (violet-600→700); cards raise their shadow and lift 2px; links shift to violet-700 / gain underline.
- **Press/active:** darken a further step (violet-800); no scale-down.
- **Focus:** 3px soft violet ring (`--ring`, rgba(151,132,250,.45)) plus a violet border — never removed.
- **Disabled:** 50% opacity, `not-allowed` cursor.

**Motion.** Purposeful and quick, never bouncy. Standard ease `cubic-bezier(0.32,0.72,0,1)`; out-ease for entrances. Durations 120/200/360ms. Progress bars ease their width; dialogs/toasts fade-and-rise (`c360-fade-in`). Respect `prefers-reduced-motion`. No infinite decorative loops.

**Transparency & blur.** Sticky nav uses `rgba(255,255,255,.85)` + `backdrop-filter: blur(12px)`. Dialog scrim is teal ink at 50% with a 3px blur. On dark gradient panels, white is layered at 6–22% opacity for inset cards and pills.

**Cards.** White surface, 1px subtle border, 16px radius, soft `sm` shadow; `interactive` cards add a hover lift. This is the atomic container for course cards, stats, brand tiles and dashboard widgets.

---

## ICONOGRAPHY
- **System:** [**Lucide**](https://lucide.dev) — clean 2px-stroke, rounded-cap outline icons that match the brand's rounded-geometric character. No icon set was provided, so Lucide is the chosen standard (loaded from CDN in UI kits: `unpkg.com/lucide`). ⚠️ *Substitution — flag for confirmation.*
- **Usage:** stroke ~2–2.2px, sizes 14–22px inline; icons inherit `currentColor`. Buttons pair a label with a leading or trailing icon (right-arrow is the signature "forward" affordance). `IconButton` for icon-only controls. Small component glyphs (checkmarks, chevrons, close ✕, alert marks) are inline SVG inside the React components so they need no runtime dependency.
- **Emoji:** never used.
- **Unicode as icons:** avoided; the "360" pill is treated as a brand motif rendered in type, not an icon.
- **Logo:** the **official brand logotype**, embedded as a live component (`components/brand/Logo.jsx`) from the supplied vectors (`assets/logo/certify360-*.svg`). Two variants: **wordmark** (`variant="wordmark"`, default — Certify360 only, the everyday lockup) and **full** (`variant="full"` — adds the payoff tagline “EdTech Group”, for corporate/organisational contexts). Two tones: **dark** (ink #27434F, for light backgrounds) and **light**/diapositive (white, for teal/violet/dark/imagery). `size` sets the rendered height. Keep clearspace ≈ the “360” badge height; min width ≈ 120px. Don't recolour, stretch, add effects, or split the badge from the wordmark. Legacy raster masters remain under `assets/` for cases needing a flat PNG.

---

## Index / manifest

**Root**
- `styles.css` — the single entry point consumers link. `@import`s only.
- `tokens/` — `colors.css`, `typography.css`, `layout.css` (spacing/radii/shadow/motion), `base.css` (element defaults, keyframes, link colours).
- `assets/` — logo variants (white / ink / purple) and self-hosted brand `fonts/`.
- `readme.md` — this file. `SKILL.md` — Agent-Skills wrapper.

**Components** (`window.Certify360DesignSystem_8724b4.<Name>`)
- Brand: **Logo**
- Actions: **Button**, **IconButton**
- Brand: **Logo**
- Forms: **Input**, **Select**, **Checkbox**, **Radio**, **Switch**
- Data display: **Card**, **Badge**, **Tag**, **Avatar**, **Progress**, **Stat**
- Feedback: **Alert**, **Dialog**, **Toast**, **Tooltip**
- Navigation: **Tabs**

Each component directory has `<Name>.jsx`, `<Name>.d.ts`, `<Name>.prompt.md` and one `@dsCard` demo HTML.

**Intentional additions** (beyond a from-scratch default set, justified by the product):
- **Progress** & **Stat** — the learning platform is progress- and metric-centric (course completion, scores, CPE points); these are core, not decorative.
- **Avatar** — learner identity in the app shell.

**UI kits**
- `ui_kits/learning-platform/` — certify360.ai app: `index.html` (interactive: login → dashboard → course → AI-graded practice exam), `shell.jsx`, `screens.jsx`, `app.jsx`.
- `ui_kits/marketing-site/` — certify360.com: `index.html` + `sections.jsx` (nav, hero, features, brand family, CTA, footer, trial dialog).

**Foundation cards** — in `guidelines/`, tagged `@dsCard`, grouped Colors / Type / Spacing / Brand.

## Known gaps / asks
- **Icons are Lucide** by choice, not confirmed brand standard.
- **No photography or illustration** was provided — kits use gradient panels/placeholders.
