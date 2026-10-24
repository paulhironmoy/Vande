import { OPPONENT_IDS, type ChallengeSpec, type Difficulty, type OpponentId, type ScenarioId } from './types';
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
