import { buildMarketPackage } from './package.js';
import { and, desc, eq, sql } from 'drizzle-orm';
import { jobs } from '../../core/db/schema.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { radarScanInput, packageSelection, radarReport } from '@c360/contracts';
import { requireLabelPermission } from '../../core/authz/policy.js';
import { currentUser } from '../../core/http/authenticate.js';
import { AppError } from '../../core/errors/app-error.js';
import { inspectUrl } from '../../core/net/index.js';
const courseParams = z.object({ labelId: z.uuid(), courseVersionId: z.uuid() });
const cardParams = z.object({
  labelId: z.uuid(),
  runId: z.uuid(),
  cardId: z.uuid(),
});
export const radarRoutes: FastifyPluginAsync = async (app) => {
  const { db, services } = app.appContext;
  app.get('/labels/:labelId/courses/:courseVersionId/radar/saved', async(request)=>{
    const p=courseParams.parse(request.params);const user=currentUser(request);
    requireLabelPermission(user,p.labelId,'research:read');
    const result=await db.execute(sql`SELECT s.run_id, s.card_id, r.report FROM radar_saved_cards s JOIN radar_runs r ON r.id=s.run_id WHERE r.label_id=${p.labelId} AND r.course_version_id=${p.courseVersionId} ORDER BY s.created_at DESC`);
    return {items:result.rows.flatMap(row=>{const report=radarReport.parse(row.report);const card=report.cards.find(c=>c.id===row.card_id);return card?[{runId:row.run_id,card,isMock:report.isMock}]:[];})};
  });
  app.post('/labels/:labelId/radar/:runId/cards/:cardId/save', async(request)=>{
    const p=cardParams.parse(request.params);const user=currentUser(request);
    requireLabelPermission(user,p.labelId,'campaign:write');
    const run=await services.radar.requireRun(db,user,p.labelId,p.runId);
    if(!run.report.cards.some(c=>c.id===p.cardId))throw AppError.notFoundOrForbidden('radar_card',p.cardId);
    await db.execute(sql`INSERT INTO radar_saved_cards(run_id,card_id) VALUES(${p.runId},${p.cardId}) ON CONFLICT DO NOTHING`);
    return {saved:true};
  });
  app.delete('/labels/:labelId/radar/:runId/cards/:cardId/save', async(request)=>{
    const p=cardParams.parse(request.params);const user=currentUser(request);
    requireLabelPermission(user,p.labelId,'campaign:write');
    await services.radar.requireRun(db,user,p.labelId,p.runId);
    await db.execute(sql`DELETE FROM radar_saved_cards WHERE run_id=${p.runId} AND card_id=${p.cardId}`);
    return {saved:false};
  });

  app.get(
    '/labels/:labelId/courses/:courseVersionId/radar',
    async (request) => {
      const p = courseParams.parse(request.params);
      const user = currentUser(request);
      const items = await services.radar.list(
        db,
        user,
        p.labelId,
        p.courseVersionId,
      );
      const [latest] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.labelId, p.labelId),
            eq(jobs.type, 'radar.scan'),
            sql`${jobs.payload}->>'courseVersionId' = ${p.courseVersionId}`,
          ),
        )
        .orderBy(desc(jobs.createdAt))
        .limit(1);
      const latestJob = latest
        ? await services.jobs.get(db, user, latest.id)
        : null;
      return { items, canDiscover: services.radar.canDiscover, latestJob };
    },
  );
  app.post(
    '/labels/:labelId/courses/:courseVersionId/radar/scan',
    async (request, reply) => {
      const p = courseParams.parse(request.params);
      const user = currentUser(request);
      requireLabelPermission(user, p.labelId, 'research:run');
      await services.courses.requireVersion(db, p.labelId, p.courseVersionId);
      const body = radarScanInput.parse(request.body ?? {});
      if (body.deliverables.length)
        throw new AppError('validation_failed', { publicMessage: 'Maak eerst een campagne en keur de briefing goed; kies daarna het contentpakket.' });
      if (body.discover && !services.radar.canDiscover)
        throw new AppError('capability_unavailable', {
          publicMessage:
            'Webzoeken is niet beschikbaar. Voeg bronlinks toe en schakel automatisch zoeken uit.',
        });
      if (!body.discover && !body.urls.length)
        throw new AppError('validation_failed', {
          publicMessage:
            'Voeg minimaal één bronlink toe of schakel webzoeken in.',
        });
      for (const url of body.urls)
        if (
          !inspectUrl(url, {
            allowedHostSuffixes: [],
            allowInsecureHttp: false,
          }).ok
        )
          throw new AppError('validation_failed', {
            publicMessage: 'Gebruik uitsluitend openbare HTTPS-bronlinks.',
          });
      const latest = (
        await services.radar.list(db, user, p.labelId, p.courseVersionId)
      )[0];
      const result = await services.generationJobs.enqueue(db, user, {
        labelId: p.labelId,
        type: 'radar.scan',
        intent: [
          'radar',
          p.courseVersionId,
          latest?.id ?? 'initial',
          JSON.stringify(body),
        ],
        payload: { courseVersionId: p.courseVersionId, ...body },
        requestId: request.id,
      });
      return reply.code(result.created ? 202 : 200).send(result.summary);
    },
  );
  app.get('/labels/:labelId/radar/:runId/package', async (request, reply) => {
    const p = z.object({ labelId: z.uuid(), runId: z.uuid() }).parse(request.params);
    const query = z.object({ parts: z.string().default('') }).parse(request.query);
    const selected = packageSelection.parse(query.parts ? query.parts.split(',') : []);
    const user = currentUser(request);
    if (selected.length) throw new AppError('conflict', { publicMessage: 'Content maak je voortaan na de briefing, vanuit de campagne. Hier download je alleen het onderzoek.' });
    requireLabelPermission(user, p.labelId, 'export:create_draft');
    const run = await services.radar.requireRun(db, user, p.labelId, p.runId);
    const course = await services.courses.requireVersion(db, p.labelId, run.courseVersionId);
    const buffer = await buildMarketPackage(run, selected, course.name);
    return reply.header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="CONCEPT-marktpakket-${run.id}.zip"`)
      .header('cache-control', 'private, no-store').send(buffer);
  });
  app.post('/labels/:labelId/radar/:runId/keywords/:keywordId/campaign', async (request, reply) => {
    const p = z.object({ labelId: z.uuid(), runId: z.uuid(), keywordId: z.uuid() }).parse(request.params);
    return reply.code(201).send(await services.radar.campaignFromKeyword(db, currentUser(request), p.labelId, p.runId, p.keywordId));
  });
  app.post(
    '/labels/:labelId/radar/:runId/audience/:findingId/campaign',
    async (request, reply) => {
      const p = z
        .object({ labelId: z.uuid(), runId: z.uuid(), findingId: z.uuid() })
        .parse(request.params);
      return reply
        .code(201)
        .send(
          await services.radar.campaignFromAudience(
            db,
            currentUser(request),
            p.labelId,
            p.runId,
            p.findingId,
          ),
        );
    },
  );
  app.get(
    '/labels/:labelId/radar/:runId/ads/:adId/preview',
    async (request, reply) => {
      const p = z
        .object({ labelId: z.uuid(), runId: z.uuid(), adId: z.uuid() })
        .parse(request.params);
      const image = await services.radar.adPreview(
        db,
        currentUser(request),
        p.labelId,
        p.runId,
        p.adId,
      );
      return reply
        .header('content-type', 'image/png')
        .header('cache-control', 'private, max-age=300')
        .send(image);
    },
  );
  app.post(
    '/labels/:labelId/radar/:runId/ads/:adId/campaign',
    async (request, reply) => {
      const p = z
        .object({ labelId: z.uuid(), runId: z.uuid(), adId: z.uuid() })
        .parse(request.params);
      return reply
        .code(201)
        .send(
          await services.radar.campaignFromAd(
            db,
            currentUser(request),
            p.labelId,
            p.runId,
            p.adId,
          ),
        );
    },
  );
  app.get(
    '/labels/:labelId/radar/:runId/cards/:cardId/preview',
    async (request, reply) => {
      const p = cardParams.parse(request.params);
      const image = await services.radar.preview(
        db,
        currentUser(request),
        p.labelId,
        p.runId,
        p.cardId,
      );
      return reply
        .header('content-type', 'image/webp')
        .header('cache-control', 'private, max-age=300')
        .send(image);
    },
  );
  app.post(
    '/labels/:labelId/radar/:runId/cards/:cardId/campaign',
    async (request, reply) => {
      const p = cardParams.parse(request.params);
      const body = z
        .object({ approachIndex: z.number().int().min(0).max(2) })
        .parse(request.body);
      const campaign = await services.radar.createCampaign(
        db,
        currentUser(request),
        p.labelId,
        p.runId,
        p.cardId,
        body.approachIndex,
      );
      return reply.code(201).send(campaign);
    },
  );
};
