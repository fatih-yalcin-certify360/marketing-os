import { apiErrorBody, type ErrorCode } from '@c360/contracts';

/**
 * Typed API client.
 *
 * Two rules the rest of the UI depends on:
 *  1. every failure becomes an `ApiClientError` carrying a Dutch message that
 *     is safe to render — the UI never has to invent error copy or expose an
 *     HTTP status to the user;
 *  2. nothing is retried automatically for state-changing requests, because a
 *     silent retry of a POST is exactly how duplicate work gets created.
 */

const BASE_URL = '/api/v1';

export class ApiClientError extends Error {
  constructor(
    public readonly code: ErrorCode | 'network_error',
    /** Dutch, safe to display. */
    public readonly userMessage: string,
    public readonly status: number,
    public readonly requestId?: string,
    public readonly issues?: { path: string; message: string }[],
  ) {
    super(userMessage);
    this.name = 'ApiClientError';
  }
}

async function toError(response: Response): Promise<ApiClientError> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return new ApiClientError(
      'internal_error',
      'Er is een onverwachte fout opgetreden.',
      response.status,
    );
  }

  const envelope = apiErrorBody.safeParse(parsed);
  if (!envelope.success) {
    return new ApiClientError(
      'internal_error',
      'Er is een onverwachte fout opgetreden.',
      response.status,
    );
  }

  const { code, message, requestId, issues } = envelope.data.error;
  return new ApiClientError(code, message, response.status, requestId, issues);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';

  // Built conditionally rather than with `undefined` placeholders, because
  // `exactOptionalPropertyTypes` correctly refuses `body: undefined` here.
  const init: RequestInit = {
    method,
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    // Identity arrives as proxy headers, so no credentials are attached and
    // there is no cookie for a cross-site request to abuse.
    credentials: 'omit',
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiClientError(
      'network_error',
      'De verbinding met de server is mislukt. Controleer je netwerk en probeer het opnieuw.',
      0,
    );
  }

  if (!response.ok) {
    throw await toError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  upload: async <T>(path: string, file: File): Promise<T> => {
    const body = new FormData();
    body.append('file', file);
    let response: Response;
    try { response = await fetch(`${BASE_URL}${path}`, { method: 'POST', body, credentials: 'omit' }); }
    catch { throw new ApiClientError('network_error', 'Het uploaden is mislukt. Controleer je verbinding.', 0); }
    if (!response.ok) throw await toError(response);
    return await response.json() as T;
  },
  get: <T>(path: string, signal?: AbortSignal): Promise<T> =>
    request<T>(path, signal === undefined ? {} : { signal }),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, body === undefined ? { method: 'POST' } : { method: 'POST', body }),
  patch: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body }),
  // No body: a deletion is identified entirely by its path, and a body would
  // be one more thing for a caller to get wrong.
  remove: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
};
