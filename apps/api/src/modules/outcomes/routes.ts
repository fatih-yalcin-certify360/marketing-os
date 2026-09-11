import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { outcomeInput, publicationInput } from '@c360/contracts';
import { authenticate, currentUser } from '../../core/http/authenticate.js';

const campaignParams = z.object({ labelId: z.uuid(), campaignId: z.uuid() });

/**
 * Recording what happened after the product's part was done (P4-1).
 *
 * Deliberately plain: these routes parse, delegate and return. Every rule that
 * could be got wrong lives either in the contract (a period the wrong way
 * round, a platform-report row with no report, a row with no figure) or in the
 * database (the same three, plus non-negative counts) — so there is nothing
 * here for a reviewer to check twice.
 *
 * Nothing in this module publishes or sends anything. It records that a person
 * did.
 */
export const outcomeRoutes: FastifyPluginAsync = async (app) => {
  const { db, services } = app.appContext;

  app.get(
    '/labels/:labelId/campaigns/:campaignId/publications',
    { preHandler: authenticate },
    async (request) => {
      const { labelId, campaignId } = campaignParams.parse(request.params);
      const items = await services.outcomes.listPublications(
        db,
        currentUser(request),
        labelId,
        campaignId,
      );
      return { items, nextCursor: null };
    },
  );

  app.post(
    '/labels/:labelId/campaigns/:campaignId/publications',
    { preHandler: authenticate },
    async (request, reply) => {
      const { labelId, campaignId } = campaignParams.parse(request.params);
      const body = publicationInput.parse(request.body);
      const record = await services.outcomes.recordPublication(
        db,
        currentUser(request),
        labelId,
        campaignId,
        body,
      );
      return reply.status(201).send(record);
    },
  );

  app.get(
    '/labels/:labelId/campaigns/:campaignId/outcomes',
    { preHandler: authenticate },
    async (request) => {
      const { labelId, campaignId } = campaignParams.parse(request.params);
      const items = await services.outcomes.listOutcomes(
        db,
        currentUser(request),
        labelId,
        campaignId,
      );
      return { items, nextCursor: null };
    },
  );

  app.post(
    '/labels/:labelId/campaigns/:campaignId/outcomes',
    { preHandler: authenticate },
    async (request, reply) => {
      const { labelId, campaignId } = campaignParams.parse(request.params);
      const body = outcomeInput.parse(request.body);
      const record = await services.outcomes.recordOutcome(
        db,
        currentUser(request),
        labelId,
        campaignId,
        body,
      );
      return reply.status(201).send(record);
    },
  );
};
