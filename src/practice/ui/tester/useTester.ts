/**
 * The tester mode for one Practice visit (hidden; off unless switched on in diagnostics). After the facilitator records
 * consent and the cohort, it records the session's events (taps, the read of each gesture, every ball and retry, a
 * voluntary next over, abandons, facilitator markers) and asks the study's questions at their scheduled moments, one
 * tap each (TESTER_SCHEDULE). Everything stays on this device; with no consent nothing is recorded.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GestureInput } from '@/contracts';
import { PRACTICE_SIM_VERSION } from '@/contracts';
import { useApp } from '@/app/store';
import { tierForQuality } from '@/perf';
import { TESTER_SCHEDULE, loadCalibrations, testerEnabled, type MarkerCode, type TesterCohort, type TesterQuestion } from '@/practice/store';
import { useKit } from '../context';
import type { FlowState, PracticeFlow } from '../flow/controller';
import { TesterRecorder, gestureClass, readGesture, type GestureRead } from './recorder';
import { lengthTruth, lineTruth, movementTruth } from './truths';

interface Ask {
  q: TesterQuestion;
  truth?: string;
}

export interface TesterApi {
  enabled: boolean;
  active: boolean;
  /** Tester mode is on and no session has begun this visit (and the facilitator has not declined one). */
  consentNeeded: boolean;
  begin(cohort: TesterCohort, handReported: 'left' | 'right' | null): void;
  decline(): void;
  current: { q: TesterQuestion; step: number; of: number } | null;
  answer(a: string): void;
  skip(): void;
  marker(code: MarkerCode, extra?: { reason?: string; value?: string }): void;
  /** The facilitator ends the session: the end-of-session questions follow. */
  endSession(): void;
  /** Every gesture, read into closed facts (the Play screen passes them through). */
  gesture(input: GestureInput): void;
  /** The end-of-over choices, for the voluntary-continuation measure. */
  nextOver(action: 'same' | 'harder' | 'different' | 'exit'): void;
  abandon(): void;
}

const EXPERT: readonly TesterCohort[] = ['expert', 'informed_expert'];

export function useTester(flow: PracticeFlow, state: FlowState, appVersion: string): TesterApi {
  const { engine } = useKit();
  const locale = useApp((s) => s.settings.locale);
  const rec = useMemo(() => new TesterRecorder(), []);
  const [enabled] = useState(() => testerEnabled());
  const [active, setActive] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [queue, setQueue] = useState<{ asks: Ask[]; index: number; ctx: Record<string, string | number> } | null>(null);
  const pendingGesture = useRef<GestureRead | null>(null);
  const ballFlags = useRef({ whyOpened: false, replayOpened: false, demoWatched: false });
  const seenBall = useRef<string | null>(null);
  const flushBall = useRef<(() => void) | null>(null);
  const oversSeen = useRef(new Set<string>());
  const coachOpen = useRef<{ key: string; attempts: number; ctx: Record<string, string | number> } | null>(null);
  const summaryAt = useRef<number | null>(null);
  const prompted = useRef(false);
  const firstBallAsked = useRef(false);

  const ask = (asks: Ask[], ctx: Record<string, string | number>) => {
    if (!rec.active || !asks.length) return;
    setQueue((cur) => (cur ? { ...cur, asks: [...cur.asks, ...asks] } : { asks, index: 0, ctx }));
  };

  // Taps on anything with a test id (closed ids, never text), with the screen they were on.
  useEffect(() => {
    if (!active) return;
    const onTap = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-testid]');
      const id = el?.getAttribute('data-testid');
      if (!id) return;
      const st = flow.getState();
      rec.event({ type: 'tap', screen: `${st.screen}:${st.phase}`, id });
      if (id === 'practice-why-toggle') ballFlags.current.whyOpened = true;
      if (id === 'practice-slowmo' || id === 'practice-closeup') ballFlags.current.replayOpened = true;
      if (id === 'practice-demo') ballFlags.current.demoWatched = true;
    };
    document.addEventListener('click', onTap, true);
    return () => document.removeEventListener('click', onTap, true);
  }, [active, flow, rec]);

  // Each innings ball: its gesture's read, then (when the player moves on) the ball itself; and the scheduled questions.
  useEffect(() => {
    if (!active) return;
    const last = state.last;
    if (state.phase === 'dead' && last && last.kind === 'innings') {
      const r = last.record;
      const key = `${r.seed}:${r.overIndex}.${r.ballIndex}`;
      if (seenBall.current === key) return;
      seenBall.current = key;
      flushBall.current?.();
      const g = pendingGesture.current;
      pendingGesture.current = null;
      const sw = last.result.swing;
      rec.event({ type: 'gesture', pointer: g?.pointer ?? 'none', cls: gestureClass(g?.pointer ?? null, sw), dwellMs: g?.dwellMs ?? null, durMs: g?.durMs ?? null, lenFrac: g?.lenFrac ?? null, travelling: g?.travelling ?? null, swing: sw ? { kind: sw.kind, directionDeg: Math.round(sw.directionDeg), power: Math.round(sw.power * 100) / 100, elevation: Math.round(sw.elevation * 100) / 100, footwork: sw.footwork } : null, movedAfterTapDecision: null });
      if (flow.firstDeliveryMs() !== null) rec.field({ ttfcdMs: Math.round(flow.firstDeliveryMs()!) });
      const c = last.result.contact;
      const source = r.plan && state.innings?.current?.plan.source === 'reference' ? 'reference' : state.overKind === 'built' ? 'predefined' : state.overKind ?? 'random';
      ballFlags.current = { whyOpened: false, replayOpened: false, demoWatched: false };
      flushBall.current = () => {
        rec.event({ type: 'ball', over: r.overIndex + 1, ball: r.ballIndex + 1, kind: 'innings', variation: r.plan.variation, runs: last.result.outcome.runs, dismissal: last.result.outcome.dismissal, timing: c.timing, contact: c.kind, timingErrorMs: c.timingErrorMs === null ? null : Math.round(c.timingErrorMs), exitBearingDeg: c.exitBearingDeg === null ? null : Math.round(c.exitBearingDeg), intendedBearingDeg: c.intendedBearingDeg === null ? null : Math.round(c.intendedBearingDeg), exitElevationDeg: c.exitElevationDeg === null ? null : Math.round(c.exitElevationDeg), assist: r.assist, toleranceMs: r.tierToleranceMs, tier: tierForQuality(state.quality), source, ...ballFlags.current });
        flushBall.current = null;
      };
      oversSeen.current.add(`${r.seed.split(':')[0]}|${r.overIndex}`);
      const overNo = oversSeen.current.size;
      const asks: Ask[] = [];
      const facts = engine.coachingFacts(last.result, r);
      if (TESTER_SCHEDULE.intentOvers.includes(overNo)) asks.push({ q: rec.cohort && EXPERT.includes(rec.cohort) ? 'intent_expert' : 'intent_rookie' }, { q: 'intent_direction' }, { q: 'control' });
      if (TESTER_SCHEDULE.readOvers.includes(overNo)) asks.push({ q: 'line', truth: lineTruth(facts) }, { q: 'length', truth: lengthTruth(facts) }, { q: 'movement', truth: movementTruth(facts) });
      if (r.ballIndex === 0 && overNo <= TESTER_SCHEDULE.paceOrSpinOvers) asks.push({ q: 'pace_or_spin', truth: r.bowler.family });
      if (!firstBallAsked.current) {
        firstBallAsked.current = true;
        asks.push(...TESTER_SCHEDULE.afterFirstBall.map((q) => ({ q })));
      }
      ask(asks, { over: r.overIndex + 1, ball: r.ballIndex + 1, variation: r.plan.variation });
    } else if (state.phase === 'runup' && flushBall.current) flushBall.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, state.phase, state.last]);

  // Coach Mode: each retry; "why" when it closes after an attempt; the ratings after a five-attempt run.
  useEffect(() => {
    if (!active) return;
    const c = state.coach;
    if (c) {
      const ctx = { over: c.overNumber, ball: c.ballNumber, variation: c.source.plan.variation, stage: c.mastery.stage };
      const prev = coachOpen.current;
      coachOpen.current = { key: c.key, attempts: c.attempts.length, ctx };
      if (prev?.key === c.key && c.attempts.length > prev.attempts) {
        rec.event({ type: 'retry', attempt: c.attempts.length, success: c.attempts[c.attempts.length - 1], verdict: c.comparison?.verdict ?? null });
        if (c.attempts.length === TESTER_SCHEDULE.masteryRun) ask(TESTER_SCHEDULE.afterMasteryRun.map((q) => ({ q })), ctx);
      }
    } else if (coachOpen.current) {
      const was = coachOpen.current;
      coachOpen.current = null;
      if (was.attempts > 0) ask(TESTER_SCHEDULE.afterCoach.map((q) => ({ q })), was.ctx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, state.coach]);

  // The end-of-over screen opens the continuation window.
  useEffect(() => {
    if (!active) return;
    if (state.screen === 'over_summary') {
      flushBall.current?.();
      summaryAt.current = rec.t();
      prompted.current = false;
    }
  }, [active, state.screen, rec]);

  const advance = () => setQueue((cur) => (cur && cur.index + 1 < cur.asks.length ? { ...cur, index: cur.index + 1 } : null));
  const cur = queue?.asks[queue.index] ?? null;
  return {
    enabled,
    active,
    consentNeeded: enabled && !active && !declined,
    begin: (cohort, handReported) => {
      const cal = loadCalibrations();
      const off = (m: 'touch' | 'mouse' | 'keyboard') => cal[m]?.offsetMs ?? null;
      const inn = state.innings;
      rec.begin({ cohort, handReported, appVersion, build: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : appVersion, simVersion: PRACTICE_SIM_VERSION, locale, device: { graphics: tierForQuality(state.quality), screen: `${window.innerWidth}x${window.innerHeight}`, input: navigator.maxTouchPoints > 0 ? 'touch' : 'mouse' }, hand: inn?.handedness ?? flow.settings.handedness, assist: inn?.assist ?? flow.settings.assist, calibration: { touch: off('touch'), mouse: off('mouse'), keyboard: off('keyboard') }, ttfcdMs: null });
      setActive(rec.active);
    },
    decline: () => setDeclined(true),
    current: cur && queue ? { q: cur.q, step: queue.index + 1, of: queue.asks.length } : null,
    answer: (a) => {
      if (!cur || !queue) return;
      rec.answer({ q: cur.q, a, ...(cur.truth ? { truth: cur.truth } : {}), ctx: queue.ctx });
      advance();
    },
    skip: advance,
    marker: (code, extra) => {
      if (code === 'prompted') prompted.current = true;
      rec.event({ type: 'marker', code, ...(extra ?? {}) });
    },
    endSession: () => {
      flushBall.current?.();
      rec.event({ type: 'marker', code: 'end_session' });
      ask([...TESTER_SCHEDULE.endOfSession, ...(rec.cohort && EXPERT.includes(rec.cohort) ? TESTER_SCHEDULE.endOfSessionExperts : [])].map((q) => ({ q })), {});
    },
    gesture: (input) => {
      if (rec.active) pendingGesture.current = readGesture(input);
    },
    nextOver: (action) => {
      if (!rec.active || summaryAt.current === null) return;
      const choiceMs = rec.t() - summaryAt.current;
      rec.event({ type: 'next_over', action, choiceMs, voluntary: !prompted.current && action !== 'exit' && choiceMs <= TESTER_SCHEDULE.continuationWindowMs });
      summaryAt.current = null;
    },
    abandon: () => {
      const s = flow.getState().innings;
      if (rec.active && s?.current) rec.event({ type: 'abandon', over: s.overs.length + 1, ball: s.current.deliveries.length });
    },
  };
}
