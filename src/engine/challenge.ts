import { OPPONENT_IDS, type ChallengeSpec, type DailyId, type Difficulty, type OpponentId, type RepublicOutcome, type ScenarioId } from './types';
import { hashString } from './prng';

const SCENARIO_CODES: Record<ScenarioId | 'campaign', string> = {
  'examination-crisis': 'EX',
  'electoral-dispute': 'EL',
  'information-storm': 'IS',
  campaign: 'CP',
};
const DIFF_CODES: Record<Difficulty, string> = { measured: 'M', standard: 'S', severe: 'V' };
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

function maskOf(opponents: OpponentId[]): number {
  let m = 0;
  OPPONENT_IDS.forEach((id, i) => {
    if (opponents.includes(id)) m |= 1 << i;
  });
  return m;
}

function opponentsOf(mask: number): OpponentId[] {
  return OPPONENT_IDS.filter((_, i) => (mask >> i) & 1);
}

function checksum(body: string): string {
  return B36[hashString(body) % 36];
}

/** Compact URL-safe code: V1-EX-k3j9z-S-b-2a-x (version, scenario, seed, difficulty, opponents mask, score?, checksum). */
export function encodeChallenge(spec: ChallengeSpec): string {
  const parts = [
    'V1',
    SCENARIO_CODES[spec.scenario],
    (spec.seed >>> 0).toString(36),
    DIFF_CODES[spec.difficulty],
    maskOf(spec.opponents).toString(36),
  ];
  if (spec.score !== undefined) parts.push(Math.round(Math.min(100, Math.max(0, spec.score))).toString(36));
  const body = parts.join('-');
  return `${body}-${checksum(body)}`;
}

export function decodeChallenge(input: string): ChallengeSpec | null {
  if (typeof input !== 'string') return null;
  const code = input.trim().replace(/^.*[?&]c=/, '').replace(/[#&].*$/, '');
  const parts = code.split('-');
  if (parts.length !== 6 && parts.length !== 7) return null;
  const chk = parts[parts.length - 1].toLowerCase();
  const body = parts.slice(0, -1);
  if (checksum(body.join('-')) !== chk) {
    // Codes are case-insensitive except for the checksum computed on the canonical form.
    const canonical = [body[0].toUpperCase(), body[1].toUpperCase(), body[2].toLowerCase(), body[3].toUpperCase(), body[4].toLowerCase(), ...(body[5] !== undefined ? [body[5].toLowerCase()] : [])];
    if (checksum(canonical.join('-')) !== chk) return null;
    body.splice(0, body.length, ...canonical);
  }
  if (body[0].toUpperCase() !== 'V1') return null;
  const scenarioEntry = Object.entries(SCENARIO_CODES).find(([, v]) => v === body[1].toUpperCase());
  if (!scenarioEntry) return null;
  const seed = parseInt(body[2], 36);
  if (!Number.isFinite(seed) || seed < 0 || seed > 0xffffffff || !/^[0-9a-z]+$/i.test(body[2])) return null;
  const diffEntry = Object.entries(DIFF_CODES).find(([, v]) => v === body[3].toUpperCase());
  if (!diffEntry) return null;
  const mask = parseInt(body[4], 36);
  if (!Number.isFinite(mask) || mask < 1 || mask > 31) return null;
  let score: number | undefined;
  if (body[5] !== undefined) {
    score = parseInt(body[5], 36);
    if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  }
  return {
    v: 1,
    scenario: scenarioEntry[0] as ScenarioId | 'campaign',
    seed: seed >>> 0,
    difficulty: diffEntry[0] as Difficulty,
    opponents: opponentsOf(mask),
    score,
  };
}

// ---------------------------------------------------------------------------
// Daily challenge codes (D1): `D1-<yyyymmdd>-<score36|_>-<fingerprint|_>-<outcome|_>-<chk>`
// Backward compatible: V1 codes are untouched; `decodeAnyChallenge` understands both.
// ---------------------------------------------------------------------------


export interface DailyChallengeSpec {
  kind: 'daily';
  v: 1;
  dailyId: DailyId;
  /** Challenger's official score (hidden by the UI until the recipient finishes). */
  score?: number;
  fingerprint?: string;
  outcome?: RepublicOutcome;
}

export type AnyChallenge = { kind: 'campaign'; spec: ChallengeSpec } | DailyChallengeSpec;

const OUTCOME_CODES: Record<RepublicOutcome, string> = {
  resilient: 'r',
  'free-fragile': 'f',
  'order-without-trust': 'o',
  manipulated: 'm',
  'institutionally-weakened': 'i',
  'economically-disrupted': 'e',
};
const DAILY_ID_RE = /^\d{4}-\d{2}-\d{2}$/;
const FP_RE = /^[DESPXW]{1,12}$/;

export function isValidDailyId(id: string): boolean {
  if (!DAILY_ID_RE.test(id)) return false;
  const [y, m, d] = id.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function encodeDailyChallenge(spec: Omit<DailyChallengeSpec, 'kind' | 'v'>): string {
  if (!isValidDailyId(spec.dailyId)) throw new Error('Invalid daily id');
  const parts = [
    'D1',
    spec.dailyId.replace(/-/g, ''),
    spec.score !== undefined ? Math.round(Math.min(100, Math.max(0, spec.score))).toString(36) : '_',
    spec.fingerprint && FP_RE.test(spec.fingerprint.toUpperCase()) ? spec.fingerprint.toUpperCase() : '_',
    spec.outcome ? OUTCOME_CODES[spec.outcome] : '_',
  ];
  const body = parts.join('-');
  return `${body}-${checksum(body)}`;
}

export function decodeDailyChallenge(input: string): DailyChallengeSpec | null {
  if (typeof input !== 'string') return null;
  const code = input.trim().replace(/^.*[?&]c=/, '').replace(/[#&].*$/, '');
  const parts = code.split('-');
  if (parts.length !== 6) return null;
  const [kind, date, scoreRaw, fpRaw, outcomeRaw, chk] = parts;
  if (kind.toUpperCase() !== 'D1') return null;
  const canonical = ['D1', date, scoreRaw.toLowerCase(), fpRaw === '_' ? '_' : fpRaw.toUpperCase(), outcomeRaw.toLowerCase()];
  if (checksum(canonical.join('-')) !== chk.toLowerCase()) return null;
  if (!/^\d{8}$/.test(date)) return null;
  const dailyId = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  if (!isValidDailyId(dailyId)) return null;
  let score: number | undefined;
  if (canonical[2] !== '_') {
    score = parseInt(canonical[2], 36);
    if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  }
  const fingerprint = canonical[3] === '_' ? undefined : canonical[3];
  if (fingerprint !== undefined && !FP_RE.test(fingerprint)) return null;
  let outcome: RepublicOutcome | undefined;
  if (canonical[4] !== '_') {
    const entry = (Object.entries(OUTCOME_CODES) as [RepublicOutcome, string][]).find(([, c]) => c === canonical[4]);
    if (!entry) return null;
    outcome = entry[0];
  }
  return { kind: 'daily', v: 1, dailyId, score, fingerprint, outcome };
}

/** Decodes either a campaign (V1) or a daily (D1) code; also accepts full URLs with `?c=`. */
export function decodeAnyChallenge(input: string): AnyChallenge | null {
  if (typeof input !== 'string') return null;
  const code = input.trim().replace(/^.*[?&]c=/, '').replace(/[#&].*$/, '');
  if (/^d1-/i.test(code)) return decodeDailyChallenge(code);
  const spec = decodeChallenge(code);
  return spec ? { kind: 'campaign', spec } : null;
}
