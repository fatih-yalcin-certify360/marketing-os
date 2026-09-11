import { requireLabelPermission } from '../../core/authz/policy.js';
import { ImageRenderer } from '../../core/render/renderer.js';
import { loadRenderResources } from '../../core/render/brand-resources.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { BRAND_STARTING_POINT, brandProfileInput } from '@c360/contracts';
import { authenticate, currentUser } from '../../core/http/authenticate.js';

const labelParams = z.object({ labelId: z.uuid() });
const versionParams = labelParams.extend({ versionId: z.uuid() });

export const brandRoutes: FastifyPluginAsync = async (app) => {
  const { db, services, env } = app.appContext;

  /**
   * Current brand state for a label.
   *
   * Returns the approved profile *and* the latest draft separately, because the
   * editing screen needs both: what is live, and what is being worked on.
   * `startingPoint` is an obvious placeholder for a label with nothing yet —
   * never a guess at the real brand.
   */
  app.get('/labels/:labelId/brand', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    await services.labels.requireAccessible(db, user, labelId);

    const [approved, latest] = await Promise.all([
      services.brand.approved(db, labelId),
      services.brand.latest(db, labelId),
    ]);

    return {
      portal: await services.brand.portal?.status(db, labelId),
      approved: approved ?? null,
      latest: latest ?? null,
      startingPoint: BRAND_STARTING_POINT,
    };
  });

  app.get('/labels/:labelId/brand/versions', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    const items = await services.brand.listVersions(db, user, labelId, 25);
    return { items, nextCursor: null };
  });

  app.post('/labels/:labelId/brand/portal/sync', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    requireLabelPermission(user, labelId, 'brand:write');
    const { slug } = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).optional() }).parse(request.body ?? {});
    if (slug) await services.brand.portal?.connect(db, user, labelId, slug);
    else await services.brand.portal?.refresh(db, labelId, true);
    return { approved: await services.brand.approved(db, labelId), portal: await services.brand.portal?.status(db, labelId) };
  });

  app.get('/labels/:labelId/brand/preview.png', { preHandler: authenticate }, async (request, reply) => {
    const { labelId } = labelParams.parse(request.params);
    requireLabelPermission(currentUser(request), labelId, 'brand:read');
    const brand = await services.brand.requireApproved(db, labelId);
    const resources = await loadRenderResources(db, env.STORAGE_ROOT, brand);
    const preview = await new ImageRenderer(env.STORAGE_ROOT).render(labelId, {
      layout: 'quiet_editorial', variant: 'A', widthPx: 1200, heightPx: 1200,
      headline: brand.brandName, subline: 'Voorbeeld van de gekoppelde huisstijl', ctaText: 'Bekijk de opleiding',
      logoText: brand.logoText, headingFamily: brand.typography.headingFamily, bodyFamily: brand.typography.bodyFamily,
      colors: { background: brand.colors.primary, foreground: brand.colors.onPrimary, accent: brand.colors.accent },
    }, resources);
    return reply.header('Cache-Control', 'private, no-store').type('image/png').send(preview.png);
  });

  /** Saves a new draft version. Never mutates an existing one. */
  app.post('/labels/:labelId/brand', { preHandler: authenticate }, async (request, reply) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    const body = brandProfileInput.parse(request.body);
    const saved = await services.brand.saveDraft(db, user, labelId, body);
    return reply.status(201).send(saved);
  });

  app.post(
    '/labels/:labelId/brand/:versionId/approve',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const { labelId, versionId } = versionParams.parse(request.params);
      const note = z
        .object({ noteNl: z.string().max(1_000).nullable().default(null) })
        .parse(request.body ?? {});
      return services.brand.approve(db, user, labelId, versionId, note.noteNl);
    },
  );
};
