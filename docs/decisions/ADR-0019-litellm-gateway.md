# ADR-0019 — LiteLLM as a gateway in front of the OpenAI-compatible adapter

**Status:** Accepted · **Date:** 2026-09-16

## Context

ADR-0013 put every provider behind task-scoped adapters; ADR-0015 added OpenAI
over the Responses API with strict Structured Outputs. The team is moving to
**LiteLLM**: a proxy that speaks OpenAI's HTTP API in front of whatever is
configured behind it — OpenAI, Azure OpenAI, Anthropic, Bedrock, Vertex.

The reasons a team does this are the reasons that matter here: one key surface
instead of one per provider, per-key budgets and spend visibility outside the
application, and the ability to move a model without redeploying the product.

The question is not whether the HTTP call works — it is the same call. It is
what the product may then **claim**, because a gateway's capabilities are the
capabilities of whatever sits behind it, and this product refuses things it
cannot do rather than failing halfway through them.

## Decision

`AI_PROVIDER=litellm` reuses the OpenAI-compatible adapter with a different base
URL, key and set of declared capabilities. No second adapter.

| Aspect | How |
| --- | --- |
| Endpoint | `LITELLM_BASE_URL` with no path; the adapter appends `/v1/responses` and `/v1/images/generations`, the same two it calls on OpenAI |
| Identity | `LITELLM_API_KEY`, the proxy's virtual key. The `openai-organization` header is not sent — the virtual key identifies the caller |
| Supplier in the ledger | `litellm`, not `openai`. A usage row says which door the call went through, and those are different suppliers with different contracts |
| Web search | `AI_WEB_SEARCH_ENABLED`, **default off** for the gateway |
| Price | `AI_TEXT_PRICE_INPUT_CENTS_PER_MTOK` / `_OUTPUT_`, both or neither |
| Actual cost | `x-litellm-response-cost`, converted with `AI_COST_USD_TO_EUR_RATE`; ignored without a rate |
| Images | Allowed, where the guard previously required `AI_PROVIDER=openai` |
| Transport | `https` required in production |

### Web search is off unless an operator says otherwise

`web_search` is a tool OpenAI **hosts**. A gateway forwards it only when the
model behind it is an OpenAI model that has it; anywhere else the call fails
rather than degrading.

The product already refuses discovery honestly when a provider cannot search —
`supportsWebSearch` → `canDiscover` → the Marktradar scan and the GEO research
both answer `capability_unavailable` with a Dutch sentence and an alternative.
So the safe default is the one that refuses. An operator whose proxy does
forward the tool sets `AI_WEB_SEARCH_ENABLED=true` and gets it back.

The alternative — assume the gateway can do whatever OpenAI can, because the
API shape matches — is precisely the failure mode requirement 11 names: a
provider failure presented as a working feature.

### Price is configuration, and cost is preferably the proxy's own figure

Behind a gateway `AI_TEXT_MODEL` is an alias the proxy defines (`team-default`),
so the price table in `openai-adapter.ts` cannot know it. Two routes, both
opt-in, neither inventing anything:

- **Estimate.** A configured price in eurocents per million tokens is used for
  the budget reservation. Both halves are required: half a price is not a price.
  Without them the existing behaviour stands — an unknown model reserves a
  deliberately high placeholder so it cannot spend without a budget check, and
  reports **no** actual cost rather than a made-up one.
- **Actual.** LiteLLM returns the real cost of the call in
  `x-litellm-response-cost`, and it knows the upstream price better than any
  table we maintain. It is in **dollars**; every column in this product is in
  eurocents. Without `AI_COST_USD_TO_EUR_RATE` the header is ignored, because a
  currency conversion nobody configured is a figure nobody can check — and this
  value lands in the ledger as an actual cost.

### https in production

Prompts, uploaded document text, course material and the virtual key all travel
over this connection. Inside one container network plain http is a choice an
operator can make deliberately; leaving production is not, and boot refuses it.

## Alternatives considered

**A second `LiteLlmProvider` adapter.** Rejected: it would be a copy of the
OpenAI adapter with three constants changed, and the two would drift. The
differences that matter are configuration and *claims*, not protocol.

**Calling `/v1/chat/completions` instead of `/v1/responses`.** LiteLLM documents
the `/responses` endpoint across its providers, and the existing adapter's
strict structured output is built on `text.format`. Moving to chat completions
would mean a second request shape and a second structured-output path for no
gain today. If a deployment's model turns out not to support `/responses`
through the proxy, that is the point to add the second style — with a test that
proves which one is in use, not a silent fallback.

**Assuming OpenAI's capabilities because the API shape matches.** Rejected; see
above. The whole reason `supportsWebSearch` exists is that a capability has to
be answered honestly before work is queued.

## Consequences

- Switching is a configuration change: four variables, no code.
- The usage ledger distinguishes `openai` from `litellm`, so spend can be read
  per supplier after a move.
- A gateway deployment starts with market discovery **off**. That is visible in
  the interface — the scan says web search is unavailable and offers source
  links instead — rather than silent.
- Anything the proxy adds that OpenAI's API does not express (routing, retries,
  fallbacks between models) is invisible to this product by design. The cost
  header is the one exception, because it is the one thing the proxy knows
  better than we do.

## Verified

- `apps/api/tests/unit/env-guards.test.ts` — the gateway refuses to start
  without a base URL or key, refuses plain http in production, does not claim
  web search unless told, prices an alias from configuration, treats half a
  price as no price, and permits images.
- `apps/api/tests/unit/openai-adapter.test.ts` — the call goes to the proxy with
  the virtual key and no organisation header, the ledger records `litellm`, the
  cost header is converted with a rate and ignored without one, and an unpriced
  model reports no actual cost.
