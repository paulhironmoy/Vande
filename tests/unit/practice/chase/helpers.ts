import type {
  AssistLevel,
  DeliveryOutcome,
  DeliveryRecord,
  Dismissal,
  Handedness,
  NormalizedSwing,
  PracticeInningsState,
} from '@/contracts/practice';
import { batTravelMs, idealTimeFor } from '@/physics';
import { makeRecord, nextDelivery, nextFlight, resolveNext, type NextDelivery } from '@/practice/game';
import {
  chaseFromInnings,
  chaseInningsAction,
  chaseInningsReducer,
  chaseStep,
  chaseSummary,
  startChaseInnings,
  type BallRuns,
  type ChaseDefinition,
  type ChaseState,
  type ChaseSummary,
} from '@/practice/chase';

/** A swing for the ball due next, `errorMs` late (negative: early) against the ideal contact for its footwork. */
export function swingFor(
  next: NextDelivery,
  s: { kind: 'attack' | 'defend'; directionDeg?: number; power?: number; elevation?: number; errorMs?: number },
): NormalizedSwing {
  const flight = nextFlight(next);
  const power = s.power ?? (s.kind === 'defend' ? 0.2 : 0.7);
  return {
    kind: s.kind,
    startT: idealTimeFor(flight, 'auto') - batTravelMs(s.kind, power) / 1000 + (s.errorMs ?? 0) / 1000,
    directionDeg: s.directionDeg ?? 0,
    power,
    elevation: s.elevation ?? 0,
    footwork: 'auto',
  };
}

/** What a scripted batter does with the ball due next (null leaves it). */
export type Batter = (next: NextDelivery, ballNumber: number) => NormalizedSwing | null;

export const LEAVE_ALL: Batter = () => null;
export const DEFEND_ALL: Batter = (next) => swingFor(next, { kind: 'defend' });
/** The same careful defence, a little late every ball: another batter whose score differs only in the details. */
export const DEFEND_LATE: Batter = (next) => swingFor(next, { kind: 'defend', errorMs: 25 });
export const DRIVE_ALL: Batter = (next) => swingFor(next, { kind: 'attack', directionDeg: 0, power: 0.7 });
/** A batter who changes his mind every ball, so a chase has runs and misses in it. */
export const MIXED: Batter = (next, n) =>
  n % 4 === 0
    ? null
    : n % 4 === 1
      ? swingFor(next, { kind: 'defend' })
      : swingFor(next, {
          kind: 'attack',
          directionDeg: ((n * 37) % 120) - 60,
          power: 0.8,
          elevation: n % 3 === 0 ? 0.6 : 0,
        });

export interface PlayedChase {
  innings: PracticeInningsState;
  state: ChaseState;
  summary: ChaseSummary | null;
  records: DeliveryRecord[];
}

export interface ChaseRun {
  /** Take the automatic steps and bowl one ball; false once the chase is finished (and its innings closed). */
  step(): boolean;
  played(): PlayedChase;
}

/** A chase being played one ball at a time, following only what `chaseStep` says to do next. */
export function startRun(
  def: ChaseDefinition,
  batter: Batter,
  opts: { id?: string; assist?: AssistLevel; handedness?: Handedness } = {},
): ChaseRun {
  let innings = startChaseInnings(def, {
    id: opts.id ?? `test:${def.seed}:${def.difficulty}`,
    assist: opts.assist ?? 'play',
    handedness: opts.handedness ?? 'right',
  });
  const records: DeliveryRecord[] = [];
  return {
    step() {
      for (let guard = 0; guard < 20; guard++) {
        const step = chaseStep(def, innings);
        if (step.kind === 'finished') {
          if (step.closeInnings) innings = chaseInningsReducer(def, innings, { type: 'abandon' });
          return false;
        }
        if (step.kind === 'bowl') {
          const { next } = step;
          const started = chaseInningsReducer(def, innings, { type: 'deliveryStarted' });
          const { record } = resolveNext(next, batter(next, records.length + 1), 0);
          innings = chaseInningsReducer(def, started, { type: 'deliveryResolved', record });
          records.push(record);
          return true;
        }
        const action = chaseInningsAction(def, innings);
        if (!action) throw new Error(`no automatic action after step ${step.kind}`);
        innings = chaseInningsReducer(def, innings, action);
      }
      throw new Error('the chase did not settle');
    },
    played() {
      const state = chaseFromInnings(def, innings);
      return { innings, state, summary: chaseSummary(state, innings.assist), records: [...records] };
    },
  };
}

/** Bowl a whole chase through the real physics. */
export function playChase(
  def: ChaseDefinition,
  batter: Batter,
  opts: { id?: string; assist?: AssistLevel; handedness?: Handedness } = {},
): PlayedChase {
  const run = startRun(def, batter, opts);
  while (run.step());
  return run.played();
}

export { makeRecord };

/**
 * An innings of a chase whose balls had the given results, without playing them through the physics (the rules of the
 * innings and of the chase do not depend on it): each ball is a leave record with the result written in. With
 * `inFlight` the next ball has been started and not resolved.
 */
export function syntheticInnings(
  def: ChaseDefinition,
  outcomes: ReadonlyArray<{ runs: BallRuns; dismissal?: Dismissal | null }>,
  opts: { inFlight?: boolean; id?: string; assist?: AssistLevel; handedness?: Handedness } = {},
): PracticeInningsState {
  let innings = startChaseInnings(def, {
    id: opts.id ?? 'synthetic',
    assist: opts.assist ?? 'play',
    handedness: opts.handedness ?? 'right',
  });
  const advance = () => {
    for (;;) {
      const a = chaseInningsAction(def, innings);
      if (!a || a.type === 'abandon') return;
      innings = chaseInningsReducer(def, innings, a);
    }
  };
  for (const o of outcomes) {
    advance();
    const next = nextDelivery(innings);
    if (!next) break;
    innings = chaseInningsReducer(def, innings, { type: 'deliveryStarted' });
    const record = makeRecord(next, null, 0, {
      outcome: { runs: o.runs, dismissal: o.dismissal ?? null } as DeliveryOutcome,
    });
    innings = chaseInningsReducer(def, innings, { type: 'deliveryResolved', record });
  }
  if (opts.inFlight) {
    advance();
    innings = chaseInningsReducer(def, innings, { type: 'deliveryStarted' });
  }
  return innings;
}
