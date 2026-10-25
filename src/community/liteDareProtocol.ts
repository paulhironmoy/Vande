/**
 * Verified dares: the wire protocol shared by the app (src/community/liteDares.ts) and the Worker
 * (backend/src/liteDares.ts). Pure: no network, storage or flags, so the Worker can bundle it through the `@/` alias.
 *
 * Flow (docs/BACKEND.md, "Verified dares"):
 *   1. start  POST /v1/lite/attempts                  the friend answers the dared question. With replay verification
 *             on (LITE_VERIFY_REPLAY=1, Workers Paid) the server replays the dare and the answer, records the verified
 *             points and best-move flag and derives the twist kind itself; with it off (the free-plan default) it
 *             records the app's claim, checking only what needs no replay. Either way it draws the twist. One attempt
 *             per device key per dare; repeating the call returns the same attempt.
 *   2. grade  POST /v1/lite/attempts/<attemptId>/grade the twist answer (or null when skipped): graded once against
 *             the server's pool, then signed. Repeating the call returns the stored result, never a regrade.
 *   3. goal   GET  /v1/lite/goal/<YYYY-MM-DD>          today's real share of dare answers that found the best move.
 *
 * Signature: ECDSA P-256 with SHA-256 over `liteDareCanonical(...)`, raw r||s as 128 lowercase hex characters,
 * prefixed by a one-letter marker of what the server verified. It travels in the R2 reply's `_x` field:
 *   v = the dared answer was replayed (friend points and best-move flag are the server's) and the twist was graded
 *   t = only the twist was graded; points and best-move flag are as the friend's app claimed (fair-play answers
 *       are still checked against the content, which needs no replay)
 * The marker is inside the signed string, so it cannot be swapped without breaking the signature.
 *
 * Why two markers: replaying a late Chapter 1 question costs up to about 20 ms of CPU, over the Workers free plan's
 * 10 ms per request (measured in backend/test/liteDares.test.ts). The free-plan default therefore signs 't'.
 */
import { dareIdentity, type DareIdentityInput } from '@/lite/twists';
import type { TwistKind, TwistOutcome } from '@/lite/contracts';

export const LITE_DARE_PROTOCOL_VERSION = 1;

export const LITE_DARE_PATHS = {
  start: '/v1/lite/attempts',
  grade: (attemptId: string) => `/v1/lite/attempts/${attemptId}/grade`,
  goal: (day: string) => `/v1/lite/goal/${day}`,
} as const;

/** What the server checked before signing (see the header). */
export type VerifiedMarker = 'v' | 't';
export type VerifiedScope = 'dare+twist' | 'twist';
export const MARKER_SCOPE: Record<VerifiedMarker, VerifiedScope> = { v: 'dare+twist', t: 'twist' };

/** SHA-256 of `${installId}:${dareIdentity}`, lowercase hex: one key per device per dare, unlinkable across dares. */
export const DEVICE_KEY_RE = /^[0-9a-f]{64}$/;
export const ATTEMPT_ID_RE = /^[0-9a-f]{32}$/;
export const NONCE_RE = /^[0-9a-z]{6}$/;
export const TWIST_OPTION_RE = /^[a-d]$/;
export const SIGNATURE_HEX_LENGTH = 128;
const SIG_FIELD_RE = /^([vt])([0-9a-f]{128})$/;
/**
 * The friend's answer from the dared moment: up to 12 clue scans (`e<i>`) then exactly one answer token for the
 * dared step (`d<i>-<o>` or `r<i>-<o>`), joined by '.'.
 */
export const ANSWER_PATH_RE = /^(?:e(?:0|[1-9]\d?)\.){0,12}[dr](?:0|[1-9]\d?)-(?:0|[1-9]\d?)$/;

export interface LiteDareRef {
  seed: number;
  path: string;
  step: string;
  deadline: number;
}

/** What the friend's app computed for its answer (the same values the local reveal shows). */
export interface LiteAnswerClaim {
  points: number;
  best: boolean;
  /** Action kind of the best move at the dared moment ('rule' for fair-play questions). */
  kind: TwistKind;
}

export interface LiteStartRequest {
  v: 1;
  dare: LiteDareRef;
  deviceKey: string;
  /** The friend's R2 nonce for this dare. Stored with the attempt; a repeated start returns the stored one. */
  nonce: string;
  answerPath: string;
  /** Used as-is only when the server does not replay (marker 't'); a replaying server computes its own values. */
  claim: LiteAnswerClaim;
}

export const TWIST_KINDS: readonly TwistKind[] = ['talk', 'check', 'protect', 'enforce', 'restrict', 'wait', 'rule'];

export interface LiteStartResponse {
  attemptId: string;
  twistId: string;
  kind: TwistKind;
  /** The nonce stored with the attempt: put this one in the R2 reply. */
  nonce: string;
  /** The friend's points and best-move flag on the dare as the server recorded them (what the reply must carry). */
  points: number;
  best: boolean;
  /** What the signature will vouch for: 'dare+twist' when the server replayed the answer, else 'twist'. */
  verified: VerifiedScope;
  /** True when this call created the attempt; false when it returned an existing one. */
  created: boolean;
}

export interface LiteGradeRequest {
  v: 1;
  deviceKey: string;
  /** The friend's twist answer ('a'..'d'), or null when they skipped the twist. */
  twistAnswer: string | null;
}

export interface LiteGradeResponse {
  attemptId: string;
  points: number;
  best: boolean;
  /** Absent when the twist was skipped. */
  twistId?: string;
  twist: TwistOutcome;
  nonce: string;
  verified: VerifiedScope;
  /** Marker + 128 lowercase hex: the R2 reply's `sig` field. */
  sig: string;
  /** False when this call returned a result stored by an earlier call. */
  graded: boolean;
}

export interface LiteGoalResponse {
  day: string;
  /** Graded dare answers today (UTC). */
  answers: number;
  minCohort: number;
  ready: boolean;
  /** Only when ready: answers that found the best move, and their share (0–100, one decimal). */
  best?: number;
  share?: number;
  asOf: string;
}

/** The fields of an R2 reply the signature covers; the helper can rebuild them offline from the reply alone. */
export interface SignedReplyFields {
  dare: DareIdentityInput;
  points: number;
  best: boolean;
  twistId?: string;
  twist: TwistOutcome;
  nonce: string;
}

/**
 * The exact string the server signs and the helper verifies:
 *   `vande-lite-dare|1|<marker>|<dareIdentity>|<points>|<0|1>|<twistId or ~>|<r|w|s>|<nonce>`
 * where dareIdentity is `dareIdentity(dare)` (seed, path, step and deadline; chain and hint are not covered).
 * The rematch deadline is not covered: it is the friend's own clock, not something the server verified.
 */
export function liteDareCanonical(fields: SignedReplyFields, marker: VerifiedMarker): string {
  const skipped = fields.twist !== 'right' && fields.twist !== 'wrong';
  const outcome = fields.twist === 'right' ? 'r' : fields.twist === 'wrong' ? 'w' : 's';
  return [
    'vande-lite-dare',
    String(LITE_DARE_PROTOCOL_VERSION),
    marker,
    dareIdentity(fields.dare),
    String(Math.max(0, Math.round(fields.points))),
    fields.best ? '1' : '0',
    skipped ? '~' : (fields.twistId ?? '~'),
    outcome,
    fields.nonce.toLowerCase(),
  ].join('|');
}

/** Splits the R2 `sig` field into its marker and the 128-hex signature; null when it has any other shape. */
export function parseSignatureField(sig: string | undefined): { marker: VerifiedMarker; hex: string } | null {
  if (typeof sig !== 'string') return null;
  const m = SIG_FIELD_RE.exec(sig);
  return m ? { marker: m[1] as VerifiedMarker, hex: m[2] } : null;
}

export function bytesToHex(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** UTC calendar day `YYYY-MM-DD` (the goal's day). */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
