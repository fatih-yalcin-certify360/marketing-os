import type { LearningWithEvidence } from '@c360/contracts';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  personaProposalSet,
  type CurrentUser,
  type Grounding,
  type PersonaProposal,
  type PersonaVersion,
  type ReviewState,
} from '@c360/contracts';
import { learningsForPrompt } from '../learnings/service.js';
import type { Db, DbOrTx } from '../../core/db/types.js';
import { campaigns, personaVersions } from '../../core/db/schema.js';
import { AppError } from '../../core/errors/app-error.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import type { GenerationService } from '../../core/ai/generation.js';
import type { BrandService } from '../brand/service.js';
import type { CourseService } from '../courses/service.js';
import type { ApprovalService } from '../reviews-approvals/service.js';

/**
 * Personas.
 *
 * Two requirements are enforced here rather than trusted to the model:
 *
 *  1. **No padding to three.** If the adapter returns fewer than three, a
 *     reason must accompany it; a short set with no reason is rejected as
 *     invalid provider output. So "only two personas" is always an explained
 *     outcome.
 *  2. **A campaign binds to a persona version.** Editing a persona creates
 *     version n+1 and leaves the version a campaign already references
 *     untouched, so a library edit can never silently rewrite live campaign
 *     material.
 */

export interface PersonaProposalResult {
  personas: PersonaVersion[];
  shortfallReasonNl: string | null;
  isMock: boolean;
}

export class PersonaService {
  constructor(
    private readonly generation: GenerationService,
    private readonly brand: BrandService,
    private readonly courses: CourseService,
    private readonly approvals: ApprovalService,
    /**
     * Research findings, when the deployment has them.
     *
     * Optional so the many call sites that only read or approve a persona need
     * no research wiring, and so a test can exercise persona generation without
     * a source registry. Absent means personas rest on confirmed course facts
     * alone — which is a real state, not a degraded one, and the model is told
     * to say so.
     */
    private readonly research?: {
      groundingsFor(
        db: Db,
        labelId: string,
        courseVersionId: string,
      ): Promise<{ groundings: { claim: string; sourceRef: string; retrievedAt: string | null }[] }>;
    },
    /**
     * Approved learnings, when the deployment has them (P4-2).
     *
     * Optional for the same reason research is: a call site that only reads or
     * approves a persona needs no learning wiring. Absent means proposals rest
     * on confirmed facts and research alone, which is a real state.
     *
     * Only *approved* learnings ever arrive here — a draft influences nothing —
     * and each carries the size of its evidence, because a hypothesis handed
     * over without its thinness reads as settled.
     */
    private readonly learnings?: {
      approvedForPrompt(db: Db, labelId: string): Promise<LearningWithEvidence[]>;
    },
  ) {}

  async listForCourse(
    db: Db,
    user: CurrentUser,
    labelId: string,
    courseVersionId: string,
    campaignId?: string,
  ): Promise<PersonaVersion[]> {
    requireLabelPermission(user, labelId, 'persona:read');
    const rows = await db
      .select()
      .from(personaVersions)
      .where(
        and(
          eq(personaVersions.labelId, labelId),
          eq(personaVersions.courseVersionId, courseVersionId),
          campaignId ? eq(personaVersions.campaignId, campaignId) : isNull(personaVersions.campaignId),
        ),
      )
      .orderBy(desc(personaVersions.createdAt));

    // Latest version per persona_key.
    const byKey = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const existing = byKey.get(row.personaKey);
      if (existing === undefined || row.version > existing.version) {
        byKey.set(row.personaKey, row);
      }
    }
    return [...byKey.values()].map(toPersona);
  }

  async findManyByIds(
    db: DbOrTx,
    labelId: string,
    ids: readonly string[],
  ): Promise<PersonaVersion[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await db
      .select()
      .from(personaVersions)
      .where(and(eq(personaVersions.labelId, labelId), inArray(personaVersions.id, [...ids])));
    return rows.map(toPersona);
  }

  async requireManyByIds(
    db: DbOrTx,
    labelId: string,
    ids: readonly string[],
  ): Promise<PersonaVersion[]> {
    const found = await this.findManyByIds(db, labelId, ids);
    if (found.length !== ids.length) {
      throw AppError.notFoundOrForbidden('persona', ids.join(','));
    }
    return found;
  }

  async requireForCampaign(db: DbOrTx, labelId: string, campaignId: string, courseVersionId: string, ids: readonly string[]): Promise<PersonaVersion[]> {
    const rows = await db.select().from(personaVersions).where(and(
      eq(personaVersions.labelId, labelId), inArray(personaVersions.id, [...ids])));
    if (rows.length !== ids.length || rows.some(row => row.courseVersionId !== courseVersionId ||
      (row.campaignId !== null && row.campaignId !== campaignId))) {
      throw AppError.notFoundOrForbidden('persona', ids.join(','));
    }
    return rows.map(toPersona);
  }

  /**
   * Generates persona proposals and stores each as a draft version.
   *
   * Stored immediately rather than held in memory, so the work survives a
   * page reload or a cancelled job — the user does not have to regenerate (and
   * pay again) to get back what was already produced.
   */
  async propose(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      courseVersionId: string;
      campaignId?: string | undefined;
      jobId?: string | null;
      attempt?: number;
      signal?: AbortSignal | undefined;
    },
  ): Promise<PersonaProposalResult> {
    requireLabelPermission(user, input.labelId, 'persona:write');

    const [campaign] = input.campaignId ? await db.select().from(campaigns).where(and(
      eq(campaigns.id, input.campaignId), eq(campaigns.labelId, input.labelId),
      eq(campaigns.courseVersionId, input.courseVersionId))) : [];
    if (input.campaignId && !campaign) throw AppError.notFoundOrForbidden('campaign', input.campaignId);
    const course = await this.courses.requireVersion(db, input.labelId, input.courseVersionId);
    const brand = await this.brand.approved(db, input.labelId);

    /*
     * The current research run, if there is one.
     *
     * This is what lets a persona rest on something checkable rather than on
     * the course card alone. Without a run there are no findings, the personas
     * are grounded only in confirmed course facts, and the model says so in
     * `shortfallReasonNl` — which is exactly why the demo card yields two
     * personas instead of three.
     *
     * `groundingsFor` returns nothing for a run that is still going or that
     * failed, so a half-finished run cannot silently become evidence.
     */
    const research =
      this.research === undefined
        ? { groundings: [] }
        : await this.research.groundingsFor(db, input.labelId, input.courseVersionId);

    const result = await this.generation.generate(db, {
      template: 'persona.propose',
      schema: personaProposalSet,
      organizationId: user.organizationId,
      labelId: input.labelId,
      jobId: input.jobId ?? null,
      attempt: input.attempt ?? 0,
      signal: input.signal,
      context: {
        language: campaign?.contentLanguage === 'en' ? 'en' : 'nl',
        userIdea: campaign?.userIdea ?? null,
        suppliedBrief: campaign?.suppliedBrief ?? null,
        course,
        brand: brand ?? null,
        findings: research.groundings.map((grounding) => ({
          claim: grounding.claim,
          sourceRef: grounding.sourceRef,
          retrievedAt: grounding.retrievedAt ?? '',
        })),
        learnings: learningsForPrompt(
          (await this.learnings?.approvedForPrompt(db, input.labelId)) ?? [],
        ),
      },
    });

    // The contract allows fewer than three; it does not allow fewer than three
    // with no explanation. Enforce that here rather than in the prompt only.
    if (result.value.personas.length < 3 && result.value.shortfallReasonNl === null) {
      throw new AppError('provider_invalid_output', {
        publicMessage:
          'Er zijn minder dan drie doelgroepen voorgesteld zonder opgaaf van reden. Er is niets opgeslagen; probeer het opnieuw.',
        internalDetail: 'persona proposal set was short without shortfallReasonNl',
      });
    }

    const stored: PersonaVersion[] = [];
    for (const proposal of result.value.personas) {
      stored.push(
        await this.createVersion(db, user, {
          labelId: input.labelId,
          courseVersionId: input.courseVersionId,
          proposal,
          campaignId: input.campaignId,
          origin: 'ai_generated',
          promptVersion: result.promptVersion,
        }),
      );
    }

    return {
      personas: stored,
      shortfallReasonNl: result.value.shortfallReasonNl,
      isMock: result.isMock,
    };
  }

  /** Creates a new persona, or the next version of an existing one. */
  async createVersion(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      courseVersionId: string;
      proposal: PersonaProposal;
      personaKey?: string;
      campaignId?: string | undefined;
      origin?: PersonaVersion['origin'];
      promptVersion?: string | null;
    },
  ): Promise<PersonaVersion> {
    requireLabelPermission(user, input.labelId, 'persona:write');
    const personaKey = input.personaKey ?? `${input.campaignId ?? input.courseVersionId}:${slugify(input.proposal.name)}`;

    return db.transaction(async (tx) => {
      const rows = await tx
        .select({ max: sql<number | null>`max(${personaVersions.version})` })
        .from(personaVersions)
        .where(
          and(eq(personaVersions.labelId, input.labelId), eq(personaVersions.personaKey, personaKey)),
        );
      const next = (rows[0]?.max ?? 0) + 1;

      const inserted = await tx
        .insert(personaVersions)
        .values({
          organizationId: user.organizationId,
          labelId: input.labelId,
          personaKey,
          campaignId: input.campaignId ?? null,
          version: next,
          courseVersionId: input.courseVersionId,
          name: input.proposal.name,
          summary: input.proposal.summary,
          need: input.proposal.need,
          motivation: input.proposal.motivation,
          barriers: input.proposal.barriers,
          decisionCriteria: input.proposal.decisionCriteria,
          relationToCourse: input.proposal.relationToCourse,
          grounding: input.proposal.grounding,
          assumptions: input.proposal.assumptions,
          reviewState: 'draft',
          origin: input.origin ?? 'user',
          promptVersion: input.promptVersion ?? null,
          createdByUserId: user.userId,
        })
        .returning();

      const row = inserted[0];
      if (row === undefined) {
        throw new AppError('internal_error', { internalDetail: 'persona insert yielded no row' });
      }
      return toPersona(row);
    });
  }

  /** Edits a persona by creating the next version. The old one stays intact. */
  async edit(
    db: Db,
    user: CurrentUser,
    labelId: string,
    versionId: string,
    // Zod's `.partial()` yields `T | undefined` per key, which under
    // `exactOptionalPropertyTypes` is distinct from an optional key.
    patch: { [K in keyof PersonaProposal]?: PersonaProposal[K] | undefined },
  ): Promise<PersonaVersion> {
    const current = await this.requireVersion(db, labelId, versionId);
    const keyRows = await db
      .select({ personaKey: personaVersions.personaKey, campaignId: personaVersions.campaignId })
      .from(personaVersions)
      .where(eq(personaVersions.id, versionId))
      .limit(1);

    return this.createVersion(db, user, {
      labelId,
      courseVersionId: current.courseVersionId,
      campaignId: keyRows[0]?.campaignId ?? undefined,
      ...(keyRows[0]?.personaKey === undefined ? {} : { personaKey: keyRows[0].personaKey }),
      origin: 'user',
      proposal: {
        name: patch.name ?? current.name,
        summary: patch.summary ?? current.summary,
        need: patch.need ?? current.need,
        motivation: patch.motivation ?? current.motivation,
        barriers: patch.barriers ?? current.barriers,
        decisionCriteria: patch.decisionCriteria ?? current.decisionCriteria,
        relationToCourse: patch.relationToCourse ?? current.relationToCourse,
        grounding: patch.grounding ?? current.grounding,
        assumptions: patch.assumptions ?? current.assumptions,
      },
    });
  }

  async approve(
    db: Db,
    user: CurrentUser,
    labelId: string,
    versionId: string,
  ): Promise<PersonaVersion> {
    requireLabelPermission(user, labelId, 'persona:approve');
    return db.transaction(async (tx) => {
      const target = await this.requireVersion(tx, labelId, versionId);
      await tx
        .update(personaVersions)
        .set({ reviewState: 'approved' })
        .where(eq(personaVersions.id, versionId));
      await this.approvals.approve(tx, user, {
        labelId,
        artefactType: 'persona',
        artefactId: versionId,
        artefactVersion: target.version,
      });
      return this.requireVersion(tx, labelId, versionId);
    });
  }

  async findVersion(
    db: DbOrTx,
    labelId: string,
    id: string,
  ): Promise<PersonaVersion | undefined> {
    const rows = await db
      .select()
      .from(personaVersions)
      .where(and(eq(personaVersions.id, id), eq(personaVersions.labelId, labelId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toPersona(row);
  }

  async requireVersion(db: DbOrTx, labelId: string, id: string): Promise<PersonaVersion> {
    const persona = await this.findVersion(db, labelId, id);
    if (persona === undefined) {
      throw AppError.notFoundOrForbidden('persona', id);
    }
    return persona;
  }
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
  return slug.length === 0 ? 'item' : slug;
}

interface PersonaRow {
  id: string;
  labelId: string;
  courseVersionId: string;
  version: number;
  name: string;
  summary: string;
  need: string;
  motivation: string;
  barriers: unknown;
  decisionCriteria: unknown;
  relationToCourse: string;
  grounding: unknown;
  assumptions: unknown;
  reviewState: string;
  origin: string;
  promptVersion: string | null;
  createdAt: Date;
  createdByUserId: string | null;
}

function toPersona(row: PersonaRow): PersonaVersion {
  return {
    id: row.id,
    labelId: row.labelId,
    courseVersionId: row.courseVersionId,
    version: row.version,
    name: row.name,
    summary: row.summary,
    need: row.need,
    motivation: row.motivation,
    barriers: (row.barriers ?? []) as string[],
    decisionCriteria: (row.decisionCriteria ?? []) as string[],
    relationToCourse: row.relationToCourse,
    grounding: (row.grounding ?? []) as Grounding[],
    assumptions: (row.assumptions ?? []) as string[],
    reviewState: row.reviewState as ReviewState,
    origin: row.origin as PersonaVersion['origin'],
    promptVersion: row.promptVersion,
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
  };
}
