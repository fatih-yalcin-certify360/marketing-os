import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../core/http/authenticate.js';
import { currentUser } from '../../core/http/authenticate.js';
import { AppError } from '../../core/errors/app-error.js';
import { contentDisposition } from '../../core/files/index.js';
import type { UploadPurpose } from './service.js';

/**
 * Upload and authorised download.
 *
 * Two properties are enforced here rather than in the service, because they are
 * transport concerns:
 *
 *  - **A single file per request, with a hard byte ceiling**, applied by the
 *    multipart parser so an oversized body is cut off at the socket instead of
 *    being buffered and then rejected.
 *  - **Nothing is ever served in a way that lets the browser execute it.** An
 *    upload comes back with `X-Content-Type-Options: nosniff`, a
 *    `Content-Security-Policy` of `sandbox`, and `Content-Disposition:
 *    attachment` for everything except a raster image. An SVG that somehow
 *    passed the guard still cannot run against this origin.
 */

const labelParams = z.object({ labelId: z.uuid() });
const assetParams = labelParams.extend({ assetId: z.uuid() });

/**
 * The purposes the endpoint accepts.
 *
 * Every one of these has something on the other end that reads what was
 * uploaded. `brand_document` used to be here and did not: it accepted and
 * stored documents no code path ever read, which is storage and accepted-file
 * surface in exchange for nothing. A purpose comes back when its consumer
 * arrives, in the same change.
 */
const uploadPurpose = z.enum([
  'visual_reference',
  'brand_logo',
  'course_document',
  'source_document',
  // Arrived with its consumer, as the rule requires: an outcome row references
  // the uploaded report it was read from (`modules/outcomes/service.ts`).
  'outcome_report',
]);

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  const { db, services, env } = app.appContext;

  /**
   * Receives one file.
   *
   * The purpose travels in the path rather than the body: it decides which
   * permission is required, so it must be known before the body is read.
   */
  app.post(
    '/labels/:labelId/uploads/:purpose',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const { labelId } = labelParams.parse(request.params);
      const purpose = uploadPurpose.parse(
        (request.params as Record<string, unknown>).purpose,
      ) satisfies UploadPurpose;

      const part = await request.file({
        limits: {
          fileSize: env.UPLOAD_MAX_BYTES,
          files: 1,
          // No text fields are read, so accepting them would only widen the
          // surface. Metadata belongs in a separate JSON call.
          fields: 0,
        },
      });

      if (part === undefined) {
        throw new AppError('bad_request', {
          publicMessage: 'Er is geen bestand meegestuurd.',
          internalDetail: 'multipart request without a file part',
        });
      }

      const bytes = await part.toBuffer().catch((error: unknown) => {
        // `toBuffer` throws when the parser's fileSize limit is exceeded, which
        // is the good case: the body was cut off rather than buffered.
        throw new AppError('payload_too_large', {
          publicMessage: `Het bestand is te groot (maximaal ${String(
            Math.floor(env.UPLOAD_MAX_BYTES / 1_048_576),
          )} MB).`,
          internalDetail: `multipart file exceeded UPLOAD_MAX_BYTES: ${String(error)}`,
        });
      });

      const asset = await services.uploads.accept(db, user, {
        labelId,
        purpose,
        filename: part.filename,
        declaredMime: part.mimetype,
        bytes,
        requestId: request.id,
        clientAddress: request.socket.remoteAddress,
      });

      return reply.status(201).send(asset);
    },
  );

  /**
   * Authorised download.
   *
   * There is deliberately no public or guessable URL: the path is resolved from
   * the asset row, the row is label-scoped, and the resolved path is checked
   * against `STORAGE_ROOT` before the file is opened.
   */
  app.get(
    '/labels/:labelId/uploads/:assetId/file',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const { labelId, assetId } = assetParams.parse(request.params);

      const asset = await services.uploads.requireForDownload(db, user, labelId, assetId);
      const absolute = services.uploads.absolutePathFor(asset.storagePath);

      // The row can outlive the file (a restore, a manual deletion). Reporting
      // "not found" is honest; streaming a zero-length body would not be.
      const info = await stat(absolute).catch(() => undefined);
      if (info === undefined) {
        throw AppError.notFoundOrForbidden('upload', assetId);
      }

      const inline = asset.servingMode === 'inline_image';

      return reply
        // The stored type, never the one the client declared at upload.
        .header('content-type', inline ? asset.mimeType : 'application/octet-stream')
        .header('content-length', String(asset.byteSize))
        .header('content-disposition', contentDisposition(inline ? 'inline' : 'attachment', asset.originalName))
        // Even for an image: no sniffing, and no script or plugin execution if
        // the type is ever wrong.
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('cross-origin-resource-policy', 'same-origin')
        // Private: an upload may contain brand material that is not public.
        .header('cache-control', 'private, no-store')
        .send(createReadStream(absolute));
    },
  );
};
