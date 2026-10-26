/** Maps API failures to honest, translated states. */
import { isApiClientError } from '@/net/errors';

export type FailureKind = 'offline' | 'not_found' | 'expired' | 'forbidden' | 'sealed' | 'rate_limited' | 'conflict' | 'invalid' | 'signed_out' | 'error';

export function failureKind(e: unknown): FailureKind {
  if (!isApiClientError(e)) return 'error';
  switch (e.code) {
    case 'network':
    case 'timeout':
    case 'offline':
      return 'offline';
    case 'not_found':
      return 'not_found';
    case 'deadline_passed':
      return 'expired';
    case 'forbidden':
      return 'forbidden';
    case 'sealed':
      return 'sealed';
    case 'rate_limited':
      return 'rate_limited';
    case 'conflict':
    case 'already_locked':
    case 'not_your_turn':
      return 'conflict';
    case 'invalid':
      return 'invalid';
    case 'unauthorized':
      return 'signed_out';
    default:
      return 'error';
  }
}
