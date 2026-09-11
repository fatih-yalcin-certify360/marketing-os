import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  COURSE_FACT_LABEL_NL,
  confirmedFacts,
  courseFactField,
  courseInput,
  unconfirmedFacts,
} from '@c360/contracts';
import { authenticate, currentUser } from '../../core/http/authenticate.js';
import { AppError } from '../../core/errors/app-error.js';
import { inspectUrl } from '../../core/net/index.js';

const labelParams = z.object({ labelId: z.uuid() });
const versionParams = labelParams.extend({ versionId: z.uuid() });

export const courseRoutes: FastifyPluginAsync = async (app) => {
  const { db, env, services } = app.appContext;

  app.get('/labels/:labelId/courses', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    const items = await services.courses.listLatestPerCourse(db, user, labelId, 50);

    // The per-field verification state is what the review screen is built
    // around, so it is summarised here rather than recomputed in the browser.
    return {
      items: items.map((course) => ({
        course,
        confirmed: confirmedFacts(course).map((field) => COURSE_FACT_LABEL_NL[field]),
        unconfirmed: unconfirmedFacts(course).map((field) => COURSE_FACT_LABEL_NL[field]),
      })),
      factLabels: COURSE_FACT_LABEL_NL,
      nextCursor: null,
    };
  });

  app.get('/labels/:labelId/courses/:versionId', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { labelId, versionId } = versionParams.parse(request.params);
    await services.labels.requireAccessible(db, user, labelId);
    const course = await services.courses.requireVersion(db, labelId, versionId);
    return {
      course,
      confirmed: confirmedFacts(course),
      unconfirmed: unconfirmedFacts(course),
    };
  });

  /**
   * Proposes a course card from an uploaded document.
   *
   * Queued like the URL path. The asset is only referenced here; it is resolved
   * label-scoped inside the job, so an id belonging to another label reads as
   * absent rather than forbidden.
   */
  app.post(
    '/labels/:labelId/courses/extract-from-document',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const { labelId } = labelParams.parse(request.params);
      const body = z
        .object({
          assetId: z.uuid(),
          courseKey: z.string().min(1).max(200).optional(),
        })
        .parse(request.body);

      const { summary, created } = await services.generationJobs.enqueue(db, user, {
        labelId,
        type: 'course.extract_from_documents',
        // The asset identifies the work, so a double click collapses onto one
        // job rather than reading and paying twice.
        intent: ['course-extract-doc', body.assetId],
        payload: {
          assetId: body.assetId,
          ...(body.courseKey === undefined ? {} : { courseKey: body.courseKey }),
        },
        requestId: request.id,
        clientAddress: request.socket.remoteAddress,
      });

      return reply.status(created ? 202 : 200).send(summary);
    },
  );

  /**
   * Proposes a course card from a course page.
   *
   * Queued, like every generating step: the fetch plus a model call is well
   * past what a request should hold open (ADR-0016). The URL is validated here
   * only for shape — the SSRF guard runs inside the job, on every redirect hop.
   */
  app.post(
    '/labels/:labelId/courses/extract-from-url',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const { labelId } = labelParams.parse(request.params);
      const body = z
        .object({
          url: z.string().min(1).max(2_000),
          /** Set to revise an existing card instead of creating a new one. */
          courseKey: z.string().min(1).max(200).optional(),
        })
        .parse(request.body);

      /*
       * Everything decidable from the URL alone is decided here.
       *
       * `inspectUrl` is pure — scheme, credentials, port, hostname shape, IP
       * literal, allow-list — so there is no reason to defer it. Deferring it
       * was a real defect: `file:///etc/passwd` and
       * `http://169.254.169.254/` both came back as **202 Accepted** with a job
       * id, so the user watched a progress bar for a URL that would never be
       * fetched, a budget reservation was held for it, and a queue slot was
       * spent. `z.url()` does not help: it accepts any scheme.
       *
       * The *address* check stays in the job, and must: DNS can resolve
       * differently a second later, so it has to happen next to the connection.
       */
      const guard = inspectUrl(body.url, {
        allowedHostSuffixes: env.RESEARCH_ALLOWED_HOST_SUFFIXES,
        allowInsecureHttp: env.RESEARCH_ALLOW_HTTP,
      });
      if (!guard.ok) {
        throw new AppError('bad_request', {
          publicMessage: guard.reasonNl,
          internalDetail: `course page URL refused at enqueue: ${guard.finding}`,
          context: { reason: guard.code },
        });
      }

      const { summary, created } = await services.generationJobs.enqueue(db, user, {
        labelId,
        type: 'course.extract_from_url',
        // The URL identifies the work, so a double click collapses onto one job
        // rather than fetching and paying twice.
        intent: ['course-extract', guard.url.toString()],
        payload: {
          url: guard.url.toString(),
          ...(body.courseKey === undefined ? {} : { courseKey: body.courseKey }),
        },
        requestId: request.id,
        clientAddress: request.socket.remoteAddress,
      });

      return reply.status(created ? 202 : 200).send(summary);
    },
  );

  app.post('/labels/:labelId/courses', { preHandler: authenticate }, async (request, reply) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    const body = courseInput.extend({ courseKey: z.string().max(60).optional() }).parse(request.body);
    const saved = await services.courses.saveDraft(db, user, labelId, body);
    return reply.status(201).send(saved);
  });

  /**
   * Confirms named factual fields.
   *
   * Explicit per field: confirming "everything" in one click would defeat the
   * purpose of tracking who took responsibility for which fact.
   */
  app.post(
    '/labels/:labelId/courses/:versionId/confirm',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const { labelId, versionId } = versionParams.parse(request.params);
      const body = z
        .object({ fields: z.array(courseFactField).min(1).max(8) })
        .parse(request.body);
      return services.courses.confirmFacts(db, user, labelId, versionId, body.fields);
    },
  );

  app.post(
    '/labels/:labelId/courses/:versionId/approve',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const { labelId, versionId } = versionParams.parse(request.params);
      const note = z
        .object({ noteNl: z.string().max(1_000).nullable().default(null) })
        .parse(request.body ?? {});
      return services.courses.approve(db, user, labelId, versionId, note.noteNl);
    },
  );
};
