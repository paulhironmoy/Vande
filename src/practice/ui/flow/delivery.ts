/**
 * One delivery, from the run-up to dead ball:
 *
 *   physics flight → [in-flight saved] → stage.bowl (Delivery Quiet Mode begins) → GestureSurface → normalizeGesture
 *     → physics resolveDelivery → [record committed and saved] → stage.play → dead ball (quiet ends)
 *
 * The in-flight flag is saved before an innings ball is bowled and the resolved record before the stage shows it, so
 * closing the app at any moment can only ever turn the ball in play into a leave. Timing is judged by the events' own
 * timestamps: a swing that began before the leave deadline counts even when a busy main thread delivers it late.
 *
 * resolveDelivery runs on the work thread when there is one (./offThread.ts): the ball is handed over before the run-up
 * and only the swing crosses at the gesture, so frames keep coming while the stroke is simulated. The result is the
 * same either way (the same function on the same inputs), and nothing about the ball is shown before it is committed.
 * If the app goes away or Practice is left while the worker computes, the result is computed here at once and
 * committed, exactly as the swing would have been in one frame.
 */
import {
  makeUnityPracticeResolution,
  type AssistanceStage,
  type AssistLevel,
  type BallCondition,
  type BallFlight,
  type BowlerProfile,
  type DeliveryRecord,
  type DeliveryResult,
  type FieldLayout,
  type GestureInput,
  type Handedness,
  type NormalizedSwing,
  type PitchCondition,
  type PracticeDeliveryPlan,
} from '@/contracts';
import { addDelivery, addTtfd, bump, loadCalibrations, ttfdBucket } from '@/practice/store';
import type { OneGestureState } from '@/input';
import type { FlowCore } from './core';
import type { BallTicket } from './offThread';
import type { StageHost } from './stageHost';
import {
  HOOK_EMIT_MS,
  LEAVE_CUE_DISPATCH_MS,
  LEAVE_GRACE_S,
  LEAVE_STALL_MS,
  LEAVE_STALL_RECHECK_MS,
  SWING_ARRIVAL_MS,
  type BallKind,
} from './state';
import type { InputModality, NextDeliveryLike, StageDeliveryContext, StageGuide, StageInputSink } from './types';

export interface BallSpec {
  kind: BallKind;
  plan: PracticeDeliveryPlan;
  bowler: BowlerProfile;
  seed: string;
  field: FieldLayout;
  conditions: PitchCondition;
  assist: AssistLevel;
  handedness: Handedness;
  ball: BallCondition;
  overNumber: number;
  ballNumber: number;
  /** Innings balls: the game's NextDelivery the record is made from. */
  next?: NextDeliveryLike;
  /** Coach Mode attempts: the exact ball re-bowled, and the assistance shown for it. */
  source?: DeliveryRecord;
  assistance?: { stage: AssistanceStage; guide: StageGuide | null };
  context?: StageDeliveryContext;
  /**
   * The timing forgiveness for this ball (ms), latched at the start of the over, so a quality change between balls
   * never changes it mid-over. Exact-ball attempts keep their source record's own.
   */
  toleranceMs: number;
}

export interface BallOutcome {
  result: DeliveryResult;
  record: DeliveryRecord;
  interrupted: boolean;
}

interface SwingWaiter {
  gesture(input: GestureInput): void;
  normalized(swing: NormalizedSwing | null): void;
  interrupt(): void;
}

type PendingNativeInput =
  | { type: 'start'; atPerfMs: number; pointer: InputModality }
  | { type: 'cancel' }
  | { type: 'swing'; swing: NormalizedSwing | null };

export class DeliveryRunner {
  private waiter: SwingWaiter | null = null;
  /** When the current swing began (its pointer-down's own timestamp), until its gesture arrives. */
  private swingStartPerf: number | null = null;
  /**
   * The calibration offsets of the delivery being awaited, read once when it is armed. A press (the touch-down stroke
   * starts in its handler, CTL1) must not wait on storage and a JSON parse, so neither cue reads them again.
   */
  private armedCalibrations: Record<InputModality, number> | null = null;
  /** A swing cue (press, key, resting finger's movement, intent) has arrived since release (see awaitSwing). */
  private cueSeen = false;
  private releasePerfMs = 0;
  private interrupted = false;
  private landscapeWaiters: Array<() => void> = [];
  private portraitOk = false;
  private openedAt: number;
  private firstDelivery = false;
  /**
   * Unity can report release, pointer and gesture in one native callback turn. The promise continuation after
   * stage.bowl() does not run until that turn ends, so retain those already-authorized events until the swing waiter
   * is armed. This queue is reset for every delivery and is deliberately tiny: it is a hand-off buffer, not input
   * history.
   */
  private pendingNativeInput: PendingNativeInput[] = [];
  /** A swing whose result the work thread is computing: settled here at once if the app goes away meanwhile. */
  private resolving: {
    ticket: BallTicket;
    swing: NormalizedSwing | null;
    commit: (result: DeliveryResult) => unknown;
  } | null = null;
  ttfd: number | null = null;

  constructor(
    private readonly core: FlowCore,
    private readonly host: StageHost,
    onPauseRequest?: () => void,
    onDeadBallAction?: StageInputSink['onDeadBallAction'],
  ) {
    this.openedAt = core.deps.openedAt ?? core.clock.now();
    host.setInputSink({
      onSwingStart: (atPerfMs, pointer) => this.acceptNativeInput({ type: 'start', atPerfMs, pointer }),
      onGestureCancel: () => this.acceptNativeInput({ type: 'cancel' }),
      // The Unity coordinator has already converted clocks, applied calibration and erased raw samples.
      onSwing: (swing) => this.acceptNativeInput({ type: 'swing', swing }),
      onPauseRequest,
      onDeadBallAction,
    });
  }

  setLandscape(landscape: boolean): void {
    if (!landscape && !this.portraitOk) return;
    this.core.set({ needLandscape: false });
    const w = this.landscapeWaiters;
    this.landscapeWaiters = [];
    for (const f of w) f();
  }

  allowPortrait(): void {
    this.portraitOk = true;
    this.setLandscape(true);
  }

  private waitLandscape(): Promise<void> {
    const landscape = this.core.deps.isLandscape?.() ?? true;
    if (landscape || this.portraitOk) return Promise.resolve();
    this.core.set({ needLandscape: true });
    return new Promise((resolve) => this.landscapeWaiters.push(resolve));
  }

  /** The app went away or the player left: the swing is gone, so the ball resolves as a leave at once. */
  interrupt(): void {
    this.interrupted = true;
    this.waiter?.interrupt();
    // The swing was made: its result is computed and committed now, as it would have been in the swing's own frame.
    // Synchronously, so a leave that settles the ball in flight next finds it already committed.
    const r = this.resolving;
    if (r) {
      this.resolving = null;
      try {
        r.commit(r.ticket.resolveNow(r.swing));
      } catch {
        /* the run's own await reports it */
      }
    }
  }

  private simToPerf(t: number): number {
    const v = this.host.stage?.simToPerf(t);
    return typeof v === 'number' && Number.isFinite(v) ? v : this.releasePerfMs + (t * 1000) / this.core.clock.scale;
  }

  /** Bowls one delivery and resolves it through the physics; innings balls are committed and saved first. */
  async run(b: BallSpec): Promise<BallOutcome | null> {
    const core = this.core;
    const stage = this.host.stage;
    if (!stage) return null;
    const gen = core.gen;
    await this.waitLandscape();
    if (gen !== core.gen) return null;
    const flight = core.engine.flight({
      plan: b.plan,
      bowler: b.bowler,
      conditions: b.conditions,
      seed: b.seed,
      handedness: b.handedness,
      ball: b.ball,
    });
    const tierToleranceMs = b.toleranceMs;
    // The physics of this ball for whichever swing comes, here (the fallback) and on the work thread.
    const local = (swing: NormalizedSwing | null): DeliveryResult =>
      b.kind === 'repeat' && b.source
        ? core.engine.repeatDelivery(b.source, swing)
        : core.engine.resolveDelivery({
            flight,
            swing,
            field: b.field,
            bowler: b.bowler,
            conditions: b.conditions,
            handedness: b.handedness,
            assist: b.assist,
            tierToleranceMs,
          });
    const ticket = core.work
      ? core.work.prepare(
          b.kind === 'repeat' && b.source
            ? { kind: 'repeat', source: b.source }
            : {
                kind: 'resolve',
                args: {
                  flight,
                  field: b.field,
                  bowler: b.bowler,
                  conditions: b.conditions,
                  handedness: b.handedness,
                  assist: b.assist,
                  tierToleranceMs,
                },
              },
          local,
        )
      : null;
    if (b.kind === 'innings') {
      const s = core.getState().innings!;
      core.set({ innings: core.engine.inningsReducer(s, { type: 'deliveryStarted' }) });
      core.persist();
    }
    this.interrupted = false;
    this.pendingNativeInput = [];
    const key = `${b.kind}:${b.overNumber}.${b.ballNumber}:${core.clock.now().toFixed(0)}`;
    stage.setAssistance(b.assistance?.stage ?? null, b.assistance?.guide ?? null);
    core.set({
      phase: 'runup',
      ball: { kind: b.kind, overNumber: b.overNumber, ballNumber: b.ballNumber, bowler: b.bowler },
      gesture: { enabled: false, key },
      announce: core.deps.words
        ? { text: core.deps.words.runup(b.ballNumber), id: Date.now() }
        : core.getState().announce,
    });
    this.host.startDeliverySampling();
    let releasePerfMs: number;
    try {
      releasePerfMs = (
        await stage.bowl(flight, {
          ...b.context,
          overIndex: b.next?.overIndex ?? b.source?.overIndex,
          ballIndex: b.next?.ballIndex ?? b.source?.ballIndex,
          seed: b.seed,
        })
      ).releasePerfMs;
    } catch {
      releasePerfMs = core.clock.now();
      this.interrupted = true;
    }
    if (gen !== core.gen || core.isDisposed()) {
      ticket?.release();
      return null;
    }
    this.releasePerfMs = releasePerfMs;
    if (!this.firstDelivery) {
      this.firstDelivery = true;
      const ms = releasePerfMs - this.openedAt;
      this.ttfd = ms;
      core.saveMetrics(addTtfd(core.metrics, ms));
      core.track('practice_first_delivery', { ttfdBucket: ttfdBucket(ms), assist: b.assist });
    }
    core.set({ phase: 'live', gesture: { enabled: !this.interrupted, key } });
    const swing = this.interrupted ? null : await this.awaitSwing(flight, releasePerfMs, b.kind, b.handedness);
    if (gen !== core.gen || core.isDisposed()) {
      ticket?.release();
      return null;
    }
    core.set({ gesture: { enabled: false, key } });
    // Whether the app had gone away by the time the swing was known (it marks a ball settled as a leave).
    const interruptedAtSwing = this.interrupted;
    let committed: { result: DeliveryResult; record: DeliveryRecord } | null = null;
    // Committed and saved before anything shows it: closing the app now cannot change this ball. A ball settled
    // because the app went away is marked, so a next start (after a kill) can say what happened.
    const commit = (result: DeliveryResult) => {
      if (committed) return committed;
      let record: DeliveryRecord;
      if (b.kind === 'repeat' && b.source)
        record = { ...b.source, swing, runs: result.outcome.runs, dismissal: result.outcome.dismissal };
      else {
        record = core.engine.makeRecord(b.next!, swing, tierToleranceMs, result);
        core.set({
          innings: core.engine.inningsReducer(core.getState().innings!, { type: 'deliveryResolved', record }),
        });
        core.persist(interruptedAtSwing ? 'resumed_leave' : null);
      }
      committed = { result, record };
      return committed;
    };
    let resolved: { result: DeliveryResult; record: DeliveryRecord };
    if (ticket) {
      // Off the main thread (or here at once, when the worker cannot take it); a leave or pause meanwhile commits it now.
      this.resolving = { ticket, swing, commit };
      try {
        resolved = await ticket.resolve(swing).then(commit);
      } finally {
        if (this.resolving?.ticket === ticket) this.resolving = null;
      }
      if (gen !== core.gen || core.isDisposed()) return null;
    } else resolved = commit(local(swing));
    const { result, record } = resolved;
    if (stage.supplyResolution) {
      try {
        const innings = core.getState().innings;
        // Canonicalized and digested once here: the identity checks and the packet that follow reuse that.
        const resolution = await makeUnityPracticeResolution(record, result, {
          runs: innings?.runs ?? 0,
          wickets: result.outcome.dismissal === null ? 0 : 1,
          balls: innings?.balls ?? 0,
          maxOvers: 10,
        });
        stage.supplyResolution(resolution);
      } catch {
        // The result is already authoritative and persisted. A native presentation that cannot accept it fails closed.
      }
    }
    core.set({ phase: 'playing' });
    try {
      await stage.play(result);
    } catch {
      /* a stage that failed mid-play is replaced between balls; the result already stands */
    }
    this.host.stopDeliverySampling();
    if (gen !== core.gen || core.isDisposed()) return null;
    const latency = swing ? stage.stats().lastInputToBatMs : null;
    const metrics = b.kind === 'repeat' ? bump(core.metrics, 'repeats') : core.metrics;
    core.saveMetrics(addDelivery(metrics, result, { scoring: b.kind === 'innings', latencyMs: latency }));
    return { result, record, interrupted: this.interrupted };
  }

  private awaitSwing(
    flight: BallFlight,
    releasePerfMs: number,
    kind: BallKind,
    handedness: Handedness,
  ): Promise<NormalizedSwing | null> {
    const core = this.core;
    return new Promise((resolve) => {
      let done = false;
      let cancels: Array<() => void> = [];
      const finish = (swing: NormalizedSwing | null) => {
        if (done) return;
        done = true;
        for (const c of cancels) c();
        cancels = [];
        this.waiter = null;
        this.swingStartPerf = null;
        this.armedCalibrations = null;
        resolve(swing);
      };
      const at = (perfMs: number, cb: () => void) => {
        const id = setTimeout(cb, Math.max(0, perfMs - core.clock.now()));
        cancels.push(() => clearTimeout(id));
      };
      // Each kind of input is corrected by its own measured offset (a touch screen reports later than a keyboard).
      const calibrations = core.engine.resolveCalibrations(loadCalibrations(core.store));
      this.armedCalibrations = calibrations;
      this.swingStartPerf = null;
      const injected = core.deps.hooks?.takeSwing?.(flight, kind) ?? null;
      const injectedStart = injected && injected !== 'leave' ? this.simToPerf(injected.startT) : null;
      // No gesture by the time the ball has passed the stumps: a leave. Detecting intentional movement can itself
      // happen after the deadline even though its event-time departure was before it (a slow, valid threshold run).
      // Keep one bounded arrival window for that onset and its gesture, then judge only their own timestamps.
      const deadline = this.simToPerf(flight.stumpsT + LEAVE_GRACE_S);
      // That window is needed only while something is in flight: a swing cue since release (a press, a key, a resting
      // finger's movement), a pointer down, native input, or a test swing still to come. With nothing in flight, a
      // swing that still counts would show its cue within LEAVE_CUE_DISPATCH_MS plus its input's calibration of the
      // deadline (state.ts), so the leave settles then; a cue arriving meanwhile restores the full window. Which
      // swings count (their own start no later than the deadline) is unchanged.
      const hookSwing =
        injected !== null && injected !== 'leave' && injectedStart !== null && injectedStart <= deadline;
      const inFlight = () =>
        hookSwing ||
        this.swingStartPerf !== null ||
        this.cueSeen ||
        this.pendingNativeInput.length > 0 ||
        this.host.ownsInput() ||
        core.engine.pointerIsDown?.() === true;
      const quietMs = Math.min(SWING_ARRIVAL_MS, Math.max(0, ...Object.values(calibrations)) + LEAVE_CUE_DISPATCH_MS);
      this.cueSeen = false;
      at(deadline, () => {
        if (inFlight()) {
          at(core.clock.now() + SWING_ARRIVAL_MS, () => finish(null));
          return;
        }
        const quietEnd = deadline + quietMs;
        const settle = (stalled: boolean) => {
          if (inFlight()) at(Math.max(core.clock.now(), deadline + SWING_ARRIVAL_MS), () => finish(null));
          // A busy page may still hold input queued before the deadline: one more turn first.
          else if (!stalled && core.clock.now() - quietEnd > LEAVE_STALL_MS)
            at(core.clock.now() + LEAVE_STALL_RECHECK_MS, () => settle(true));
          else finish(null);
        };
        at(quietEnd, () => settle(false));
      });
      const startedInTime = (swing: NormalizedSwing): boolean => this.simToPerf(swing.startT) <= deadline;
      this.waiter = {
        gesture: (input) => {
          const swing = core.engine.normalizeGesture(input, {
            releasePerfMs,
            calibrationMs: calibrations[input.pointer] ?? 0,
            calibrations,
            handedness,
            ...(core.clock.scale !== 1 ? { timeScale: core.clock.scale } : {}),
          });
          if (swing) finish(startedInTime(swing) ? swing : null);
          // Not a swing (a cancelled touch): re-arm for the rest of the delivery.
          else {
            this.swingStartPerf = null;
            core.set({ gesture: { enabled: true, key: `${core.getState().gesture.key}+` } });
          }
        },
        // Native input is normalized exactly once by UnityPracticeSessionCoordinator.
        normalized: (swing) => finish(swing && !startedInTime(swing) ? null : swing),
        interrupt: () => finish(null),
      };
      if (injected && injected !== 'leave' && injectedStart !== null && injectedStart <= deadline) {
        // A hooked swing comes from no input, so no input's offset applies to it.
        at(injectedStart, () => this.host.stage?.beginSwing(injectedStart, 0));
        at(injectedStart + HOOK_EMIT_MS / core.clock.scale, () => finish(injected));
      }
      // Drain only after the waiter and all of its timers are installed. This closes the native release/input race
      // without accepting input before Unity itself has armed capture at authoritative release.
      const pending = this.pendingNativeInput.splice(0);
      for (const event of pending) {
        if (done) break;
        if (event.type === 'start') this.onSwingStart(event.atPerfMs, event.pointer);
        else if (event.type === 'cancel') this.onGestureCancel();
        else this.waiter?.normalized(event.swing);
      }
    });
  }

  private acceptNativeInput(event: PendingNativeInput): void {
    if (this.waiter) {
      if (event.type === 'start') this.onSwingStart(event.atPerfMs, event.pointer);
      else if (event.type === 'cancel') this.onGestureCancel();
      else this.waiter.normalized(event.swing);
      return;
    }
    // Before release or after resolution input is inert. `runup` is the narrow hand-off window in which Unity has
    // released the ball but the JavaScript continuation has not yet installed its waiter.
    if (this.core.getState().phase !== 'runup') return;
    if (this.pendingNativeInput.length < 8) this.pendingNativeInput.push(event);
  }

  /** The offset of one input modality: the armed delivery's, else read from storage (between deliveries). */
  private calibrationFor(pointer: InputModality): number {
    const set = this.armedCalibrations ?? this.core.engine.resolveCalibrations(loadCalibrations(this.core.store));
    return set[pointer] ?? 0;
  }

  /** From the GestureSurface. */
  onSwingStart = (atPerfMs: number, pointer: InputModality = 'touch'): void => {
    const st = this.core.getState();
    if (st.phase !== 'live' || !st.gesture.enabled) return;
    this.cueSeen = true;
    if (this.swingStartPerf === null) this.swingStartPerf = atPerfMs;
    // Touch-down is the input (owner decision 2026-11-04, CTL1): the stage starts the bat's stroke here, at the same
    // calibrated instant a tap's physics swing starts. It stays bounded until the gesture commits (the lift, a swipe
    // or a key) and checks back if the press outlives the tap window or becomes a pullback.
    this.host.stage?.prepareSwing?.(atPerfMs, this.calibrationFor(pointer));
  };

  /** The committed gesture (a tap at its lift, a swipe at its start, a key): the touch-down stroke continues into it. */
  onSwingIntent = (intent: { atPerfMs: number; pointer: InputModality }): void => {
    const st = this.core.getState();
    if (st.phase !== 'live' || !st.gesture.enabled) return;
    this.cueSeen = true;
    this.swingStartPerf = intent.atPerfMs;
    this.host.stage?.beginSwing(intent.atPerfMs, this.calibrationFor(intent.pointer));
  };

  onGestureCancel = (): void => {
    if (this.core.getState().phase !== 'live' || !this.waiter) return;
    this.swingStartPerf = null;
    this.host.stage?.cancelSwing?.();
  };

  /** Presentation-only canonical contact state. Physics still receives only the normalized swing. */
  onContactState = (state: OneGestureState): void => {
    const st = this.core.getState();
    if (st.phase !== 'live' || !st.gesture.enabled) return;
    this.host.stage?.previewContact?.(state);
  };

  onGesture = (input: GestureInput): void => {
    if (this.core.getState().phase === 'live') this.waiter?.gesture(input);
  };
}
