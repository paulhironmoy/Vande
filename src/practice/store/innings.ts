/**
 * The innings in progress, saved after every change so a pause, a kill or a reload never erases it. The in-flight
 * flag (set the moment a delivery starts) is saved before the delivery is bowled; a resumed innings resolves that
 * delivery as a leave (src/practice/game resumeInnings), so nothing can be replayed for a better score. An innings
 * from another simulation version is discarded: its deliveries would no longer replay exactly.
 */
import {
  PRACTICE_MAX_OVERS,
  PRACTICE_SIM_VERSION,
  type BowlerFamily,
  type DeliveryRecord,
  type DeliveryVariation,
  type FieldLayout,
  type InningsStatus,
  type PaceBand,
  type PracticeDeliveryPlan,
  type PracticeInningsState,
  type PracticeOverPlan,
  type SpinType,
} from '@/contracts';
import { PRACTICE_KEYS, isInt, isNum, isObj, localStore, readJson, removeKey, writeJson, type KeyStore } from './storage';

const STATUSES: readonly InningsStatus[] = ['choosing_over', 'batting', 'over_complete', 'out', 'complete'];
const RUNS = [0, 1, 2, 3, 4, 6];
const DISMISSALS = ['bowled', 'caught', 'caught_behind', 'lbw'];
const PITCHES = ['balanced', 'green', 'hard', 'turning'];
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 200;

function isBowler(v: unknown): boolean {
  return isObj(v) && (v.family === 'pace' || v.family === 'spin') && (v.arm === 'right' || v.arm === 'left') && typeof v.lookSeed === 'string';
}

function isDeliveryPlan(v: unknown): v is PracticeDeliveryPlan {
  return isObj(v) && str(v.variation) && isNum(v.lengthM) && isNum(v.lineM) && isNum(v.speedKph);
}

export function isOverPlan(v: unknown): v is PracticeOverPlan {
  return (
    isObj(v) &&
    v.version === PRACTICE_SIM_VERSION &&
    isBowler(v.bowler) &&
    Array.isArray(v.balls) &&
    v.balls.length === 6 &&
    v.balls.every(isDeliveryPlan) &&
    str(v.seed) &&
    (v.source === 'random' || v.source === 'built' || v.source === 'guided')
  );
}

function isField(v: unknown): v is FieldLayout {
  return isObj(v) && str(v.id) && Array.isArray(v.fielders) && v.fielders.length === 11 && v.fielders.every((f) => isObj(f) && str(f.id) && str(f.role) && isNum(f.x) && isNum(f.z));
}

function isSwing(v: unknown): boolean {
  return v === null || (isObj(v) && (v.kind === 'defend' || v.kind === 'attack') && isNum(v.startT) && isNum(v.directionDeg) && isNum(v.power) && isNum(v.elevation) && str(v.footwork));
}

export function isDeliveryRecord(v: unknown): v is DeliveryRecord {
  return (
    isObj(v) &&
    v.version === PRACTICE_SIM_VERSION &&
    isInt(v.overIndex) &&
    (v.overIndex as number) >= 0 &&
    (v.overIndex as number) < PRACTICE_MAX_OVERS &&
    isInt(v.ballIndex) &&
    (v.ballIndex as number) >= 0 &&
    (v.ballIndex as number) < 6 &&
    isBowler(v.bowler) &&
    isDeliveryPlan(v.plan) &&
    str(v.seed) &&
    PITCHES.includes(v.conditions as string) &&
    isField(v.field) &&
    (v.handedness === 'right' || v.handedness === 'left') &&
    (v.assist === 'learn' || v.assist === 'play' || v.assist === 'real') &&
    isNum(v.tierToleranceMs) &&
    isSwing(v.swing) &&
    RUNS.includes(v.runs as number) &&
    (v.dismissal === null || DISMISSALS.includes(v.dismissal as string))
  );
}

/** A structurally valid innings of this simulation version (the reducer owns the rules; this guards the shape). */
export function isInningsState(v: unknown): v is PracticeInningsState {
  if (!isObj(v) || v.version !== PRACTICE_SIM_VERSION || !str(v.id) || !STATUSES.includes(v.status as InningsStatus)) return false;
  if (!PITCHES.includes(v.conditions as string) || !['learn', 'play', 'real'].includes(v.assist as string) || !['right', 'left'].includes(v.handedness as string)) return false;
  if (!isInt(v.runs) || (v.runs as number) < 0 || !isInt(v.balls) || (v.balls as number) < 0 || (v.balls as number) > PRACTICE_MAX_OVERS * 6) return false;
  if (!Array.isArray(v.overs) || v.overs.length > PRACTICE_MAX_OVERS) return false;
  if (!v.overs.every((o) => isObj(o) && isOverPlan(o.plan) && Array.isArray(o.deliveries) && o.deliveries.every(isDeliveryRecord))) return false;
  if (v.current !== null) {
    const c = v.current;
    if (!isObj(c) || !isOverPlan(c.plan) || !isField(c.field) || !Array.isArray(c.deliveries) || c.deliveries.length > 6 || !c.deliveries.every(isDeliveryRecord)) return false;
  }
  if (v.inFlight !== null && !(isObj(v.inFlight) && isInt(v.inFlight.overIndex) && isInt(v.inFlight.ballIndex))) return false;
  if (v.dismissal !== null && !(isObj(v.dismissal) && isDeliveryRecord(v.dismissal.record))) return false;
  return true;
}

/** The saved innings, and whether its last ball was cut short by the app closing (to say so on the next start). */
export interface SavedInnings {
  state: PracticeInningsState;
  notice: 'resumed_leave' | null;
}

export function loadSavedInnings(store: KeyStore | null = localStore()): SavedInnings | null {
  const raw = readJson(store, PRACTICE_KEYS.innings);
  if (!isObj(raw) || raw.v !== 1 || !isInningsState(raw.state)) return null;
  return { state: raw.state, notice: raw.notice === 'resumed_leave' ? 'resumed_leave' : null };
}

export function loadInnings(store: KeyStore | null = localStore()): PracticeInningsState | null {
  return loadSavedInnings(store)?.state ?? null;
}

/**
 * Saves synchronously; false when storage is unavailable or full. `notice` marks that the last ball was resolved
 * as a leave because the app went away during it (the next start says so); any later save clears it.
 */
export function saveInnings(state: PracticeInningsState, store: KeyStore | null = localStore(), notice: 'resumed_leave' | null = null): boolean {
  return writeJson(store, PRACTICE_KEYS.innings, notice ? { v: 1, state, notice } : { v: 1, state });
}

export function clearInnings(store: KeyStore | null = localStore()): void {
  removeKey(store, PRACTICE_KEYS.innings);
}

/** An innings worth offering to continue (not finished). */
export function isResumable(s: PracticeInningsState | null): s is PracticeInningsState {
  return Boolean(s) && (s!.status === 'batting' || s!.status === 'over_complete' || s!.status === 'choosing_over');
}

// ---------------------------------------------------------------------------------------------------------------
// The Build an Over draft (kept so leaving the editor never loses six chosen balls)
// ---------------------------------------------------------------------------------------------------------------

export interface DraftBall {
  lineM: number;
  lengthM: number;
  variation: DeliveryVariation;
}

export interface BuildDraft {
  v: 1;
  family: BowlerFamily;
  paceBand: PaceBand;
  spinType: SpinType;
  arm: 'right' | 'left';
  balls: Array<DraftBall | null>;
  order: 'exact' | 'shuffle';
}

export function emptyDraft(family: BowlerFamily = 'pace'): BuildDraft {
  return { v: 1, family, paceBand: 'fast', spinType: 'finger', arm: 'right', balls: [null, null, null, null, null, null], order: 'exact' };
}

function isDraftBall(v: unknown): v is DraftBall {
  return isObj(v) && isNum(v.lineM) && isNum(v.lengthM) && str(v.variation);
}

export function loadDraft(store: KeyStore | null = localStore()): BuildDraft | null {
  const v = readJson(store, PRACTICE_KEYS.draft);
  if (!isObj(v) || v.v !== 1 || (v.family !== 'pace' && v.family !== 'spin')) return null;
  if (!['controlled', 'fast', 'express'].includes(v.paceBand as string) || !['finger', 'wrist'].includes(v.spinType as string)) return null;
  if (v.arm !== 'right' && v.arm !== 'left') return null;
  if (!Array.isArray(v.balls) || v.balls.length !== 6 || !v.balls.every((b) => b === null || isDraftBall(b))) return null;
  return { v: 1, family: v.family, paceBand: v.paceBand as PaceBand, spinType: v.spinType as SpinType, arm: v.arm, balls: v.balls as Array<DraftBall | null>, order: v.order === 'shuffle' ? 'shuffle' : 'exact' };
}

export function saveDraft(d: BuildDraft, store: KeyStore | null = localStore()): void {
  writeJson(store, PRACTICE_KEYS.draft, d);
}

export function clearDraft(store: KeyStore | null = localStore()): void {
  removeKey(store, PRACTICE_KEYS.draft);
}
