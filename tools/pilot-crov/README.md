# First content marketing pilot: CS Opleidingen / CROV

The product owner relayed the manager/Wesley decision on 2026-09-10: the first
content marketing output should concern **Casemanager Regie op Verzuim (CROV)**
at **CS Opleidingen**. This supersedes Lindenhaeghe / Wft Basis as the first
real-content pilot. Existing demo fixtures and campaigns remain intact.

Official course source:
https://cs-opleidingen.nl/opleidingen/casemanager-regie-op-verzuim-crov

Brand Portal slug: `cs-opleidingen`. Production release observed: `0.4.0`.
The bundle contains logos and Behind the Nineties / Euclid Square fonts.
The observed bundle has no `content_profile`; do not borrow another label's
copy rules or invent CS tone-of-voice instructions.

From the repository root, with the local API and worker running:

```sh
node --env-file=.env --import tsx tools/pilot-crov/index.ts
```

This provisions a separate local label for the existing local organization
owner and submits the official course URL through the existing extraction
queue. It uses the configured AI provider and its budget controls. Re-running
reuses an existing course with that URL, or the queue's idempotent extraction
job. No course fact is automatically confirmed or approved.

In the interface, select **CS Opleidingen**, then open **Opleidingen** to review
the CROV proposal. Existing browser label preferences remain user-controlled.
Brand Portal data is currently cached by the standalone integration; runtime
brand/renderer wiring is pending coordination with the concurrent P1-5 work.
