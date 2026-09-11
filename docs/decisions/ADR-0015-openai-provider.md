# ADR-0015 — OpenAI as the first real provider, via the Responses API with strict Structured Outputs

**Status:** Accepted · **Date:** 2026-09-09

## Context

ADR-0013 established task-scoped adapters behind a replaceable layer, with a
mock for development. The pilot now needs a real provider. The user supplies an
OpenAI key.

Two constraints framed the choice and are worth restating because they rule out
the shortcut most likely to be suggested:

- Requirement 12 states plainly that a ChatGPT or Claude **subscription must not
  be used as application API access**. It is also against the provider's terms
  and technically fragile. A paid API key is the only route, and this was
  declined once already in this project when it was asked for.
- Requirement 11 requires runtime schema validation, bounded repair, and that a
  provider failure never becomes a fake success.

## Decision

Add an `openai` provider implementing `TextGenerationAdapter` and, when
explicitly enabled, `ImageGenerationAdapter`. `ResearchAdapter` is **not**
implemented and `research()` returns `undefined`, so callers receive
`capability_unavailable` — controlled web research needs the SSRF-safe fetcher,
which is not built, and pretending otherwise is the failure mode requirement 11
names.

### Responses API with `text.format` strict JSON Schema

Every text call sends the target contract as a strict JSON Schema. Strict mode
guarantees the *shape* of the reply, which removes an entire class of parse
failure. It accepts only a subset of JSON Schema, so
`apps/api/src/core/ai/strict-schema.ts` converts our Zod-derived schema:

- every object lists **every** property in `required` and sets
  `additionalProperties: false` — strict mode has no optional keys, so a
  property our contract allows to be absent becomes explicitly nullable;
- validation keywords (`minLength`, `maximum`, `pattern`, `format`, …) are
  **dropped** rather than sent;
- `oneOf` is rewritten to `anyOf`.

Dropping the constraints loses nothing, because the reply is validated with the
original Zod schema afterwards. The division of labour is the whole point:

> **OpenAI enforces the shape, Zod enforces the rules.**

A reply with the right shape but a broken rule (a 400-character `hook`, say)
becomes one bounded repair attempt and then a recorded
`provider_invalid_output` failure — never a partially-trusted result.

### The prompt-injection boundary

The request separates `instructions` (our rules) from `input` (task data:
course text, research findings, the user's revision instruction). Source
content and user text only ever travel in `input`. This is the mechanical part
of requirement 13's "never execute source content as instructions"; it is
verified by a test asserting that task data does not appear in `instructions`.

`store: false` on every call, so no conversation state is retained provider-side.

### Failure classification

`toUnavailableError()` maps transport and HTTP failures onto retryable or not:

| Condition | Result |
| --- | --- |
| 429 | retryable, honours `retry-after` |
| 5xx | retryable |
| 4xx | **not** retryable — our mistake; retrying wastes attempts |
| network error | retryable |
| `status: 'incomplete'` (truncation) | **failure**, not a partial result |

The distinction drives the job runner: a retryable failure is requeued with
backoff, a non-retryable one goes terminal immediately.

### Models and prices

Prices verified **2026-09-09** from `https://developers.openai.com/api/docs/pricing`,
stored in eurocents per 1M tokens in `openai-adapter.ts`.

| Text model | Input | Output |
| --- | --- | --- |
| `gpt-6-astra` | 1,000 | 5,000 |
| `gpt-5.6-sol` | 400 | 2,000 |
| **`gpt-5.6-terra`** (default) | **200** | **1,200** |
| `gpt-5.6-luna` | 20 | 120 |
| `gpt-5.5` | 500 | 3,000 |
| `gpt-5.4` | 250 | 1,500 |
| `gpt-5` | 125 | 1,000 |
| `gpt-4o` | 250 | 1,000 |
| `gpt-4o-mini` | 15 | 60 |

| Image model | Input | Output |
| --- | --- | --- |
| `gpt-image-2.5-sunburst` | 500 | 3,000 |
| `gpt-image-2` | 500 | 3,000 |
| `gpt-image-1.5` | 500 | 3,200 |
| **`gpt-image-1-mini`** (default) | **200** | **800** |

`gpt-5.6-terra` is the default because structured marketing copy does not need
the flagship and the spread across the range is roughly 50×. An **unpriced**
model reports `actualCostCents: null` rather than inventing a figure, and
reserves a high placeholder — zero would let it spend with no budget check at
all.

### Images are opt-in

`AI_IMAGE_ENABLED` defaults to false. Requirement 8 already requires that logos
and brand text be applied in a **controlled render layer** rather than drawn by
a model, and that layer exists (`@resvg/resvg-js`), so the product produces
usable brand-correct images with no image spend. When enabled, the image
instruction demands a text-free background and the size is snapped to a
supported value.

## Consequences

- A real key is required for any real output; `AI_PROVIDER=mock` remains
  refused in production by env validation.
- **Unverified until a key exists:** that the live API accepts our converted
  schemas and returns what we expect. The 55 tests covering the adapter and the
  schema conversion run against a stubbed `fetch`; they pin request shape,
  failure classification and cost derivation, not live acceptance. This is
  recorded in the risk register rather than papered over.
- Prices drift. They are in one table with a verification date, and the
  supplier inventory carries the review obligation.
- Data sent to the provider is minimised and `store: false`; the region and
  retention decision remains to be verified against company policy.

## Rejected

- **A ChatGPT subscription as API access.** Forbidden by requirement 12,
  against the provider's terms, and fragile. Declined when asked for.
- **Chat Completions with `response_format: json_object`.** Asks for JSON
  without guaranteeing a shape, which moves work back into repair loops.
- **A schema-to-strict conversion at request time without tests.** The
  conversion is the part most likely to break silently on a contract change, so
  every contract the product sends is converted and asserted in
  `apps/api/tests/unit/strict-schema.test.ts`.
