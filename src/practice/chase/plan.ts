/**
 * The chase on the Practice innings: the 12 balls (two Random Overs from the seed), the innings that carries them
 * (the same one-wicket innings reducer, with its in-flight protection and its saved form), and the one question the
 * screen asks after every change: what happens next (`chaseStep`).
 *
 * Nothing here changes a ball: the overs come from the seeded generator (src/practice/game/overs.ts) and each ball is
 * resolved by the frozen physics exactly as in Practice. The chase only chooses which two overs, in which order, and
 * refuses the Practice actions that would let a score be taken back (restart over) or a fixed ball be swapped.
 */
import type { Handedness, AssistLevel, PracticeInningsState, PracticeOverPlan } from '@/contracts/practice';
import { PRACTICE_SIM_VERSION } from '@/contracts/practice';
import { autoField } from '@/physics';
import {
  inningsError,
  inningsReducer,
  newInnings,
  nextDelivery,
  randomOver,
  resumeInnings,
  verifyRecord,
  type InningsAction,
} from '@/practice/game';
import { chaseDefinitionError, chaseFromInnings, chaseSummary, inningsDeliveries } from './rules';
import {
  CHASE_OVERS,
  type ChaseDefinition,
  type ChaseOverSetup,
  type ChaseState,
  type ChaseStep,
  type SavedChase,
} from './types';

/** The seed of one chase over (a name for the generator; the same seed and over always give the same six balls). */
export function chaseOverSeed(seed: string, overIndex: number): string {
  return `vande-chase|1|${seed}|over|${overIndex}`;
}

/**
 * One of the two overs of a chase: its fixed plan and the field set for it (the field is the automatic one of Practice).
 *
 * A left-handed batter gets the mirror image of the right-hander's chase: every bowler's arm is flipped, and the physics
 * flips the arm again for a left-handed striker, so each ball plays out exactly as it does for a right-hander with the same
 * swing (the same runs, wickets, contact and field; tested ball by ball in tests/unit/practice/chase/plan.test.ts). Without
 * this a left-hander would face a different physical problem (a right-arm bowler seen from the other side), and the same
 * target would be anywhere from far easier to far harder for him than the table says (measured: between 4% and 99% of the
 * reference batter's innings at the Standard target). Take the plan from here, never from `randomOver` directly.
 */
export function chaseOver(def: ChaseDefinition, overIndex: number, handedness: Handedness = 'right'): ChaseOverSetup {
  const drawn = randomOver({
    seed: chaseOverSeed(def.seed, overIndex),
    conditions: def.conditions,
    assist: 'play',
    difficulty: def.bowling,
  });
  const plan: PracticeOverPlan =
    handedness === 'left'
      ? { ...drawn, bowler: { ...drawn.bowler, arm: drawn.bowler.arm === 'right' ? 'left' : 'right' } }
      : drawn;
  return { overIndex, plan, field: autoField(plan.bowler, def.conditions, handedness, plan.ball) };
}

/** Both overs of a chase. Each is a few milliseconds of work: call it once per chase, not once per frame. */
export function chaseOvers(def: ChaseDefinition, handedness: Handedness = 'right'): ChaseOverSetup[] {
  return Array.from({ length: CHASE_OVERS }, (_, i) => chaseOver(def, i, handedness));
}

/** A new innings for the chase with its first over chosen: the next thing that happens is the first ball. */
export function startChaseInnings(
  def: ChaseDefinition,
  opts: { id: string; assist: AssistLevel; handedness: Handedness },
): PracticeInningsState {
  const fresh = newInnings({
    id: opts.id,
    conditions: def.conditions,
    assist: opts.assist,
    handedness: opts.handedness,
  });
  const first = chaseOver(def, 0, opts.handedness);
  return inningsReducer(fresh, { type: 'chooseOver', plan: first.plan, field: first.field });
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Why an innings action may not be applied in a chase (a closed code), or null. It adds to the innings' own rules
 * (`inningsError`): no restart of an over (it would take runs off), only the chase's own overs may be chosen, and
 * nothing is bowled once the chase is decided.
 */
export function chaseInningsError(
  def: ChaseDefinition,
  innings: PracticeInningsState,
  action: InningsAction,
): string | null {
  if (action.type === 'restartOver') return 'restart_not_allowed_in_chase';
  const own = inningsError(innings, action);
  if (own !== null) return own;
  const state = chaseFromInnings(def, innings);
  if (action.type === 'abandon') return null;
  if (state.result !== 'in_progress') return 'chase_over';
  if (action.type === 'chooseOver') {
    if (innings.overs.length >= CHASE_OVERS) return 'chase_has_two_overs';
    const expected = chaseOver(def, innings.overs.length, innings.handedness);
    if (!sameJson(action.plan, expected.plan) || !sameJson(action.field, expected.field)) return 'not_the_chase_over';
  }
  return null;
}

/** Apply an innings action in a chase; one the chase refuses leaves the innings exactly as it was (the same object). */
export function chaseInningsReducer(
  def: ChaseDefinition,
  innings: PracticeInningsState,
  action: InningsAction,
): PracticeInningsState {
  return chaseInningsError(def, innings, action) === null ? inningsReducer(innings, action) : innings;
}

/** What the screen does next, from the innings and the chase together. */
export function chaseStep(def: ChaseDefinition, innings: PracticeInningsState, state?: ChaseState): ChaseStep {
  const chase = state ?? chaseFromInnings(def, innings);
  if (chase.result !== 'in_progress') {
    return {
      kind: 'finished',
      summary: chaseSummary(chase, innings.assist),
      closeInnings: innings.status !== 'out' && innings.status !== 'complete',
    };
  }
  switch (innings.status) {
    case 'batting': {
      if (innings.inFlight) return { kind: 'wait' };
      const next = nextDelivery(innings);
      return next ? { kind: 'bowl', next } : { kind: 'wait' };
    }
    case 'over_complete':
      return { kind: 'next_over' };
    case 'choosing_over':
      return { kind: 'choose_over', setup: chaseOver(def, innings.overs.length, innings.handedness) };
    default:
      // 'out' and 'complete' always decide the chase, so an in-progress chase never gets here (a damaged save is
      // caught by verifyChaseInnings); closing it is the safe answer.
      return { kind: 'finished', summary: null, closeInnings: false };
  }
}

/**
 * The innings action that follows without the player doing anything (`nextOver`, `chooseOver` with the chase's next
 * over, or `abandon` to close an innings whose chase is decided), or null when the next step is a ball or a wait.
 */
export function chaseInningsAction(def: ChaseDefinition, innings: PracticeInningsState): InningsAction | null {
  const step = chaseStep(def, innings);
  switch (step.kind) {
    case 'next_over':
      return { type: 'nextOver' };
    case 'choose_over':
      return { type: 'chooseOver', plan: step.setup.plan, field: step.setup.field };
    case 'finished':
      return step.closeInnings ? { type: 'abandon' } : null;
    default:
      return null;
  }
}

/**
 * Whether an innings is exactly this chase's innings (a closed code, or null): the pitch, the overs and every record are
 * the ones the chase would have made, in order, with nothing after the chase was decided. It rebuilds the innings
 * from its own records through the innings reducer, so a damaged or edited save fails here and nowhere else.
 * That check is structural, as the innings' own is; `deep` also plays every record again through the physics
 * (about 7 ms a ball) and refuses one whose runs or wicket are not what the physics gives.
 */
export function verifyChaseInnings(
  def: ChaseDefinition,
  innings: PracticeInningsState,
  opts: { deep?: boolean } = {},
): string | null {
  if (innings.version !== PRACTICE_SIM_VERSION) return 'wrong_version';
  if (innings.conditions !== def.conditions) return 'wrong_conditions';
  if (innings.dismissal && innings.status !== 'out') return 'dismissal_without_out';
  const records = inningsDeliveries(innings);
  if (records.length > def.balls) return 'too_many_balls';
  let rebuilt = startChaseInnings(def, { id: innings.id, assist: innings.assist, handedness: innings.handedness });
  if (rebuilt.status !== 'batting') return 'cannot_start';
  let chase = chaseFromInnings(def, rebuilt);
  for (const record of records) {
    if (chase.result !== 'in_progress') return 'ball_after_decision';
    if (rebuilt.status === 'over_complete') rebuilt = chaseInningsReducer(def, rebuilt, { type: 'nextOver' });
    if (rebuilt.status === 'choosing_over') {
      const setup = chaseOver(def, rebuilt.overs.length, innings.handedness);
      rebuilt = chaseInningsReducer(def, rebuilt, { type: 'chooseOver', plan: setup.plan, field: setup.field });
      if (rebuilt.status !== 'batting') return 'cannot_choose_over';
    }
    const started = chaseInningsReducer(def, rebuilt, { type: 'deliveryStarted' });
    const applied = chaseInningsReducer(def, started, { type: 'deliveryResolved', record });
    if (applied === started) return `refused_ball_${record.overIndex}_${record.ballIndex}`;
    rebuilt = applied;
    chase = chaseFromInnings(def, rebuilt);
  }
  if (!sameJson(rebuilt.runs, innings.runs) || rebuilt.balls !== innings.balls) return 'score_mismatch';
  if (opts.deep) for (const record of records) if (!verifyRecord(record)) return 'record_not_reproducible';
  return null;
}

/**
 * A saved chase back in play: the definition and the innings are checked, and a delivery that was in flight when the
 * app left resolves as a leave through the physics (the Practice rule, so quitting mid-ball can never earn a second
 * try). Null when the save is not a valid chase of this build.
 */
export function resumeChase(
  saved: SavedChase,
  opts: { deep?: boolean } = {},
): { definition: ChaseDefinition; innings: PracticeInningsState; state: ChaseState } | null {
  if (!saved || chaseDefinitionError(saved.definition) !== null) return null;
  const def = saved.definition;
  try {
    const innings = resumeInnings(saved.innings);
    if (verifyChaseInnings(def, innings, opts) !== null) return null;
    return { definition: def, innings, state: chaseFromInnings(def, innings) };
  } catch {
    // Whatever was read back from storage is not an innings this build can play: it is not a chase to resume.
    return null;
  }
}
