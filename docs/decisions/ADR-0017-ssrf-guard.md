# ADR-0017 — Outbound fetching is guarded on the resolved address, and every redirect hop

**Status:** Accepted · **Date:** 2026-09-10

## Context

A user supplies a course-page URL and we fetch it. That single sentence is the
whole SSRF surface: the request leaves from inside the deployment network, so a
URL the user chose reaches hosts they could never reach themselves. On an
unhardened instance the metadata service hands out credentials, and even without
a readable response the *fact* that a connection succeeded is an internal port
scan.

Requirement 13 lists what must hold. This record is about the two decisions
that are easy to get subtly wrong.

## Decision

### The resolved address decides, not the hostname

A hostname is not evidence. `evil.example` can have an A record pointing at
`169.254.169.254`, and a name that resolved publicly a moment ago can resolve
internally now. So `ip-guard.ts` classifies **addresses**, and everything else
is a narrowing on top.

Refused: loopback, RFC 1918, link-local (which is where every cloud metadata
endpoint lives), carrier-grade NAT (which is where Alibaba's is), documentation
and benchmarking ranges, multicast, reserved space, and the unique-local IPv6
range that holds AWS's IPv6 metadata address.

NAT64, Teredo and 6to4 prefixes embed an IPv4 address inside an IPv6 one. The
whole prefix is refused rather than decoding the embedded address and re-checking
it: nothing this product does needs a translation prefix, and decoding is a place
to make a mistake.

IPv4-mapped addresses are caught twice on purpose. `normaliseAddress` rewrites
the dotted form (`::ffff:127.0.0.1`) to IPv4 so the IPv4 rules apply, and
`::ffff:0:0/96` is in the IPv6 list so the hex form (`::ffff:7f00:1`) cannot
slip past by being written differently.

### DNS rebinding is closed by connecting to the address we checked

The classic bug is check-then-connect with two resolutions: validate the
hostname's address, then hand the hostname to the stack, which resolves it again
and gets a different answer.

So the hostname is resolved **once**, the resolved addresses are classified, and
the connection is made through a `lookup` hook pinned to a validated address.
Node calls that hook instead of resolving, so there is exactly one resolution and
it is the one that was checked. TLS is unaffected: the hook changes which address
is dialled, not which name the certificate is verified against.

### Every redirect hop is a fresh request

A fetcher that validates the entry URL and then follows redirects is not
protected at all — `https://ok.example/r` returning
`Location: http://169.254.169.254/` defeats it in one hop. So the redirect loop
is ours, and each hop goes through the identical guard. The timeout and byte
budget are shared across the chain, so five redirects cannot cost five timeouts.

### The guard runs at the route as well as in the job

Everything decidable from the URL alone — scheme, credentials, port, hostname
shape, IP literal, allow-list — is decided in the request. The address check
stays in the job, because it needs DNS and must happen next to the connection.

This was a defect first: the guard lived only in the job, so
`file:///etc/passwd` and `http://169.254.169.254/` both returned **202 Accepted**
with a job id. The control still held — the job failed — but the user watched a
progress bar for a URL that would never be fetched, a budget reservation was held
for it, and a queue slot was spent. Same lesson as ADR-0016's gates: a control
that fires a minute later in a failure message is not the same control.

### Ports 80 and 443 only

Most of what makes SSRF valuable is reaching something that is not a web server.
An address check alone does not stop a *public* host on 6379.

## Consequences

- **Fetched content is untrusted data.** It travels in the user message inside a
  `<paginatekst>` block and the template instructs the model to ignore any
  instruction in it (threat T-05). Nothing from a page reaches the system rules.
- Extraction confirms nothing: every field is stored `unverified` with the URL as
  its `sourceRef`, and a field the page does not mention stays **empty**. This
  was verified against a real page — a law article — where the model correctly
  reported that the source contained no course data at all.
- A deployment that genuinely needs an internal source must use
  `RESEARCH_ALLOWED_HOST_SUFFIXES` deliberately. The address list is not a
  policy knob.
- **Unverified:** behaviour against a host that deliberately rebinds
  mid-connection, and an IPv6-only egress path. Recorded as R-05.

## Rejected

- **A hostname allow-list as the primary control.** It is a useful narrowing and
  a poor gate: it says nothing about where a permitted name resolves.
- **`fetch` with `redirect: 'follow'`.** The redirect chain is exactly what needs
  inspecting, and `fetch` offers no hook for the address a connection uses.
- **A DOM parser for the fetched HTML.** A dependency and a new class of
  vulnerability, to extract prose we then hand to a person for review. The
  regex reducer produces text, never HTML, so nothing downstream can render it.
- **Decoding NAT64/6to4 embedded addresses.** More code, more ways to be wrong,
  for a capability nothing needs.
