import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  opportunityProposalSet,
  type CurrentUser,
  type Grounding,
  type Opportunity,
} from '@c360/contracts';
import type { Db, DbOrTx } from '../../core/db/types.js';
import { opportunities } from '../../core/db/schema.js';
import { AppError } from '../../core/errors/app-error.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import type { GenerationService } from '../../core/ai/generation.js';
import type { BrandService } from '../brand/service.js';
import type { CourseService } from '../courses/service.js';
import type { PersonaService } from '../personas/service.js';

/**
 * Campaign opportunities.
 *
 * There is deliberately no score, no predicted conversion and no revenue
 * estimate — the requirement forbids unfounded success scores and definite
 * sales forecasts. What the user gets instead is an order plus a *stated
 * reason* for that order, which is honest about being a judgement.
 *
 * Proposals produced together share a `proposalSetId`, so "the three options I
 * was shown" stays reconstructable after one has been chosen.
 */

export interface OpportunityProposalResult {
  proposalSetId: string;
  opportunities: Opportunity[];
  shortfallReasonNl: string | null;
  isMock: boolean;
}

export class OpportunityService {
  constructor(
    private readonly generation: GenerationService,
    private readonly brand: BrandService,
    private readonly courses: CourseService,
    private readonly personas: PersonaService,
  ) {}

  async propose(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      courseVersionId: string;
      personaVersionIds: readonly string[];
      jobId?: string | null;
      attempt?: number;
      signal?: AbortSignal | undefined;
    },
  ): Promise<OpportunityProposalResult> {
    requireLabelPermission(user, input.labelId, 'opportunity:write');

    const course = await this.courses.requireVersion(db, input.labelId, input.courseVersionId);
    const brand = await this.brand.approved(db, input.labelId);
    // Requires every persona to exist in this label — a foreign persona id
    // cannot be smuggled in alongside a legitimate one.
    const personas = await this.personas.requireManyByIds(db, input.labelId, input.personaVersionIds);

    const result = await this.generation.generate(db, {
      template: 'opportunity.propose',
      schema: opportunityProposalSet,
      organizationId: user.organizationId,
      labelId: input.labelId,
      jobId: input.jobId ?? null,
      attempt: input.attempt ?? 0,
      signal: input.signal,
      context: { language: 'nl', course, brand: brand ?? null, personas },
    });

    const proposalSetId = randomUUID();
    const stored: Opportunity[] = [];

    for (const proposal of result.value.opportunities) {
      const inserted = await db
        .insert(opportunities)
        .values({
          organizationId: user.organizationId,
          labelId: input.labelId,
          courseVersionId: input.courseVersionId,
          proposalSetId,
          personaVersionIds: [...input.personaVersionIds],
          title: proposal.title,
          goalAndNeed: proposal.goalAndNeed,
          coreIdea: proposal.coreIdea,
          sourceAndTiming: proposal.sourceAndTiming,
          fitNotes: proposal.fitNotes,
          uncertainties: proposal.uncertainties,
          smallTestProposal: proposal.smallTestProposal,
          measurementApproach: proposal.measurementApproach,
          rank: proposal.rank,
          rankRationaleNl: proposal.rankRationaleNl,
          grounding: proposal.grounding,
          origin: 'ai_generated',
          promptVersion: result.promptVersion,
        })
        .returning();

      const row = inserted[0];
      if (row === undefined) {
        throw new AppError('internal_error', { internalDetail: 'opportunity insert yielded no row' });
      }
      stored.push(toOpportunity(row));
    }

    return {
      proposalSetId,
      opportunities: stored.sort((a, b) => a.rank - b.rank),
      shortfallReasonNl: result.value.shortfallReasonNl,
      isMock: result.isMock,
    };
  }

  async listForSet(db: Db, user: CurrentUser, labelId: string, setId: string): Promise<Opportunity[]> {
    requireLabelPermission(user, labelId, 'opportunity:read');
    const rows = await db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.labelId, labelId), eq(opportunities.proposalSetId, setId)))
      .orderBy(asc(opportunities.rank));
    return rows.map(toOpportunity);
  }

  async findById(db: DbOrTx, labelId: string, id: string): Promise<Opportunity | undefined> {
    const rows = await db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, id), eq(opportunities.labelId, labelId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toOpportunity(row);
  }

  async requireById(db: DbOrTx, labelId: string, id: string): Promise<Opportunity> {
    const found = await this.findById(db, labelId, id);
    if (found === undefined) {
      throw AppError.notFoundOrForbidden('opportunity', id);
    }
    return found;
  }

  /**
   * Marks one opportunity in a set as chosen, clearing any previous choice.
   *
   * Scoped to the *same proposal set*, so choosing an opportunity in one set
   * does not deselect a choice made in an unrelated set for the same label.
   */
  async select(db: Db, user: CurrentUser, labelId: string, id: string): Promise<Opportunity> {
    requireLabelPermission(user, labelId, 'opportunity:write');

    return db.transaction(async (tx) => {
      // Existence and label scope are checked before anything is written.
      await this.requireById(tx, labelId, id);

      const setRows = await tx
        .select({ proposalSetId: opportunities.proposalSetId })
        .from(opportunities)
        .where(and(eq(opportunities.id, id), eq(opportunities.labelId, labelId)))
        .limit(1);
      const proposalSetId = setRows[0]?.proposalSetId;
      if (proposalSetId === undefined) {
        throw AppError.notFoundOrForbidden('opportunity', id);
      }

      await tx
        .update(opportunities)
        .set({ selected: false })
        .where(
          and(
            eq(opportunities.labelId, labelId),
            eq(opportunities.proposalSetId, proposalSetId),
          ),
        );
      await tx.update(opportunities).set({ selected: true }).where(eq(opportunities.id, id));

      return this.requireById(tx, labelId, id);
    });
  }
}

interface OpportunityRow {
  id: string;
  labelId: string;
  courseVersionId: string;
  personaVersionIds: unknown;
  title: string;
  goalAndNeed: string;
  coreIdea: string;
  sourceAndTiming: string;
  fitNotes: string;
  uncertainties: unknown;
  smallTestProposal: string;
  measurementApproach: string;
  rank: number;
  rankRationaleNl: string;
  grounding: unknown;
  selected: boolean;
  origin: string;
  promptVersion: string | null;
  createdAt: Date;
}

function toOpportunity(row: OpportunityRow): Opportunity {
  return {
    id: row.id,
    labelId: row.labelId,
    courseVersionId: row.courseVersionId,
    personaVersionIds: (row.personaVersionIds ?? []) as string[],
    title: row.title,
    goalAndNeed: row.goalAndNeed,
    coreIdea: row.coreIdea,
    sourceAndTiming: row.sourceAndTiming,
    fitNotes: row.fitNotes,
    uncertainties: (row.uncertainties ?? []) as string[],
    smallTestProposal: row.smallTestProposal,
    measurementApproach: row.measurementApproach,
    rank: row.rank,
    rankRationaleNl: row.rankRationaleNl,
    grounding: (row.grounding ?? []) as Grounding[],
    selected: row.selected,
    origin: row.origin as Opportunity['origin'],
    promptVersion: row.promptVersion,
    createdAt: row.createdAt.toISOString(),
  };
}
