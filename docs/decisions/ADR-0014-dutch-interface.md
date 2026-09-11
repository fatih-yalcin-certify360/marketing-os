# ADR-0014 — Dutch interface, content language per campaign

**Status:** Accepted · **Date:** 2026-09-09

## Context

The interface is Dutch. Generated content defaults to Dutch but must be
changeable per campaign. Users write revision instructions in their own words.
Technical detail must not surface in the UI.

## Decision

- **Interface language:** Dutch, written directly into components. No i18n
  framework in Phase 0.
- **Content language:** a per-campaign field (`contentLanguage`, default `nl`),
  entirely separate from the interface language.
- **Error copy:** every error code has a default Dutch message in
  `@c360/contracts/errors.ts`, returned by the API. The SPA renders the server's
  message and never invents its own.

## Rejected

- **An i18n framework now (react-i18next / FormatJS).** There is one interface
  language and no second locale requested. Adding message extraction, catalogues
  and a provider would be cost with no current benefit. The decision that
  *matters* — separating interface language from content language — is made, and
  it is the one that would be expensive to retrofit.
- **Interface strings from the API.** Would put presentation in the backend.
  Only *data-dependent* text (error messages, gate labels, attention items) comes
  from the server, because only the server knows the reason.

## Consequences

- Accepted: introducing a second interface language means extracting strings.
  Bounded, and the content-language split means it does not touch generation.
- Accepted: Dutch user-facing text and English code/comments coexist. Deliberate:
  the audience for each is different.
- Gained: because error copy lives with the error codes, a new failure mode
  cannot ship without a Dutch message.
