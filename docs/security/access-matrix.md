# Access matrix

Authoritative source: `packages/contracts/src/access.ts`. This document
explains it; the code enforces it, and
`packages/contracts/tests/access-matrix.test.ts` proves the properties below.

## Scopes

Two scopes that are deliberately **not** interchangeable:

- **Organisation roles** govern org-wide administration.
- **Label roles** govern everything inside one label, granted only by a
  `memberships` row for that specific label.

## Label roles

| Permission group | Meelezer (viewer) | Redacteur (editor) | Beoordelaar (approver) | Labelbeheerder (manager) |
| --- | :-: | :-: | :-: | :-: |
| Read label, brand, courses, sources, research, personas, opportunities, campaigns, briefs, concepts, content, exports, outcomes, learnings, jobs | ✅ | ✅ | ✅ | ✅ |
| Write sources, run research | — | ✅ | — | ✅ |
| Write personas, opportunities, campaigns, briefs, concepts, content | — | ✅ | — | ✅ |
| Cancel / retry jobs | — | ✅ | — | ✅ |
| Record publication, write outcomes | — | ✅ | — | ✅ |
| Create **draft** export | — | ✅ | ✅ | ✅ |
| Create **publish-ready** export | — | **—** | ✅ | ✅ |
| Approve brand, courses, personas, briefs, content | — | **—** | ✅ | ✅ |
| Approve learnings | — | — | ✅ | ✅ |
| Write brand, write courses | — | — | — | ✅ |
| Manage label, read members, read usage, manage budget, read audit | — | — | — | ✅ |

Two separations carry real weight:

- **An editor cannot approve anything.** Not content, not a brief, not a persona,
  not brand or course truth.
- **Draft export and publish-ready export are different permissions.** An editor
  may produce a clearly-labelled draft but cannot assert that a package has
  passed every gate.

## Organisation roles

| Permission | org_member | org_admin | org_owner |
| --- | :-: | :-: | :-: |
| `org:read` | ✅ | ✅ | ✅ |
| `member:read`, `member:manage` | — | ✅ | ✅ |
| `label:read` (existence of labels) | — | ✅ | ✅ |
| `usage:read`, `audit:read` | — | ✅ | ✅ |
| `org:manage`, `label:manage`, `budget:manage` | — | — | ✅ |
| **Any label content permission** | **—** | **—** | **—** |

**The last row is the important one.** No organisation role grants read access to
a label's brand, courses, personas, campaigns, briefs, concepts, content or
exports. An org admin who is not a member of a label cannot read that label's
material — they get `not_found`, not `forbidden`, so they cannot even confirm the
label id exists.

## Enforcement points

| Layer | Control |
| --- | --- |
| Identity | Adapter asserts subject/e-mail/name only — no role, no label |
| Request | `requireLabelPermission` / `requireOrgPermission`, deny-by-default |
| Repository | Every lookup filters `organization_id` in addition to the id |
| Database | `memberships` composite FKs include `organization_id` |
| Response | `not_found` for non-member access, so ids cannot be enumerated |

## Approval assignment

`APPROVER_ROLES` (`label_approver`, `label_manager`) are the roles that may be
nominated as an approver. The pilot user is a label manager and can therefore
approve their own content — the flexible-approval case in the requirements —
while a separate approver can be assigned per label or campaign when needed.
Authority is always evaluated server-side.

## Changing this matrix

1. Edit `packages/contracts/src/access.ts`.
2. Update `packages/contracts/tests/access-matrix.test.ts`.
3. Update this table.
4. Record the reason in a decision record if a separation is being removed.

## Why `member:manage` is not a label role

`label_manager` holds `member:read` and not `member:manage`. A manager can see
who works on their label; granting or revoking access is an organisation-level
act held by `org_owner` and `org_admin`.

The reason is concrete rather than tidy: if a label role could grant
memberships, a manager could grant themselves a role on a second label, and the
label boundary — the control every other isolation test rests on — would be
self-serve. Held by `member-administration.test.ts`.

One rule sits on top of it. Removing or demoting the **last `label_manager`** of
a label is refused, because confirming a course fact needs `course:write`, which
only a manager grants. A label with no manager is a label whose price, dates and
entry conditions can never be confirmed again, and an unconfirmed fact blocks a
publish-ready export.
