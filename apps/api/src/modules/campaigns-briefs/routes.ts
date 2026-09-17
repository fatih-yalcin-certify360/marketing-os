import {createHash} from 'node:crypto';
import {personaTextInput} from '@c360/contracts';
import { pageQuery, personaListScope } from '@c360/contracts';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { assets, campaigns } from '../../core/db/schema.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  briefEditInput,
  buildCampaignCalendar,
  campaignObjective,
  createCampaignInput,
  GATE_LABEL_NL,
  personaInput,
  plannableContentPlan,
} from '@c360/contracts';
import { PROMPT_VERSIONS } from '../../core/ai/prompts.js';
import { AppError } from '../../core/errors/app-error.js';
import { authenticate, currentUser } from '../../core/http/authenticate.js';

/**
 * The campaign chain over HTTP.
 *
 * **Every generating endpoint enqueues a job and returns it.** None of them
 * calls a model in the request, so no user request can time out however slow
 * the provider is: the response is a `JobSummary` the client polls, and the
 * work happens on the worker (ADR-0016).
 *
 * The read endpoint (`GET .../campaigns/:id`) assembles everything the screen
 * needs, including the server's gate evaluation, so the browser never has to
 * decide what "ready" means.
 */

const labelParams = z.object({ labelId: z.uuid() });
const campaignParams = labelParams.extend({ campaignId: z.uuid() });

export const campaignRoutes: FastifyPluginAsync = async (app) => {
  const { db, services } = app.appContext;

  /**
   * Chooses (or clears) the campaign's start date.
   *
   * `z.iso.date()` rather than a free string: a calendar built from an
   * unparseable date would silently produce nonsense dates rather than
   * refusing. Nullable, so a date chosen too early can be removed and the
   * calendar returns to its relative form.
   */
  app.patch(
    '/labels/:labelId/campaigns/:campaignId/start-date',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const { labelId, campaignId } = campaignParams.parse(request.params);
      const { startDate } = z
        .object({ startDate: z.iso.date().nullable() })
        .parse(request.body);
      return services.campaigns.setStartDate(db, user, labelId, campaignId, startDate);
    },
  );

  /**
   * Sets the objective of a campaign created before objectives existed.
   *
   * Not nullable: an objective is chosen, not un-chosen — the plan and the
   * content that follow are argued from it. New campaigns set it at creation.
   */
  app.patch(
    '/labels/:labelId/campaigns/:campaignId/objective',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const { labelId, campaignId } = campaignParams.parse(request.params);
      const { objective } = z.object({ objective: campaignObjective }).parse(request.body);
      return services.campaigns.setObjective(db, user, labelId, campaignId, objective);
    },
  );

  app.patch('/labels/:labelId/campaigns/:campaignId/visual-references', { preHandler: authenticate }, async request => {
    const user = currentUser(request);
    const { labelId, campaignId } = campaignParams.parse(request.params);
    requireLabelPermission(user, labelId, 'campaign:write');
    await services.campaigns.requireById(db, labelId, campaignId);
    const { assetIds } = z.object({ assetIds: z.array(z.uuid()).max(3) }).parse(request.body);
    const ids = [...new Set(assetIds)];
    const rows = ids.length ? await db.select().from(assets).where(and(eq(assets.labelId, labelId), inArray(assets.id, ids))) : [];
    if (rows.length !== ids.length || rows.some(row => row.kind !== 'upload' ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(row.mimeType) || row.byteSize > 10 * 1_048_576)) {
      throw new AppError('bad_request', { publicMessage: 'Kies maximaal drie PNG-, JPEG- of WebP-beelden van dit label (maximaal 10 MB per beeld).' });
    }
    await db.update(campaigns).set({ visualReferenceAssetIds: ids }).where(and(eq(campaigns.id, campaignId), eq(campaigns.labelId, labelId)));
    return services.campaigns.requireById(db, labelId, campaignId);
  });

  // ------------------------------------------------------------ personas ---

  app.post('/labels/:labelId/courses/:courseVersionId/personas/extract-from-text', {preHandler:authenticate}, async(request,reply)=>{
    const user=currentUser(request);const params=labelParams.extend({courseVersionId:z.uuid()}).parse(request.params);
    requireLabelPermission(user,params.labelId,'persona:write');
    await services.courses.requireVersion(db,params.labelId,params.courseVersionId);
    const input=personaTextInput.parse(request.body);
    const queued=await services.generationJobs.enqueue(db,user,{labelId:params.labelId,type:'persona.extract_from_text',
      intent:['persona-text',user.userId,params.courseVersionId,input.requestKey,createHash('sha256').update(input.text).digest('hex')],
      payload:{...input,courseVersionId:params.courseVersionId},requestId:request.id});
    return reply.code(202).send(queued.summary);
  });

  app.post('/labels/:labelId/courses/:courseVersionId/personas', { preHandler: authenticate }, async (request, reply) => {
    const user=currentUser(request);
    const params=labelParams.extend({courseVersionId:z.uuid()}).parse(request.params);
    requireLabelPermission(user,params.labelId,'persona:write');
    await services.courses.requireVersion(db,params.labelId,params.courseVersionId);
    const { linkedCourseVersionIds, ...proposal } = personaInput.parse(request.body);
    const result = await services.personas.createVersion(db, user, {
      ...params,
      proposal,
      personaKey: randomUUID(),
      origin: 'user',
      linkedCourseVersionIds,
    });
    return reply.code(201).send(result);
  });

  app.get(
    '/labels/:labelId/courses/:courseVersionId/personas',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const params = labelParams.extend({ courseVersionId: z.uuid() }).parse(request.params);
      // `scope` defaults to what the call meant before scopes existed: the
      // campaign's personas when a campaign is named, else the library.
      const { campaignId, scope } = z
        .object({ campaignId: z.uuid().optional(), scope: personaListScope.optional() })
        .parse(request.query);
      if (campaignId) await services.campaigns.requireById(db, params.labelId, campaignId);
      const items = await services.personas.listForCourse(
        db,
        user,
        params.labelId,
        params.courseVersionId,
        campaignId,
        scope ?? (campaignId === undefined ? 'library' : 'campaign'),
      );
      return { items, nextCursor: null };
    },
  );

  app.post(
    '/labels/:labelId/courses/:courseVersionId/personas/propose',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const params = labelParams.extend({ courseVersionId: z.uuid() }).parse(request.params);
      const { campaignId } = z.object({ campaignId: z.uuid().optional() }).parse(request.body ?? {});
      if (campaignId) {
        const campaign = await services.campaigns.requireById(db, params.labelId, campaignId);
        if (campaign.courseVersionId !== params.courseVersionId) throw AppError.notFoundOrForbidden('campaign', campaignId);
      }
      const { summary, created } = await services.generationJobs.enqueue(db, user, {
        labelId: params.labelId,
        type: 'persona.propose',
        intent: ['personas', params.courseVersionId, campaignId ?? 'course'],
        payload: { courseVersionId: params.courseVersionId, ...(campaignId ? { campaignId } : {}) },
        requestId: request.id,
        clientAddress: request.socket.remoteAddress,
      });
      return reply.status(created ? 202 : 200).send(summary);
    },
  );

  app.patch(
    '/labels/:labelId/personas/:personaVersionId',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const params = labelParams.extend({ personaVersionId: z.uuid() }).parse(request.params);
      const patch = personaInput.partial().parse(request.body);
      return services.personas.edit(db, user, params.labelId, params.personaVersionId, patch);
    },
  );

  /**
   * Lets the system answer the open questions of a stored persona's
   * questionnaire from its own material (2026-09-14). One job, one call; the
   * result is the next version of the same persona, answered questions kept.
   */
  app.post(
    '/labels/:labelId/personas/:personaVersionId/questionnaire/fill',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const params = labelParams.extend({ personaVersionId: z.uuid() }).parse(request.params);
      requireLabelPermission(user, params.labelId, 'persona:write');
      const persona = await services.personas.requireVersion(db, params.labelId, params.personaVersionId);
      const { summary, created } = await services.generationJobs.enqueue(db, user, {
        labelId: params.labelId,
        type: 'persona.fill_questionnaire',
        intent: ['persona-questionnaire', persona.id],
        payload: { personaVersionId: persona.id },
        requestId: request.id,
        clientAddress: request.socket.remoteAddress,
      });
      return reply.status(created ? 202 : 200).send(summary);
    },
  );

  /**
   * Researches where a stored audience orients (2026-09-16).
   *
   * The field the channel plan leans on, for a persona that has none: one job,
   * one call over the persona's own course, campaign input and research. It
   * adds and never overwrites, so a statement somebody typed stays as typed.
   */
  app.post(
    '/labels/:labelId/personas/:personaVersionId/orientation/fill',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const params = labelParams.extend({ personaVersionId: z.uuid() }).parse(request.params);
      requireLabelPermission(user, params.labelId, 'persona:write');
      const persona = await services.personas.requireVersion(db, params.labelId, params.personaVersionId);
      const { summary, created } = await services.generationJobs.enqueue(db, user, {
        labelId: params.labelId,
        type: 'persona.fill_orientation',
        intent: ['persona-orientation', persona.id],
        payload: { personaVersionId: persona.id },
        requestId: request.id,
        clientAddress: request.socket.remoteAddress,
      });
      return reply.status(created ? 202 : 200).send(summary);
    },
  );

  /**
   * Moves a campaign to the currently approved version of its own course
   * (audit 2026-09-15). Flags the briefing and the content for re-review,
   * because both quote facts from the card that may have changed.
   */
  app.post(
    '/labels/:labelId/campaigns/:campaignId/course-version',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const params = labelParams.extend({ campaignId: z.uuid() }).parse(request.params);
      return services.campaigns.repointToCurrentCourse(db, user, params.labelId, params.campaignId);
    },
  );

  /** Copies a campaign persona into the library; the original stays in its campaign. */
  app.post(
    '/labels/:labelId/personas/:personaVersionId/library',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const params = labelParams.extend({ personaVersionId: z.uuid() }).parse(request.params);
      const promoted = await services.personas.promoteToLibrary(
        db,
        user,
        params.labelId,
        params.personaVersionId,
      );
      return reply.code(201).send(promoted);
    },
  );

  // ------------------------------------------------------- opportunities ---

  app.post(
    '/labels/:labelId/opportunities/propose',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const { labelId } = labelParams.parse(request.params);
      const body = z
        .object({
          courseVersionId: z.uuid(),
          personaVersionIds: z.array(z.uuid()).min(1).max(3),
        })
        .parse(request.body);
      const { summary, created } = await services.generationJobs.enqueue(db, user, {
        labelId,
        type: 'opportunity.propose',
        // Sorted so the same selection in a different click order is one job.
        intent: ['opportunities', body.courseVersionId, ...[...body.personaVersionIds].sort()],
        payload: body,
        requestId: request.id,
        clientAddress: request.socket.remoteAddress,
      });
      return reply.status(created ? 202 : 200).send(summary);
    },
  );

  app.get('/labels/:labelId/opportunities/:setId', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const params = labelParams.extend({ setId: z.uuid() }).parse(request.params);
    const items = await services.opportunities.listForSet(db, user, params.labelId, params.setId);
    return { items, nextCursor: null };
  });

  app.post(
    '/labels/:labelId/opportunities/:opportunityId/select',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const params = labelParams.extend({ opportunityId: z.uuid() }).parse(request.params);
      return services.opportunities.select(db, user, params.labelId, params.opportunityId);
    },
  );

  // ----------------------------------------------------------- campaigns ---

  app.get('/labels/:labelId/campaigns', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    // Fifty by default: the list screen shows a label's campaigns in one go
    // and asks for the next page only when there is one.
    const query = pageQuery.extend({ limit: pageQuery.shape.limit.removeDefault().default(50) }).parse(request.query);
    return services.campaigns.list(db, user, labelId, query);
  });

  app.post('/labels/:labelId/campaigns', { preHandler: authenticate }, async (request, reply) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    const body = createCampaignInput.parse(request.body);
    const created = await services.campaigns.create(db, user, labelId, body);
    return reply.status(201).send(created);
  });

  /**
   * Everything the campaign screen needs, in one call.
   *
   * Assembled server-side so the browser never has to decide what "ready"
   * means — the gate evaluation is the server's answer, computed from rows.
   */
  app.get(
    '/labels/:labelId/campaigns/:campaignId',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const { labelId, campaignId } = campaignParams.parse(request.params);

      const campaign = await services.campaigns.requireById(db, labelId, campaignId);
      const [brief, approvedBrief, concepts, plan, assets, exportRecords, gates, outcomes] =
        await Promise.all([
          services.campaigns.latestBrief(db, campaignId),
          services.campaigns.approvedBrief(db, campaignId),
          services.concepts.list(db, user, labelId, campaignId),
          services.concepts.latestPlan(db, campaignId),
          services.content.list(db, user, labelId, campaignId),
          services.exports.list(db, user, labelId, campaignId),
          services.exports.evaluateGates(db, user, labelId, campaignId),
          // The list route already knows whether results were recorded; this one
          // hardcoded `false` in the browser, so step 8 never ticked on the
          // detail screen while the same campaign showed as finished in the
          // list (audit 2026-09-15). One source, both screens.
          services.outcomes.listOutcomes(db, user, labelId, campaignId),
        ]);

      const personas = await services.personas.findManyByIds(
        db,
        labelId,
        brief?.personaVersionIds ?? [],
      );

      /*
       * The calendar is derived here, not stored.
       *
       * It is a pure function of the approved plan, the chosen start date and
       * the course's *confirmed* dates, so computing it on read means it can
       * never disagree with any of them. Storing it would add a fourth thing
       * to keep in step with three others.
       *
       * `course.dates` is only populated once someone has confirmed the date
       * fact; the unconfirmed prose is deliberately not parsed, and the flag
       * below is what lets the calendar say it is ignoring it.
       */
      const course = await services.courses.findVersion(db, labelId, campaign.courseVersionId);
      const datesFact = course?.facts.dates;
      const calendar = buildCampaignCalendar({
        // The stored plan row wraps the plan itself, alongside its version
        // and review state.
        plan: plan?.plan ?? null,
        startDate: campaign.startDate,
        courseDates: course?.dates ?? [],
        courseDatesUnconfirmed:
          datesFact !== undefined &&
          datesFact.value !== null &&
          datesFact.state !== 'user_confirmed',
      });

      return {
        campaign,
        brief: brief ?? null,
        briefApproved: approvedBrief !== undefined,
        personas,
        concepts,
        selectedConcept: concepts.find((concept) => concept.selected) ?? null,
        plan: plan ?? null,
        calendar,
        assets,
        exports: exportRecords,
        gates: {
          passed: [...gates.passed],
          blockedReasonsNl: gates.reasonsNl,
          labels: GATE_LABEL_NL,
        },
        hasOutcomes: outcomes.length > 0,
        // Surfaced so the UI can label every generated artefact as mock output.
        aiIsMock: services.generation.isMock,
        aiProvider: services.generation.providerName,
      };
    },
  );

  // -------------------------------------------------------------- briefs ---

  app.post(
    '/labels/:labelId/campaigns/:campaignId/brief/draft',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const { labelId, campaignId } = campaignParams.parse(request.params);
      const body = z
        .object({ personaVersionIds: z.array(z.uuid()).min(1).max(3) })
        .parse(request.body);

      // Refuse before enqueueing. The work runs on the worker, so without this
      // an impossible request would come back as an accepted job.
      await services.campaigns.assertCanDraftBrief(
        db,
        user,
        labelId,
        campaignId,
        body.personaVersionIds,
      );

      const currentBrief = await services.campaigns.latestBrief(db, campaignId);
      const { summary, created } = await services.generationJobs.enqueue(db, user, {
        labelId,
        type: 'brief.draft',
        intent: ['brief', campaignId, PROMPT_VERSIONS['brief.draft'], String(currentBrief?.version ?? 0), ...[...body.personaVersionIds].sort()],
        payload: { campaignId, personaVersionIds: body.personaVersionIds },
        requestId: request.id,
        clientAddress: request.socket.remoteAddress,
      });
      return reply.status(created ? 202 : 200).send(summary);
    },
  );

  app.patch(
    '/labels/:labelId/campaigns/:campaignId/brief',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const { labelId, campaignId } = campaignParams.parse(request.params);
      const patch = briefEditInput.parse(request.body);
      return services.campaigns.editBrief(db, user, labelId, campaignId, patch);
    },
  );

  app.post(
    '/labels/:labelId/campaigns/:campaignId/brief/:briefVersionId/approve',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const params = campaignParams.extend({ briefVersionId: z.uuid() }).parse(request.params);
      const note = z
        .object({ noteNl: z.string().max(1_000).nullable().default(null) })
        .parse(request.body ?? {});
      return services.campaigns.approveBrief(
        db,
        user,
        params.labelId,
        params.campaignId,
        params.briefVersionId,
        note.noteNl,
      );
    },
  );

  app.post(
    '/labels/:labelId/campaigns/:campaignId/opportunity',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const { labelId, campaignId } = campaignParams.parse(request.params);
      const body = z.object({ opportunityId: z.uuid() }).parse(request.body);
      return services.campaigns.attachOpportunity(
        db,
        user,
        labelId,
        campaignId,
        body.opportunityId,
      );
    },
  );

  // ------------------------------------------------------------ concepts ---

  app.post(
    '/labels/:labelId/campaigns/:campaignId/concepts/propose',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const { labelId, campaignId } = campaignParams.parse(request.params);

      /*
       * The gate is checked twice, and both are needed.
       *
       * Here, so an unapproved brief is a 409 the user can act on rather than
       * an accepted job that fails a minute later with a budget reservation
       * held against it. And again in the handler against the state at run
       * time, because un-approving the brief after enqueue must still refuse,
       * and approving it after enqueue must not be a way to have skipped the
       * check.
       */
      await services.concepts.assertCanPropose(db, user, labelId, campaignId);
      const sourceBrief = await services.campaigns.requireApprovedBrief(db, campaignId);

      const { summary, created } = await services.generationJobs.enqueue(db, user, {
        labelId,
        type: 'concept.propose',
        intent: ['concepts', campaignId, sourceBrief.id, PROMPT_VERSIONS['concept.propose']],
        payload: { campaignId },
        requestId: request.id,
        clientAddress: request.socket.remoteAddress,
      });
      return reply.status(created ? 202 : 200).send(summary);
    },
  );

  app.post(
    '/labels/:labelId/campaigns/:campaignId/concepts/:conceptVersionId/select',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const params = campaignParams.extend({ conceptVersionId: z.uuid() }).parse(request.params);
      return services.concepts.select(
        db,
        user,
        params.labelId,
        params.campaignId,
        params.conceptVersionId,
      );
    },
  );

  // -------------------------------------------------------- content plan ---

  app.post(
    '/labels/:labelId/campaigns/:campaignId/plan/propose',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const { labelId, campaignId } = campaignParams.parse(request.params);
      await services.concepts.assertCanProposePlan(db, user, labelId, campaignId);

      const { summary, created } = await services.generationJobs.enqueue(db, user, {
        labelId,
        type: 'content.plan',
        intent: ['plan', campaignId],
        payload: { campaignId },
        requestId: request.id,
        clientAddress: request.socket.remoteAddress,
      });
      return reply.status(created ? 202 : 200).send(summary);
    },
  );

  app.post(
    '/labels/:labelId/campaigns/:campaignId/plan/approve',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const { labelId, campaignId } = campaignParams.parse(request.params);
      // An edited plan is approved as a new version, so the approval binds to
      // what the user agreed to rather than the original proposal.
      // The narrow form: a user must not be able to approve a plan for a
      // channel this build cannot produce either.
      const body = z
        .object({ edited: plannableContentPlan.nullable().default(null) })
        .parse(request.body ?? {});
      return services.concepts.approvePlan(db, user, labelId, campaignId, body.edited);
    },
  );
};
