/**
 * The Practice flow controller: PREPARE (the setup screen) → OBSERVE, READ, DECIDE, EXECUTE (one delivery, see
 * ./delivery.ts) → EXPERIENCE (the stage) → UNDERSTAND (the dead ball and its one insight) → MASTER (Coach Mode,
 * ./coachLoop.ts), then the over summary.
 *
 * Rules it enforces (docs/PRACTICE.md): one wicket ends the innings, at most ten overs, a full over before the next is
 * chosen, an over is fixed before its first ball, the score changes only after the stage has shown the ball. Nothing
 * advances by itself after a dead ball: the player reads the result and chooses. Quality changes only between balls.
 */
import type {
  AssistLevel,
  CoachOption,
  DeliveryRecord,
  DeliveryResult,
  PracticeInningsState,
  PracticeOverPlan,
  UnityPracticeDeadBallAction,
} from '@/contracts';
import { PRACTICE_MAX_OVERS } from '@/contracts';
import {
  bump,
  clearInnings,
  droppedInnings,
  durationBucket,
  intentMatch,
  isResumable,
  latencyBucket,
  loadPracticeSettings,
  loadSavedInnings,
  outcomeProp,
  overNumberProp,
  timingProp,
  updatePracticeSettings,
} from '@/practice/store';
import { FlowCore, type FlowDeps } from './core';
import { CoachLoop } from './coachLoop';
import { DeliveryRunner, type BallSpec } from './delivery';
import { StageHost } from './stageHost';
import type { InputModality, StageDeadBallUi } from './types';
import type { OneGestureState } from '@/input';
import {
  AUTO_NEXT_MS,
  EMPTY_BOARD,
  HINT_BALLS,
  READY_MS,
  isQuiet,
  type Board,
  type FlowState,
  type LivePhase,
  type OverKind,
  type PendingOver,
  type RandomChoice,
} from './state';

export * from './state';
export type { FlowDeps, FlowHooks, FlowWords } from './core';

/** The balanced defaults a Random Over starts from: Club bowling on a Balanced pitch, any bowler. */
const DEFAULT_RANDOM: RandomChoice = { difficulty: 'club', conditions: 'balanced', bowling: 'any' };

export class PracticeFlow extends FlowCore {
  readonly host: StageHost;
  readonly runner: DeliveryRunner;
  readonly coachLoop: CoachLoop;
  private hiddenPause = false;
  /** Native Pause during Quiet Mode hides Unity only after the authoritative dead ball. */
  private pauseNativeAtDeadBall = false;
  private hidden = false;
  /** True only while a native ready surface is waiting for its visibility acknowledgement. */
  private readyPending = false;
  private pausedFrom: LivePhase = 'dead';
  /** The timing forgiveness of the over in play (ms), latched at its first ball; the last one latched, for the notice. */
  private latched: { over: string; ms: number } | null = null;
  private skipIntro: (() => void) | null = null;
  private demoFailed = false;
  /** A graphics change made as the over began (after its setup screen): said at the over's first dead ball. */
  private openingNotice: 'balanced' | 'classic' | null = null;
  private startedAt = 0;
  private openedAt: number;
  private handledDeadBall: FlowState['last'] = null;

  constructor(deps: FlowDeps) {
    super(deps, (settings) => ({
      screen: 'idle',
      phase: 'idle',
      innings: null,
      pending: null,
      overKind: null,
      overDifficulty: null,
      board: EMPTY_BOARD,
      ball: null,
      gesture: { enabled: false, key: '0' },
      last: null,
      insight: null,
      coach: null,
      replay: null,
      field: null,
      intent: null,
      conditions: settings.conditions,
      handedness: settings.handedness,
      assessment: null,
      quality: { stage: '3d', profile: 'standard', tier: 'full', toleranceMs: 0 },
      stageReady: false,
      notice: null,
      needLandscape: false,
      canvasKey: 0,
      coachCanvasKey: 0,
      storageOk: true,
      announce: null,
      error: null,
    }));
    this.host = new StageHost(this);
    this.runner = new DeliveryRunner(
      this,
      this.host,
      () => this.requestPause(),
      (action) => this.handleDeadBallAction(action),
    );
    this.coachLoop = new CoachLoop(this);
    this.openedAt = deps.openedAt ?? this.clock.now();
    const assessment = this.host.initialAssessment();
    this.state = {
      ...this.state,
      assessment,
      quality: this.host.qualityFor(assessment),
      storageOk: this.probeStorage(),
    };
  }

  private probeStorage(): boolean {
    if (!this.store) return false;
    try {
      this.store.setItem('vc:practice:probe', '1');
      this.store.removeItem('vc:practice:probe');
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Start-up, resume and settings
  // ------------------------------------------------------------------------------------------------------------

  /** Loads the saved innings and resolves anything left in flight (as a leave). 'summary' for a finished innings. */
  init(): 'menu' | 'summary' {
    this.saveMetrics(bump(this.metrics, 'sessions'));
    this.track('practice_opened', {});
    const dropped = droppedInnings(this.store);
    if (dropped) {
      // Old or damaged data never crashes Practice: it is forgotten, and the player is told plainly.
      clearInnings(this.store);
      this.set({ notice: dropped });
      return 'menu';
    }
    const loaded = loadSavedInnings(this.store);
    if (!loaded) return 'menu';
    const saved = loaded.state;
    const wasInFlight = Boolean(saved.inFlight);
    const resumed = wasInFlight ? this.engine.resumeInnings(saved) : saved;
    this.set({
      innings: resumed,
      board: this.boardOf(resumed),
      conditions: resumed.conditions,
      handedness: resumed.handedness,
      notice: wasInFlight || loaded.notice ? 'resumed_leave' : null,
      overKind: kindOf(resumed),
    });
    if (wasInFlight) this.persist();
    if (resumed.status === 'out' || resumed.status === 'complete') {
      this.set({ screen: resumed.status === 'out' ? 'out' : 'complete' });
      return 'summary';
    }
    return 'menu';
  }

  /** An innings worth continuing (the Practice home's resume card). */
  resumable(): PracticeInningsState | null {
    const s = this.state.innings;
    return isResumable(s) ? s : null;
  }

  /** Settings changed: graphics apply before the next ball; hand and assistance with the next innings. */
  refreshSettings(): void {
    this.settings = loadPracticeSettings(this.store);
    this.host.settingsChanged();
    if (!this.state.innings) this.set({ handedness: this.settings.handedness });
  }

  /** Refreshes future spoken announcements and the already-mounted native ready cue after an in-app language change. */
  setLanguage(locale: string, readyHint: string, words: FlowDeps['words']): void {
    this.deps.words = words;
    this.host.setLanguage(locale, readyHint);
  }

  rerunDeviceCheck(): void {
    this.host.rerunCheck();
  }

  attachCanvas = (el: HTMLCanvasElement | null): void => this.host.attachCanvas(el);
  attachCoachCanvas = (el: HTMLCanvasElement | null): void => this.host.attachCoachCanvas(el);
  onSwingStart = (atPerfMs: number, pointer?: InputModality): void => this.runner.onSwingStart(atPerfMs, pointer);
  onSwingIntent = (intent: { atPerfMs: number; pointer: InputModality }): void => this.runner.onSwingIntent(intent);
  onGestureCancel = (): void => this.runner.onGestureCancel();
  onContactState = (state: OneGestureState): void => this.runner.onContactState(state);
  onGesture: DeliveryRunner['onGesture'] = (input) => this.runner.onGesture(input);
  setLandscape = (landscape: boolean): void => this.runner.setLandscape(landscape);
  allowPortrait = (): void => this.runner.allowPortrait();

  firstDeliveryMs(): number | null {
    return this.runner.ttfd;
  }

  sessionFps(): number[] {
    return this.host.monitor?.recentFps() ?? [];
  }

  stageStats() {
    try {
      return this.host.stage?.stats() ?? null;
    } catch {
      return null;
    }
  }

  lastInputToBatMs(): number | null {
    return this.stageStats()?.lastInputToBatMs ?? null;
  }

  protectedRegions() {
    try {
      return this.host.stage?.protectedRegions() ?? [];
    } catch {
      return [];
    }
  }

  /** React must not mount a second live input surface when the selected native stage owns batting input. */
  stageOwnsInput(): boolean {
    return this.host.ownsInput();
  }

  /** Sends localized result guidance to the selected native stage, if it owns that surface. */
  async presentDeadBallUi(ui: StageDeadBallUi): Promise<boolean> {
    try {
      return (await this.host.stage?.presentDeadBallUi?.(ui)) ?? false;
    } catch {
      return false;
    }
  }

  private handleDeadBallAction(action: UnityPracticeDeadBallAction): void {
    const state = this.state;
    if (state.screen !== 'live' || state.phase !== 'dead' || !state.last) return;
    if (action === 'practice_ball') {
      if (!this.coach || this.handledDeadBall === state.last) return;
      this.handledDeadBall = state.last;
      this.coachLoop.practiceThisBall();
      return;
    }
    if (this.handledDeadBall === state.last) return;
    this.handledDeadBall = state.last;
    this.nextBall();
  }

  /** One authority gate shared by Android Unity actions and the React result surface. */
  acceptDeadBallAction(action: UnityPracticeDeadBallAction): void {
    this.handleDeadBallAction(action);
  }

  /**
   * The dead ball is on screen again after Coach Mode (opened from it): its actions are offered afresh, so "Next ball"
   * (or practising it again) works once more. Without this the dead ball's first action, "Practice this ball", kept it
   * consumed, and "Next ball" after Coach Mode did nothing: a dead end.
   */
  deadBallShownAgain(): void {
    this.handledDeadBall = null;
  }

  // ------------------------------------------------------------------------------------------------------------
  // PREPARE: the setup screen for the coming over
  // ------------------------------------------------------------------------------------------------------------

  private continuing(): PracticeInningsState | null {
    const s = this.state.innings;
    return s && (s.status === 'over_complete' || s.status === 'choosing_over') ? s : null;
  }

  private randomPlan(
    choice: RandomChoice,
    conditions: PracticeInningsState['conditions'],
    assist: AssistLevel,
  ): PracticeOverPlan {
    return this.engine.randomOver({
      seed: this.seed(),
      conditions,
      assist,
      difficulty: choice.difficulty,
      ...(choice.bowling === 'any' ? {} : { family: choice.bowling }),
    });
  }

  /**
   * Opens the setup screen for an over: a Random Over (its choices, balanced by default), the reference over, or the
   * player's own six. The stage is prepared behind it (discreetly), so Play bowls at once.
   */
  prepareOver(opts: { kind: OverKind; plan?: PracticeOverPlan; random?: RandomChoice }): void {
    const inn = this.continuing();
    const assist = inn?.assist ?? this.settings.assist;
    const handedness = inn?.handedness ?? this.settings.handedness;
    const random =
      opts.kind === 'random'
        ? (opts.random ?? {
            difficulty: this.settings.difficulty,
            conditions: this.settings.conditions,
            bowling: this.settings.bowling,
          })
        : null;
    const conditions = inn?.conditions ?? (random ? random.conditions : 'balanced');
    const plan =
      opts.kind === 'reference'
        ? this.engine.referenceOver()
        : (opts.plan ?? this.randomPlan(random ?? DEFAULT_RANDOM, conditions, assist));
    this.setPending({
      kind: opts.kind,
      plan,
      random,
      conditions,
      assist,
      handedness,
      continuing: Boolean(inn),
      overNumber: (inn?.overs.length ?? 0) + 1,
      bowled: 0,
    });
    this.startWork();
    void this.host.prepare(assist, handedness).then((stage) => stage && this.warmPhysics());
  }

  private warmed = false;

  /**
   * The work thread's script is fetched and compiled as the setup screen opens, on every path (a forced tier, the
   * Automatic device check, a resumed innings), so it is never an asset load inside a delivery (PERF4: on the Automatic
   * path the idle-time warm-up below ran only after the device check, and the first run-up fetched the worker). Only the
   * worker is created here: off the main thread, nothing waits for it, and its warm-up simulation still waits for the
   * stage to be ready, so it never competes with the device check.
   */
  private startWork(): void {
    this.work?.warm();
  }

  /**
   * Once per visit, while the setup screen is open: one throwaway resolution of the coming over's first ball, so the
   * physics' first-use cost (contact, the bat track, fielding) never lands on the first real swing. The result is
   * discarded; nothing is recorded or shown. The stage builds its own result path on it once too (`warmResult`), in
   * spare slices of frames, so the first real result does not compile that either.
   */
  private warmPhysics(): void {
    if (this.warmed) return;
    this.warmed = true;
    const p = this.state.pending;
    if (!p) return;
    const run = () => {
      try {
        const plan = p.plan.balls[0];
        const flight = this.engine.flight({
          plan,
          bowler: p.plan.bowler,
          conditions: p.conditions,
          seed: `warm:${p.plan.seed}`,
          handedness: p.handedness,
          ball: p.plan.ball,
        });
        const swing = {
          kind: 'attack' as const,
          startT: Math.max(0, flight.idealContactT - 0.14),
          directionDeg: 20,
          power: 0.6,
          elevation: 0,
          footwork: 'auto' as const,
        };
        // The work thread starts and warms on the same throwaway ball (it resolves the live balls when it is there).
        this.work?.warm({
          kind: 'resolve',
          args: {
            flight,
            field: p.field,
            bowler: p.plan.bowler,
            conditions: p.conditions,
            handedness: p.handedness,
            assist: p.assist,
            tierToleranceMs: 0,
          },
        });
        const result = this.engine.resolveDelivery({
          flight,
          swing,
          field: p.field,
          bowler: p.plan.bowler,
          conditions: p.conditions,
          handedness: p.handedness,
          assist: p.assist,
          tierToleranceMs: 0,
        });
        // The stage runs its result path once on it too (in spare slices of frames), then it is dropped.
        this.host.stage?.warmResult?.(result, flight, {
          field: p.field,
          bowler: p.plan.bowler,
          conditions: p.conditions,
          handedness: p.handedness,
          ball: p.plan.ball,
        });
      } catch {
        /* warming is best effort */
      }
    };
    const w =
      typeof window !== 'undefined'
        ? (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
        : null;
    if (w?.requestIdleCallback) w.requestIdleCallback(run, { timeout: 1500 });
    else this.after(0, run);
  }

  private setPending(p: Omit<PendingOver, 'field' | 'intent'>): void {
    // The over's ball sets the kind of field: a white ball a limited-overs one, a red ball a Test one.
    const field = this.engine.autoField(p.plan.bowler, p.conditions, p.handedness, p.plan.ball);
    let intent: PendingOver['intent'];
    try {
      intent = this.engine.fieldIntent(field, p.plan.bowler, p.conditions, p.handedness);
    } catch {
      intent = null;
    }
    this.set({
      pending: { ...p, field, intent },
      screen: 'setup',
      phase: 'idle',
      field,
      intent,
      conditions: p.conditions,
      handedness: p.handedness,
      error: null,
      last: null,
      insight: null,
    });
  }

  /** The Random Over's choices changed on the setup screen: a new over, still unknown until release. */
  updateRandom(choice: RandomChoice): void {
    const p = this.state.pending;
    if (!p || p.kind !== 'random' || p.bowled > 0) return;
    const conditions = p.continuing ? p.conditions : choice.conditions;
    this.setPending({
      ...p,
      kind: 'random',
      random: choice,
      conditions,
      plan: this.randomPlan(choice, conditions, p.assist),
    });
  }

  /** Assistance for a new innings (fixed once the innings has begun). */
  setAssist(assist: AssistLevel): void {
    const p = this.state.pending;
    if (!p || p.continuing || p.bowled > 0) return;
    this.set({ pending: { ...p, assist } });
  }

  /** Back from the setup screen: nothing was bowled, nothing changes. */
  cancelSetup(): void {
    this.set({ pending: null, screen: 'idle', phase: 'idle' });
  }

  /** Play (the setup screen's one action): commits the over and bowls its next ball. */
  async play(): Promise<void> {
    const p = this.state.pending;
    if (!p) return;
    const gen = ++this.gen;
    this.startedAt = this.startedAt || this.clock.now();
    this.set({
      screen: 'live',
      phase: 'loading',
      board: this.state.innings && p.continuing ? this.boardOf(this.state.innings) : this.state.board,
      notice: this.state.notice,
    });
    const stage = await this.host.prepare(p.assist, p.handedness);
    if (gen !== this.gen) return;
    if (!stage) {
      this.set({ screen: 'error', phase: 'idle', error: 'stage' });
      return;
    }
    let s = this.state.innings;
    if (!p.continuing && p.bowled === 0) {
      // Starting a new innings while one is saved ends that one (the home screen asked first): its score is final.
      if (isResumable(s)) this.finishInnings(this.engine.inningsReducer(s, { type: 'abandon' }), 'abandon');
      s = this.engine.newInnings({
        id: this.newId(),
        conditions: p.conditions,
        assist: p.assist,
        handedness: p.handedness,
      });
      this.coachLoop.forgetResults();
      this.startedAt = this.clock.now();
    }
    if (!s) return;
    if (s.status === 'over_complete') s = this.toNextOver(s);
    if (s.status === 'choosing_over')
      s = this.engine.inningsReducer(s, { type: 'chooseOver', plan: p.plan, field: p.field });
    if (s.status !== 'batting' || !s.current) {
      this.set({ screen: 'error', phase: 'idle', error: 'over' });
      return;
    }
    this.set({
      innings: s,
      pending: null,
      overKind: p.kind,
      overDifficulty: p.random?.difficulty ?? (p.continuing && p.bowled > 0 ? this.state.overDifficulty : null),
      field: s.current.field,
      board: { ...this.boardOf(s) },
    });
    this.persist();
    stage.setScene({
      field: s.current.field,
      ...(p.intent ? { fieldIntent: p.intent.intention } : {}),
      trainingObjective: p.kind,
      bowler: s.current.plan.bowler,
      conditions: s.conditions,
      handedness: s.handedness,
      ball: s.current.plan.ball,
    });
    // Between overs is when quality may change; then the over's forgiveness is latched for all six balls.
    const quality = await this.host.applyPending(() => this.setSceneFor(this.state.innings), s.assist, s.handedness);
    if (gen !== this.gen) return;
    if (!this.host.stage) {
      // The stage could not be rebuilt (its code could not load, say): a calm stop, never an endless wait.
      this.set({ screen: 'error', phase: 'idle', error: 'stage' });
      return;
    }
    this.openingNotice = quality === 'balanced' || quality === 'classic' ? quality : null;
    if (quality) this.set({ notice: quality });
    if (this.settings.teach && !this.settings.demoSeen && this.coach && !this.demoFailed)
      await this.firstRunDemo(gen, p);
    if (gen !== this.gen) return;
    void this.bowlNext();
  }

  /**
   * The timing forgiveness is fixed for a whole over at its first ball, whatever the device does later in the over (a
   * resumed or restarted over keeps the one its first ball was played with), so nothing about a delivery changes while
   * it is being bowled. When the forgiveness differs from the previous over's, the player is told which way, in plain
   * words (never in Real, which gives none on any device).
   */
  private latchTolerance(s: PracticeInningsState): { ms: number; notice: 'help_changed' | 'help_less' | null } {
    const over = `${s.id}:${s.overs.length}`;
    if (this.latched?.over === over) return { ms: this.latched.ms, notice: null };
    const first = s.current?.deliveries[0];
    const ms = first ? first.tierToleranceMs : this.state.quality.toleranceMs;
    const prev = this.latched?.ms ?? null;
    this.latched = { over, ms };
    if (prev === null || prev === ms || s.assist === 'real') return { ms, notice: null };
    return { ms, notice: ms > prev ? 'help_changed' : 'help_less' };
  }

  /**
   * The first run's one short demonstration, before the first ball: a readable stock ball from this over's bowler
   * (never one of the over's own deliveries) played by the same production batter, in the same Unity world and HUD,
   * with the coach's recommended response. It can be skipped (or all teaching turned off) in one tap; either way it
   * is remembered and never shown again.
   */
  private async firstRunDemo(gen: number, p: PendingOver): Promise<void> {
    const stage = this.host.stage;
    const coach = this.coach;
    if (!stage || !coach) return;
    this.set({ phase: 'intro' });
    const abort = new AbortController();
    let skipRequested = false;
    this.skipIntro = () => {
      skipRequested = true;
      abort.abort();
    };
    try {
      const plan = {
        variation: 'stock' as const,
        lengthM: 5.8,
        lineM: 0.15,
        speedKph: p.plan.balls.find((b) => b.variation === 'stock')?.speedKph ?? p.plan.balls[0].speedKph,
      };
      const record = {
        version: p.plan.version,
        overIndex: 0,
        ballIndex: 0,
        bowler: p.plan.bowler,
        plan,
        seed: `demo:${p.plan.seed}`,
        conditions: p.conditions,
        ball: p.plan.ball,
        field: p.field,
        handedness: p.handedness,
        assist: p.assist,
        tierToleranceMs: 0,
        swing: null,
        runs: 0 as const,
        dismissal: null,
      };
      const flight = this.engine.flight({
        plan,
        bowler: p.plan.bowler,
        conditions: p.conditions,
        seed: record.seed,
        handedness: p.handedness,
        ball: p.plan.ball,
      });
      const left = this.engine.resolveDelivery({
        flight,
        swing: null,
        field: p.field,
        bowler: p.plan.bowler,
        conditions: p.conditions,
        handedness: p.handedness,
        assist: p.assist,
        tierToleranceMs: 0,
      });
      // The coach's whole reading of this ball is seconds of simulation: on the work thread when there is one (Skip
      // stays live meanwhile), else here as before. The same recommended response either way.
      let guide: { option: CoachOption; result: DeliveryResult } | null = null;
      if (this.work?.canWork()) {
        try {
          guide = (await this.work.read(record, left, { tip: false, sample: null, guide: true }, abort.signal)).guide;
        } catch (e) {
          if (abort.signal.aborted) throw e;
          guide = null;
        }
        if (gen !== this.gen || this.disposed) {
          this.skipIntro = null;
          return;
        }
      }
      if (!guide) {
        const analysis = coach.analyzeBall(record, left);
        const option = coach.optionOf(analysis, 'recommended');
        guide = { option, result: this.engine.repeatDelivery(record, option.swing) };
      }
      const { option, result } = guide;
      // A one-tap Skip aborts immediately, but the live ball waits for the
      // stage's acknowledged cancellation cleanup. Racing an immediate local
      // resolve against this promise can overlap the next bowl with a native
      // demonstration that is still unwinding.
      await stage.demonstrate(result, option, { source: record, signal: abort.signal });
    } catch (error) {
      // A demonstration is never worth blocking the first ball. It was not seen, so it is offered again next visit.
      this.skipIntro = null;
      if (skipRequested && error instanceof Error && error.name === 'AbortError') {
        if (gen === this.gen) this.settings = updatePracticeSettings({ demoSeen: true }, this.store);
        return;
      }
      this.demoFailed = true;
      return;
    }
    this.skipIntro = null;
    if (gen === this.gen) this.settings = updatePracticeSettings({ demoSeen: true }, this.store);
  }

  /** "Skip" on the first-run demonstration; `all` also turns teaching off for good (one tap, remembered). */
  skipTeaching(all: boolean): void {
    this.settings = updatePracticeSettings(all ? { demoSeen: true, teach: false } : { demoSeen: true }, this.store);
    this.skipIntro?.();
  }

  private toNextOver(s: PracticeInningsState): PracticeInningsState {
    const next = this.engine.inningsReducer(s, { type: 'nextOver' });
    this.saveMetrics(bump(this.metrics, 'nextOver'));
    this.track('practice_next_over', { overNumber: overNumberProp(next.overs.length + 1), assist: next.assist });
    return next;
  }

  /** "Continue innings": back to the setup screen of the over in progress, or to the summary the innings reached. */
  continueInnings(): void {
    const s = this.state.innings;
    if (!s) return;
    if (s.status === 'batting' && s.current) {
      const kind = this.state.overKind ?? kindOf(s) ?? 'random';
      const field = s.current.field;
      let intent: PendingOver['intent'];
      try {
        intent = this.engine.fieldIntent(field, s.current.plan.bowler, s.conditions, s.handedness);
      } catch {
        intent = null;
      }
      const pending: PendingOver = {
        kind,
        plan: s.current.plan,
        field,
        intent,
        overNumber: s.overs.length + 1,
        conditions: s.conditions,
        assist: s.assist,
        handedness: s.handedness,
        random: null,
        continuing: true,
        bowled: s.current.deliveries.length,
      };
      this.set({ pending, screen: 'setup', phase: 'idle', field, intent, board: this.boardOf(s) });
      this.startWork();
      void this.host.prepare(s.assist, s.handedness);
    } else if (s.status === 'over_complete' || s.status === 'choosing_over')
      this.set({ screen: 'over_summary', phase: 'idle', board: this.boardOf(s) });
  }

  /** "Try again" on the calm error: the stage is prepared afresh and the innings carries on (it was saved). */
  async retry(): Promise<void> {
    const s = this.state.innings;
    this.set({ screen: 'live', phase: 'loading', error: null });
    const stage = await this.host.prepare(s?.assist ?? this.settings.assist, s?.handedness ?? this.settings.handedness);
    if (!stage) {
      this.set({ screen: 'error', phase: 'idle', error: 'stage' });
      return;
    }
    this.setSceneFor(this.state.innings);
    if (s?.status === 'batting') this.continueInnings();
    else this.set({ screen: 'idle', phase: 'idle' });
  }

  /** "Choose a different over" from the over summary: the Practice home chooses the next over of this innings. */
  chooseNextOver(): void {
    const s = this.state.innings;
    if (!s || (s.status !== 'over_complete' && s.status !== 'choosing_over')) return;
    this.set({ screen: 'idle', phase: 'idle' });
  }

  /** The innings is between overs (the Practice home then chooses its next over). */
  betweenOvers(): boolean {
    return Boolean(this.continuing());
  }

  /** Abandons the saved innings (a new innings from the home screen, confirmed). Its score is final. */
  discardInnings(): void {
    const s = this.state.innings;
    if (s && isResumable(s)) this.finishInnings(this.engine.inningsReducer(s, { type: 'abandon' }), 'abandon');
    clearInnings(this.store);
    this.coachLoop.forgetResults();
    this.set({ innings: null, board: EMPTY_BOARD, last: null, insight: null, notice: null, overKind: null });
  }

  // ------------------------------------------------------------------------------------------------------------
  // One ball, then the dead ball (UNDERSTAND)
  // ------------------------------------------------------------------------------------------------------------

  /** Quiet mode (and the moment before it): no pause, no menus, nothing but the ball. */
  busy(): boolean {
    const p = this.state.phase;
    return isQuiet(p) || p === 'loading' || p === 'ready' || p === 'intro';
  }

  /**
   * The pre-delivery moment for the first few balls on this device: "Tap to defend · Flick to hit", then the run-up.
   * False when it was interrupted (leaving, or the app going away, which pauses: Resume bowls the ball).
   */
  private async ready(gen: number): Promise<boolean> {
    if (!this.settings.teach || this.settings.hintsShown >= HINT_BALLS) return gen === this.gen;
    const stage = this.host.stage;
    const phase = this.state.phase;
    if (stage?.presentReady) {
      this.readyPending = true;
      let shown: boolean;
      try {
        shown = await stage.presentReady(true);
      } finally {
        this.readyPending = false;
      }
      if (gen !== this.gen || this.disposed || this.host.stage !== stage || this.state.phase !== phase) {
        if (!this.disposed && this.host.stage === stage && shown) await stage.presentReady(false);
        return false;
      }
      if (!shown) {
        this.set({ screen: 'error', phase: 'idle', error: 'stage' });
        return false;
      }
    }
    if (gen !== this.gen || this.disposed) return false;
    this.set({ phase: 'ready' });
    const proceed = (await this.wait(READY_MS)) && gen === this.gen;
    if (!proceed) await stage?.presentReady?.(false);
    return proceed;
  }

  /** The app is in the background as a ball is about to start: it waits, paused, and Resume bowls it. */
  private holdWhileHidden(): boolean {
    if (!this.hidden) return false;
    this.pausedFrom = 'ready';
    this.set({ phase: 'paused' });
    return true;
  }

  /** The next ball of the over in progress. */
  async bowlNext(): Promise<void> {
    this.clearTimers();
    const s = this.state.innings;
    if (!s || s.status !== 'batting' || !s.current || isQuiet(this.state.phase) || this.state.phase === 'ready') return;
    const gen = this.gen;
    this.coachLoop.abortInsight();
    const notice = await this.host.applyPending(() => this.setSceneFor(this.state.innings), s.assist, s.handedness);
    if (gen !== this.gen) return;
    if (!this.host.stage) {
      this.set({ screen: 'error', phase: 'idle', error: 'stage' });
      return;
    }
    const now = this.state.innings;
    const next = now ? this.engine.nextDelivery(now) : null;
    if (!next || !now) return;
    // Latched after any quality change between balls, so the over's first ball and the five after it share one value.
    const help = this.latchTolerance(now);
    // A notice raised between balls stays for this ball's dead ball (one raised as the over began stays for its first
    // ball, and a change in timing help, which changes the batting, says so first); the others are cleared as it starts.
    const opening = (now.current?.deliveries.length ?? 0) === 0;
    const keep = opening ? this.openingNotice : null;
    this.openingNotice = null;
    this.set({ notice: help.notice ?? notice ?? keep, last: null, insight: null, replay: null });
    this.hiddenPause = false;
    this.pauseNativeAtDeadBall = false;
    const spec: BallSpec = {
      kind: 'innings',
      ...next,
      overNumber: next.overIndex + 1,
      ballNumber: next.ballIndex + 1,
      next,
      context: this.deps.deliveryContext?.({
        runs: now.runs,
        wicketsInHand: 1,
        ballsLeft: PRACTICE_MAX_OVERS * 6 - now.balls,
      }),
      toleranceMs: help.ms,
    };
    this.set({
      ball: { kind: 'innings', overNumber: spec.overNumber, ballNumber: spec.ballNumber, bowler: next.bowler },
    });
    if (this.holdWhileHidden()) return;
    if (!(await this.ready(gen))) return;
    if (this.holdWhileHidden()) return;
    // Never bowled onto a stage that is not ready: wait for the one being prepared, or stop calmly.
    if (!this.host.stage || !this.state.stageReady || this.host.isPreparing()) {
      this.set({ phase: 'loading' });
      const stage = await this.host.prepare(now.assist, now.handedness);
      if (gen !== this.gen) return;
      if (!stage) {
        this.set({ screen: 'error', phase: 'idle', error: 'stage' });
        return;
      }
    }
    const out = await this.runner.run(spec);
    if (!out || gen !== this.gen) return;
    const inn = this.state.innings!;
    this.coachLoop.remember(out.record, out.result);
    const latency = out.result.swing ? (this.host.stage?.stats().lastInputToBatMs ?? null) : null;
    this.track('practice_delivery', {
      assist: next.assist,
      tier: this.state.quality.tier,
      timing: timingProp(out.result),
      intentMatch: intentMatch(out.result),
      outcome: outcomeProp(out.result.outcome),
      ...(latency !== null && Number.isFinite(latency) ? { latencyBucket: latencyBucket(latency) } : {}),
    });
    if (this.settings.hintsShown < 10) {
      this.settings = { ...this.settings, hintsShown: this.settings.hintsShown + 1 };
      this.coachLoop.saveHints(this.settings.hintsShown);
    }
    const board = this.boardOf(inn);
    const last = {
      kind: 'innings' as const,
      result: out.result,
      record: out.record,
      overNumber: spec.overNumber,
      ballNumber: spec.ballNumber,
      interrupted: out.interrupted,
    };
    this.set({
      phase: this.hiddenPause ? 'paused' : 'dead',
      last,
      board,
      notice: out.interrupted ? 'interrupted' : this.state.notice,
      announce: this.deps.words ? { text: this.deps.words.outcome(last, board), id: Date.now() } : this.state.announce,
    });
    if (this.hiddenPause) {
      this.pausedFrom = 'dead';
      if (this.pauseNativeAtDeadBall) {
        this.pauseNativeAtDeadBall = false;
        const pauseTask = this.host.stage?.pause?.('player');
        void pauseTask?.catch(() => undefined);
      }
    }
    this.coachLoop.analyzeLast();
    if (this.deps.hooks?.autoNext) this.after(AUTO_NEXT_MS, () => this.nextBall());
  }

  private setSceneFor(s: PracticeInningsState | null): void {
    if (!s?.current) return;
    this.host.stage?.setScene({
      field: s.current.field,
      ...(this.state.intent ? { fieldIntent: this.state.intent.intention } : {}),
      ...(this.state.overKind ? { trainingObjective: this.state.overKind } : {}),
      bowler: s.current.plan.bowler,
      conditions: s.conditions,
      handedness: s.handedness,
      ball: s.current.plan.ball,
    });
  }

  /** "Next ball" (the dead ball's secondary action): the next ball, or the summary the innings reached. */
  nextBall(): void {
    const ph = this.state.phase;
    if (ph !== 'dead' && ph !== 'paused') return;
    this.clearTimers();
    const s = this.state.innings;
    if (s && s.status !== 'batting') {
      this.showEnd(s);
      return;
    }
    void this.bowlNext();
  }

  private showEnd(s: PracticeInningsState): void {
    this.clearTimers();
    this.coachLoop.abortInsight();
    if (s.status === 'over_complete') {
      this.saveMetrics(bump(this.metrics, 'overs'));
      this.track('practice_over_completed', { overNumber: overNumberProp(s.overs.length), assist: s.assist });
      this.set({ screen: 'over_summary', phase: 'idle' });
    } else if (s.status === 'out') {
      this.track('practice_wicket', { overNumber: overNumberProp(s.overs.length + 1), assist: s.assist });
      this.finishInnings(s, 'out');
      this.set({ screen: 'out', phase: 'idle' });
    } else if (s.status === 'complete') {
      this.saveMetrics(bump(this.metrics, 'overs'));
      this.track('practice_over_completed', { overNumber: overNumberProp(PRACTICE_MAX_OVERS), assist: s.assist });
      this.finishInnings(s, 'complete');
      this.set({ screen: 'complete', phase: 'idle' });
    }
  }

  private finishInnings(s: PracticeInningsState, how: 'out' | 'complete' | 'abandon'): void {
    this.saveMetrics(bump(this.metrics, 'innings'));
    const overs = Math.max(1, Math.min(PRACTICE_MAX_OVERS, s.overs.length + (s.current?.deliveries.length ? 1 : 0)));
    this.track('practice_innings_completed', {
      overNumber: overNumberProp(overs),
      assist: s.assist,
      ...(how === 'out' ? { outcome: 'out' as const } : {}),
      durationBucket: durationBucket(this.clock.now() - (this.startedAt || this.openedAt)),
    });
  }

  /** Restart over (pause panel, confirmed): the same over from its first ball; its runs so far are removed. */
  restartOver(): boolean {
    const s = this.state.innings;
    if (!s || s.status !== 'batting' || !s.current || s.current.deliveries.length === 0 || this.busy()) return false;
    const next = this.engine.inningsReducer(s, { type: 'restartOver' }) as PracticeInningsState | undefined;
    if (!next || next === s || next.status !== 'batting' || next.current?.deliveries.length !== 0) return false;
    this.gen++;
    this.clearTimers();
    this.set({ innings: next, board: this.boardOf(next), last: null, insight: null, phase: 'idle', notice: null });
    this.persist();
    void this.bowlNext();
    return true;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Pause, the app going away, leaving
  // ------------------------------------------------------------------------------------------------------------

  pause(): void {
    const p = this.state.phase;
    if (p === 'paused' || this.state.screen !== 'live') return;
    // The native pause target remains visible while the ready scene is being acknowledged and during its short cue.
    // Both are pre-delivery states: Resume must retry the same unbowled ball, not restore a dead-ball card we cleared.
    if (this.readyPending || p === 'ready') {
      this.clearTimers();
      this.pausedFrom = 'ready';
      this.set({ phase: 'paused' });
      const task = this.host.stage?.pause?.('player');
      void task?.catch(() => undefined);
      return;
    }
    if (this.busy()) return;
    this.clearTimers();
    this.pausedFrom = p === 'idle' ? 'dead' : p;
    this.set({ phase: 'paused' });
    const task = this.host.stage?.pause?.('player');
    void task?.catch(() => undefined);
  }

  /** Native pause remains reachable in Quiet Mode; the ball is first settled as an interrupted leave. */
  private requestPause(): void {
    const phase = this.state.phase;
    if (this.state.screen !== 'live' || phase === 'paused') return;
    if (isQuiet(phase)) {
      this.clearTimers();
      this.hiddenPause = true;
      this.pauseNativeAtDeadBall = true;
      this.runner.interrupt();
      return;
    }
    this.pause();
  }

  /**
   * Semantic DOM/TalkBack mirror of the native Unity Pause control. It deliberately shares the native deferred
   * authority path: during Quiet Mode the current ball settles as an interrupted leave before the stage is hidden.
   */
  requestUnityPause(): void {
    this.requestPause();
  }

  resume(): void {
    this.hiddenPause = false;
    this.pauseNativeAtDeadBall = false;
    if (this.state.phase !== 'paused') return;
    const task = this.host.stage?.resume?.('player');
    void task?.catch(() => undefined);
    if (this.pausedFrom === 'ready') {
      // Paused just before a ball (the app went away): Resume bowls it.
      this.set({ phase: 'idle' });
      void this.bowlNext();
      return;
    }
    const back =
      this.pausedFrom === 'demo' || this.pausedFrom === 'closeup' || this.pausedFrom === 'replay'
        ? 'dead'
        : this.pausedFrom;
    this.set({ phase: back });
    if (back === 'dead' && this.deps.hooks?.autoNext) this.after(AUTO_NEXT_MS, () => this.nextBall());
  }

  /**
   * The app went to the background. During a delivery the swing is gone, so the ball resolves as a leave at once
   * (exactly what a resumed innings would do) and then waits, paused. Between balls nothing else starts.
   */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (!hidden) {
      const task = this.host.stage?.resume?.('foreground');
      void task?.catch(() => undefined);
      return;
    }
    // A real background pause supersedes a deferred in-app native Pause; the
    // stage is already being hidden and must not be paused a second time at dead ball.
    this.pauseNativeAtDeadBall = false;
    const pauseTask = this.host.stage?.pause?.('background');
    void pauseTask?.catch(() => undefined);
    const p = this.state.phase;
    this.clearTimers();
    if (isQuiet(p)) {
      this.hiddenPause = true;
      this.runner.interrupt();
    } else if (this.state.screen === 'live' && p === 'dead') {
      this.pausedFrom = 'dead';
      this.set({ phase: 'paused' });
    } else if (this.state.screen === 'live' && p === 'ready') {
      // The hint's wait was cleared above (bowlNext stops): the ball waits, paused, for Resume.
      this.pausedFrom = 'ready';
      this.set({ phase: 'paused' });
    }
  }

  /**
   * A delivery left in flight (leaving or closing mid-ball) is resolved as a leave at once, exactly as a resumed
   * innings would be, so continuing in the same visit can never bowl that ball again.
   */
  private settleInFlight(): void {
    const s = this.state.innings;
    if (!s?.inFlight) return;
    this.set({ innings: this.engine.resumeInnings(s), notice: 'resumed_leave' });
    this.persist();
  }

  /**
   * Back to the Practice home (the innings stays saved; a ball in play is resolved as a leave). The mounted stage is
   * kept for the next over or innings, so its shaders and first render are paid once per visit.
   */
  leave(): void {
    this.gen++;
    this.clearTimers();
    this.runner.interrupt();
    this.coachLoop.abortInsight();
    this.settleInFlight();
    this.host.stage?.setAssistance(null, null);
    const s = this.state.innings;
    this.set({
      screen: 'idle',
      phase: 'idle',
      replay: null,
      coach: null,
      pending: null,
      gesture: { enabled: false, key: this.state.gesture.key },
      needLandscape: false,
      board: s ? this.boardOf(s) : EMPTY_BOARD,
    });
  }

  /** "End innings" from the over summary (confirmed): the score is final. */
  endInnings(): void {
    const s = this.state.innings;
    if (!s) return;
    this.finishInnings(this.engine.inningsReducer(s, { type: 'abandon' }), 'abandon');
    clearInnings(this.store);
    this.set({ innings: null, screen: 'idle', phase: 'idle', board: EMPTY_BOARD, overKind: null });
  }

  /** Leaving a finished innings' summary forgets it on the device. */
  closeFinished(): void {
    const s = this.state.innings;
    if (s && (s.status === 'out' || s.status === 'complete')) clearInnings(this.store);
    this.set({
      innings: null,
      board: EMPTY_BOARD,
      last: null,
      insight: null,
      screen: 'idle',
      phase: 'idle',
      overKind: null,
    });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Helpers and teardown
  // ------------------------------------------------------------------------------------------------------------

  boardOf(s: PracticeInningsState): Board {
    const lastOver = s.overs[s.overs.length - 1]?.deliveries ?? [];
    const balls = s.current ? s.current.deliveries : s.status === 'batting' ? [] : lastOver;
    return {
      runs: s.runs,
      wickets: s.status === 'out' ? 1 : 0,
      balls: s.balls,
      over: balls.map((r) => ({ runs: r.runs, dismissal: r.dismissal })),
    };
  }

  /** Every result of an over (index into innings.overs, or the over in progress). */
  overResults(overIndex: number): DeliveryResult[] {
    return this.coachLoop.overResults(overIndex);
  }

  resultOf(record: DeliveryRecord): DeliveryResult {
    return this.coachLoop.resultOf(record);
  }

  resultsMap(): ReadonlyMap<string, DeliveryResult> {
    return this.coachLoop.resultsMap();
  }

  dispose(): void {
    this.gen++;
    this.clearTimers();
    this.runner.interrupt();
    this.coachLoop.abortInsight();
    this.settleInFlight();
    this.work?.dispose();
    this.host.dispose();
    this.disposed = true;
    this.clearListeners();
  }

  /** The shown state, for the coach loop (it shares this flow's state). */
  setState(patch: Partial<FlowState>): void {
    this.set(patch);
  }
}

/** The kind of over an innings was batting, from its plan (a restart forgets whether a random over was Quick). */
function kindOf(s: PracticeInningsState): OverKind | null {
  const plan = s.current?.plan ?? s.overs[s.overs.length - 1]?.plan;
  if (!plan) return null;
  return plan.source === 'reference' ? 'reference' : plan.source === 'built' ? 'built' : 'random';
}
