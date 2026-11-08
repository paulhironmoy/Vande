/**
 * UNDERSTAND and MASTER: the coach's reading of each dead ball (on the work thread from the moment it is dead; without
 * one, after its consequence has been shown and in short slices that let every frame be drawn, so the outcome shows at
 * once and the scene stays smooth either way), the demonstration, the ball close-up and slow
 * motion, and exact-ball Coach Mode: "Replay exact ball" re-bowls the identical delivery with assistance stages 1 → 4,
 * compares each attempt with the previous one, and lets the coach's mastery rule (never one lucky result) decide
 * progress; its confirmation plays only on a 'better' attempt. Nothing here touches the innings: attempts are
 * non-scoring repeats of a record.
 */
import type { AttemptComparison, CoachAnalysis, CoachOption, DeliveryRecord, DeliveryResult } from '@/contracts';
import { addFormSample, loadMastery, saveMastery, updatePracticeSettings } from '@/practice/store';
import { guideKey, readRecord } from '@/practice/worker/work';
import type { PracticeFlow } from './controller';
import type { CoachTipLike } from './coachTypes';
import type { AnalyzeOutput, AnalyzeWant } from './offThread';
import {
  INSIGHT_AFTER_DEAD_MS,
  INSIGHT_OFFTHREAD_AFTER_DEAD_MS,
  INSIGHT_SLICE_MS,
  type CoachSession,
  type FlowScreen,
  type LivePhase,
  type ReplayItem,
} from './state';

/**
 * The mastery confirmation for one recorded attempt (WA6, COACH5; constitution "Proportional feedback": exact-ball
 * improvement): the coach's mastery event, played only when the comparison's verdict is 'better'. An attempt that is
 * the same or worse never chimes, buzzes or shows the moment, even when it completes a stage. The stage and mastery
 * are not gated here: they follow every recorded attempt by the coach's own rule (MASTERY_RULE: consecutive
 * successes), because repeating a success exactly is by definition 'same', and repeatability is what mastery is.
 */
export function masteryConfirmation(
  comparison: AttemptComparison | null,
  event: 'stage_up' | 'mastered' | null,
): 'stage_up' | 'mastered' | null {
  return comparison?.verdict === 'better' ? event : null;
}

/**
 * How the coach yields between its slices while Practice is on screen: to the next ordinary task (a message on a fresh
 * channel), so a frame that is due is drawn first and input is handled. Not a prioritised continuation: with
 * scheduler.yield() (the slicer's default) the dead-ball scene was measured drawing only every 105-140 ms while the
 * coach read it, long task or not. The price: where frames are expensive the reading is slower (an open risk, measured
 * in release/product-sequence/stage-1-practice/wedge/flow/).
 */
export function yieldToRendering(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'function') {
      setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

function aborted(): Error {
  const e = new Error('coach: reading cancelled');
  e.name = 'AbortError';
  return e;
}

/** Demonstrations the work thread already simulated with a reading, kept for "Watch demonstration" and Coach Mode. */
const GUIDES_KEPT = 4;

export class CoachLoop {
  private results = new Map<string, DeliveryResult>();
  private guides = new Map<string, { option: CoachOption; result: DeliveryResult }>();
  private abort: AbortController | null = null;
  private presentationAbort: AbortController | null = null;
  /** The reading of the newest Coach Mode attempt (cancelled when Coach Mode is left). */
  private attemptAbort: AbortController | null = null;
  private replayGen = 0;

  constructor(private readonly flow: PracticeFlow) {}

  // ---- results of the innings (re-simulated from their records when not cached)

  forgetResults(): void {
    this.results.clear();
  }

  remember(record: DeliveryRecord, result: DeliveryResult): void {
    this.results.set(`${record.overIndex}:${record.ballIndex}`, result);
  }

  resultOf(record: DeliveryRecord): DeliveryResult {
    const key = `${record.overIndex}:${record.ballIndex}`;
    let r = this.results.get(key);
    if (!r) {
      r = this.flow.engine.replayDelivery(record);
      this.results.set(key, r);
    }
    return r;
  }

  resultsMap(): ReadonlyMap<string, DeliveryResult> {
    const s = this.flow.getState().innings;
    if (s)
      for (const o of [...s.overs, ...(s.current ? [s.current] : [])]) for (const r of o.deliveries) this.resultOf(r);
    return this.results;
  }

  overResults(overIndex: number): DeliveryResult[] {
    const s = this.flow.getState().innings;
    if (!s) return [];
    const over = s.overs[overIndex] ?? (overIndex === s.overs.length ? s.current : null);
    return over ? over.deliveries.map((r) => this.resultOf(r)) : [];
  }

  saveHints(n: number): void {
    updatePracticeSettings({ hintsShown: n }, this.flow.store);
  }

  // ---- the dead ball's one insight

  /** Cancels the coach's reading: the dead ball's, and a Coach Mode attempt's (leaving Practice). */
  abortInsight(): void {
    this.abort?.abort();
    this.abort = null;
    this.attemptAbort?.abort();
    this.attemptAbort = null;
  }

  /**
   * Waits until `ms` after the dead ball (`deadAt`, flow clock), so its consequence is shown before any main-thread
   * coach simulation runs (rejects at once when the reading is cancelled; no wait once that time has passed).
   */
  private afterDeadBall(signal: AbortSignal, deadAt: number, ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(aborted());
      const wait = deadAt + ms - this.flow.clock.now();
      if (wait <= 0) return resolve();
      const cancel = this.flow.clock.after(wait, () => {
        signal.removeEventListener('abort', stop);
        resolve();
      });
      const stop = () => {
        cancel();
        reject(aborted());
      };
      signal.addEventListener('abort', stop, { once: true });
    });
  }

  /**
   * The coach's reading of a record: the analysis and whatever else is wanted (the tip, the form sample, the
   * demonstration). On the work thread when there is one, else here, in slices between frames (identical, byte for
   * byte, to analyzeBall: slicing decides only when) and, for a dead ball (`deadAt`), only once its consequence has
   * been shown. Which thread read it never changes what it says.
   */
  private async read(
    record: DeliveryRecord,
    result: DeliveryResult,
    want: AnalyzeWant,
    signal: AbortSignal,
    deadAt: number | null,
  ): Promise<AnalyzeOutput> {
    const work = this.flow.work;
    if (work?.canWork()) {
      try {
        if (deadAt !== null && INSIGHT_OFFTHREAD_AFTER_DEAD_MS > 0)
          await this.afterDeadBall(signal, deadAt, INSIGHT_OFFTHREAD_AFTER_DEAD_MS);
        const out = await work.read(record, result, want, signal);
        if (out.guide) this.keepGuide(record, out.guide);
        return out;
      } catch (e) {
        if (signal.aborted || (e instanceof Error && e.name === 'AbortError')) throw e;
        // The worker could not read it: the main thread reads it, paced as it always was.
      }
    }
    if (deadAt !== null) await this.afterDeadBall(signal, deadAt, INSIGHT_AFTER_DEAD_MS);
    const kit = { ...this.flow.coach!, repeatDelivery: this.flow.engine.repeatDelivery };
    // Here the demonstration is simulated only when it is asked for, as before: never as a main-thread task now.
    return readRecord(
      kit,
      record,
      result,
      { ...want, guide: false },
      { sliceMs: INSIGHT_SLICE_MS, yieldTo: yieldToRendering, signal },
    );
  }

  private keepGuide(record: DeliveryRecord, guide: { option: CoachOption; result: DeliveryResult }): void {
    const key = guideKey(record, guide.option.swing);
    this.guides.delete(key);
    this.guides.set(key, guide);
    while (this.guides.size > GUIDES_KEPT) this.guides.delete(this.guides.keys().next().value as string);
  }

  /** The card's one sentence for an analysed record; null if it cannot be formed (the card then words the insight alone). */
  private tipFor(record: DeliveryRecord, analysis: CoachAnalysis): CoachTipLike | null {
    try {
      return this.flow.coach?.coachTip(record, analysis) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Analyses the dead innings ball. The outcome shows at once; the coach starts reading only after the dead ball's
   * consequence has been shown (INSIGHT_AFTER_DEAD_MS) and then works in slices (INSIGHT_SLICE_MS, checked after every
   * simulation) that let each due frame be drawn, so no coach work runs while the ball is live or its consequence is on screen. Then the
   * tip: the measured fact and the one action.
   */
  analyzeLast(): void {
    const coach = this.flow.coach;
    const last = this.flow.getState().last;
    if (!coach || !last) return;
    this.abortInsight();
    const ctl = new AbortController();
    this.abort = ctl;
    const key = `${last.record.seed}:${last.record.overIndex}.${last.record.ballIndex}`;
    this.flow.setState({ insight: { key, status: 'working', analysis: null, primary: null, tip: null } });
    const sample = last.kind === 'innings' && !last.interrupted ? ({ source: 'innings' } as const) : null;
    void this.read(last.record, last.result, { tip: true, sample, guide: true }, ctl.signal, this.flow.clock.now())
      .then(({ analysis, tip, sample: evidence }) => {
        if (ctl.signal.aborted || this.flow.getState().insight?.key !== key) return;
        if (evidence) addFormSample(evidence, this.flow.store);
        // Subscribers can synchronously observe `ready`, so persist the matching form evidence first. A ready
        // insight and its demonstrated-skill sample are one coherent dead-ball result, never a transient split state.
        this.flow.setState({
          insight: { key, status: 'ready', analysis, primary: coach.primaryInsight(analysis), tip },
        });
      })
      .catch(() => {
        if (!ctl.signal.aborted && this.flow.getState().insight?.key === key)
          this.flow.setState({ insight: { key, status: 'failed', analysis: null, primary: null, tip: null } });
      });
  }

  /**
   * The recommended response on the same flight, for the markers and same-world production-batter demonstration: the
   * one the work thread simulated with the reading, or simulated here now (the same call either way).
   */
  private guideFor(
    source: DeliveryRecord,
    analysis: CoachAnalysis | null,
  ): { result: DeliveryResult; option: CoachOption } | null {
    const coach = this.flow.coach;
    if (!coach || !analysis) return null;
    const option = coach.optionOf(analysis, 'recommended');
    const kept = this.guides.get(guideKey(source, option.swing));
    return { option, result: kept?.result ?? this.flow.engine.repeatDelivery(source, option.swing) };
  }

  private async withStage(): Promise<boolean> {
    if (this.flow.host.stage) return true;
    const s = this.flow.getState().innings;
    const st = this.flow.settings;
    return Boolean(await this.flow.host.prepare(s?.assist ?? st.assist, s?.handedness ?? st.handedness));
  }

  /** "Watch demonstration" on the dead ball: the recommended response, played by the normal production batter. */
  async demonstrateLast(): Promise<void> {
    const st = this.flow.getState();
    const guide = st.last ? this.guideFor(st.last.record, st.insight?.analysis ?? null) : null;
    if (!guide || st.phase !== 'dead' || !this.flow.host.stage) return;
    await this.during('demo', (signal) =>
      this.flow.host.stage!.demonstrate(guide.result, guide.option, { source: st.last!.record, signal }),
    );
  }

  /** "See the ball" inside Why?: the close-up of the seam and shine at release. */
  async closeUpLast(): Promise<void> {
    const st = this.flow.getState();
    if (!st.last || st.phase !== 'dead' || !this.flow.host.stage) return;
    await this.during('closeup', () => this.flow.host.stage!.closeUp(st.last!.result.flight));
  }

  private async during(phase: LivePhase, run: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const gen = this.flow.gen;
    const back = this.flow.getState().phase;
    this.presentationAbort?.abort();
    const abort = new AbortController();
    this.presentationAbort = abort;
    this.flow.setState({ phase });
    const stop = this.flow.subscribe(() => {
      if (this.flow.getState().phase !== phase) abort.abort();
    });
    try {
      await run(abort.signal);
    } catch {
      /* the stage settles quietly */
    } finally {
      stop();
      if (this.presentationAbort === abort) this.presentationAbort = null;
    }
    if (gen === this.flow.gen && this.flow.getState().phase === phase) this.flow.setState({ phase: back });
  }

  // ---- slow-motion replays

  replayLast(): void {
    const last = this.flow.getState().last;
    if (last)
      void this.startReplay(
        [{ result: last.result, overNumber: last.overNumber, ballNumber: last.ballNumber }],
        0.3,
        true,
      );
  }

  replayDismissal(): void {
    const rec = this.flow.getState().innings?.dismissal?.record;
    if (rec)
      void this.startReplay(
        [{ result: this.resultOf(rec), overNumber: rec.overIndex + 1, ballNumber: rec.ballIndex + 1 }],
        0.3,
        true,
      );
  }

  replayOver(overIndex: number): void {
    const over = this.flow.getState().innings?.overs[overIndex];
    if (over)
      void this.startReplay(
        over.deliveries.map((r) => ({
          result: this.resultOf(r),
          overNumber: overIndex + 1,
          ballNumber: r.ballIndex + 1,
        })),
        1,
        false,
      );
  }

  private async startReplay(items: ReplayItem[], speed: number, diagnostics: boolean): Promise<void> {
    if (!items.length || this.flow.busy()) return;
    const st = this.flow.getState();
    const back = { screen: st.screen, phase: st.phase };
    if (!(await this.withStage())) return;
    this.flow.saveMetrics({ ...this.flow.metrics, replays: this.flow.metrics.replays + 1 });
    this.flow.track('practice_replay', { overNumber: String(Math.min(10, Math.max(1, items[0].overNumber))) as '1' });
    this.flow.setState({
      replay: { items, index: 0, playing: true, back, speed, diagnostics },
      screen: 'live',
      phase: 'replay',
    });
    const gen = ++this.replayGen;
    for (let i = 0; i < items.length; i++) {
      const r = this.flow.getState().replay;
      if (!r || gen !== this.replayGen) return;
      this.flow.setState({ replay: { ...r, index: i, playing: true } });
      try {
        await this.flow.host.stage?.replay(items[i].result, { speed, diagnostics });
      } catch {
        /* nothing to show */
      }
    }
    const r = this.flow.getState().replay;
    if (r && gen === this.replayGen) this.flow.setState({ replay: { ...r, playing: false } });
  }

  /** "Play again" on the replay bar. */
  replayAgain(): void {
    const r = this.flow.getState().replay;
    if (!r || r.playing) return;
    const back = r.back;
    this.flow.setState({ replay: null });
    void this.startReplay(r.items, r.speed, r.diagnostics).then(() => {
      const cur = this.flow.getState().replay;
      if (cur) this.flow.setState({ replay: { ...cur, back } });
    });
  }

  closeReplay(): void {
    const r = this.flow.getState().replay;
    if (!r) return;
    this.replayGen++;
    this.flow.setState({
      replay: null,
      screen: r.back.screen,
      phase: r.back.phase === 'replay' ? 'dead' : r.back.phase,
    });
  }

  // ---- exact-ball Coach Mode

  /** "Practice this ball" on the dead ball: Coach Mode opens on the exact ball and its first retry starts at once. */
  practiceThisBall(): void {
    const st = this.flow.getState();
    if (!st.last || st.phase !== 'dead' || !this.flow.coach) return;
    void this.open(
      st.last.record,
      st.last.result,
      st.insight?.analysis ?? null,
      { screen: 'live', phase: 'dead' },
      st.insight?.tip ?? null,
    ).then((ok) => {
      if (ok) void this.replayExactBall();
    });
  }

  /** A ball from a summary (any ball of the innings, the dismissal ball included). */
  practiceBall(record: DeliveryRecord): void {
    const st = this.flow.getState();
    void this.open(record, this.resultOf(record), null, { screen: st.screen, phase: 'idle' });
  }

  private async open(
    record: DeliveryRecord,
    result: DeliveryResult,
    analysis: CoachAnalysis | null,
    back: { screen: FlowScreen; phase: LivePhase },
    tip: CoachTipLike | null = null,
  ): Promise<boolean> {
    const coach = this.flow.coach;
    if (!coach || this.flow.busy()) return false;
    const gen = this.flow.gen;
    this.abortInsight();
    const key = coach.masteryKey(record);
    const mastery = loadMastery(key, this.flow.store) ?? coach.startMastery(key);
    const baseTip = analysis ? (tip ?? this.tipFor(record, analysis)) : null;
    const session: CoachSession = {
      key,
      source: record,
      sourceResult: result,
      overNumber: record.overIndex + 1,
      ballNumber: record.ballIndex + 1,
      base: analysis,
      baseTip,
      latest: null,
      comparison: null,
      mastery,
      event: null,
      attempts: [],
      back,
    };
    this.flow.setState({ coach: session, screen: 'coach', phase: 'idle', replay: null });
    if (!analysis) {
      try {
        const { analysis: base, tip: baseTip } = await this.read(
          record,
          result,
          { tip: true, sample: null, guide: true },
          new AbortController().signal,
          null,
        );
        const cur = this.flow.getState().coach;
        if (cur?.key === key) this.flow.setState({ coach: { ...cur, base, baseTip } });
      } catch {
        /* the coach screen says it could not read the ball */
      }
    }
    const ready = await this.withStage();
    return ready && gen === this.flow.gen && this.flow.getState().coach?.key === key;
  }

  /** "Replay exact ball": the identical release, trajectory, bounce and field, with this stage's assistance. */
  async replayExactBall(): Promise<void> {
    const coach = this.flow.coach;
    const c = this.flow.getState().coach;
    if (!coach || !c || this.flow.busy() || !(await this.withStage())) return;
    const gen = this.flow.gen;
    const src = c.source;
    const stage = c.mastery.stage;
    const guide = this.guideFor(src, c.base);
    this.flow.host.stage?.setScene({
      field: src.field,
      bowler: src.bowler,
      conditions: src.conditions,
      handedness: src.handedness,
      ball: src.ball,
    });
    const out = await this.flow.runner.run({
      kind: 'repeat',
      plan: src.plan,
      bowler: src.bowler,
      seed: src.seed,
      field: src.field,
      conditions: src.conditions,
      assist: src.assist,
      handedness: src.handedness,
      ball: src.ball,
      overNumber: c.overNumber,
      ballNumber: c.ballNumber,
      source: src,
      assistance: { stage, guide },
      // The exact ball keeps the forgiveness it was first played with (repeatDelivery reads the record's own).
      toleranceMs: src.tierToleranceMs,
    });
    if (!out || gen !== this.flow.gen) return;
    this.flow.host.stage?.setAssistance(null, null);
    if (!this.flow.getState().coach) return;
    // Like an innings ball: read from its dead ball on the work thread, or here once its consequence has been shown.
    let reading: AnalyzeOutput | null = null;
    if (!out.interrupted) {
      const ctl = new AbortController();
      this.attemptAbort = ctl;
      try {
        reading = await this.read(
          out.record,
          out.result,
          { tip: true, sample: { source: 'mastery', stage }, guide: false },
          ctl.signal,
          this.flow.clock.now(),
        );
      } catch {
        reading = null;
      } finally {
        if (this.attemptAbort === ctl) this.attemptAbort = null;
      }
      if (ctl.signal.aborted || gen !== this.flow.gen) return;
    }
    const analysis = reading?.analysis ?? null;
    const cur = this.flow.getState().coach;
    if (!cur) return;
    if (!analysis || out.interrupted) {
      // An attempt cut short by the app going away never counts, either way.
      this.flow.setState({ coach: { ...cur, latest: null, comparison: null, event: null }, phase: 'idle' });
      return;
    }
    const previous = cur.latest?.analysis ?? cur.base;
    const previousTip = cur.latest ? cur.latest.tip : cur.baseTip;
    // Each attempt's measured clean contact (its tip: the face, the sweet zone, the bat speed), never the label alone,
    // so "Clean contact this time" and the 'better' chime follow the measurement.
    const comparison = previous
      ? coach.compareAttempts(previous, analysis, {
          previous: previousTip?.cleanContact ?? null,
          next: reading?.tip?.cleanContact ?? null,
        })
      : null;
    // The mastery rule records every attempt (never gated by the verdict); only the confirmation needs 'better'.
    // The attempt's tip carries its measured clean contact: a slow fend labelled 'middle' is not a success (WA7).
    const next = coach.recordAttempt(cur.mastery, analysis, stage, reading?.tip ?? null);
    const event = masteryConfirmation(comparison, coach.masteryEvent(cur.mastery, next));
    saveMastery(next, this.flow.store);
    if (reading?.sample) addFormSample(reading.sample, this.flow.store);
    if (event) this.flow.deps.masteryFeel?.(event);
    const success = next.attempts[next.attempts.length - 1]?.success ?? false;
    this.flow.setState({
      coach: {
        ...cur,
        latest: { result: out.result, analysis, tip: reading?.tip ?? null },
        comparison,
        mastery: next,
        event,
        attempts: [...cur.attempts, success],
      },
      phase: 'idle',
    });
  }

  /** "Watch demonstration" in Coach Mode. */
  async coachDemonstrate(): Promise<void> {
    const c = this.flow.getState().coach;
    const guide = c ? this.guideFor(c.source, c.base) : null;
    if (!guide || this.flow.busy() || !(await this.withStage())) return;
    await this.during('demo', (signal) =>
      this.flow.host.stage!.demonstrate(guide.result, guide.option, { source: c!.source, signal }),
    );
  }

  /** Back from Coach Mode to where it was opened (the dead ball, or a summary). */
  leaveCoach(): void {
    const c = this.flow.getState().coach;
    if (!c || this.flow.busy()) return;
    this.flow.host.stage?.setAssistance(null, null);
    const s = this.flow.getState().innings;
    if (s?.current)
      this.flow.host.stage?.setScene({
        field: s.current.field,
        bowler: s.current.plan.bowler,
        conditions: s.conditions,
        handedness: s.handedness,
        ball: s.current.plan.ball,
      });
    this.flow.setState({ coach: null, screen: c.back.screen, phase: c.back.phase });
    if (c.back.screen === 'live' && c.back.phase === 'dead') this.flow.deadBallShownAgain();
  }
}
