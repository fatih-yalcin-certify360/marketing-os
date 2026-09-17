# The interface: anatomy, components and rules (2026-09-14)

Status: **applied to every screen** on 2026-09-14. This is the reference a
screen is built against; `packages/ui` is the implementation.

## Why a pass over the whole interface

The product had grown screen by screen. Each one opened with three
paragraphs of how-it-works above the first control, put its primary action
wherever the author last touched, styled links browser-blue and headings at
browser sizes, and used a light pill bar for steps and tabs alike. Two pages
written by another agent added raw `<h2>` cards nested in cards. Nothing was
wrong; nothing was the same twice, and a person could not tell at a glance
where they were or what to do.

The pass fixes that with one page anatomy, one set of parts, and the
Certify360 palette as the only colours: deep teal for navigation, purple as
the single action colour, off-white canvas, white cards with a hairline
border, soft status pills. No new colour was introduced.

## Page anatomy

Every screen, top to bottom:

1. **Page header** (`PageHeader`): eyebrow (area · label), title, one-line
   lead of at most 78 characters wide, optional meta row (badges, funnel
   pills), and the actions on the right with **at most one primary button**.
   An object page (a campaign) uses the medium title size.
2. **Explanation behind a toggle** (`Disclosure`, "Hoe werkt dit?"): the
   how-it-works text every screen used to open with. Still there, one click
   away; the controls come first.
3. **Toolbar** (`Toolbar`): filters and search above a list, wrapping on
   narrow screens.
4. **Tabs** (`Tabs`): underline tabs with a count per tab, for peers that are
   not a sequence — Bibliotheek / Uit campagnes, Feiten / Bronnen, the radar's
   views, the studio's kinds of content, the content step's funnel stages.
5. **Cards** (`Card`): title, one-line description, optional action; `muted`
   for secondary information, `accent` (purple hairline) for the one card that
   is now to be acted on, `padding="sm"` inside grids.
6. **Empty state** (`EmptyState`): what would appear here and the way to make
   it, never a bare sentence.
7. **Loading** (`Skeleton`): shimmering lines announced once as busy.

Facts about an object are a **key–value list** (`KeyValue`): small-caps term,
bold value, muted note. Icons (`Icon`) are a sixteen-pixel stroke set in the
current text colour, decorative unless labelled.

## The trail in the top bar

The top bar shows a breadcrumb trail (`shell/breadcrumbs.tsx`): every level
above the current page is a link, the current page is bold and unlinked. The
trail follows the route by default — "Kennis & beheer / Opleidingen" — and a
page that knows more sets its own with `useBreadcrumbs`: the campaign screen
writes "Campagnes / <naam> / 3. Briefing", so the list and the campaign are one
click away from any step. A group without a page of its own (Kennis & beheer)
is text, not a link.

## The campaign chain

The eight steps are a **stepper** (`FlowNavigation` in steps mode): a
numbered disc per step — green with a check when done, filled purple when
current, outlined when upcoming, amber-ringed when something asks for a
second look — and the website branch beside the chain without a number. Each
step card opens with the same head: the number in a disc, the title, the
status badge (Nu aan zet · Afgerond · Nog niet mogelijk · Open); the card
that is now to be acted on carries the accent hairline. One sentence says what
the step is for; the explanation sits behind "Hoe werkt deze stap?". Content
is reviewed one funnel stage at a time behind tabs with a count and an
attention marker.

## Rules

- One primary button per screen and per step card; everything else is
  secondary or ghost. A link styled as a button keeps the button's colours.
- Links are purple with a purple underline; headings and paragraphs take the
  shared sizes; native `<details>` get a turning chevron. A page written
  without the components still looks like the product.
- Status words come from one vocabulary: Concept, Ter beoordeling,
  Goedgekeurd, Opnieuw beoordelen, Gearchiveerd; Nu aan zet, Afgerond, Nog
  niet mogelijk, Open.
- Honesty over polish: demo data stays marked, unverified channels stay
  draft-only, a count is shown only when it was counted, and no screen
  claims a measurement the system did not make.
- The browser smoke's labels are a contract: `ui-smoke-labels.test.ts` fails
  when a label the driver clicks disappears from the sources.

## What changed per screen

| Screen | Change |
| --- | --- |
| Werkruimte | Header with greeting and the two starts (Nieuwe campagne, Marktradar); stat tiles link onward; attention items link to their campaign; the fundament as a key–value list with links; the development test-task form behind a toggle; the six latest tasks with Dutch names and "alle tonen" |
| Campagnes | Shared header; the list from 2026-09-12 unchanged |
| Campagne | Header with eyebrow and meta; the next step as a status line with one small primary button; stepper; step-card heads; explanations behind toggles; content per stage behind tabs |
| Marktradar | Shared header; tabs restyled |
| AI Visibility & GEO | Shared header and tabs; the finished-progress card hidden when a report is shown; the nested page rendered as a section; every plain element on the Certify360 baseline |
| Content Studio | Rewritten: header, toolbar, tabs by kind of content, one card shape for pieces and packages, one status vocabulary, one way out to the campaign |
| Opleidingen | Header with the intake behind the primary action (open when the label has no course); per course tabs Feiten / Bronnen & onderzoek; the empty confirm column no longer prints a dash |
| Doelgroepen | Rewritten: header, toolbar, tabs Bibliotheek / Uit campagnes with counts, a card grid with the three counts as facts, the editor opening under its card |
| Merk & bronnen, Labels & toegang | Shared header; state as a badge in the header |
| Website & interactief (2026-09-15) | Rewritten: the four gates as a checklist with what to do, three numbered actions, each package with tabs and a sandboxed preview frame, embed code with copy button, download, evidence and provenance behind toggles; Google ad lines with a count per line against the limit and the Google Ads frame behind a toggle on the content card and in the channel plan |

## Not done

A mobile navigation drawer (the sidebar stacks above the content under 860px
but does not collapse); dark mode (the palette is light by design); an icon
on every button; per-screen component tests (the repository has no web test
runner; the browser smoke and the label scan stand in).
