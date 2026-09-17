# The blog article: how it ranks, gets cited and still leads to the course (2026-09-14)

Status: **applied** on 2026-09-14 to `websiteBlogArticle`, `content.generate`
v9, the mock and `content-assets/article-quality.ts`. This note records the
practice the code holds the model to, and where it comes from.

## Why

The website piece of a campaign is, when the course page already covers the
facts, a blog article. The first articles were long enough but read as a
summary of the course page in five sections: no question answered, no reason
to read on, the course in every paragraph. A reader learns nothing they did
not have, a search engine finds nothing it has not indexed, and an AI answer
engine has nothing to quote.

Two researchers read the 2024–2026 material (Google Search Central on helpful
content, AI features and title links; the Princeton generative-engine
optimisation paper; Semrush's citation study; Ahrefs' AI Overview and
freshness studies; Search Engine Land's 2026 GEO guide; Nielsen Norman Group
on reading online; Copyhackers on button copy; Dutch B1 guidance from
CommunicatieRijk and Gebruiker Centraal). The picture is convergent, and it is
one picture for search, for AI answer engines and for the reader.

## The practice

**The article answers one question of the audience completely, then leads
to the course.** Not a sales page, not a summary of the course page, not a
teaser that withholds the answer "in de opleiding".

Reading order, with the floors and ceilings the code applies:

| Part | Rule | Why |
| --- | --- | --- |
| Title | The reader's question as they would search it; at most 70 characters; no course name | Title links are truncated and vague titles rewritten; a course-first title signals a sales page |
| Meta description | 120–155 characters, one or two sentences on what the reader learns and for whom, the main search phrase once | A click pitch, shown at that length; keyword lists do not help |
| Direct answer | 35–90 words, declarative, quotable on its own, with the main search phrase; not "In dit artikel …" | Most readers scan; the opening passage is what AI engines lift; terms early weigh more |
| Intro | 40–130 words: the problem in the reader's words and the thesis; no course | People-first content opens with the reader, not the product |
| Sections | 4–7, headings phrased as the reader's sub-questions, one idea each in 60–320 words, opening with a sentence that stands alone (not "Dit", "Deze", "Daarom") | Q&A format and section structure are the strongest citation correlates after clear summaries; a lifted passage must read right out of context |
| Scenario | One concrete, fictional workplace scenario of at least 40 words: role, situation, decision; no names | First-hand, concrete detail is the proof device that needs no invented number |
| External facts | 0–3, each with a source reference the service handed the model (a persona grounding's URL, the course page); none otherwise | Cited sources raise generative visibility; an invented source is worse than none |
| Bridge sentence | One sentence in running text after the first or second section, naming the course; the first course link | The product enters where the topic demands it, as the obvious next step |
| Path section | 60–320 words: what a professional needs, then two to four sentences about the course strictly from the card, then at most three objections answered with card facts | Address time, level and cost with facts; omit what the card cannot answer |
| FAQ | 3–5 real follow-up questions, different from the headings, each ending in a question mark, answers 30–110 words, answer first | Follow-up questions are what people ask AI engines; the FAQ rich result is gone, the visible text is what counts |
| Closing call to action | One sentence of 6–70 words that says what the click gives ("Bekijk …", "Ontdek …", "Vergelijk …"); the second course link | The "I want to …" test; commitment words add friction |
| Tone | "je", never mixed with "u"; short sentences (average under 24, none over 45); no exclamation marks; no superlatives or promises; no generic openings | Objective, concise, scannable text measurably raises usability and credibility; promotional tone lowers citations |
| Share | At most four in ten paragraphs about the course or enrolling | Helping, not selling; the article must be useful to a reader who never buys |
| Numbers | Every number on the course card or in a cited external fact; otherwise absent | Trust is the heaviest part of E-E-A-T; an unverifiable figure breaks it |
| Length | 800–1,800 words, aim for 900–1,500, stop when the question is answered | No preferred word count exists; padding is the anti-pattern |

**What to teach and what to signal.** Explain the *what* and the *why* in
full. Name the practical skill the course teaches in one sentence; do not
give the procedure. The reader leaves with the answer and with a clear
picture of what the course adds.

## How the code holds the line

- `websiteBlogArticle` carries the parts as fields: `directAnswerNl`,
  `scenarioNl`, `externalFacts`, `midCtaNl` with `midCtaAfterSection`,
  `coursePathNl`, `closingCtaNl`, next to title, meta description, intro,
  sections, FAQ and link text. Defaulted, so articles written before read
  back with what they have.
- `checkArticleStructure` judges structure and tone from the article alone
  and sends every shortfall back to the model once (`<herstelpunten>`);
  `checkArticleFacts` judges numbers against the course card and the cited
  facts, and sources against what the service handed the model. Readability
  and the course share are reported to the reviewer, not repaired.
- The mock writes an article that passes every check, so the demo path and
  the tests exercise the practice.

## Sources

- Google Search Central: creating helpful content; AI features and your
  website; title links; snippets; Article structured data; FAQPage (rich
  result no longer shown in Search, May 2026); spam policies.
- Aggarwal et al., *GEO: Generative Engine Optimization* (arXiv 2311.09735).
- Semrush, *Content optimization for AI search* (citation study, 2025).
- Ahrefs, *Do AI assistants prefer to cite fresh content*; Search Engine
  Journal on AI Overview citations (2026).
- Search Engine Land, *Mastering generative engine optimization in 2026*.
- Nielsen Norman Group, *How users read on the web*; *Concise, scannable and
  objective*; *The inverted pyramid*.
- Copyhackers, *How to optimize your button copy*; CXL and Ten Speed on
  bottom-of-funnel content.
- CommunicatieRijk and Gebruiker Centraal on B1 Dutch.

Figures quoted in the research (for example the citation-lift percentages)
are the sources' own and are not repeated in the interface; the product
measures nothing about reach.
