import {buildPersonaTextDraft} from './text-draft.js';
import {PERSONA_QUESTIONS,PRODUCIBLE_CHANNELS,personaOrientationProposal,personaQuestionnaireProposal,personaTextExtraction,personaTextInput} from '@c360/contracts';
import type { LearningWithEvidence } from '@c360/contracts';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  personaProposalSet,
  statableFacts,
  type CourseVersion,
  type CurrentUser,
  type Grounding,
  type OrientationSource,
  type PersonaInput,
  type PersonaListScope,
  type PersonaProposal,
  type PersonaVersion,
  type ReviewState,
} from '@c360/contracts';
import { learningsForPrompt } from '../learnings/service.js';
import { fillOpenQuestions, materialForPrompt, openQuestionIds, questionnaireMaterial, verifyQuestionnaire } from './questionnaire.js';
import type { Db, DbOrTx } from '../../core/db/types.js';
import { briefVersions, campaigns, personaVersions, courseVersions } from '../../core/db/schema.js';
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
  /** What the research could and could not answer in the questionnaires, in Dutch. */
  questionnaireNoteNl: string | null;
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

  async extractFromText(db:Db,user:CurrentUser,input:{labelId:string;courseVersionId:string;text:string;jobId:string;attempt:number}){
    requireLabelPermission(user,input.labelId,'persona:write');
    const text=personaTextInput.shape.text.parse(input.text);
    const course=await this.courses.requireVersion(db,input.labelId,input.courseVersionId);
    const generated=await this.generation.generate(db,{
      organizationId:user.organizationId,labelId:input.labelId,jobId:input.jobId,attempt:input.attempt,
      template:'persona.extract_from_text',schema:personaTextExtraction,
      context:{language:'nl',course:null,brand:null,pageText:JSON.stringify({questions:PERSONA_QUESTIONS,rawText:text})},
    });
    return {...buildPersonaTextDraft(text,generated.value,course.name),isMock:generated.isMock};
  }

  /**
   * The latest version of every persona of a course version, in one scope.
   *
   * The default scope keeps the behaviour callers relied on before scopes
   * existed: a campaign id means that campaign's personas, no campaign id
   * means the library. `all` is for the screens that show where each persona
   * came from — the library page's "Voorgesteld in campagnes" list — and
   * returns library and every campaign's personas together, each row carrying
   * its `campaignId`.
   */
  async listForCourse(
    db: Db,
    user: CurrentUser,
    labelId: string,
    courseVersionId: string,
    campaignId?: string,
    scope: PersonaListScope = campaignId === undefined ? 'library' : 'campaign',
  ): Promise<PersonaVersion[]> {
    requireLabelPermission(user, labelId, 'persona:read');
    if (scope === 'campaign' && campaignId === undefined) {
      throw new AppError('bad_request', {
        publicMessage: 'Geef een campagne op om de doelgroepen van die campagne te tonen.',
        internalDetail: 'persona list scope=campaign without campaignId',
      });
    }
    return this.latestVersions(
      db,
      labelId,
      courseVersionId,
      scope === 'all'
        ? { kind: 'all' }
        : scope === 'library' || campaignId === undefined
          ? { kind: 'library' }
          : { kind: 'campaign', campaignId },
    );
  }

  /**
   * Latest version per persona key, without an authorisation check — the
   * public methods check first.
   */
  private async latestVersions(
    db: DbOrTx,
    labelId: string,
    courseVersionId: string,
    scope: { kind: 'all' } | { kind: 'library' } | { kind: 'campaign'; campaignId: string },
  ): Promise<PersonaVersion[]> {
    /*
     * Collapse to the latest version per identity *before* filtering by
     * course. A persona linked to a course in version one and unlinked in
     * version two must disappear from that course's list; filtering rows by
     * course first would keep version one as "the latest that matches".
     */
    const rows = await db
      .select()
      .from(personaVersions)
      .where(
        and(
          eq(personaVersions.labelId, labelId),
          scope.kind === 'all'
            ? undefined
            : scope.kind === 'library'
              ? isNull(personaVersions.campaignId)
              : eq(personaVersions.campaignId, scope.campaignId),
        ),
      )
      .orderBy(desc(personaVersions.createdAt));

    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const current = latest.get(row.personaKey);
      if (current === undefined || row.version > current.version) {
        latest.set(row.personaKey, row);
      }
    }
    return [...latest.values()]
      .filter(
        (row) =>
          row.courseVersionId === courseVersionId ||
          (Array.isArray(row.linkedCourseVersionIds) && (row.linkedCourseVersionIds as unknown[]).includes(courseVersionId)),
      )
      .map(toPersona);
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
    const forCourse = (row: (typeof rows)[number]): boolean =>
      row.courseVersionId === courseVersionId ||
      (Array.isArray(row.linkedCourseVersionIds) && (row.linkedCourseVersionIds as unknown[]).includes(courseVersionId));
    if (rows.length !== ids.length || rows.some(row => !forCourse(row) ||
      (row.campaignId !== null && row.campaignId !== campaignId))) {
      throw AppError.notFoundOrForbidden('persona', ids.join(','));
    }
    return rows.map(toPersona);
  }

  /**
   * The course links a version may carry: every id must be a course version
   * of the same label, and the primary course is not repeated. An unknown id
   * is refused rather than dropped — a person linking a persona to a course
   * that does not exist has made a mistake worth telling them about.
   */
  private async verifiedCourseLinks(
    db: DbOrTx,
    labelId: string,
    courseVersionId: string,
    requested: readonly string[],
  ): Promise<string[]> {
    const wanted = [...new Set(requested)].filter((id) => id !== courseVersionId);
    if (wanted.length === 0) return [];
    const rows = await db
      .select({ id: courseVersions.id })
      .from(courseVersions)
      .where(and(eq(courseVersions.labelId, labelId), inArray(courseVersions.id, wanted)));
    const known = new Set(rows.map((row) => row.id));
    const missing = wanted.filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw new AppError('bad_request', {
        publicMessage: 'Een van de gekoppelde opleidingen bestaat niet in dit label.',
        internalDetail: `unknown course version links: ${missing.join(',')}`,
      });
    }
    return wanted;
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

    /*
     * What already exists, so a proposal can add to it.
     *
     * The library personas of the course and, inside a campaign, that
     * campaign's own personas. The model is handed their names and summaries
     * under `<bestaande_doelgroepen>` and told to propose only audiences that
     * differ materially; a proposal that still repeats a name is skipped below.
     * Without this the second run of "Nieuwe doelgroepen voorstellen" produced
     * the same three audiences, which then became version 2 of the same
     * identities and the list did not grow.
     */
    const existing = [
      ...(await this.latestVersions(db, input.labelId, input.courseVersionId, { kind: 'library' })),
      ...(input.campaignId === undefined
        ? []
        : await this.latestVersions(db, input.labelId, input.courseVersionId, {
            kind: 'campaign',
            campaignId: input.campaignId,
          })),
    ];

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
        existingPersonas: existing.map((persona) => ({ name: persona.name, summary: persona.summary })),
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

    /*
     * The duplicate guard the prompt cannot be trusted with.
     *
     * A proposal whose normalised name — lower-case, diacritics folded,
     * whitespace collapsed — equals an existing persona's name in scope, or an
     * earlier proposal's in this same set, is not stored. It is counted and
     * named in the shortfall reason, so a run that adds nothing says so
     * instead of quietly re-describing the audiences that were already there.
     * Skipping everything is a valid outcome, not a failure: the model was
     * asked to deliver fewer when nothing else can be grounded.
     */
    const taken = new Set(existing.map((persona) => normalisePersonaName(persona.name)));
    const kept: typeof result.value.personas = [];
    const skipped: string[] = [];
    for (const proposal of result.value.personas) {
      const normalised = normalisePersonaName(proposal.name);
      if (taken.has(normalised)) {
        skipped.push(proposal.name);
        continue;
      }
      taken.add(normalised);
      kept.push(proposal);
    }
    const skipNote =
      skipped.length === 0
        ? null
        : skipped.length === 1
          ? `1 voorstel overgeslagen omdat die doelgroep al bestaat: ${skipped[0] ?? ''}.`
          : `${String(skipped.length)} voorstellen overgeslagen omdat die doelgroepen al bestaan: ${skipped.join(', ')}.`;
    const shortfallReasonNl =
      [result.value.shortfallReasonNl, skipNote].filter((part): part is string => part !== null).join(' ') || null;

    /*
     * One identity per proposal per run.
     *
     * The key used to be `${scope}:${slug(name)}`, so a second run that
     * returned a similar name became version 2 of the first run's persona and
     * the list — latest version per key — did not grow. The run token (the
     * job id, or a random one outside a job) makes every run append; `edit`
     * keeps the key, so a correction is still version n+1 of the same identity
     * and still flags the briefs pinned to older versions.
     */
    const runToken = (input.jobId ?? randomUUID()).slice(0, 8);

    /*
     * Orientation evidence is verified against what *we* handed the model.
     *
     * A statement about where the audience orients is only evidence when its
     * source is one of the findings or confirmed facts in the prompt; a
     * source the model produced on its own is, by construction, not something
     * we gave it. Such a statement is kept — it may well be a good hypothesis
     * — but its grounding becomes null, so the screen shows *aanname* and the
     * channel plan cannot move a verdict on it. Same posture as the research
     * and radar excerpts: provenance is checked, not trusted.
     */
    const knownSources = new Set(research.groundings.map((grounding) => grounding.sourceRef));

    /*
     * The questionnaire, filled from the same research the persona rests on.
     *
     * One more call per persona, over the material the system itself supplied
     * — findings, confirmed facts, the campaign's own input — and every answer
     * verified against it (`verifyQuestionnaire`): a quote that is not a
     * passage of the material demotes the answer to an assumption, a personal
     * question without a stated relevance stays unknown, and the notes say
     * how many questions the research could answer. A model failure here
     * leaves the persona with an all-unknown questionnaire and a note; the
     * persona itself is not lost over its questionnaire.
     */
    const material = questionnaireMaterial({
      findings: research.groundings,
      course,
      campaignInput: campaign?.suppliedBrief ?? campaign?.userIdea ?? null,
    });
    const questionnaireNotes: string[] = [];

    const stored: PersonaVersion[] = [];
    for (const proposal of kept) {
      const filled = await this.generation
        .generate(db, {
          template: 'persona.questionnaire',
          schema: personaQuestionnaireProposal,
          organizationId: user.organizationId,
          labelId: input.labelId,
          jobId: input.jobId ?? null,
          attempt: input.attempt ?? 0,
          signal: input.signal,
          context: {
            language: campaign?.contentLanguage === 'en' ? 'en' : 'nl',
            course,
            brand: null,
            personaProfile: proposal,
            questions: PERSONA_QUESTIONS,
            material: materialForPrompt(material),
          },
        })
        .catch((error: unknown) => {
          if (!(error instanceof AppError) || error.code !== 'provider_invalid_output') throw error;
          return { value: null };
        });
      const verified = verifyQuestionnaire(filled.value, material);
      questionnaireNotes.push(`${proposal.name}: ${verified.notesNl.join(' ')}`);

      stored.push(
        await this.createVersion(db, user, {
          labelId: input.labelId,
          courseVersionId: input.courseVersionId,
          proposal: {
            ...proposal,
            questionnaire: verified.questionnaire,
            orientationSources: verifyOrientationSources(proposal.orientationSources, {
              findingSourceRefs: knownSources,
              course,
              hasBrand: brand !== undefined && brand !== null,
            }),
          },
          campaignId: input.campaignId,
          personaKey: `${input.campaignId ?? input.courseVersionId}:${runToken}:${slugify(proposal.name)}`,
          origin: 'ai_generated',
          promptVersion: result.promptVersion,
        }),
      );
    }

    return {
      personas: stored,
      shortfallReasonNl,
      questionnaireNoteNl: questionnaireNotes.length > 0 ? questionnaireNotes.join('\n') : null,
      isMock: result.isMock,
    };
  }

  /**
   * Answers the open questions of a stored persona's questionnaire from the
   * system's own material, as the next version of the same persona.
   *
   * Personas stored before 2026-09-14 arrived with many questions on unknown,
   * and hand-made ones have whatever a person typed. This runs the same
   * `persona.questionnaire` call and the same verification a proposal gets,
   * over the persona's own course, campaign input and research, and then
   * **touches only the open cells**: an answer a person or an earlier run
   * gave stays as it is. The persona keeps its key, its campaign, its links
   * and its origin — a hand-made persona does not become a proposal because
   * the system completed its questionnaire; every new cell carries its own
   * origin. A model failure fails the job (nothing is stored), which is the
   * right outcome for a job whose only work is this.
   */
  async fillQuestionnaire(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      personaVersionId: string;
      jobId?: string | null;
      attempt?: number;
      signal?: AbortSignal | undefined;
    },
  ): Promise<{ persona: PersonaVersion; filledIds: string[]; stillOpenIds: string[]; noteNl: string; isMock: boolean }> {
    requireLabelPermission(user, input.labelId, 'persona:write');
    const current = await this.requireVersion(db, input.labelId, input.personaVersionId);
    const open = openQuestionIds(current.questionnaire);
    if (open.length === 0) {
      return {
        persona: current,
        filledIds: [],
        stillOpenIds: [],
        noteNl: 'Alle 36 vragen waren al beantwoord; er is niets gewijzigd.',
        isMock: false,
      };
    }
    const course = await this.courses.requireVersion(db, input.labelId, current.courseVersionId);
    const [campaign] =
      current.campaignId === null
        ? []
        : await db
            .select()
            .from(campaigns)
            .where(and(eq(campaigns.id, current.campaignId), eq(campaigns.labelId, input.labelId)));
    const research =
      this.research === undefined
        ? { groundings: [] }
        : await this.research.groundingsFor(db, input.labelId, current.courseVersionId);
    const material = questionnaireMaterial({
      findings: research.groundings,
      course,
      campaignInput: campaign?.suppliedBrief ?? campaign?.userIdea ?? null,
    });
    const filled = await this.generation.generate(db, {
      template: 'persona.questionnaire',
      schema: personaQuestionnaireProposal,
      organizationId: user.organizationId,
      labelId: input.labelId,
      jobId: input.jobId ?? null,
      attempt: input.attempt ?? 0,
      signal: input.signal,
      context: {
        language: campaign?.contentLanguage === 'en' ? 'en' : 'nl',
        course,
        brand: null,
        personaProfile: current,
        questions: PERSONA_QUESTIONS,
        material: materialForPrompt(material),
      },
    });
    const verified = verifyQuestionnaire(filled.value, material);
    const merged = fillOpenQuestions(current.questionnaire, verified.questionnaire);

    const persona = await this.createVersion(db, user, {
      labelId: input.labelId,
      courseVersionId: current.courseVersionId,
      campaignId: current.campaignId ?? undefined,
      personaKey: current.personaKey,
      origin: current.origin,
      promptVersion: filled.promptVersion,
      linkedCourseVersionIds: current.linkedCourseVersionIds,
      proposal: {
        name: current.name,
        summary: current.summary,
        need: current.need,
        motivation: current.motivation,
        barriers: current.barriers,
        decisionCriteria: current.decisionCriteria,
        relationToCourse: current.relationToCourse,
        grounding: current.grounding,
        assumptions: current.assumptions,
        orientationSources: current.orientationSources,
        questionnaire: merged.questionnaire,
      },
    });
    const noteNl = [
      `${String(merged.filledIds.length)} van de ${String(open.length)} open vragen aangevuld; al beantwoorde vragen zijn ongewijzigd (versie ${String(persona.version)}).`,
      ...verified.notesNl,
    ].join(' ');
    return { persona, filledIds: merged.filledIds, stillOpenIds: merged.stillOpenIds, noteNl, isMock: filled.isMock };
  }

  /**
   * Researches where one stored audience orients, and adds what it finds.
   *
   * The field exists so channel advice can rest on the *audience* rather than
   * on the editorial rule alone — but a persona written by hand, imported from
   * a document, or proposed before the field existed has none, and nothing
   * filled it afterwards (2026-09-16). This runs the same material the
   * questionnaire reads and the same verification a proposal gets.
   *
   * **It adds; it never overwrites.** A statement somebody typed stays exactly
   * as typed, and a proposal that repeats one already on the persona is
   * dropped. That is what makes it safe to press twice.
   */
  async fillOrientation(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      personaVersionId: string;
      jobId?: string | null;
      attempt?: number;
      signal?: AbortSignal | undefined;
    },
  ): Promise<{ persona: PersonaVersion; addedNl: string[]; noteNl: string; isMock: boolean }> {
    requireLabelPermission(user, input.labelId, 'persona:write');
    const current = await this.requireVersion(db, input.labelId, input.personaVersionId);
    const course = await this.courses.requireVersion(db, input.labelId, current.courseVersionId);
    const [campaign] =
      current.campaignId === null
        ? []
        : await db
            .select()
            .from(campaigns)
            .where(and(eq(campaigns.id, current.campaignId), eq(campaigns.labelId, input.labelId)));
    const research =
      this.research === undefined
        ? { groundings: [] }
        : await this.research.groundingsFor(db, input.labelId, current.courseVersionId);
    const material = questionnaireMaterial({
      findings: research.groundings,
      course,
      campaignInput: campaign?.suppliedBrief ?? campaign?.userIdea ?? null,
    });

    const result = await this.generation.generate(db, {
      template: 'persona.orientation',
      schema: personaOrientationProposal,
      organizationId: user.organizationId,
      labelId: input.labelId,
      jobId: input.jobId ?? null,
      attempt: input.attempt ?? 0,
      signal: input.signal,
      context: {
        language: campaign?.contentLanguage === 'en' ? 'en' : 'nl',
        course,
        brand: null,
        personaProfile: current,
        channels: [...PRODUCIBLE_CHANNELS],
        material: materialForPrompt(material),
      },
    });

    // The same check a proposal gets: a citation that is not in the material we
    // handed the model has its grounding removed, so an invented source becomes
    // a visible assumption instead of passing as evidence.
    const verified = verifyOrientationSources(result.value.orientationSources, {
      findingSourceRefs: new Set(material.map((item) => item.ref)),
      course,
      hasBrand: false,
    });

    const seen = new Set(
      current.orientationSources.map((source) => source.statementNl.trim().toLowerCase()),
    );
    const added = verified.filter((source) => {
      const key = source.statementNl.trim().toLowerCase();
      if (key.length === 0 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const merged = [...current.orientationSources, ...added].slice(0, 8);

    const persona = await this.createVersion(db, user, {
      labelId: input.labelId,
      courseVersionId: current.courseVersionId,
      campaignId: current.campaignId ?? undefined,
      personaKey: current.personaKey,
      origin: current.origin,
      promptVersion: result.promptVersion,
      linkedCourseVersionIds: current.linkedCourseVersionIds,
      proposal: {
        name: current.name,
        summary: current.summary,
        need: current.need,
        motivation: current.motivation,
        barriers: current.barriers,
        decisionCriteria: current.decisionCriteria,
        relationToCourse: current.relationToCourse,
        grounding: current.grounding,
        assumptions: current.assumptions,
        orientationSources: merged,
        ...(current.questionnaire === undefined ? {} : { questionnaire: current.questionnaire }),
      },
    });

    const grounded = added.filter((source) => source.grounding !== null).length;
    const noteNl = [
      added.length === 0
        ? 'Er is niets toegevoegd: het materiaal zei hier niets bruikbaars over.'
        : `${String(added.length)} uitspraak(en) toegevoegd, waarvan ${String(grounded)} met een bron; de rest staat als aanname. Wat er al stond is ongewijzigd (versie ${String(persona.version)}).`,
      result.value.noteNl,
    ]
      .filter((part) => part.trim().length > 0)
      .join(' ');

    return {
      persona,
      addedNl: added.map((source) => source.statementNl),
      noteNl,
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
      /** Other course versions of the label this persona is also relevant for. */
      linkedCourseVersionIds?: readonly string[] | undefined;
    },
  ): Promise<PersonaVersion> {
    requireLabelPermission(user, input.labelId, 'persona:write');
    const personaKey = input.personaKey ?? `${input.campaignId ?? input.courseVersionId}:${slugify(input.proposal.name)}`;
    const linked = await this.verifiedCourseLinks(db, input.labelId, input.courseVersionId, input.linkedCourseVersionIds ?? []);

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
          orientationSources: input.proposal.orientationSources,
          questionnaire: input.proposal.questionnaire ?? {},
          linkedCourseVersionIds: linked,
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

      /*
       * A brief pinned to an older version of this persona needs a second look.
       *
       * The brief binds to persona *versions* on purpose, so the edit above
       * cannot rewrite it — but a briefing that was approved for an audience
       * described one way and is now described another has an approval that
       * no longer means what it meant. The same transition content already
       * makes when a course fact or a brand rule changes. Written here rather
       * than through `CampaignService`, which is constructed after this
       * service; the brief table is the only thing touched, and only its
       * review state.
       */
      if (next > 1) {
        const previous = await tx
          .select({ id: personaVersions.id })
          .from(personaVersions)
          .where(
            and(
              eq(personaVersions.labelId, input.labelId),
              eq(personaVersions.personaKey, personaKey),
              ne(personaVersions.id, row.id),
            ),
          );
        for (const version of previous) {
          await tx
            .update(briefVersions)
            .set({ reviewState: 'needs_rereview' })
            .where(
              and(
                eq(briefVersions.labelId, input.labelId),
                sql`${briefVersions.reviewState} IN ('draft', 'approved')`,
                sql`${briefVersions.personaVersionIds} @> ${JSON.stringify([version.id])}::jsonb`,
              ),
            );
        }
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
    patch: { [K in keyof PersonaInput]?: PersonaInput[K] | undefined },
  ): Promise<PersonaVersion> {
    const current = await this.requireVersion(db, labelId, versionId);

    // The same key and the same campaign: an edit is the next version of this
    // identity, in the scope it already had.
    return this.createVersion(db, user, {
      labelId,
      courseVersionId: current.courseVersionId,
      campaignId: current.campaignId ?? undefined,
      personaKey: current.personaKey,
      origin: 'user',
      linkedCourseVersionIds: patch.linkedCourseVersionIds ?? current.linkedCourseVersionIds,
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
        orientationSources: patch.orientationSources ?? current.orientationSources,
        questionnaire: patch.questionnaire ?? current.questionnaire ?? {},
      },
    });
  }

  /**
   * Copies a campaign persona into the library as a new identity.
   *
   * The original stays where it is, pinned to whatever briefing rests on it;
   * the copy has no campaign, a random key and origin `user` — a person chose
   * to keep it — and every field travels along, questionnaire and orientation
   * statements included. One grounding entry records which campaign it came
   * from, because a library persona that arrived without saying so would read
   * as research on the course rather than as an audience found for one
   * campaign. A persona that is already in the library is refused rather than
   * copied twice.
   */
  async promoteToLibrary(
    db: Db,
    user: CurrentUser,
    labelId: string,
    versionId: string,
  ): Promise<PersonaVersion> {
    requireLabelPermission(user, labelId, 'persona:write');
    const current = await this.requireVersion(db, labelId, versionId);
    if (current.campaignId === null) {
      throw new AppError('bad_request', {
        publicMessage: 'Deze doelgroep staat al in de bibliotheek.',
        internalDetail: 'promoteToLibrary called on a library persona',
      });
    }
    const [campaign] = await db
      .select({ id: campaigns.id, name: campaigns.name })
      .from(campaigns)
      .where(and(eq(campaigns.id, current.campaignId), eq(campaigns.labelId, labelId)))
      .limit(1);
    if (campaign === undefined) {
      throw AppError.notFoundOrForbidden('campaign', current.campaignId);
    }
    // The contract caps grounding at twenty entries; the provenance entry is
    // not worth dropping evidence for, so a full list is refused, not trimmed.
    if (current.grounding.length >= 20) {
      throw new AppError('bad_request', {
        publicMessage:
          'Deze doelgroep heeft al het maximale aantal bronverwijzingen. Verwijder er een voordat je hem in de bibliotheek opslaat.',
        internalDetail: 'promoteToLibrary: grounding list full',
      });
    }
    const provenance: Grounding = {
      kind: 'user_document',
      claim: `Overgenomen uit campagne ${campaign.name}`,
      sourceRef: `campagne:${campaign.id}`,
      retrievedAt: new Date().toISOString(),
    };
    return this.createVersion(db, user, {
      labelId,
      courseVersionId: current.courseVersionId,
      personaKey: randomUUID(),
      origin: 'user',
      promptVersion: current.promptVersion,
      linkedCourseVersionIds: current.linkedCourseVersionIds,
      proposal: {
        name: current.name,
        summary: current.summary,
        need: current.need,
        motivation: current.motivation,
        barriers: current.barriers,
        decisionCriteria: current.decisionCriteria,
        relationToCourse: current.relationToCourse,
        grounding: [...current.grounding, provenance],
        assumptions: current.assumptions,
        orientationSources: current.orientationSources,
        questionnaire: current.questionnaire ?? {},
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

/**
 * Keeps a statement's evidence only when we handed the model that source.
 *
 * - `external_source` / `user_document`: the reference must be one of the
 *   findings' source references, exactly.
 * - `course_fact`: the reference must name a confirmed fact's label.
 * - `brand_profile`: accepted when a brand profile was in the prompt.
 * - `observed_outcome`: never accepted here — a persona proposal is not
 *   handed outcome rows, so a citation of one cannot be checked.
 *
 * Anything else keeps its statement and loses its grounding: it is shown as an
 * assumption, and the channel plan may not move a verdict on it.
 */
export function verifyOrientationSources(
  sources: readonly OrientationSource[],
  known: {
    findingSourceRefs: ReadonlySet<string>;
    course: Pick<CourseVersion, 'name' | 'facts'>;
    hasBrand: boolean;
  },
): OrientationSource[] {
  const factLabels = statableFacts(known.course).map((fact) => fact.label.toLowerCase());
  return sources.map((source) => {
    const grounding = source.grounding;
    if (grounding === null) {
      return source;
    }
    const ref = grounding.sourceRef.trim();
    const traceable =
      grounding.kind === 'course_fact'
        ? factLabels.some((label) => ref.toLowerCase().includes(label))
        : grounding.kind === 'brand_profile'
          ? known.hasBrand
          : grounding.kind === 'observed_outcome'
            ? false
            : known.findingSourceRefs.has(ref);
    return traceable ? source : { ...source, grounding: null };
  });
}

/**
 * The form in which two persona names count as the same audience: lower-case,
 * diacritics folded, whitespace collapsed. "Carrièreswitcher" and
 * "carriereswitcher " are one name; "Carrièreswitcher in de zorg" is another.
 */
export function normalisePersonaName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
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
  personaKey: string;
  campaignId: string | null;
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
  orientationSources?: unknown;
  questionnaire?: unknown;
  linkedCourseVersionIds?: unknown;
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
    personaKey: row.personaKey,
    campaignId: row.campaignId,
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
    orientationSources: (row.orientationSources ?? []) as OrientationSource[],
    questionnaire: row.questionnaire ?? {},
    linkedCourseVersionIds: (row.linkedCourseVersionIds ?? []) as string[],
    reviewState: row.reviewState as ReviewState,
    origin: row.origin as PersonaVersion['origin'],
    promptVersion: row.promptVersion,
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
  };
}
