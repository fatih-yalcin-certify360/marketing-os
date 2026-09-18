import {personaTextInput} from '@c360/contracts';
import { z } from 'zod';
import { CHANNEL_LABEL_NL, FUNNEL_STAGE_LABEL_NL, geoStartInput, radarScanInput, campaignPackageInput } from '@c360/contracts';
import type { CurrentUser } from '@c360/contracts';
import type { Db } from '@c360/api/db';
import type { GenerationDeps } from '@c360/api/generation-deps';
import { defineHandler, JobFailure, JobCancelled, type JobContext, type RegisteredHandler } from './types.js';

/**
 * Generation job handlers.
 *
 * This is what removes request timeouts entirely: an HTTP request enqueues a
 * job and returns immediately, and every provider call happens here, where a
 * five-minute model response is normal rather than a failure. Progress is
 * committed between steps, so a page reload or a worker restart never loses
 * finished work.
 *
 * Each handler is thin on purpose. The business rules and the gates live in the
 * services, which the API and the worker share — so moving a stage onto the
 * queue changed *where* it runs and nothing about *what it enforces*.
 *
 * Cost flows the other way: the job reserved a pessimistic estimate at enqueue
 * time, each provider call returns what it actually cost, and the handler sums
 * those into `actualCostCents`. The runner settles the difference once, so a
 * job can never be charged twice or leave a reservation stranded.
 */

/** Every generation job carries who asked for it and in which label. */
const basePayload = z.object({
  labelId: z.uuid(),
  /** The requesting user, re-resolved so authorisation is re-checked here. */
  userId: z.uuid(),
});

const personaPayload = basePayload.extend({ courseVersionId: z.uuid(), campaignId: z.uuid().optional() });
const opportunityPayload = basePayload.extend({
  courseVersionId: z.uuid(),
  personaVersionIds: z.array(z.uuid()).min(1).max(3),
});
const briefPayload = basePayload.extend({
  campaignId: z.uuid(),
  personaVersionIds: z.array(z.uuid()).min(1).max(3),
});
const campaignPayload = basePayload.extend({ campaignId: z.uuid() });
/**
 * One piece outside any campaign.
 *
 * Everything the generator needs travels in the payload: there is no briefing
 * and no concept to read it back from, so the requester's own sentence *is* the
 * instruction and has to survive the hop to the worker intact.
 */
const standalonePayload = basePayload.extend({
  courseVersionId: z.uuid(),
  channel: z.string().min(1).max(60),
  stage: z.string().min(1).max(40).nullable(),
  angleNl: z.string().min(10).max(4_000),
  originKind: z.string().min(1).max(40),
  originRefId: z.uuid().nullable(),
  ctaUrl: z.string().max(2_000).nullable(),
  // Optional so a job queued before personas could be chosen still parses.
  personaVersionId: z.uuid().nullable().default(null),
});

const revisePayload = basePayload.extend({
  assetId: z.uuid(),
  instructionNl: z.string().min(3).max(2_000),
  expectedVersion: z.number().int().min(1),
  scope: z.enum(['copy', 'images', 'both']),
  acceptOverwritingUserEdit: z.boolean(),
});

/**
 * Re-resolves the requesting user inside the job.
 *
 * Authorisation is *not* inherited from the enqueue: a membership revoked
 * between enqueue and execution must take effect, so the services re-check
 * against freshly loaded memberships. A user who lost access sees the job fail
 * rather than have work done on their behalf.
 */
async function resolveActor(deps: GenerationDeps, db: Db, userId: string): Promise<CurrentUser> {
  const user = await deps.identity.resolveById(db, userId);
  if (user === undefined) {
    throw new JobFailure(
      'validation_failed',
      'De gebruiker die deze taak heeft gestart, bestaat niet meer of heeft geen toegang.',
      `user ${userId} could not be resolved`,
    );
  }
  return user;
}

const courseDocumentPayload = z.object({
  labelId: z.uuid(),
  userId: z.uuid(),
  assetId: z.uuid(),
  courseKey: z.string().min(1).max(200).optional(),
});

const researchPayload = z.object({
  labelId: z.uuid(),
  userId: z.uuid(),
  courseVersionId: z.uuid(),
});

const courseExtractPayload = z.object({
  labelId: z.uuid(),
  userId: z.uuid(),
  url: z.url().max(2_000),
  courseKey: z.string().min(1).max(200).optional(),
});

/** Progress helper: reports a step and stops cleanly if ownership was lost. */
async function step(
  context: JobContext,
  percent: number,
  message: string,
  completed: number,
  total: number,
): Promise<void> {
  const owned = await context.reportProgress({
    percent,
    message,
    completedUnits: completed,
    totalUnits: total,
  });
  if (!owned) {
    // Another worker owns this job now; continuing would risk a double write.
    throw new JobFailure(
      'internal_error',
      'De verwerking is overgenomen door een andere verwerker en hier gestopt.',
      'lost job ownership mid-run',
    );
  }
}

export function createGenerationHandlers(deps: GenerationDeps): RegisteredHandler[] {
  return [
    defineHandler({
      type: 'course.extract_from_url',
      parsePayload: (payload) => courseExtractPayload.parse(payload),
      run: async (payload, context) => {
        const user = await resolveActor(deps, context.db, payload.userId);

        const result = await deps.courses.extractFromUrl(context.db, user, {
          labelId: payload.labelId,
          url: payload.url,
          courseKey: payload.courseKey,
          jobId: context.jobId,
          attempt: context.attempt,
          // The fetch and the extraction are separately slow, so progress is
          // reported from inside the service rather than around it.
          onProgress: async (percent, messageNl) => {
            await step(context, percent, messageNl, percent >= 100 ? 1 : 0, 1);
          },
        });

        await step(context, 100, 'Opleidingskaart voorgesteld', 1, 1);
        return {
          result: {
            courseVersionId: result.course.id,
            version: result.course.version,
            sourceUrl: result.sourceUrl,
            retrievedAt: result.retrievedAt.toISOString(),
            overallUncertaintyNl: result.overallUncertaintyNl,
            isMock: result.isMock,
          },
          actualCostCents: await context.spentCents(),
        };
      },
    }),
    defineHandler({
      type: 'course.extract_from_documents',
      parsePayload: (payload) => courseDocumentPayload.parse(payload),
      run: async (payload, context) => {
        const user = await resolveActor(deps, context.db, payload.userId);

        const result = await deps.courses.extractFromDocument(context.db, user, {
          labelId: payload.labelId,
          assetId: payload.assetId,
          courseKey: payload.courseKey,
          jobId: context.jobId,
          attempt: context.attempt,
          onProgress: async (percent, messageNl) => {
            await step(context, percent, messageNl, percent >= 100 ? 1 : 0, 1);
          },
        });

        await step(context, 100, 'Opleidingskaart voorgesteld', 1, 1);
        return {
          result: {
            courseVersionId: result.course.id,
            version: result.course.version,
            sourceRef: result.sourceRef,
            overallUncertaintyNl: result.overallUncertaintyNl,
            isMock: result.isMock,
          },
          actualCostCents: await context.spentCents(),
        };
      },
    }),
    defineHandler({
      type: 'campaign.package',
      parsePayload: (payload) => { const base=campaignPayload.parse(payload); return {...base,...campaignPackageInput.parse(payload)}; },
      run: async(payload,context)=>{
        const user=await resolveActor(deps,context.db,payload.userId);
        await step(context,10,'Actuele merkregels en goedgekeurde briefing controleren',0,1);
        const result=await deps.campaignPackages.generate(context.db,user,{...payload,jobId:context.jobId,attempt:context.attempt,progress:async(percent,message)=>{await step(context,percent,message,0,1);}});
        await step(context,100,payload.mode==='recommend'?'Contentvormen voorgesteld':'Campagnepakket gemaakt',1,1);
        return {result:{packageId:result.id},actualCostCents:await context.spentCents()};
      },
    }),
    defineHandler({
      type: 'geo.research',
      parsePayload: payload=>basePayload.extend(geoStartInput.shape).parse(payload),
      run: async(payload,context)=>{
        const user=await resolveActor(deps,context.db,payload.userId);
        const report=await deps.geo.research(context.db,user,{...payload,jobId:context.jobId,attempt:context.attempt,progress:async(percent,message)=>{await step(context,percent,message,0,1);}});
        await step(context,100,'GEO-onderzoek opgeslagen',1,1);
        return {result:{reportId:report.id,isMock:report.isMock},actualCostCents:await context.spentCents()};
      },
    }),
    defineHandler({
      type: 'radar.scan',
      parsePayload: payload => researchPayload.extend(radarScanInput.shape).parse(payload),
      run: async (payload, context) => {
        const user = await resolveActor(deps, context.db, payload.userId);
        const run = await deps.radar.scan(context.db, user, { ...payload, jobId: context.jobId, attempt: context.attempt,
          progress: async (percent, message) => { await step(context, percent, message, 0, 1); } });
        await step(context, 100, `${String(run.report.cards.length)} onderbouwde kansen gevonden`, 1, 1);
        return { result: { runId: run.id, cardCount: run.report.cards.length, isMock: run.report.isMock }, actualCostCents: await context.spentCents() };
      },
    }),
    defineHandler({
      type: 'research.run',
      parsePayload: (payload) => researchPayload.parse(payload),
      run: async (payload, context) => {
        const user = await resolveActor(deps, context.db, payload.userId);

        const result = await deps.research.run(context.db, user, {
          labelId: payload.labelId,
          courseVersionId: payload.courseVersionId,
          jobId: context.jobId,
          attempt: context.attempt,
          onProgress: async (percent, messageNl) => {
            await step(context, percent, messageNl, percent >= 100 ? 1 : 0, 1);
          },
        });

        await step(
          context,
          100,
          `${String(result.findings.length)} bevindingen vastgelegd`,
          1,
          1,
        );
        return {
          result: {
            runId: result.run.id,
            version: result.run.version,
            findingCount: result.findings.length,
            sourcesRead: result.readCount,
            sourcesFailed: result.failedCount,
            shortfallReasonNl: result.run.shortfallReasonNl,
            isMock: result.isMock,
          },
          actualCostCents: await context.spentCents(),
        };
      },
    }),
    defineHandler({
      type:'persona.extract_from_text',
      parsePayload:payload=>basePayload.extend({courseVersionId:z.uuid(),...personaTextInput.shape}).parse(payload),
      run:async(payload,context)=>{
        const user=await resolveActor(deps,context.db,payload.userId);
        await step(context,10,'Aangeleverde tekst omzetten naar een personavoorstel',0,1);
        const draft=await deps.personas.extractFromText(context.db,user,{...payload,jobId:context.jobId,attempt:context.attempt});
        await step(context,100,'Voorstel klaar om te controleren; nog niet als persona opgeslagen',1,1);
        return {result:draft,actualCostCents:await context.spentCents()};
      },
    }),
    /*
     * Where one audience orients, researched on its own.
     *
     * A persona written by hand or imported from a document has an empty
     * orientation list, and the channel plan leans on exactly that field. It
     * adds and never overwrites, so pressing it twice is harmless.
     */
    defineHandler({
      type: 'persona.fill_orientation',
      parsePayload: (payload) => basePayload.extend({ personaVersionId: z.uuid() }).parse(payload),
      run: async (payload, context) => {
        const user = await resolveActor(deps, context.db, payload.userId);
        await step(context, 15, 'Oriëntatiegedrag wordt onderzocht uit onderzoek en opleidingskaart', 0, 1);
        const result = await deps.personas.fillOrientation(context.db, user, {
          labelId: payload.labelId,
          personaVersionId: payload.personaVersionId,
          jobId: context.jobId,
          attempt: context.attempt,
        });
        await step(
          context,
          100,
          result.addedNl.length === 0
            ? 'Niets gevonden om toe te voegen'
            : `${String(result.addedNl.length)} uitspraak(en) toegevoegd; versie ${String(result.persona.version)} opgeslagen`,
          1,
          1,
        );
        return {
          result: {
            personaVersionId: result.persona.id,
            previousVersionId: payload.personaVersionId,
            addedCount: result.addedNl.length,
            noteNl: result.noteNl,
            isMock: result.isMock,
          },
          actualCostCents: await context.spentCents(),
        };
      },
    }),
    defineHandler({
      type: 'persona.fill_questionnaire',
      parsePayload: (payload) => basePayload.extend({ personaVersionId: z.uuid() }).parse(payload),
      run: async (payload, context) => {
        const user = await resolveActor(deps, context.db, payload.userId);
        await step(context, 10, 'Open personavragen worden beantwoord uit onderzoek en opleidingskaart', 0, 1);
        const result = await deps.personas.fillQuestionnaire(context.db, user, {
          labelId: payload.labelId,
          personaVersionId: payload.personaVersionId,
          jobId: context.jobId,
          attempt: context.attempt,
        });
        await step(
          context,
          100,
          result.filledIds.length === 0
            ? 'Geen open vraag om aan te vullen'
            : `${String(result.filledIds.length)} vragen aangevuld; versie ${String(result.persona.version)} opgeslagen`,
          1,
          1,
        );
        return {
          result: {
            personaVersionId: result.persona.id,
            previousVersionId: payload.personaVersionId,
            filledCount: result.filledIds.length,
            stillOpenCount: result.stillOpenIds.length,
            noteNl: result.noteNl,
            isMock: result.isMock,
          },
          actualCostCents: await context.spentCents(),
        };
      },
    }),
    defineHandler({
      type: 'persona.propose',
      parsePayload: (payload) => personaPayload.parse(payload),
      run: async (payload, context) => {
        const user = await resolveActor(deps, context.db, payload.userId);
        await step(context, 10, 'Opleidingsinformatie wordt gelezen', 0, 1);

        const result = await deps.personas.propose(context.db, user, {
          labelId: payload.labelId,
          courseVersionId: payload.courseVersionId,
          campaignId: payload.campaignId,
          jobId: context.jobId,
          attempt: context.attempt,
        });

        await step(context, 100, `${String(result.personas.length)} doelgroepen gemaakt`, 1, 1);
        return {
          result: {
            personaIds: result.personas.map((persona) => persona.id),
            shortfallReasonNl: result.shortfallReasonNl,
            questionnaireNoteNl: result.questionnaireNoteNl,
            isMock: result.isMock,
          },
          actualCostCents: await context.spentCents(),
        };
      },
    }),

    defineHandler({
      type: 'opportunity.propose',
      parsePayload: (payload) => opportunityPayload.parse(payload),
      run: async (payload, context) => {
        const user = await resolveActor(deps, context.db, payload.userId);
        await step(context, 10, 'Doelgroepen worden gelezen', 0, 1);

        const result = await deps.opportunities.propose(context.db, user, {
          labelId: payload.labelId,
          courseVersionId: payload.courseVersionId,
          personaVersionIds: payload.personaVersionIds,
          jobId: context.jobId,
          attempt: context.attempt,
        });

        await step(context, 100, `${String(result.opportunities.length)} kansen gemaakt`, 1, 1);
        return {
          result: {
            proposalSetId: result.proposalSetId,
            opportunityIds: result.opportunities.map((item) => item.id),
            shortfallReasonNl: result.shortfallReasonNl,
          },
          actualCostCents: await context.spentCents(),
        };
      },
    }),

    defineHandler({
      type: 'brief.draft',
      parsePayload: (payload) => briefPayload.parse(payload),
      run: async (payload, context) => {
        const user = await resolveActor(deps, context.db, payload.userId);
        await step(context, 15, 'Briefing wordt opgesteld', 0, 1);

        const brief = await deps.campaigns.draftBrief(context.db, user, {
          labelId: payload.labelId,
          campaignId: payload.campaignId,
          personaVersionIds: payload.personaVersionIds,
          jobId: context.jobId,
          attempt: context.attempt,
        });

        await step(context, 100, `Briefing v${String(brief.version)} klaar`, 1, 1);
        return {
          result: { briefVersionId: brief.id, version: brief.version },
          actualCostCents: await context.spentCents(),
        };
      },
    }),

    defineHandler({
      type: 'concept.propose',
      parsePayload: (payload) => campaignPayload.parse(payload),
      run: async (payload, context) => {
        const user = await resolveActor(deps, context.db, payload.userId);
        await step(context, 15, 'Concepten worden gemaakt', 0, 1);

        const result = await deps.concepts.propose(context.db, user, {
          labelId: payload.labelId,
          campaignId: payload.campaignId,
          jobId: context.jobId,
          attempt: context.attempt,
        });

        await step(context, 100, `${String(result.concepts.length)} concepten klaar`, 1, 1);
        return {
          result: { conceptIds: result.concepts.map((concept) => concept.id) },
          actualCostCents: await context.spentCents(),
        };
      },
    }),

    defineHandler({
      type: 'content.plan',
      parsePayload: (payload) => campaignPayload.parse(payload),
      run: async (payload, context) => {
        const user = await resolveActor(deps, context.db, payload.userId);
        await step(context, 20, 'Kanaalplan wordt voorgesteld', 0, 1);

        const result = await deps.concepts.proposePlan(context.db, user, {
          labelId: payload.labelId,
          campaignId: payload.campaignId,
          jobId: context.jobId,
          attempt: context.attempt,
        });

        await step(context, 100, 'Kanaalplan klaar', 1, 1);
        return {
          result: { planId: result.planId, version: result.version },
          actualCostCents: await context.spentCents(),
        };
      },
    }),

    /**
     * The longest job: one provider call for the copy, then two rendered images
     * per channel. Progress is reported per channel so the user sees movement
     * rather than a spinner for a minute.
     */
    defineHandler({
      type: 'content.generate',
      parsePayload: (payload) => campaignPayload.parse(payload),
      run: async (payload, context) => {
        const user = await resolveActor(deps, context.db, payload.userId);
        await step(context, 10, 'Content wordt geschreven', 0, 2);

        const result = await deps.content.generate(context.db, user, {
          labelId: payload.labelId,
          campaignId: payload.campaignId,
          jobId: context.jobId,
          attempt: context.attempt,
          beforeVisual: async () => { if (await context.isCancellationRequested()) throw new JobCancelled(); },
          onChannelDone: async (channel, done, total, stage) => {
            await step(
              context,
              20 + Math.round((done / Math.max(1, total)) * 75),
              `${stage === null ? '' : `${FUNNEL_STAGE_LABEL_NL[stage]} · `}${CHANNEL_LABEL_NL[channel]}: tekst en beeld klaar`,
              done,
              total,
            );
          },
        });

        await step(context, 100, `${String(result.assets.length)} contentitems klaar`, 2, 2);
        return {
          // The campaign travels back so the notice can link to the step that
          // now holds the content, rather than to the list of campaigns.
          result: {
            campaignId: payload.campaignId,
            assetIds: result.assets.map((asset) => asset.id),
            isMock: result.isMock,
          },
          actualCostCents: await context.spentCents(),
        };
      },
    }),

    /*
     * A loose piece, written on the queue.
     *
     * It used to be written inside the request, which meant the person sat in
     * front of a spinner for as long as the model took — and for an image
     * channel that is two renders on top of the text. The work is the same; the
     * waiting is not the requester's any more (2026-09-15).
     */
    defineHandler({
      type: 'content.standalone',
      parsePayload: (payload) => standalonePayload.parse(payload),
      run: async (payload, context) => {
        const user = await resolveActor(deps, context.db, payload.userId);
        await step(context, 15, 'De uiting wordt geschreven', 0, 1);

        const asset = await deps.content.generateStandalone(context.db, user, {
          labelId: payload.labelId,
          courseVersionId: payload.courseVersionId,
          channel: payload.channel as Parameters<typeof deps.content.generateStandalone>[2]['channel'],
          funnelStage: payload.stage as Parameters<typeof deps.content.generateStandalone>[2]['funnelStage'],
          angleNl: payload.angleNl,
          personaVersionId: payload.personaVersionId,
          origin: {
            kind: payload.originKind as Parameters<typeof deps.content.generateStandalone>[2]['origin']['kind'],
            refId: payload.originRefId,
          },
          ctaUrl: payload.ctaUrl,
          beforeVisual: async () => {
            if (await context.isCancellationRequested()) throw new JobCancelled();
          },
          onProgress: async (percent, message) => {
            await step(context, percent, message, 0, 1);
          },
        });

        await step(context, 100, `${CHANNEL_LABEL_NL[asset.channel]} klaar`, 1, 1);
        return {
          result: { assetId: asset.id, channel: asset.channel, hook: asset.copy.hook },
          actualCostCents: await context.spentCents(),
        };
      },
    }),

    defineHandler({
      type: 'content.revise',
      parsePayload: (payload) => revisePayload.parse(payload),
      run: async (payload, context) => {
        const user = await resolveActor(deps, context.db, payload.userId);
        await step(context, 20, 'Herziening wordt gemaakt', 0, 1);

        const revised = await deps.content.revise(context.db, user, payload.labelId, payload.assetId, {
          instructionNl: payload.instructionNl,
          expectedVersion: payload.expectedVersion,
          scope: payload.scope,
          acceptOverwritingUserEdit: payload.acceptOverwritingUserEdit,
          jobId: context.jobId,
          attempt: context.attempt,
          beforeVisual: async () => { if (await context.isCancellationRequested()) throw new JobCancelled(); },
        });

        await step(context, 100, `Versie ${String(revised.version)} klaar`, 1, 1);
        return {
          result: { assetId: revised.id, version: revised.version },
          actualCostCents: await context.spentCents(),
        };
      },
    }),
  ];
}
