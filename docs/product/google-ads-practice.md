# Google Ads as an advised channel: what Google's documentation says (2026-09-15)

Status: **applied** on 2026-09-15 to the channel specification
(`google_search_ads`), the Google Ads frame per funnel stage
(`packages/contracts/src/google-ads.ts`), the copy checks in
`content-assets/quality.ts`, `content.generate` v12, the mock and the
export. Every figure below was read on Google's own help pages on
2026-09-15; the page is named next to it. Where Google publishes no number,
none is stated here and none is enforced in the product.

## Why

Google Search Ads was a producible channel since 2026-09-10, with every
limit deliberately `null` — "checked in the platform" — and a three-headline,
two-description proposal. For a live campaign that is not enough: a headline
over thirty characters is rejected by Google, a campaign started without a
conversion action cannot be optimised, and a consent banner without Consent
Mode v2 loses the EEA measurement. The user asked for Google Ads among the
advised channels, with the tool saying what the campaign goal is when Google
Ads is chosen and guiding the set-up from Google's current documentation.

## What Google documents (read 2026-09-15)

**Objectives and campaign types.** Sales, Leads, Website traffic, YouTube
reach/views/engagements (the renamed awareness objective), App promotion; a
campaign can also be made without an objective. Leads enables Performance
Max, Search, Display, Demand Gen, Shopping and Video; Website traffic the
same without Performance Max. Display campaigns are being folded into Demand
Gen (migration tool June 2026). — *Choose a campaign objective*, *About
campaign types*, *Demand Gen*, *Display to Demand Gen migration*.

**Search ads (responsive search ads).** 3 to 15 headlines of at most 30
characters; 2 to 4 descriptions of at most 90; two optional display paths of
at most 15 each. Headline 1 and description 1 show most; pinning to H1, H2
or D1 always shows but lowers Ad Strength, so pin at most one or two
essentials. Per ad group at least two responsive search ads with Good or
Excellent Ad Strength. Ad Strength weighs relevance, quantity and diversity
of assets: unique headlines with different selling points and calls to
action, the top keywords inside a single headline. Keyword insertion
`{KeyWord:standaardtekst}` is allowed in headlines, descriptions and paths.
— *About responsive search ads*, *Create effective RSAs*, *About Ad
Strength*.

**Policy that blocks a Search ad.** Standard spelling and grammar in the
"clear and informational" style of the results page; no consecutively
repeated punctuation ("nu!!"), no bullets, asterisks or emoji, no "excessive
or gimmicky" use of numbers, symbols or punctuation; no gimmicky
capitalisation ("OPLEIDING", "OpLeIdInG") except common abbreviations,
codes and brand names; no unnecessary repetition of words; no claims that
present an improbable result as likely; no offers that are not on the
destination; competitor trademarks are complaint-driven and restricted.
Nothing education-specific; local law applies. — *Editorial*, *Punctuation
and symbols*, *Capitalization*, *Misrepresentation*, *Trademarks*.

**Keywords.** Broad match reaches related searches (also without the
literal words, using the landing page and other keywords) and is what Smart
Bidding works best with; phrase match needs the meaning of the keyword;
exact match the same meaning or intent. Negative keywords do not match close
variants, so misspellings must be listed. Ad groups follow one narrow theme.
Quality Score (expected click-through rate, ad relevance, landing page
experience) is a diagnostic, not an auction input. — *Keyword matching
options*, *Negative keywords*, *Ad groups*, *Quality Score*.

**Conversion tracking for leads.** Conversion actions for form submissions,
calls and downloads through the Google tag or a GA4 import; lead-specific
goals ("Submit lead form", "Sign-up", "Qualified lead", "Converted lead")
carry invalid-traffic protection; optimise to the goal closest to a sale
with at least 15 conversions in the last 30 days. Enhanced conversions for
leads send hashed form data to attribute offline enrolments. In the EEA,
Consent Mode v2 — `ad_storage`, `analytics_storage`, `ad_user_data`,
`ad_personalization` — and the EU User Consent Policy are required for
measurement and remarketing since March 2024. Data-driven attribution is the
default. — *Lead generation guide*, *Enhanced conversions for leads*,
*Consent mode*, *Attribution models*.

**Bidding and budget.** Maximize clicks or Manual CPC while conversion data
is thin; Maximize conversions once a lead goal reports about 15 conversions
per 30 days; Target CPA after roughly 30 conversions, evaluated over at least
two conversion cycles; a target set too low forgoes clicks. Enhanced CPC ended
in March 2025. Learning takes up to about 50 conversions or three conversion
cycles; do not change settings during it. The monthly spending limit is 30.4
times the average daily budget and a single day may spend twice the daily
budget. — *Bid strategies*, *Maximize conversions*, *Target CPA*, *Learning
period*, *Smart Bidding evaluation*, *Budgets*.

**Landing page and destination.** Useful, original information; the
important information at the top; mobile-friendly; the call to action of the
ad mirrored on the page; the display URL domain equal to the final URL; no
redirects to another domain, no downloads, no pages made to show ads.
— *Landing page experience*, *Destination requirements*.

**EU specifics.** Advertiser verification is being made mandatory and an
unverified account is paused at its deadline; ads, the payer, targeting and
recipient counts for EEA ads appear in the Ads Transparency Center under the
Digital Services Act. — *Advertiser verification*, *Ads Transparency
Center*.

## What the product does with it

- **Channel specification.** `google_search_ads` is now *verified against
  official docs* for its text limits (30 · 90 · 15) with the source page and
  the date; images stay out of scope. `CHANNEL_CONFIG` version 8.
- **A Google Ads frame per funnel stage** (`googleAdsFrame(stage)`): the
  campaign objective in Google's vocabulary, the campaign type, why, the
  keyword approach, the conversion actions to configure first, the bidding
  path, the budget arithmetic, the landing page, the compliance points, and
  the source pages. Ontdekken says plainly that Search reaches only people
  who already search and points at Demand Gen; Overwegen and Beslissen are
  Search first, Performance Max as a scale-out once the lead goal has data.
  Shown in the channel plan next to the advice, on the Google Search Ads
  content card, and in the export.
- **Copy checks** on a Google Search Ads piece, repaired once and then
  refused: at least 8 headlines (Google's minimum is 3; Ad Strength wants
  variety) each at most 30 characters, at least 3 descriptions each at most
  90, paths at most 15, one of the briefing's search phrases inside a
  headline, no repeated punctuation, no exclamation marks in headlines, no
  gimmicky capitals, no number that is not on the course card, no
  marketese. Every check quotes the offending text in Dutch.
- **The proposal** carries, next to headlines and descriptions, the display
  paths, negative keywords, a match-type advice per keyword group and the
  final URL (the course page). The export writes a hand-off sheet
  (`google-ads-<fase>.csv`, one row per asset) and the frame as text; it is
  a sheet for the person who builds the campaign in Google Ads, not an
  upload, and says so.
- **What it does not do.** No account connection, no keyword volumes, no
  bids, no spend; no claim of Google approval. The numbers on this page are
  Google's and may change; the verification date travels with them.

## Sources (all read 2026-09-15)

- Objectives: https://support.google.com/google-ads/answer/7450050 · campaign types: https://support.google.com/google-ads/answer/2567043 · Demand Gen: https://support.google.com/google-ads/answer/13695777 · Display migration: https://support.google.com/google-ads/answer/17051545
- Lead generation: https://support.google.com/google-ads/answer/13775965 · https://support.google.com/google-ads/answer/13489421
- Responsive search ads: https://support.google.com/google-ads/answer/7684791 · effective RSAs: https://support.google.com/google-ads/answer/6167122 · Ad Strength: https://support.google.com/google-ads/answer/9921843 · keyword insertion: https://support.google.com/google-ads/answer/2454041
- Policy: editorial https://support.google.com/adspolicy/answer/6021546 · punctuation https://support.google.com/adspolicy/answer/14847994 · capitalization https://support.google.com/adspolicy/answer/14848295 · misrepresentation https://support.google.com/adspolicy/answer/6020955 · trademarks https://support.google.com/adspolicy/answer/6118 · destination requirements https://support.google.com/adspolicy/answer/6368661
- Keywords: match types https://support.google.com/google-ads/answer/7478529 · negatives https://support.google.com/google-ads/answer/2453972 · ad groups https://support.google.com/google-ads/answer/6372655 · Quality Score https://support.google.com/google-ads/answer/6167118
- Conversions: https://support.google.com/google-ads/answer/1722022 · enhanced conversions for leads https://support.google.com/google-ads/answer/9888656 · consent mode https://support.google.com/google-ads/answer/13695607 · EU User Consent Policy https://www.google.com/about/company/user-consent-policy/ · attribution https://support.google.com/google-ads/answer/6259715
- Bidding: strategies https://support.google.com/google-ads/answer/2979071 · Maximize conversions https://support.google.com/google-ads/answer/7381968 · Target CPA https://support.google.com/google-ads/answer/6268632 · learning https://support.google.com/google-ads/answer/13020501 · evaluation https://support.google.com/google-ads/answer/6268633 · ECPC end https://support.google.com/google-ads/answer/2464964 · budgets https://support.google.com/google-ads/answer/6385083
- Landing page: https://support.google.com/google-ads/answer/14086 · https://support.google.com/google-ads/answer/6238826
- EU: advertiser verification https://support.google.com/adspolicy/answer/9703665 · Ads Transparency Center https://support.google.com/google-ads/answer/9729263
