import { type ErrorCode, errorHttpStatus, errorMessageNl, type FieldIssue } from '@c360/contracts';

/**
 * The only error type handlers should throw.
 *
 * It separates two audiences deliberately:
 *  - `publicMessage` is Dutch, safe to render, and free of internal detail;
 *  - `internalDetail` is logged against the request id and never serialised
 *    into a response (requirement 13: "İç hata ve secret'ları istemciye
 *    sızdırmama").
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly publicMessage: string;
  public readonly issues?: FieldIssue[];
  public readonly internalDetail?: string;
  /** Extra key/value pairs for the log line and audit row. No user content. */
  public readonly context: Readonly<Record<string, string | number | boolean>>;

  constructor(
    code: ErrorCode,
    options: {
      publicMessage?: string;
      issues?: FieldIssue[];
      internalDetail?: string;
      context?: Record<string, string | number | boolean>;
      cause?: unknown;
    } = {},
  ) {
    const publicMessage = options.publicMessage ?? errorMessageNl[code];
    super(publicMessage, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = errorHttpStatus[code];
    this.publicMessage = publicMessage;
    if (options.issues !== undefined) {
      this.issues = options.issues;
    }
    if (options.internalDetail !== undefined) {
      this.internalDetail = options.internalDetail;
    }
    this.context = Object.freeze({ ...options.context });
  }

  static unauthenticated(internalDetail: string): AppError {
    return new AppError('unauthenticated', { internalDetail });
  }

  static forbidden(reason: string, context?: Record<string, string>): AppError {
    return new AppError('forbidden', {
      internalDetail: reason,
      ...(context === undefined ? {} : { context }),
    });
  }

  /**
   * Used wherever a record exists but the caller may not see it. Returning
   * "not found" rather than "forbidden" avoids confirming existence, which is
   * what closes the IDOR/BOLA enumeration channel.
   */
  static notFoundOrForbidden(resourceType: string, resourceId: string): AppError {
    return new AppError('not_found', {
      internalDetail: `${resourceType} not visible to caller`,
      context: { resourceType, resourceId },
    });
  }

  static staleVersion(resourceType: string): AppError {
    return new AppError('stale_version', { context: { resourceType } });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
