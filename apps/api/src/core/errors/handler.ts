import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ApiErrorBody, FieldIssue } from '@c360/contracts';
import { AppError, isAppError } from './app-error.js';

function zodIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/**
 * Single exit point for every failure.
 *
 * Anything that is not an `AppError` is treated as an unexpected internal
 * error: the client gets a generic Dutch message plus the request id, and the
 * real cause goes to the log only. Fastify's own errors (body too large,
 * malformed JSON, rate limit) are mapped onto our codes so the client sees one
 * consistent envelope.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    const appError = toAppError(error);

    const logPayload = {
      requestId,
      code: appError.code,
      status: appError.status,
      detail: appError.internalDetail,
      context: appError.context,
      route: request.routeOptions.url ?? request.url,
      method: request.method,
    };

    if (appError.status >= 500) {
      request.log.error({ ...logPayload, err: error }, 'request failed');
    } else {
      request.log.warn(logPayload, 'request rejected');
    }

    const body: ApiErrorBody = {
      error: {
        code: appError.code,
        message: appError.publicMessage,
        requestId,
        ...(appError.issues === undefined ? {} : { issues: appError.issues }),
      },
    };

    void reply.status(appError.status).send(body);
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const body: ApiErrorBody = {
      error: {
        code: 'not_found',
        message: 'Dit onderdeel bestaat niet of is niet beschikbaar.',
        requestId: request.id,
      },
    };
    void reply.status(404).send(body);
  });
}

function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof z.ZodError) {
    return new AppError('validation_failed', { issues: zodIssues(error) });
  }

  if (isFastifyError(error)) {
    switch (error.code) {
      case 'FST_ERR_CTP_BODY_TOO_LARGE':
      case 'FST_ERR_REQ_FILE_TOO_LARGE':
        return new AppError('payload_too_large', { internalDetail: error.code });
      case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      case 'FST_ERR_CTP_INVALID_CONTENT_LENGTH':
        return new AppError('unsupported_media_type', { internalDetail: error.code });
      case 'FST_ERR_CTP_EMPTY_JSON_BODY':
      case 'FST_ERR_CTP_INVALID_JSON_BODY':
        return new AppError('bad_request', { internalDetail: error.code });
      case 'FST_ERR_VALIDATION':
        return new AppError('validation_failed', { internalDetail: error.code });
      case undefined:
      default:
        break;
    }
    if (error.statusCode === 429) {
      return new AppError('rate_limited', { internalDetail: 'rate limit exceeded' });
    }
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      return new AppError('bad_request', { internalDetail: error.code ?? 'fastify client error' });
    }
  }

  return new AppError('internal_error', {
    internalDetail: error instanceof Error ? error.message : 'non-error thrown',
    cause: error,
  });
}

interface FastifyLikeError {
  code?: string;
  statusCode?: number;
}

function isFastifyError(error: unknown): error is FastifyLikeError & Error {
  return error instanceof Error && ('code' in error || 'statusCode' in error);
}
