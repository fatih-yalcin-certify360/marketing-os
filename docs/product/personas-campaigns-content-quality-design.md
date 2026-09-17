# Personas that accumulate, a campaigns list that shows state, content that reads as written — design

Status: **built, 2026-09-12.** Three slices. They were to be built in parallel
by three implementation agents with strict file ownership; all three stopped
on the account's spend limit after about thirteen minutes, leaving coherent
partial work in seven files (persona keys, scopes, promotion, the prompt rule
and the length schema). That work was kept and the rest was built by hand.
`npm run verify` and `npm run smoke` decided when it was done; the PLATFORM
document's section of the same date records what shipped and what did not.

## Why these three, now

Three complaints from the same afternoon of real use, each traced to code:

1. **"Saved personas exist, new ones are not added, and I cannot change the
   existing ones."** A proposal derives the persona identity from
   `campaign:slug(name)`; a second proposal in the same campaign that returns a
   similar name becomes *version 2* of the same identity and the list, which
   shows the latest version per identity, does not grow. The model is never
   told which audiences already exist, so it repeats them. Campaign-scoped
   personas are listed nowhere editable: the library page shows only
   library personas, the campaign step has no edit affordance, although the
   PATCH route exists.
2. **"The campaigns page is not up to standard."** The create form sits above
   the list, the only status is a stale server enum (`campaign.stage` stops at
   "production"), there is no next step, no course name, no last activity, no
   filter, no sort, no role awareness.
3. **"Content is thin, copy-pasted, without keywords or hashtags; a two-line
   landing page is not acceptable."** The schema allows a one-character body
   and zero sections; the prompt says "3 to 5 sections" and immediately allows
   leaving them out; `channelNotes` tells long-form channels to "keep it
   short"; nothing checks minimum length, keyword use, hashtags, repetition
   across channels or verbatim recitation of the course card; keyword research
   never reaches a prompt; the course's own page URL never reaches a prompt.

## Slice P — personas that accumulate and can be corrected

**Identity.** `PersonaService.propose` passes an explicit `personaKey` of the
form `${campaignId ?? courseVersionId}:${runToken}:${slug(name)}` where
`runToken` is the first eight characters of the job id, or a random UUID when
the service is called outside a job. Every proposal appends identities. `edit`
keeps the key, so an edit is still version n+1 of the same identity and still
flags briefs pinned to older versions.

**The model sees what exists.** `propose` loads the library personas of the
course and the campaign's own personas and hands their names and summaries to
the prompt under `<bestaande_doelgroepen>`. Rule (Dutch, `persona.propose` v5):
propose only audiences that differ materially from those listed; if no other
audience can be grounded, deliver fewer and say so in `shortfallReasonNl`. In
code, a proposal whose normalised name equals an existing name in scope is
skipped and counted in the shortfall reason; the mock varies its names by the
number of existing personas so the demo path also appends.

**Contract.** `personaVersion` exposes `personaKey` and `campaignId`
(nullable) so the interface can tell "bibliotheek" from "deze campagne" and
group versions without a second query. The list route accepts
`scope=library|campaign|all` (default keeps today's behaviour); `all` returns
library and every campaign's personas of the course, each with `campaignId`.

**Promotion.** `POST /labels/:labelId/personas/:id/library` copies a campaign
persona into the library: new identity, `campaignId: null`, origin `user`,
grounding and questionnaire preserved, a grounding entry recording which
campaign it came from. The original stays where it is.

**Screen.** In the Doelgroep step:
- rows order: new from the last proposal (from the job result's `personaIds`,
  badge "Nieuw"), then this campaign's, then library, then brief-pinned
  versions no longer current;
- a per-row **Bewerken** (writable roles) opens the shared `PersonaEditor`
  inline (extracted from the library page, same fields and questionnaire);
  saving creates the next version through the PATCH route, the selection
  follows the new id, and when a brief is pinned the existing
  `needs_rereview` hint appears with the existing re-draft action;
- **Opslaan in bibliotheek** on campaign rows;
- the propose button is disabled while the tracked job is queued or running,
  and when a run adds nothing the step says so with the shortfall reason.

The library page gains a second list, "Voorgesteld in campagnes", from
`scope=all`, with the same editor and the promotion action.

**Tests.** A second proposal appends identities and the campaign list grows;
a name equal to an existing one is skipped and named in the shortfall; an edit
of a persona pinned by an approved brief flips the brief to `needs_rereview`
and the list shows only the new version; promotion yields a library persona
with provenance; `scope=all` returns both kinds.

**Addendum 2026-09-14 — every question answered.** A proposed persona's
questionnaire now answers all 36 questions: *uit bron* (a literal passage and
its reference) or *door AI afgeleid* (an assumption with the model's
reasoning in `reasoningNl`); every cell carries `origin`. What the model
leaves open is an explicit system cell, and an estimated age is replaced by
the statement that age is not derivable. Stored personas are completed by a
person through `persona.fill_questionnaire`, which changes only the open
cells and keeps identity and origin. Details in PLATFORM.md, section "Every
persona question answered".

## Slice K — a campaigns list that shows where each campaign stands

**One rule for progress.** `packages/contracts/src/campaign-progress.ts`
exports `campaignProgress(input): CampaignProgress` — the pure function behind
the detail page's `nextStepFor`, with the same eight steps and Dutch actions.
Input is a small shape the server can fill with set-based queries: entry mode,
opportunity present, latest brief state and approval, pinned persona count,
selected concept present, latest plan state, asset states, export present,
outcomes present. Output: `nextStepId`, `nextStepNumber`, `nextActionNl`,
`doneStepIds`, `attention` (any `needs_rereview`), `lastActivityAt`.

**List route.** `GET /labels/:labelId/campaigns` items gain `progress` and
`courseName`, computed per label with grouped queries (latest brief per
campaign, approved brief, selected concept, latest plan, asset state counts,
export count, outcome count) — never a detail call per row. The route accepts
`limit` and `cursor` from `pagination.ts`; the body keeps `userIdea` and
`suppliedBrief` off the list rows.

**Screen** (`/campagnes`), in the pattern of the redesigned pages:
- header: title, one-line lead, one primary button **Nieuwe campagne** that
  reveals the existing form (open by default when the label has no campaign);
  viewers see neither;
- toolbar: section title with the count, search on name, selects for next
  step, objective and course, sort (last changed default, name, created);
- the list as a table inside `.c360-table-scroll` on wide screens and as cards
  under 720px: name (link to `/campagnes/:id?fase=<nextStepId>`), course,
  objective with small funnel pills, next step as a badge (purple "Nu aan zet",
  amber "Opnieuw beoordelen", green "Afgerond"), progress "n van 8", last
  changed;
- empty states with a call to action and a link to the courses page; a
  courses error no longer masquerades as "no course yet";
- stale copy fixed: eight step names everywhere, the success notice names the
  real next step for the entry mode, the Content Studio deep link points at
  `?fase=content`.

The smoke driver opens the form through **Nieuwe campagne** first; every label
it depends on stays or is updated together with `ui-smoke-labels.test.ts`.

**Tests.** The list returns campaigns newest-first with `progress` for a
campaign at each of several steps; `campaignProgress` unit tests per branch.

## Slice C — content that is long enough, specific, findable and shareable

**Length is a contract.** `channelGuidance` gains per-channel minimums:
landing page (website) total ≥ 500 words in 4–6 sections of ≥ 120 words;
e-mail 2–4 sections, total ≥ 180 words; LinkedIn body ≥ 80 words; Facebook
≥ 60; Instagram ≥ 40; adverts unchanged. `checkContentQuality(copy, channel,
stage, context)` in `content-assets/quality.ts` returns typed warnings
(`body_too_short`, `sections_missing`, `hashtags_missing`,
`keywords_missing`, `copied_fact_sentence`, `repeated_across_pieces`,
`page_excerpt_not_found`, `alt_text_missing`) that block publish-ready; for
the website and e-mail pieces a too-short result is `provider_invalid_output`
and goes through the repair loop rather than being stored.

**The website piece is either a page change or an article.** The channel id
`landing_page` stays; its copy gains `website`, a discriminated union:
- `course_page_update`: `pageUrl`, 1–6 `changes` of `{placement, reason,
  currentExcerpt, proposedText ≥ 80 words}`; every `currentExcerpt` must occur
  literally in the fetched course page text or the piece is repaired;
- `blog_article`: `title`, `metaDescription` 80–160 characters, `intro`,
  3–6 sections of ≥ 120 words, 2–4 FAQ, `internalLinkText`, total ≥ 700 words.
The live course page (`courseVersion.courseUrl`) is fetched through the
existing SSRF-guarded fetch and readable-text extraction and handed to the
prompt as `<opleidingspagina_url>` and `<opleidingspagina_tekst>`; when the
fetch fails, only the article form is allowed and the piece says so. The rule:
propose changes to the existing page when it lacks what the stage message
needs; otherwise write the article. Export renders both as Markdown; the
interface label reads "Website: opleidingspagina of blogartikel".

**Keywords travel.** `briefVersion` gains `keywords` (≤ 10 of `{phrase,
sourceRef, kind: 'radar' | 'afgeleid'}`) filled by `brief.draft` v6 from
`<zoektermen>`: the radar keyword report when the campaign has a run, else
phrases derived from the course name and confirmed facts, labelled as such.
No volume or difficulty figure exists anywhere. `content.generate` receives
the same `<zoektermen>`; `contentCopy.keywordsUsed` lists what the piece used
and the code verifies each phrase occurs literally; the website piece and the
e-mail must carry at least one brief keyword in title or hook and in the first
section; `ads.keywords` outside the brief keywords and course-name variants
become a warning.

**Hashtags are made, checked and shown.** Rule: LinkedIn 3–5, Instagram 5–10,
Facebook 1–3, other channels none; derived from the course, the field and the
audience; camel-case for readability. Code normalises the leading `#`, checks
count per channel and the character set, and refuses forbidden words. The
asset card shows them as text with a copy action and lets an editor change
them.

**No copy-paste.** Every stage call receives `<eerdere_content>`: hook and
first 200 characters of every piece already produced for the campaign, and
the rule that each channel and stage opens differently and answers a
different question of the reader. Code computes normalised trigram Jaccard
between hooks and between bodies of the campaign's pieces; above 0.6 the
piece is repaired. A sentence of ten or more words copied verbatim from a
course-card fact (the course name excepted) is `copied_fact_sentence`: facts
are used as answers to a reader's question, paraphrased, with the exact
values kept.

**Calls.** Long-form pieces (website, e-mail) get their own provider call
with a larger `maxOutputTokens` (request-level override, capped by
`AI_MAX_OUTPUT_TOKENS`), social and advert channels of a stage share one call;
`CALLS_PER_JOB['content.generate']` reflects the ceiling. `channelNotes` reads
the channel's real format and states minimum and maximum. `content.revise`
passes the full existing copy. Prompt versions: `content.generate` v8,
`brief.draft` v6; stale version comments corrected.

**Screen.** `ContentAssetCard` (new component, swapped into the detail page
and the studio): word count against the channel minimum, inline "te kort"
from the quality warnings, hashtags and alt text as text, copy buttons for
hook, body, each section, hashtags and the whole piece as Markdown, an editor
for sections and hashtags.

**Mock.** Realistic lengths, hashtags on social channels, both website forms
depending on whether page text is present, all marked Demo, so tests and the
smoke run exercise the minimums.

**Tests.** Unit: every quality check on synthetic copy; excerpt verification;
keyword coverage; similarity; hashtag rules. Integration: generation on the
mock stores a website piece in one of the two forms with keywords and a
LinkedIn piece with hashtags; a spied provider returning a two-line page is
repaired or refused, never stored.

## Not in these slices

Approving or archiving personas; pagination beyond a first page on the
campaigns list; HTML rendering of the website piece; measured reach of any
hashtag or keyword (there is no measurement; the interface says so).
