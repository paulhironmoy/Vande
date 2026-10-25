/**
 * Verified dares client. Off unless the build enables it (flags.liteVerifiedDares) AND the player opted in to
 * community sharing; every call returns null or false on any failure and never throws, with a short timeout, so the
 * Lite friend loop always works locally. Protocol and signed string: ./liteDareProtocol.ts. Privacy: docs/PRIVACY.md.
 *
 * Where the Lite screen calls it (see docs/BACKEND.md, "Verified dares"):
 *   friend answers the dare   startVerifiedAttempt({ optedIn, installId, dare, nonce, answerPath, claim })
 *                             -> use the returned twistId and nonce instead of a local draw; null = local twist
 *   friend sends the reply    gradeVerifiedAttempt({ optedIn, installId, dare, attemptId, twistAnswer })
 *                             -> put points, best, twistId, twist, nonce and sig into the R2 reply; null = unsigned
 *   helper opens a reply      verifyReplySignature(reply) (offline) -> award with verified = true when it holds
 *   goal line                 <LiteGoal optedIn={...} /> (src/components/game/community/LiteGoal.tsx)
 * with optedIn = useApp.getState().settings.communitySharing === 'on' and installId = useApp.getState().installId.
 */
import { flags } from '@/app/flags';
import { dareIdentity, type DareIdentityInput } from '@/lite/twists';
import type { DareReply } from '@/share/dare';
import { sha256Hex } from './hash';
import {
  ATTEMPT_ID_RE,
  LITE_DARE_PATHS,
  MARKER_SCOPE,
  NONCE_RE,
  TWIST_KINDS,
  hexToBytes,
  liteDareCanonical,
  parseSignatureField,
  type LiteAnswerClaim,
  type LiteGoalResponse,
  type LiteGradeRequest,
  type LiteGradeResponse,
  type LiteStartRequest,
  type LiteStartResponse,
  type VerifiedScope,
} from './liteDareProtocol';

export type { LiteAnswerClaim, LiteGoalResponse, LiteGradeResponse, LiteStartResponse, VerifiedScope } from './liteDareProtocol';
export { utcDay } from './liteDareProtocol';

/** Every request gives up after this long and the caller falls back to local play. */
export const LITE_DARE_TIMEOUT_MS = 3000;
/** Goal reads are reused for this long in memory (the edge caches them for five minutes too). */
export const LITE_GOAL_TTL_MS = 5 * 60 * 1000;

export interface LiteDareOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  /** Public key override (tests); defaults to flags.darePublicKey. */
  publicKeyHex?: string;
  /** Feature override (tests); defaults to flags.liteVerifiedDares. */
  enabled?: boolean;
}

/** True when this build has verified dares on and the player opted in to community sharing. */
export function verifiedDaresEnabled(optedIn: boolean, opts: Pick<LiteDareOptions, 'enabled'> = {}): boolean {
  return (opts.enabled ?? flags.liteVerifiedDares) && optedIn === true;
}

/** sha256(`${installId}:${dareIdentity(dare)}`): one key per device per dare, unlinkable across dares. */
export async function liteDeviceKey(installId: string, dare: DareIdentityInput): Promise<string | null> {
  if (typeof installId !== 'string' || !installId) return null;
  try {
    return await sha256Hex(`${installId}:${dareIdentity(dare)}`);
  } catch {
    return null;
  }
}

async function call<T>(path: string, init: RequestInit, opts: LiteDareOptions, isValid: (x: unknown) => x is T): Promise<T | null> {
  const base = (opts.baseUrl ?? flags.communityApiUrl ?? '').replace(/\/+$/, '');
  const f = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!base || !f) return null;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller?.abort();
        resolve(null);
      }, opts.timeoutMs ?? LITE_DARE_TIMEOUT_MS);
    });
    const res = await Promise.race([f(`${base}${path}`, { ...init, signal: controller?.signal }), timeout]);
    if (!res || !res.ok) return null;
    const body: unknown = await Promise.race([res.json(), timeout]);
    return isValid(body) ? body : null;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isPoints = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 9999;
const isTwistId = (v: unknown): v is string => typeof v === 'string' && /^t[1-9]\d{0,3}$/.test(v);
const isScope = (v: unknown): v is VerifiedScope => v === 'dare+twist' || v === 'twist';

function isStartResponse(x: unknown): x is LiteStartResponse {
  return (
    isObj(x) &&
    typeof x.attemptId === 'string' &&
    ATTEMPT_ID_RE.test(x.attemptId) &&
    isTwistId(x.twistId) &&
    typeof x.kind === 'string' &&
    (TWIST_KINDS as readonly string[]).includes(x.kind) &&
    typeof x.nonce === 'string' &&
    NONCE_RE.test(x.nonce) &&
    isPoints(x.points) &&
    typeof x.best === 'boolean' &&
    isScope(x.verified) &&
    typeof x.created === 'boolean'
  );
}

function isGradeResponse(x: unknown): x is LiteGradeResponse {
  if (!isObj(x)) return false;
  const twistOk = x.twist === 'skipped' ? x.twistId === undefined : (x.twist === 'right' || x.twist === 'wrong') && isTwistId(x.twistId);
  return (
    typeof x.attemptId === 'string' &&
    ATTEMPT_ID_RE.test(x.attemptId) &&
    isPoints(x.points) &&
    typeof x.best === 'boolean' &&
    twistOk &&
    typeof x.nonce === 'string' &&
    NONCE_RE.test(x.nonce) &&
    isScope(x.verified) &&
    typeof x.sig === 'string' &&
    parseSignatureField(x.sig) !== null &&
    MARKER_SCOPE[parseSignatureField(x.sig)!.marker] === x.verified &&
    typeof x.graded === 'boolean'
  );
}

function isGoalResponse(x: unknown): x is LiteGoalResponse {
  return (
    isObj(x) &&
    typeof x.day === 'string' &&
    typeof x.answers === 'number' &&
    x.answers >= 0 &&
    typeof x.minCohort === 'number' &&
    typeof x.ready === 'boolean' &&
    (x.share === undefined || (typeof x.share === 'number' && x.share >= 0 && x.share <= 100)) &&
    typeof x.asOf === 'string'
  );
}

const ref = (d: DareIdentityInput) => ({ seed: d.seed >>> 0, path: d.path ?? '', step: d.step, deadline: Math.round(d.deadline) });

export interface StartVerifiedInput {
  optedIn: boolean;
  installId: string;
  dare: DareIdentityInput;
  /** The device's attempt nonce for this dare (ensureAttempt(dareKey).nonce). */
  nonce: string;
  /** Tokens the friend applied from the dared moment: clue scans `e<i>` then the answer `d<i>-<o>` / `r<i>-<o>`. */
  answerPath: string;
  /** The friend's own result, as the local reveal computed it. */
  claim: LiteAnswerClaim;
}

/**
 * Registers the friend's answer and gets the server-chosen twist. Call it when the friend answers the dared question
 * (before the reveal can influence anything). Null whenever verified dares are off, not opted in, or unreachable.
 */
export async function startVerifiedAttempt(input: StartVerifiedInput, opts: LiteDareOptions = {}): Promise<LiteStartResponse | null> {
  if (!verifiedDaresEnabled(input.optedIn, opts)) return null;
  const deviceKey = await liteDeviceKey(input.installId, input.dare);
  if (!deviceKey) return null;
  const body: LiteStartRequest = {
    v: 1,
    dare: ref(input.dare),
    deviceKey,
    nonce: String(input.nonce).toLowerCase(),
    answerPath: input.answerPath,
    claim: { points: Math.max(0, Math.min(9999, Math.round(input.claim.points))), best: Boolean(input.claim.best), kind: input.claim.kind },
  };
  return call(LITE_DARE_PATHS.start, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, opts, isStartResponse);
}

export interface GradeVerifiedInput {
  optedIn: boolean;
  installId: string;
  dare: DareIdentityInput;
  attemptId: string;
  /** The twist option the friend chose ('a'..'d'), or null when they skipped the twist. */
  twistAnswer: string | null;
}

/**
 * Grades the twist on the server and returns the signed values for the R2 reply. The signature is checked against
 * the build's public key before it is returned, so a misconfigured server can never produce links that fail later.
 * Null whenever anything is off or fails: send an unsigned reply then.
 */
export async function gradeVerifiedAttempt(input: GradeVerifiedInput, opts: LiteDareOptions = {}): Promise<LiteGradeResponse | null> {
  if (!verifiedDaresEnabled(input.optedIn, opts)) return null;
  if (typeof input.attemptId !== 'string' || !ATTEMPT_ID_RE.test(input.attemptId)) return null;
  const deviceKey = await liteDeviceKey(input.installId, input.dare);
  if (!deviceKey) return null;
  const body: LiteGradeRequest = { v: 1, deviceKey, twistAnswer: input.twistAnswer === null ? null : String(input.twistAnswer) };
  const graded = await call(LITE_DARE_PATHS.grade(input.attemptId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, opts, isGradeResponse);
  if (!graded) return null;
  const ok = await verifyFields(
    { dare: input.dare, points: graded.points, best: graded.best, twistId: graded.twistId, twist: graded.twist, nonce: graded.nonce, sig: graded.sig },
    opts.publicKeyHex ?? flags.darePublicKey,
  );
  return ok ? graded : null;
}

const keyCache = new Map<string, Promise<CryptoKey | null>>();

function publicKey(hex: string): Promise<CryptoKey | null> {
  const cached = keyCache.get(hex);
  if (cached) return cached;
  const p = (async () => {
    try {
      const bytes = hexToBytes(hex);
      const subtle = globalThis.crypto?.subtle;
      if (!bytes || bytes.length !== 65 || !subtle) return null;
      return await subtle.importKey('raw', bytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    } catch {
      return null;
    }
  })();
  keyCache.set(hex, p);
  return p;
}

interface SignedFields {
  dare: DareIdentityInput;
  points: number;
  best: boolean;
  twistId?: string;
  twist?: DareReply['twist'];
  nonce?: string;
  sig?: string;
}

async function verifyFields(f: SignedFields, publicKeyHex: string): Promise<VerifiedScope | null> {
  try {
    const parsed = parseSignatureField(f.sig);
    if (!parsed || !f.nonce || !f.twist || !publicKeyHex) return null;
    const key = await publicKey(publicKeyHex);
    const sigBytes = hexToBytes(parsed.hex);
    const subtle = globalThis.crypto?.subtle;
    if (!key || !sigBytes || !subtle) return null;
    const canonical = liteDareCanonical({ dare: f.dare, points: f.points, best: f.best, twistId: f.twistId, twist: f.twist, nonce: f.nonce }, parsed.marker);
    const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, new TextEncoder().encode(canonical));
    return ok ? MARKER_SCOPE[parsed.marker] : null;
  } catch {
    return null;
  }
}

/** What a signed R2 reply's signature vouches for, checked offline with the public key; null when it does not hold. */
export async function replyVerification(reply: DareReply, publicKeyHex: string = flags.darePublicKey): Promise<VerifiedScope | null> {
  if (!reply || reply.version !== 2 || !reply.sig) return null;
  return verifyFields(reply, publicKeyHex);
}

/** True when the reply carries a signature from this build's key over exactly its fields (offline, no request). */
export async function verifyReplySignature(reply: DareReply, publicKeyHex: string = flags.darePublicKey): Promise<boolean> {
  return (await replyVerification(reply, publicKeyHex)) !== null;
}

const goalCache = new Map<string, { at: number; value: LiteGoalResponse }>();

/** Today's goal numbers (or another UTC day's); null when off, not opted in, unreachable or malformed. */
export async function fetchLiteGoal(day: string, optedIn: boolean, opts: LiteDareOptions = {}): Promise<LiteGoalResponse | null> {
  if (!verifiedDaresEnabled(optedIn, opts)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const hit = goalCache.get(day);
  if (hit && Date.now() - hit.at < LITE_GOAL_TTL_MS) return hit.value;
  const value = await call(LITE_DARE_PATHS.goal(day), { method: 'GET' }, opts, isGoalResponse);
  if (value) goalCache.set(day, { at: Date.now(), value });
  return value;
}

/** Test hook. */
export function __resetLiteDaresForTests(): void {
  keyCache.clear();
  goalCache.clear();
}
