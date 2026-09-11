import { eq, sql } from 'drizzle-orm';
import type { LabelRole } from '@c360/contracts';
import type { Db } from './types.js';
import { labels, memberships, organizations, users } from './schema.js';
import { seedCampaignData } from './seed-campaign-data.js';

/**
 * Development seed data.
 *
 * Everything created here is marked `origin = 'demo'` and named so it reads as
 * Demo in the interface. No brand assets, accreditations, prices or course
 * conditions are invented: the real Lindenhaeghe / Wft Basis package will be
 * supplied later and entered through the Phase 1 brand and course flows.
 *
 * Six labels exist because that is the starting count for the platform; five
 * of them are neutral placeholders rather than guesses at real label names.
 */

export interface SeedOptions {
  /** The local development identity, so the dev user gets memberships. */
  devSubject: string;
  devEmail: string;
  devName: string;
}

export interface SeedResult {
  organizationId: string;
  labels: { id: string; slug: string; name: string; role: LabelRole }[];
  devUserId: string;
  secondUserId: string;
  /** Demo brand profile and course card for the pilot label, when seeded. */
  pilot: { brandProfileVersionId: string | null; courseVersionId: string | null };
}

const ORGANIZATION = { slug: 'certify360-demo', name: 'Certify360 (Demo)' } as const;

/**
 * The pilot label plus five placeholders. Roles differ on purpose so the
 * access matrix and the cross-label denial tests have something real to bite
 * on — in particular `demolabel-2`, where the dev user is only a viewer.
 */
const SEED_LABELS: readonly { slug: string; name: string; role: LabelRole | null }[] = [
  { slug: 'lindenhaeghe', name: 'Lindenhaeghe (Demo)', role: 'label_manager' },
  { slug: 'demolabel-2', name: 'Demolabel 2', role: 'label_viewer' },
  { slug: 'demolabel-3', name: 'Demolabel 3', role: 'label_editor' },
  { slug: 'demolabel-4', name: 'Demolabel 4', role: 'label_approver' },
  // No membership for the dev user: proves that a label they cannot see is
  // absent from every listing rather than merely hidden in the UI.
  { slug: 'demolabel-5', name: 'Demolabel 5', role: null },
  { slug: 'demolabel-6', name: 'Demolabel 6', role: null },
];

/** Second user, member of only `demolabel-5`. Used by cross-label tests. */
const SECOND_USER = {
  subject: 'dev-local-subject-2',
  email: 'tweede.gebruiker@local.test',
  name: 'Tweede Testgebruiker',
  labelSlug: 'demolabel-5',
  role: 'label_manager' as LabelRole,
};

export async function seedDevelopmentData(db: Db, options: SeedOptions): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    await tx
      .insert(organizations)
      .values({ slug: ORGANIZATION.slug, name: ORGANIZATION.name })
      .onConflictDoNothing({ target: organizations.slug });

    const orgRows = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, ORGANIZATION.slug))
      .limit(1);
    const organizationId = orgRows[0]?.id;
    if (organizationId === undefined) {
      throw new Error('Seed failed: organization row missing');
    }

    for (const label of SEED_LABELS) {
      await tx
        .insert(labels)
        .values({
          organizationId,
          slug: label.slug,
          name: label.name,
          origin: 'demo',
        })
        .onConflictDoNothing({ target: [labels.organizationId, labels.slug] });
    }

    const labelRows = await tx
      .select({ id: labels.id, slug: labels.slug, name: labels.name })
      .from(labels)
      .where(eq(labels.organizationId, organizationId));
    const labelIdBySlug = new Map(labelRows.map((row) => [row.slug, row.id]));

    const devUserId = await upsertUser(tx, {
      organizationId,
      subject: options.devSubject,
      email: options.devEmail,
      name: options.devName,
      // The pilot user approves their own content (requirement 9: flexible
      // approval), so they are an org owner and a label manager.
      orgRole: 'org_owner',
    });

    const secondUserId = await upsertUser(tx, {
      organizationId,
      subject: SECOND_USER.subject,
      email: SECOND_USER.email,
      name: SECOND_USER.name,
      orgRole: 'org_member',
    });

    const assigned: SeedResult['labels'] = [];
    for (const label of SEED_LABELS) {
      const labelId = labelIdBySlug.get(label.slug);
      if (labelId === undefined || label.role === null) {
        continue;
      }
      await tx
        .insert(memberships)
        .values({ organizationId, userId: devUserId, labelId, role: label.role })
        .onConflictDoNothing({ target: [memberships.userId, memberships.labelId] });
      assigned.push({ id: labelId, slug: label.slug, name: label.name, role: label.role });
    }

    const secondLabelId = labelIdBySlug.get(SECOND_USER.labelSlug);
    if (secondLabelId !== undefined) {
      await tx
        .insert(memberships)
        .values({
          organizationId,
          userId: secondUserId,
          labelId: secondLabelId,
          role: SECOND_USER.role,
        })
        .onConflictDoNothing({ target: [memberships.userId, memberships.labelId] });
    }

    // Pilot label gets a demo brand profile and course card so the campaign
    // flow can be walked immediately. Clearly marked demo; nothing invented.
    const pilotLabelId = labelIdBySlug.get('lindenhaeghe');
    const pilot =
      pilotLabelId === undefined
        ? { brandProfileVersionId: null, courseVersionId: null }
        : await seedCampaignData(tx, organizationId, pilotLabelId);

    return { organizationId, labels: assigned, devUserId, secondUserId, pilot };
  });
}

async function upsertUser(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  input: {
    organizationId: string;
    subject: string;
    email: string;
    name: string;
    orgRole: 'org_owner' | 'org_admin' | 'org_member';
  },
): Promise<string> {
  await tx
    .insert(users)
    .values({
      organizationId: input.organizationId,
      externalSubject: input.subject,
      email: input.email,
      displayName: input.name,
      orgRole: input.orgRole,
      authSource: 'local',
    })
    .onConflictDoUpdate({
      target: [users.organizationId, users.externalSubject],
      set: { displayName: sql`excluded.display_name`, orgRole: sql`excluded.org_role` },
    });

  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalSubject, input.subject))
    .limit(1);
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error(`Seed failed: user ${input.subject} missing after upsert`);
  }
  return id;
}
