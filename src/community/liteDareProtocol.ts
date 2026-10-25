/**
 * Verified dares: the wire protocol shared by the app (src/community/liteDares.ts) and the Worker
 * (backend/src/liteDares.ts). Pure: no network, storage or flags, so the Worker can bundle it through the `@/` alias.
 *
 * Flow (docs/BACKEND.md, "Verified dares"):
 *   1. start  POST /v1/lite/attempts                  the friend answers the dared question. With replay verification
 *             on (LITE_VERIFY_REPLAY=1, Workers Paid) the server replays the dare and the answer, records the verified
 *             points and best-move flag and derives the twist kind itself; with it off (the free-plan default) it
 *             records the app's claim, checking only what needs no replay. Either way it draws the twist. One attempt
 *             per device key per dare; repeating the call returns the same attempt. A content version that does not
 *             match the Worker's answers 409, and the app plays locally.
 *   2. grade  POST /v1/lite/attempts/<attemptId>/grade the twist answer (or null when skipped), with the dare
 *             reference: the attempt is found by (dare, device key) and must carry this id. Graded once, then signed;
 *             repeating the call returns the stored result, never a regrade.
 *   3. goal   GET  /v1/lite/goal/<YYYY-MM-DD>          today's real share of dare answers that found the best move,
 *             counting only replay-verified ('v') answers, at most 3 per network per UTC day. `active: false` says the
 *             goal is off on this deployment (no replay), so the app stops asking for that day.
 *
 * Signature (`_x` field of an R2 reply, lowercase only because codes are lowercased):
 *   <marker 1><keyId 8 hex><issueDay 4 base36><r||s 128 hex>        (141 characters)
 * over liteDareCanonical(...). marker: v = the dared answer was replayed (friend points and best-move flag are the
 * server's) and the twist was graded; t = only the twist was graded (points and best-move flag are claimed; fair-play
 * answers are still checked against the content). keyId names the public key (rotation); issueDay is the UTC day the
 * server signed (days since 1970-01-01, base36). All three are inside the signed string.
 *
 * Why two markers: replaying a late Chapter 1 question costs up to about 20 ms of CPU, over the Workers free plan's
 * 10 ms per request (measured in backend/test/liteDares.test.ts). The free-plan default therefore signs 't'.
 */
import scenarioJson from '@/content/scenarios/examination-crisis.json';
import { hashString } from '@/engine/prng';
import { TWIST_POOL, dareIdentity, type DareIdentityInput } from '@/lite/twists';
import type { TwistKind, TwistOutcome } from '@/lite/contracts';

/** Version of the signed string and the signature field layout. */
export const LITE_DARE_PROTOCOL_VERSION = 2;

/** Bump when scoring, replay or grading rules change in a way the content hash cannot see. */
export const LITE_ENGINE_VERSION = 1;

let contentVersionMemo: string | null = null;

/**
 * What the app and the Worker must agree on to grade the same game: the engine version plus hashes of the Chapter 1
 * content and the twist pool, e.g. `1-k3j9x2-1q8v0a`. Computed once, lazily.
 */
export function liteContentVersion(): string {
  if (!contentVersionMemo) {
    const h = (v: unknown) => (hashString(JSON.stringify(v)) >>> 0).toString(36);
    contentVersionMemo = `${LITE_ENGINE_VERSION}-${h(scenarioJson)}-${h(TWIST_POOL)}`;
  }
  return contentVersionMemo;
}

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
export const CONTENT_VERSION_RE = /^[0-9a-z-]{1,40}$/;
export const SIGNATURE_HEX_LENGTH = 128;
const SIG_FIELD_RE = /^([vt])([0-9a-f]{8})([0-9a-z]{4})([0-9a-f]{128})$/;
/**
 * The friend's answer from the dared moment: up to 12 clue scans (`e<i>`) then exactly one answer token for the
 * dared step (`d<i>-<o>` or `r<i>-<o>`), joined by '.'.
 */
export const ANSWER_PATH_RE = /^(?:e(?:0|[1-9]\d?)\.){0,12}[dr](?:0|[1-9]\d?)-(?:0|[1-9]\d?)$/;

export const TWIST_KINDS: readonly TwistKind[] = ['talk', 'check', 'protect', 'enforce', 'restrict', 'wait', 'rule'];

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
  /** liteContentVersion() of the app; a different Worker version answers 409. */
  contentVersion: string;
  dare: LiteDareRef;
  deviceKey: string;
  /** The friend's R2 nonce for this dare. Stored with the attempt; a repeated start returns the stored one. */
  nonce: string;
  answerPath: string;
  /** Used as-is only when the server does not replay (marker 't'); a replaying server computes its own values. */
  claim: LiteAnswerClaim;
}

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
  /** The dare the attempt belongs to (the attempt is stored under it). */
  dare: LiteDareRef;
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
  /** The R2 reply's `sig` field: marker + key id + issue day + 128 hex. */
  sig: string;
  /** False when this call returned a result stored by an earlier call. */
  graded: boolean;
}

export interface LiteGoalResponse {
  day: string;
  /** False when this deployment does not count a goal (no replay verification): stop asking for this day. */
  active: boolean;
  /** Replay-verified graded dare answers today (UTC), at most 3 per network. */
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

/** What the signature header says: who signed (key id), when (UTC day) and what was verified (marker). */
export interface SignatureHeader {
  marker: VerifiedMarker;
  keyId: string;
  /** Days since 1970-01-01 (UTC), as 4 base36 characters. */
  issueDay: string;
}

/** The UTC day of `now` as 4 base36 characters (days since 1970-01-01). */
export function issueDayOf(now: Date): string {
  return Math.floor(now.getTime() / 86_400_000)
    .toString(36)
    .padStart(4, '0');
}

/** The day number an issue day stands for, or NaN. */
export function issueDayNumber(issueDay: string): number {
  return /^[0-9a-z]{4}$/.test(issueDay) ? parseInt(issueDay, 36) : NaN;
}

/**
 * The exact string the server signs and the helper verifies:
 *   `vande-lite-dare|2|<marker>|<keyId>|<issueDay>|<dareIdentity>|<points>|<0|1>|<twistId or ~>|<r|w|s>|<nonce>`
 * where dareIdentity is `dareIdentity(dare)` (seed, path, step and deadline; chain and hint are not covered).
 * The rematch deadline is not covered: it is the friend's own clock, not something the server verified.
 */
export function liteDareCanonical(fields: SignedReplyFields, header: SignatureHeader): string {
  const skipped = fields.twist !== 'right' && fields.twist !== 'wrong';
  const outcome = fields.twist === 'right' ? 'r' : fields.twist === 'wrong' ? 'w' : 's';
  return [
    'vande-lite-dare',
    String(LITE_DARE_PROTOCOL_VERSION),
    header.marker,
    header.keyId,
    header.issueDay,
    dareIdentity(fields.dare),
    String(Math.max(0, Math.round(fields.points))),
    fields.best ? '1' : '0',
    skipped ? '~' : (fields.twistId ?? '~'),
    outcome,
    fields.nonce.toLowerCase(),
  ].join('|');
}

/** The R2 `sig` field for a header and a 128-hex signature. */
export function signatureField(header: SignatureHeader, hex: string): string {
  return `${header.marker}${header.keyId}${header.issueDay}${hex}`;
}

/** Splits the R2 `sig` field into its header and the 128-hex signature; null when it has any other shape. */
export function parseSignatureField(sig: string | undefined): (SignatureHeader & { hex: string }) | null {
  if (typeof sig !== 'string') return null;
  const m = SIG_FIELD_RE.exec(sig);
  return m ? { marker: m[1] as VerifiedMarker, keyId: m[2], issueDay: m[3], hex: m[4] } : null;
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

/** Key id of an uncompressed P-256 public key (hex): the first 8 hex of its SHA-256. */
export async function darePublicKeyId(publicKeyHex: string): Promise<string> {
  const bytes = hexToBytes(publicKeyHex.toLowerCase());
  if (!bytes) throw new Error('bad public key');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest)).slice(0, 8);
}

/** UTC calendar day `YYYY-MM-DD` (the goal's day). */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
