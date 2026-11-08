/**
 * The Target Chase on the Practice flow. The innings stays the one saved truth (src/practice/game, with its in-flight
 * protection); the chase is read from its records by CHASE-CORE's rules (src/practice/chase), and this class only
 * decides what the screens do around them: opening a chase, the break between the two overs, the result, "Try this
 * chase again", leaving and coming back. It never decides a ball, never shows a chase number before the stage has shown
 * the ball it comes from, and refuses everything that could take a score back (restart over, practice this ball).
 *
 * The flow (../flow/controller.ts) owns the state and the stage; this class works through its public methods, like the
 * coach loop does, so the chase adds a few hook calls to the flow and no second copy of its sequencing.
 */
import type { DeliveryRecord, PracticeInningsState } from '@/contracts';
import {
  DEFAULT_CHASE_DIFFICULTY,
  audioSituation,
  chaseAllowed,
  chaseFromInnings,
  chaseInningsReducer,
  chaseOver,
  chaseSeedAt,
  chaseStep,
  chaseSummary,
  inningsDeliveries,
  isDecided,
  lastChaseResult,
  makeChase,
  nextChaseSeed,
  pickChaseSeed,
  recordChaseResult,
  resumeChase,
  startChase,
  startChaseInnings,
  type ChaseDefinition,
} from '@/practice/chase';
import { bump, clearInnings } from '@/practice/store';
import type { MatchSituation } from '@/audio/situation';
import type { PracticeFlow } from '../flow/controller';
import { EMPTY_BOARD, type ChaseFlow, type PendingOver } from '../flow/state';
import { clearChase, droppedChase, loadChaseHistory, loadSavedChase, saveChaseHistory } from './store';

/** True in the hooks build (VITE_PRACTICE_TEST_HOOKS=1) and in unit tests; false, and folded away, in a production build. */
const TEST_BUILD = import.meta.env.VITE_PRACTICE_TEST_HOOKS === '1' || import.meta.env.MODE === 'test';

/** FNV-1a over a string, as a number in [0, 1): the flow's own seed source picks the pool seed, so tests can fix it. */
export function unitOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x100000000;
}

/** What the deciding ball's replay shows: slow motion, with the diagnostics explaining a loss but not decorating a win. */
export const DECIDING_REPLAY = { speed: 0.3, winSpeed: 0.5, lingerMs: 700 } as const;

export class ChaseDriver {
  /** The seed of the chase last opened in this visit, so "a new chase" is never the same one again by chance. */
  private lastSeed: string | null = null;

  constructor(private readonly flow: PracticeFlow) {}

  // ---- what is on --------------------------------------------------------------------------------------------

  get current(): ChaseFlow | null {
    return this.flow.getState().chase;
  }

  /** What may be done now (CHASE-CORE's answer), or null outside a chase. */
  allowed() {
    const c = this.current;
    return c ? chaseAllowed(c.state) : null;
  }

  // ---- opening a chase ---------------------------------------------------------------------------------------

  /** A pool seed for a new chase: from the flow's own seed source (fixed in tests), never the one just played. */
  freshSeed(): string {
    // The test hook is read only in a test build or a unit test: no hook name stays in the production bundle (DoD G-15).
    const hook = TEST_BUILD ? (this.flow.deps.hooks?.chaseSeed?.() ?? null) : null;
    if (hook && makeChase(hook)) return hook;
    const seed = pickChaseSeed(unitOf(this.flow.seed()));
    return seed === this.lastSeed ? nextChaseSeed(seed) : seed;
  }

  /**
   * Opens a chase. A fresh seed (the default) or the given one ("Try this chase again": same seed, same target), at the
   * Standard difficulty, chosen here once and never changed. Its setup screen waits for Play; `direct` goes straight to
   * the first ball (the retry: the player has seen the briefing).
   */
  start(opts: { seed?: string; direct?: boolean } = {}): void {
    const f = this.flow;
    const def = makeChase(opts.seed ?? this.freshSeed(), DEFAULT_CHASE_DIFFICULTY) ?? this.fallback();
    this.lastSeed = def.seed;
    const { assist, handedness } = f.settings;
    const first = chaseOver(def, 0, handedness);
    let intent: PendingOver['intent'];
    try {
      intent = f.engine.fieldIntent(first.field, first.plan.bowler, def.conditions, handedness);
    } catch {
      intent = null;
    }
    const pending: PendingOver = {
      kind: 'random',
      plan: first.plan,
      field: first.field,
      intent,
      overNumber: 1,
      conditions: def.conditions,
      assist,
      handedness,
      random: null,
      continuing: false,
      bowled: 0,
    };
    const previous = lastChaseResult(loadChaseHistory(f.store), def.seed, def.difficulty);
    // Everything of an earlier innings or chase is dropped in this one change, so the screens never see a half state.
    clearInnings(f.store);
    clearChase(f.store);
    f.coachLoop.forgetResults();
    f.gen++;
    f.clearTimers();
    f.set({
      chase: { state: startChase(def), previous, summary: null },
      innings: null,
      board: EMPTY_BOARD,
      pending,
      overKind: 'random',
      overDifficulty: def.bowling,
      screen: opts.direct ? 'live' : 'setup',
      phase: opts.direct ? 'loading' : 'idle',
      field: first.field,
      intent,
      conditions: def.conditions,
      handedness,
      error: null,
      last: null,
      insight: null,
      coach: null,
      replay: null,
      notice: null,
    });
    f.startWork();
    void f.host.prepare(assist, handedness).then((stage) => stage && f.warmPhysics());
    if (opts.direct) void f.play();
  }

  /**
   * "Try this chase again": the same seed, the same target, a new attempt, straight to the first ball. After the result,
   * or from the pause (the attempt so far is dropped; it is neither a win nor a loss and nothing of it is kept).
   */
  retry(): void {
    const c = this.current;
    if (!c || c.state.result === 'abandoned') return;
    this.start({ seed: c.state.definition.seed, direct: true });
  }

  private fallback(): ChaseDefinition {
    return makeChase(chaseSeedAt(0), DEFAULT_CHASE_DIFFICULTY) as ChaseDefinition;
  }

  /** The innings a chase is batted on: over 1 already chosen, so Play bowls the first ball. */
  newInnings(p: PendingOver): PracticeInningsState {
    const def = (this.current as ChaseFlow).state.definition;
    return startChaseInnings(def, { id: this.flow.newId(), assist: p.assist, handedness: p.handedness });
  }

  // ---- during the chase --------------------------------------------------------------------------------------

  /** The match situation for the ball due next, as the crowd and the stage's emotion signals take it. */
  matchSituation(): MatchSituation | null {
    const c = this.current;
    return c && c.state.result === 'in_progress' ? audioSituation(c.state) : null;
  }

  /** The screen-reader line of a ball: its outcome, then (in a chase) what is needed now or how the chase ended. */
  said(outcome: string, chase: ChaseFlow | null): string {
    const more = chase ? this.flow.deps.words?.chase?.(chase.state) : null;
    return more ? `${outcome} ${more}` : outcome;
  }

  /** The chase as shown after a ball: read from the innings, so it changes exactly when the board does. */
  afterBall(innings: PracticeInningsState): ChaseFlow | null {
    const c = this.current;
    if (!c) return null;
    const state = chaseFromInnings(c.state.definition, innings);
    return { ...c, state, summary: chaseSummary(state, innings.assist) };
  }

  /**
   * The deciding ball is dead and shown: the result is kept in the local history (this device only), and the result
   * moment is handed to the stage, which plays its clips now that the physics has decided (the crowd already reacted
   * at the confirmed outcome, in src/audio, so nothing more is sounded here).
   */
  decidedNow(): void {
    const f = this.flow;
    const c = this.current;
    if (!c?.summary) return;
    saveChaseHistory(recordChaseResult(loadChaseHistory(f.store), c.summary, Date.now()), f.store);
    const moment = c.summary.result;
    try {
      void Promise.resolve(f.host.stage?.presentChaseMoment?.(moment)).catch(() => undefined);
    } catch {
      /* neither does a clip */
    }
  }

  /**
   * "Next ball" on the dead ball of a chase: the next ball, the second over, or the result. Returns true when the chase
   * took it (the flow then does nothing else).
   */
  next(): boolean {
    const f = this.flow;
    const c = this.current;
    const innings = f.getState().innings;
    if (!c || !innings) return false;
    const step = chaseStep(c.state.definition, innings, c.state);
    switch (step.kind) {
      case 'bowl':
        void f.bowlNext();
        return true;
      case 'next_over':
      case 'choose_over':
        if (this.advanceOver()) void f.bowlNext();
        return true;
      case 'finished':
        this.showResult();
        return true;
      default:
        return true;
    }
  }

  /** The break between the overs: the second over is chosen by the chase (never by the player) and set on the stage. */
  advanceOver(): boolean {
    const f = this.flow;
    const c = this.current;
    let innings = f.getState().innings;
    if (!c || !innings) return false;
    const def = c.state.definition;
    for (let i = 0; i < 2 && innings.status !== 'batting'; i++) {
      const before: PracticeInningsState = innings;
      const step = chaseStep(def, innings, c.state);
      if (step.kind === 'next_over') innings = chaseInningsReducer(def, innings, { type: 'nextOver' });
      else if (step.kind === 'choose_over')
        innings = chaseInningsReducer(def, innings, {
          type: 'chooseOver',
          plan: step.setup.plan,
          field: step.setup.field,
        });
      if (innings === before) return false;
    }
    if (innings.status !== 'batting' || !innings.current) return false;
    let intent: PendingOver['intent'];
    try {
      intent = f.engine.fieldIntent(
        innings.current.field,
        innings.current.plan.bowler,
        innings.conditions,
        innings.handedness,
      );
    } catch {
      intent = null;
    }
    f.set({
      innings,
      field: innings.current.field,
      intent,
      board: f.boardOf(innings),
      last: null,
      insight: null,
      replay: null,
    });
    // The stage draws the second over with its own bowler and field (a Practice over gets this from Play).
    f.setSceneFor(innings);
    f.persist();
    return true;
  }

  // ---- the end ------------------------------------------------------------------------------------------------

  /** The deciding ball's record, from the innings. */
  decidingRecord(): DeliveryRecord | null {
    const c = this.current;
    const innings = this.flow.getState().innings;
    const key = c?.summary?.decidingBall.key;
    if (!key || !innings) return null;
    return inningsDeliveries(innings).find((r) => `${r.overIndex}:${r.ballIndex}` === key) ?? null;
  }

  /** The win or loss screen, after the deciding ball: the innings is closed, and the deciding ball is replayed. */
  showResult(): void {
    const f = this.flow;
    const c = this.current;
    let innings = f.getState().innings;
    if (!c || !innings || !isDecided(c.state) || f.getState().screen === 'chase_result') return;
    const step = chaseStep(c.state.definition, innings, c.state);
    if (step.kind === 'finished' && step.closeInnings)
      innings = chaseInningsReducer(c.state.definition, innings, { type: 'abandon' });
    f.clearTimers();
    f.coachLoop.abortInsight();
    f.saveMetrics(bump(f.metrics, 'innings'));
    f.set({
      innings,
      screen: 'chase_result',
      phase: 'idle',
      chase: this.afterBall(innings),
      last: null,
      insight: null,
    });
    f.persist();
    this.watchDecidingBall();
  }

  /** Slow motion of the deciding ball; closing it comes back to the result. A replay changes nothing in the chase. */
  watchDecidingBall(): void {
    const c = this.current;
    const record = this.decidingRecord();
    if (!c?.summary || !record) return;
    const won = c.summary.result === 'won';
    const f = this.flow;
    const gen = f.gen;
    void f.coachLoop
      .replayBall(record, won ? DECIDING_REPLAY.winSpeed : DECIDING_REPLAY.speed, !won, c.summary.result)
      .then(() => f.wait(DECIDING_REPLAY.lingerMs))
      .then((stayed) => {
        // The replay ended by itself and nobody left or closed it: back to the result, the last frame held a moment.
        const st = f.getState();
        if (stayed && gen === f.gen && st.replay && !st.replay.playing) f.coachLoop.closeReplay();
      });
  }

  /** "Practise the deciding ball": Coach Mode on that exact ball, practice only; it comes back to the result. */
  practiseDecidingBall(): void {
    const record = this.decidingRecord();
    if (record && this.allowed()?.practiceThisBall) this.flow.coachLoop.practiceBall(record);
  }

  // ---- leaving, resuming, forgetting -------------------------------------------------------------------------

  /** Forgets the saved chase on this device (a new innings from the home, the result screen closed). */
  forget(): void {
    clearChase(this.flow.store);
  }

  /** Brings back a chase that was left half way, or one decided as the app closed. Null: there is none. */
  restore(): 'menu' | 'summary' | null {
    const f = this.flow;
    const dropped = droppedChase(f.store);
    if (dropped) {
      clearChase(f.store);
      f.set({ notice: dropped });
      return 'menu';
    }
    const loaded = loadSavedChase(f.store);
    if (!loaded) return null;
    const wasInFlight = Boolean(loaded.saved.innings.inFlight);
    const resumed = resumeChase(loaded.saved);
    if (!resumed) {
      clearChase(f.store);
      f.set({ notice: 'unreadable' });
      return 'menu';
    }
    const def = resumed.definition;
    const state = resumed.state;
    const summary = chaseSummary(state, resumed.innings.assist);
    const history = loadChaseHistory(f.store);
    // A chase decided as the app closed keeps its result (it is authoritative once the ball is committed); its screen then
    // shows no "last try", which would be itself.
    const previous = summary ? null : lastChaseResult(history, def.seed, def.difficulty);
    if (summary) saveChaseHistory(recordChaseResult(history, summary, Date.now()), f.store);
    f.set({
      innings: resumed.innings,
      chase: { state, previous, summary },
      board: f.boardOf(resumed.innings),
      conditions: resumed.innings.conditions,
      handedness: resumed.innings.handedness,
      overKind: 'random',
      overDifficulty: def.bowling,
      notice: wasInFlight || loaded.notice ? 'resumed_leave' : null,
    });
    this.lastSeed = def.seed;
    if (wasInFlight) f.persist();
    if (isDecided(state)) {
      f.set({ screen: 'chase_result' });
      return 'summary';
    }
    return 'menu';
  }

  /** The chase left half way, in the words the home's resume card needs. */
  resumeInfo(): { runsNeeded: number; ballsLeft: number } | null {
    const c = this.current;
    return c && c.state.result === 'in_progress' && this.flow.getState().innings
      ? { runsNeeded: c.state.runsNeeded, ballsLeft: c.state.ballsLeft }
      : null;
  }
}
