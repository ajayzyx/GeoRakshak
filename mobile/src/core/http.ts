// Transport abstraction. The core never touches `fetch` directly, so every
// module can be tested with an in-memory client and tests never hit the network.

export interface MultipartFile {
  uri: string;
  name: string;
  type: string;
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path relative to the API base, e.g. `/reports`. */
  path: string;
  query?: Record<string, string | number>;
  headers?: Record<string, string>;
  json?: unknown;
  multipart?: { fields: Record<string, string>; file: MultipartFile };
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export interface HttpClient {
  /** Resolves for any HTTP status. Rejects with NetworkError when no response arrived. */
  send(request: HttpRequest): Promise<HttpResponse>;
}

export class NetworkError extends Error {
  constructor(message = 'Network unavailable') {
    super(message);
    this.name = 'NetworkError';
  }
}

export type ApiErrorKind = 'network' | 'unauthenticated' | 'client' | 'server';

/** Error envelope from api.md §1. */
interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: { field?: string; issue?: string }[] };
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;

  constructor(kind: ApiErrorKind, message: string, status: number | null, code: string | null) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }

  /**
   * Network failures, 5xx, 408 and 429 are transient. Other 4xx responses
   * (validation, forbidden, not found, conflict, payload too large) will fail
   * the same way on every retry, so the sync engine must not loop on them.
   * 401 is not retryable by itself: the user has to sign in again.
   */
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'server';
  }

  static fromResponse(res: HttpResponse): ApiError {
    const env = (res.body ?? {}) as ErrorEnvelope;
    const code = env.error?.code ?? null;
    const detail = env.error?.details
      ?.map((d) => [d.field, d.issue].filter(Boolean).join(': '))
      .filter(Boolean)
      .join('; ');
    const base = env.error?.message ?? `HTTP ${res.status}`;
    const message = detail ? `${base} (${detail})` : base;
    if (res.status === 401) return new ApiError('unauthenticated', message, 401, code);
    if (res.status >= 500 || res.status === 408 || res.status === 429) {
      return new ApiError('server', message, res.status, code);
    }
    return new ApiError('client', message, res.status, code);
  }

  static network(err: unknown): ApiError {
    const msg = err instanceof Error ? err.message : 'Network unavailable';
    return new ApiError('network', msg, null, null);
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return ApiError.network(err);
}
