/** Stable API errors: `{ error: { code, message } }` with the codes from src/contracts/api.ts. */
import type { ApiErrorCode } from '@/contracts';
import { json } from './http';

export const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  conflict: 409,
  rate_limited: 429,
  deadline_passed: 410,
  already_locked: 409,
  not_your_turn: 409,
  sealed: 409,
  version_mismatch: 409,
  unavailable: 503,
};

/** Thrown by handlers; converted to the JSON error shape at the edge of the Worker or the Durable Object. */
export class ApiFailure extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly headers: Record<string, string>;
  constructor(code: ApiErrorCode, message: string, opts: { status?: number; headers?: Record<string, string> } = {}) {
    super(message);
    this.name = 'ApiFailure';
    this.code = code;
    this.status = opts.status ?? STATUS[code];
    this.headers = opts.headers ?? {};
  }
}

export function fail(code: ApiErrorCode, message: string, opts?: { status?: number; headers?: Record<string, string> }): never {
  throw new ApiFailure(code, message, opts);
}

export function errorResponse(code: ApiErrorCode, message: string, status = STATUS[code], headers: Record<string, string> = {}): Response {
  return json({ error: { code, message } }, status, headers);
}

export function failureResponse(f: ApiFailure, headers: Record<string, string> = {}): Response {
  return errorResponse(f.code, f.message, f.status, { ...headers, ...f.headers });
}

export function isApiFailure(e: unknown): e is ApiFailure {
  return e instanceof ApiFailure;
}
