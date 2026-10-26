/** Errors from the API client: the server's stable codes plus the client's own network conditions. */
import type { ApiErrorCode } from '@/contracts';

export type ClientErrorCode = ApiErrorCode | 'network' | 'timeout' | 'offline' | 'bad_response';

const RETRYABLE: ReadonlySet<ClientErrorCode> = new Set(['network', 'timeout', 'offline', 'rate_limited', 'unavailable']);

export class ApiClientError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  /** From retry-after, when the server sent one. */
  readonly retryAfterMs: number | null;
  /** From x-decided-at: when a sealed result is decided (e.g. a Top 100 day before its 00:00 IST cutoff). */
  readonly decidedAt: string | null;

  constructor(code: ClientErrorCode, message: string, status = 0, retryAfterMs: number | null = null, decidedAt: string | null = null) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.decidedAt = decidedAt;
  }

  /** True when the same request may succeed later (network trouble, overload, or "in progress, retry"). */
  get retryable(): boolean {
    if (RETRYABLE.has(this.code) || this.status >= 500) return true;
    return this.status === 409 && this.retryAfterMs !== null;
  }
}

export function isApiClientError(e: unknown): e is ApiClientError {
  return e instanceof ApiClientError;
}

/**
 * VANDE Cricket is for players aged 18 and over: without the age screen's confirmation there is no account, so a
 * sign-up (explicit, or implied by a signed-in call) stops here and nothing is sent. Not retryable.
 */
export class AgeNotConfirmedError extends ApiClientError {
  constructor() {
    super('forbidden', 'VANDE Cricket is for players aged 18 and over: confirm your age to play online');
    this.name = 'AgeNotConfirmedError';
  }
}

export function isAgeNotConfirmed(e: unknown): e is AgeNotConfirmedError {
  return e instanceof AgeNotConfirmedError;
}

export function codeForStatus(status: number): ApiErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 410) return 'deadline_passed';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'invalid';
}
