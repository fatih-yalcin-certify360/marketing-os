import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { attachToCampaignInput, contentEditInput, contentReviseInput, exportKind, standaloneContentInput } from '@c360/contracts';
import { authenticate, currentUser } from '../../core/http/authenticate.js';
import { assets } from '../../core/db/schema.js';
import { AppError } from '../../core/errors/app-error.js';
import { buildEmailHtml } from '../../core/render/email-html.js';
import { renderDossierDocx } from '../../core/render/dossier-docx.js';
import { renderDossierPdf } from '../../core/render/dossier-pdf.js';

const labelParams = z.object({ labelId: z.uuid() });
const campaignParams = labelParams.extend({ campaignId: z.uuid() });
const assetParams = labelParams.extend({ assetId: z.uuid() });

export const contentRoutes: FastifyPluginAsync = async (app) => {
  const { db, env, services } = app.appContext;

  app.get(
    '/labels/:labelId/campaigns/:campaignId/content',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const { labelId, campaignId } = campaignParams.parse(request.params);
      const items = await services.content.list(db, user, labelId, campaignId);
      return { items, nextCursor: null };
    },
  );

  /**
   * Queues content production.
   *
   * The longest job in the product: one text call plus two rendered images per
   * channel. It returns a job the client polls, so a slow model can never time
   * out a request.
   */
  app.post(
    '/labels/:labelId/campaigns/:campaignId/content/generate',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const { labelId, campaignId } = campaignParams.parse(request.params);
      // Refused here as well as in the handler: this is the expensive step, and
      // a missing approval should not first surface as a failed job.
      await services.content.assertCanGenerate(db, user, labelId, campaignId);

      const { summary, created } = await services.generationJobs.enqueue(db, user, {
        labelId,
        type: 'content.generate',
        intent: ['content', campaignId],
        payload: { campaignId },
        requestId: request.id,
        clientAddress: request.socket.remoteAddress,
      });
      return reply.status(created ? 202 : 200).send(summary);
    },
  );

  app.get(
    '/labels/:labelId/campaigns/:campaignId/content/:assetKey/versions',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const params = campaignParams
        .extend({ assetKey: z.string().min(1).max(120) })
        .parse(request.params);
      const items = await services.content.listVersions(
        db,
        user,
        params.labelId,
        params.campaignId,
        params.assetKey,
      );
      return { items, nextCursor: null };
    },
  );

  /**
   * One piece of content outside any campaign.
   *
   * Runs in the request rather than as a background job: it is one piece and
   * one provider call, and the person who asked for it is waiting for it. A
   * campaign's content step makes up to twenty-seven and is a job for that
   * reason (2026-09-15).
   */
  app.post('/labels/:labelId/content/standalone', { preHandler: authenticate }, async (request, reply) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    const body = standaloneContentInput.parse(request.body);

    /*
     * Queued rather than written inside the request.
     *
     * The requester used to watch a spinner for as long as the model took, and
     * for an image channel that is two renders on top of the text. They get a
     * job back, carry on, and are told when it lands (2026-09-15).
     */
    const { summary, created } = await services.generationJobs.enqueue(db, user, {
      labelId,
      type: 'content.standalone',
      intent: ['content-standalone', body.courseVersionId, body.channel, body.angleNl.slice(0, 120)],
      payload: {
        courseVersionId: body.courseVersionId,
        channel: body.channel,
        stage: body.stage,
        angleNl: body.angleNl,
        originKind: body.originKind,
        originRefId: body.originRefId,
        ctaUrl: body.ctaUrl,
        personaVersionId: body.personaVersionId,
      },
      requestId: request.id,
      clientAddress: request.socket.remoteAddress,
    });
    return reply.status(created ? 202 : 200).send(summary);
  });

  /** Everything this label made outside a campaign. */
  app.get('/labels/:labelId/content/standalone', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    const items = await services.content.listStandalone(db, user, labelId);
    return { items, nextCursor: null };
  });

  /** Gives a standalone piece a campaign, after the fact. */
  app.post('/labels/:labelId/content/:assetId/campaign', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { labelId, assetId } = assetParams.parse(request.params);
    const body = attachToCampaignInput.parse(request.body);
    return services.content.attachToCampaign(db, user, labelId, assetId, body.campaignId);
  });

  /**
   * Withdraws a piece from the campaign.
   *
   * `DELETE` because that is what it means to the reader, but nothing is
   * removed: every version of the piece is archived so approvals and earlier
   * exports keep pointing at something real. Without this, one piece on a
   * channel whose specification is not verified blocked every publish-ready
   * export of the campaign for good (2026-09-15).
   */
  app.delete(
    '/labels/:labelId/campaigns/:campaignId/content/:assetId',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const params = campaignParams.extend({ assetId: z.uuid() }).parse(request.params);
      return services.content.withdraw(db, user, params.labelId, params.campaignId, params.assetId);
    },
  );

  /** Direct text edit. Creates a new version; the previous one is kept. */
  app.patch('/labels/:labelId/content/:assetId', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { labelId, assetId } = assetParams.parse(request.params);
    const body = contentEditInput.parse(request.body);
    return services.content.editCopy(db, user, labelId, assetId, body);
  });

  /**
   * AI revision of one asset, from the user's own instruction.
   *
   * `acceptOverwritingUserEdit` must be sent explicitly when the version was
   * hand-edited, so a manual rewrite cannot be lost by accident.
   */
  app.post(
    '/labels/:labelId/content/:assetId/revise',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const { labelId, assetId } = assetParams.parse(request.params);
      const body = contentReviseInput
        .extend({ acceptOverwritingUserEdit: z.boolean().default(false) })
        .parse(request.body);

      // The hand-edit guard is checked here as well as in the handler, so the
      // user gets an immediate 409 instead of discovering it in a failed job.
      await services.content.assertRevisable(db, user, labelId, assetId, body);

      const { summary, created } = await services.generationJobs.enqueue(db, user, {
        labelId,
        type: 'content.revise',
        // The instruction is part of the intent: a different instruction is
        // different work, the same one twice is not.
        intent: ['revise', assetId, String(body.expectedVersion), body.scope, body.instructionNl],
        payload: {
          assetId,
          instructionNl: body.instructionNl,
          expectedVersion: body.expectedVersion,
          scope: body.scope,
          acceptOverwritingUserEdit: body.acceptOverwritingUserEdit,
        },
        requestId: request.id,
        clientAddress: request.socket.remoteAddress,
      });
      return reply.status(created ? 202 : 200).send(summary);
    },
  );

  app.post(
    '/labels/:labelId/content/:assetId/approve',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const { labelId, assetId } = assetParams.parse(request.params);
      const note = z
        .object({ noteNl: z.string().max(1_000).nullable().default(null) })
        .parse(request.body ?? {});
      return services.content.approve(db, user, labelId, assetId, note.noteNl);
    },
  );

  /**
   * Authorised image download.
   *
   * There is deliberately no public or guessable URL for a rendered image:
   * every read goes through this route, which checks label access first. The
   * stored path is server-generated and re-validated against STORAGE_ROOT
   * before the file is opened (threat T-07).
   */
  /**
   * The e-mail as HTML, for a preview.
   *
   * Served rather than embedded in JSON so the browser can put it in a
   * sandboxed frame and show what a recipient would see. Three headers do the
   * work of keeping that safe:
   *
   *  - `Content-Security-Policy: sandbox` — the document gets no origin, so
   *    even if it somehow contained script it could not reach our session. The
   *    HTML is generated from plain text and cannot contain script
   *    (`core/render/email-html.ts`), so this is the second of two independent
   *    reasons rather than the only one.
   *  - `X-Content-Type-Options: nosniff` — served as HTML because it *is*
   *    HTML, never guessed.
   *  - `Cache-Control: private, no-store` — an unapproved draft for one label.
   *
   * Nothing is sent from here. This endpoint produces a document.
   */
  app.get(
    '/labels/:labelId/campaigns/:campaignId/content/:assetId/email.html',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const params = campaignParams.extend({ assetId: z.uuid() }).parse(request.params);
      const assetsList = await services.content.list(db, user, params.labelId, params.campaignId);
      const asset = assetsList.find((item) => item.id === params.assetId);

      if (asset?.channel !== 'email') {
        // A non-e-mail asset reads as absent rather than as "wrong channel":
        // the id came from the client and must not become an oracle.
        throw AppError.notFoundOrForbidden('content', params.assetId);
      }

      const brand = await services.brand.requireCurrent(db, params.labelId);
      const html = buildEmailHtml({
        asset,
        brand,
        draftNoticeNl:
          'VOORBEELD — dit is een concept. Er wordt niets verzonden en de weergave verschilt per e-mailclient.',
      });

      return reply
        .header('content-type', 'text/html; charset=utf-8')
        /*
         * `style-src 'unsafe-inline'` is required, and is safe here.
         *
         * An e-mail is styled with inline `style` attributes because that is
         * what mail clients honour — so `default-src 'none'` alone blocked
         * every one of them and the preview rendered as unstyled text, which
         * is worse than no preview: it shows the user something that is not
         * what a recipient sees. The browser smoke run is what caught it.
         *
         * What makes the allowance safe is that no part of the CSS is
         * attacker-controlled: colours are hex-validated and font names are
         * matched against a font-name character set before they reach a
         * declaration (`email-html.ts`). The document is also origin-less
         * under `sandbox` and contains no script.
         */
        .header('content-security-policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'")
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, no-store')
        .send(html);
    },
  );

  /**
   * One piece of content as a document, to keep or to hand over.
   *
   * ## What is in it
   *
   * The label and the course it was made for, who asked for it and when, the
   * audience it was written for with everything the system knows about that
   * audience, the instruction it was written from, and then the text itself.
   * The parts are assembled once (`dossier.ts`) and only the file format
   * differs between these two routes.
   *
   * ## Built on request, not stored
   *
   * There is no dossier row and no file in storage. The document is a view of
   * the piece and everything around it, and all of that changes — a persona is
   * revised, a piece is approved. A stored file would start disagreeing with
   * the product the day after it was written, and nobody would know which of
   * the two was right. Building it per request costs a few hundred
   * milliseconds and cannot go stale.
   *
   * A read, so `content:read` is enough: a viewer may take away what they are
   * already allowed to look at.
   */
  app.get(
    '/labels/:labelId/content/:assetId/dossier.docx',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const { labelId, assetId } = assetParams.parse(request.params);
      const dossier = await services.content.dossierFor(
        db, user, labelId, assetId, new Date().toISOString(),
      );
      const file = await renderDossierDocx(dossier);
      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('content-length', String(file.byteLength))
        // The name is folded to letters, digits and hyphens when the dossier is
        // built, so it cannot carry a quote, a slash or a newline into this header.
        .header('content-disposition', `attachment; filename="${dossier.fileName}.docx"`)
        // A draft of one label, often unapproved: never in a shared cache.
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(file);
    },
  );

  app.get(
    '/labels/:labelId/content/:assetId/dossier.pdf',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const { labelId, assetId } = assetParams.parse(request.params);
      const dossier = await services.content.dossierFor(
        db, user, labelId, assetId, new Date().toISOString(),
      );
      const file = Buffer.from(await renderDossierPdf(dossier));
      return reply
        .header('content-type', 'application/pdf')
        .header('content-length', String(file.byteLength))
        .header('content-disposition', `attachment; filename="${dossier.fileName}.pdf"`)
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(file);
    },
  );

  app.get('/labels/:labelId/assets/:assetId/file', { preHandler: authenticate }, async (request, reply) => {
    const user = currentUser(request);
    const { labelId, assetId } = assetParams.parse(request.params);
    await services.labels.requireAccessible(db, user, labelId);

    const rows = await db
      .select({
        storagePath: assets.storagePath,
        mimeType: assets.mimeType,
        byteSize: assets.byteSize,
        kind: assets.kind,
      })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.labelId, labelId)))
      .limit(1);

    const asset = rows[0];
    if (asset === undefined) {
      throw AppError.notFoundOrForbidden('asset', assetId);
    }

    const absolute = path.resolve(env.STORAGE_ROOT, asset.storagePath);
    const root = path.resolve(env.STORAGE_ROOT);
    if (!absolute.startsWith(root + path.sep)) {
      throw new AppError('internal_error', {
        internalDetail: 'stored asset path escapes STORAGE_ROOT',
      });
    }

    try {
      await stat(absolute);
    } catch {
      throw AppError.notFoundOrForbidden('asset', assetId);
    }

    return reply
      .header('content-type', asset.mimeType)
      .header('content-length', String(asset.byteSize))
      // Never render an attachment inline from this origin.
      .header('content-disposition', asset.kind === 'export' ? 'attachment' : 'inline')
      .header('cache-control', 'private, max-age=300')
      .header('x-content-type-options', 'nosniff')
      .send(createReadStream(absolute));
  });

  // ------------------------------------------------------------- exports ---

  app.get(
    '/labels/:labelId/campaigns/:campaignId/exports',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const { labelId, campaignId } = campaignParams.parse(request.params);
      const items = await services.exports.list(db, user, labelId, campaignId);
      return { items, nextCursor: null };
    },
  );

  /**
   * Authorised export download.
   *
   * Same rule as images: no guessable public URL. The path is resolved from the
   * export record, checked against label access, and re-validated against
   * STORAGE_ROOT before the file is opened.
   */
  app.get(
    '/labels/:labelId/exports/:exportId/file',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const params = labelParams.extend({ exportId: z.uuid() }).parse(request.params);
      const storagePath = await services.exports.storagePathFor(
        db,
        user,
        params.labelId,
        params.exportId,
      );

      const absolute = path.resolve(env.STORAGE_ROOT, storagePath);
      const root = path.resolve(env.STORAGE_ROOT);
      if (!absolute.startsWith(root + path.sep)) {
        throw new AppError('internal_error', {
          internalDetail: 'stored export path escapes STORAGE_ROOT',
        });
      }

      const info = await stat(absolute).catch(() => undefined);
      if (info === undefined) {
        throw AppError.notFoundOrForbidden('export', params.exportId);
      }

      return reply
        .header('content-type', 'application/zip')
        .header('content-length', String(info.size))
        .header('content-disposition', `attachment; filename="campagne-export.zip"`)
        .header('x-content-type-options', 'nosniff')
        .send(createReadStream(absolute));
    },
  );

  /**
   * Builds a package.
   *
   * A draft always succeeds and is labelled a draft inside the archive. A
   * publish-ready package is refused when a gate fails; the refusal is recorded
   * with its reasons rather than thrown away.
   */
  app.post(
    '/labels/:labelId/campaigns/:campaignId/exports',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const { labelId, campaignId } = campaignParams.parse(request.params);
      const body = z.object({ kind: exportKind }).parse(request.body);
      const result = await services.exports.build(db, user, labelId, campaignId, body.kind);

      if (result.storagePath === null) {
        /*
         * A refusal answers in the same envelope as every other refusal.
         *
         * This used to be a 409 carrying a *success-shaped* body. The web
         * client builds its Dutch message from the error envelope, found none,
         * and fell back to "Er is een onverwachte fout opgetreden" — so the
         * most specific refusal in the product, six named reasons deep,
         * reached the person who clicked the button as an unknown failure.
         *
         * The record was already written inside `build`, so the attempt and
         * its reasons are in the trail regardless of what is answered here.
         * This puts them in front of the user as well.
         */
        throw new AppError('conflict', {
          publicMessage: [
            'Dit pakket is nog niet publicatieklaar.',
            ...result.record.blockedReasonsNl,
          ].join(' '),
        });
      }

      return reply.status(201).send({ export: result.record, ready: true });
    },
  );
};
