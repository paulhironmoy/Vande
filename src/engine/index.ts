/**
 * Sealed Six engine — public entry. GAMEPLAY-OWNED implementation of SealedSixEngineApi (src/contracts/engine.ts).
 *
 * `engine` is the current rules version. `verifyMatchLog` always dispatches to the version recorded in the log, so old
 * replays keep verifying after an upgrade. Pure and deterministic: no DOM, no Node APIs, no wall clock, no Math.random
 * (WebCrypto is used only for commit hashes). The named helpers below are stable additions for the UI, the platform and
 * tools; they are not part of the frozen contract.
 */
import type { MatchEventLog, SealedSixEngineApi } from '@/contracts';
import { ENGINE_VERSION as CONTRACT_ENGINE_VERSION } from '@/contracts/cricket';
import { engineFor, ENGINES, SUPPORTED_ENGINE_VERSIONS } from './registry';

const current = ENGINES[CONTRACT_ENGINE_VERSION];
if (!current) throw new Error(`engine: no rules registered for ENGINE_VERSION ${CONTRACT_ENGINE_VERSION}`);

async function verifyAnyVersion(log: MatchEventLog): ReturnType<SealedSixEngineApi['verifyMatchLog']> {
  if (!log || typeof log !== 'object') return { ok: false, errors: ['log.missing'] };
  const rules = engineFor(log.engine);
  if (!rules) return { ok: false, errors: ['log.engine_version_unsupported'] };
  return rules.verifyMatchLog(log);
}

export const engine: SealedSixEngineApi = { ...current, verifyMatchLog: verifyAnyVersion };

export default engine;

export { engineFor, ENGINES, SUPPORTED_ENGINE_VERSIONS };

// --- Stable helpers (v1 rules) ----------------------------------------------------------------------------------
export { zoneFromSwipe, swipeVectorForZone, checkTrace, qualityFromRelease } from './v1/traces';
export { timingGrade, isLegalZone, timingAudit } from './v1/batting';
export { deliveryTiming, deliveryPath } from './v1/delivery';
export { ballTimeline, RUN_UP_MS } from './v1/cues';
export { EXPLAIN_KEYS } from './v1/resolve';
export { COMMENTARY_KEYS, potmPoints } from './v1/match';
export { planEnergy } from './v1/plan';
export { dailyCommits, dailyCommitSalt } from './v1/daily';
export {
  ALLOWED_LENGTHS,
  ENERGY_BASE,
  FAMILY,
  FIELD_LAYOUTS,
  LEGAL_ZONES,
  NATURAL_ZONES,
  METER as EXECUTION_METER,
  SUPER_BALL_ALLOWANCE,
  LATE_LIMIT_MS,
  MIN_SWIPE,
  SECTOR_ZONES,
} from './v1/tables';
export { canonicalJson } from './canonical';
export { autoXiBalls, autoXiSeed } from './auto';
export { FIELD_POSITIONS, type FieldPosition, type FieldPositionKind, type FieldRole } from './fieldDisplay';
export { newSeed } from './prng';
