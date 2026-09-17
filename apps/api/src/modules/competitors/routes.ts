import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireLabelPermission } from '../../core/authz/policy.js';
import { AppError } from '../../core/errors/app-error.js';
import { currentUser } from '../../core/http/authenticate.js';
import { fillSocialsFromWebsite, listCompetitors, saveCompetitor } from './service.js';

const params = z.object({ labelId: z.uuid() });
const withId = params.extend({ id: z.uuid() });

export const competitorRoutes: FastifyPluginAsync = async app => {
  const { db, env } = app.appContext;
  const root = '/labels/:labelId/competitors';
  app.get(root, async request => {
    const { labelId } = params.parse(request.params);
    requireLabelPermission(currentUser(request), labelId, 'research:read');
    const query = z.object({ courseVersionId: z.uuid().optional() }).parse(request.query);
    let courseKey: string | null = null;
    if (query.courseVersionId) {
      const course = await db.execute(sql`SELECT course_key FROM course_versions WHERE id=${query.courseVersionId} AND label_id=${labelId}`);
      if (!course.rows[0]) throw AppError.notFoundOrForbidden('course_version', query.courseVersionId);
      courseKey = String(course.rows[0].course_key);
    }
    return { items: await listCompetitors(db, labelId), courseKey };
  });
  app.post(root, request => saveCompetitor(db, currentUser(request), params.parse(request.params).labelId, request.body));
  app.post(`${root}/:id`, request => {
    const { labelId, id } = withId.parse(request.params);
    return saveCompetitor(db, currentUser(request), labelId, request.body, id);
  });

  /*
   * Reads the competitor's own website and fills the social pages it publishes.
   *
   * A fetch, not a question to a model: asked for "the LinkedIn page of X" a
   * model returns a confident URL that may belong to someone else, and there is
   * no way to tell from the answer. Every link here came off a page we read, and
   * the response says which page (2026-09-15).
   */
  app.post(`${root}/:id/socials`, async request => {
    const { labelId, id } = withId.parse(request.params);
    return fillSocialsFromWebsite(db, currentUser(request), labelId, id, env);
  });
};
