/**
 * Praise follows the measured contact (COACH: bat speed and the sweet zone), never the contact label: the tick, the
 * green, "Clean contact this time" and the 'better' chime. A stroke met in the middle at less than
 * PRAISE_MIN_SPEED_SHARE of the bat speed it asked for (requestedKph) is a fend: no tick, no green on the dead-ball card
 * or the Coach card, and no 'better' verdict (so no chime). A block met at the 7–8 km/h a block is played at is not a
 * fend: a block asks for no stroke speed, so it is never flagged slow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import type { CoachAnalysis, CoachRecommendation, PrimaryInsight } from '@/contracts';
import {
  PRAISE_MIN_SPEED_SHARE,
  analyzeBall,
  coachTip,
  compareAttempts,
  praiseEarned,
  primaryInsight,
  requestedKph,
  type CoachTip,
} from '@/practice/coach';
import { PracticeKitContext, type PracticeKit } from '@/practice/ui/context';
import { ResultLayer } from '@/practice/ui/components/ResultLayer';
import { masteryConfirmation } from '@/practice/ui/flow/coachLoop';
import type { CoachSession, Insight, LastBall } from '@/practice/ui/flow/state';
import type { CoachKit, GestureSurfaceProps } from '@/practice/ui/flow/types';
import { Coach } from '@/practice/ui/screens/Coach';
import { play, referenceRecord, swingFor } from '../coach/fixtures';
import { attack, defend, quickPlay, setup, until, useFakeTimers } from './flowSetup';

const GestureProbe: ComponentType<GestureSurfaceProps> = () => <div />;

function kitOf(value: { engine: unknown; coach: CoachKit | null; createStage: unknown }): PracticeKit {
  return {
    engine: value.engine,
    coach: value.coach,
    createStage: value.createStage,
    input: { GestureSurface: GestureProbe },
    ground: { boundaryR: 70, ringR: 27.4, pitchHalf: 10.06, bladeM: 0.96, striker: { x: 0, z: 10.06 } },
    fielderClass: () => 'ring',
    build: {
      lengthBand: () => 'good',
      lineBand: () => 'outside_off',
      stockRange: () => [125, 135],
      variationsFor: () => ['stock'],
    },
  } as unknown as PracticeKit;
}

const WELL_PLAYED: CoachRecommendation = {
  kind: 'well_played',
  decision: 'attack',
  footwork: 'forward',
  shiftMs: null,
  directionDeg: 55,
  region: 'cover',
  lofted: false,
};

/** A cover drive met in the middle of the bat, with no risk the recommended response avoids. */
function middleDrive(base: CoachAnalysis): CoachAnalysis {
  return {
    ...base,
    attempted: {
      ...base.attempted,
      decision: 'attack',
      footwork: 'forward',
      directionDeg: 55,
      elevation: 0,
      power: 0.7,
      contact: 'middle',
      timing: 'perfect',
      timingErrorMs: 2,
      dismissal: null,
      spread: null,
    },
    options: base.options.map((o) => ({ ...o, risks: [] })),
  };
}

/** The tip a slow middle earns (tip.ts contactFact): the measured speed against the speed the stroke asked for. */
function slowTip(an: CoachAnalysis): CoachTip {
  const req = requestedKph(an.attempted)!;
  return {
    mistake: null,
    fact: {
      kind: 'slow',
      kph: Math.round(req * (PRAISE_MIN_SPEED_SHARE - 0.1)),
      requestedKph: Math.round(req),
      instead: 'aim_for_the_gap',
    },
    action: WELL_PLAYED,
    cleanContact: false,
  };
}

/** The same stroke met cleanly. */
function cleanTip(): CoachTip {
  return {
    mistake: null,
    fact: { kind: 'reason', reason: 'found_the_gap', zone: 'cover', fielder: null },
    action: WELL_PLAYED,
    cleanContact: true,
  };
}

beforeEach(() => useFakeTimers());
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function deadBall() {
  const value = setup();
  value.flow.init();
  value.swings.push(attack(0.7, 55));
  await quickPlay(value.flow);
  await until(() => value.flow.getState().phase === 'dead');
  return { value, last: value.flow.getState().last as LastBall };
}

function card(value: Awaited<ReturnType<typeof deadBall>>['value'], last: LastBall, insight: Insight) {
  return render(
    <PracticeKitContext.Provider value={kitOf(value)}>
      <ResultLayer
        last={last}
        insight={insight}
        score="0/0"
        nextLabel="Next ball"
        canPractice
        onPractice={vi.fn()}
        onNext={vi.fn()}
        onDemo={vi.fn()}
        onCloseUp={vi.fn()}
        onSlowMo={vi.fn()}
      />
    </PracticeKitContext.Provider>,
  );
}

describe('a middle at less than PRAISE_MIN_SPEED_SHARE of the speed asked for is not praised', () => {
  it('the requested speed is the physics plan (requestedKph), and the share is one half', () => {
    expect(PRAISE_MIN_SPEED_SHARE).toBe(0.5);
    expect(requestedKph({ decision: 'attack', footwork: 'forward', directionDeg: 55, power: 0.7 })).toBeGreaterThan(0);
    expect(requestedKph({ decision: 'defend', footwork: 'forward', directionDeg: 0, power: 0.2 })).toBeNull();
  });

  it('dead-ball card: no tick and no green for the slow middle; the tick for the same stroke met cleanly', async () => {
    const { value, last } = await deadBall();
    const an = middleDrive(value.coach!.analyzeBall(last.record, last.result));
    const primary: PrimaryInsight = { reason: 'found_the_gap', timingMs: 2, recommendation: WELL_PLAYED };
    // The contact label alone would praise it: that is exactly what must not decide.
    expect(praiseEarned(an, WELL_PLAYED)).toBe(true);
    const slow = card(value, last, { key: 'k', status: 'ready', analysis: an, primary, tip: slowTip(an) });
    expect(screen.getByTestId('practice-result-tip').getAttribute('data-confirm')).toBe('false');
    expect(screen.getByTestId('practice-result-tip').textContent).toMatch(/km\/h/);
    slow.unmount();
    card(value, last, { key: 'k', status: 'ready', analysis: an, primary, tip: cleanTip() });
    expect(screen.getByTestId('practice-result-tip').getAttribute('data-confirm')).toBe('true');
  });

  it('Coach Mode card: the same', async () => {
    const { value, last } = await deadBall();
    const an = middleDrive(value.coach!.analyzeBall(last.record, last.result));
    const coach = {
      ...value.coach!,
      primaryInsight: () => ({ reason: 'found_the_gap', timingMs: 2, recommendation: WELL_PLAYED }) as PrimaryInsight,
    };
    const session = (tip: CoachTip): CoachSession => ({
      key: 'k',
      source: last.record,
      sourceResult: last.result,
      overNumber: 1,
      ballNumber: 1,
      base: an,
      baseTip: tip,
      latest: { result: last.result, analysis: an, tip },
      comparison: null,
      mastery: coach.startMastery('k'),
      event: null,
      attempts: [true],
      back: { screen: 'live', phase: 'dead' },
    });
    const show = (tip: CoachTip) =>
      render(
        <PracticeKitContext.Provider value={kitOf({ ...value, coach })}>
          <Coach session={session(tip)} busy={false} onReplay={vi.fn()} onDemo={vi.fn()} onBack={vi.fn()} />
        </PracticeKitContext.Provider>,
      );
    const slow = show(slowTip(an));
    expect(screen.getByTestId('practice-coach-recommendation').getAttribute('data-confirm')).toBe('false');
    slow.unmount();
    show(cleanTip());
    expect(screen.getByTestId('practice-coach-recommendation').getAttribute('data-confirm')).toBe('true');
  });

  it('no "Clean contact this time" and no better chime when the newer middle is a slow fend', async () => {
    const { value, last } = await deadBall();
    const base = middleDrive(value.coach!.analyzeBall(last.record, last.result));
    const edged: CoachAnalysis = { ...base, attempted: { ...base.attempted, contact: 'outside_edge' } };
    // By the label the newer middle is "clean contact now", a better verdict, and the chime would play.
    const byLabel = compareAttempts(edged, base);
    expect(byLabel.changes).toContain('clean_contact_now');
    expect(masteryConfirmation(byLabel, 'stage_up')).toBe('stage_up');
    // By the measurement (the tips' cleanContact, as the coach loop now passes it) it is not.
    const measured = compareAttempts(edged, base, { previous: false, next: slowTip(base).cleanContact });
    expect(measured.changes).not.toContain('clean_contact_now');
    expect(measured.verdict).not.toBe('better');
    expect(masteryConfirmation(measured, 'stage_up')).toBeNull();
  });

  it('the coach loop passes both attempts’ measured clean contact to compareAttempts', async () => {
    const value = setup();
    const calls: unknown[] = [];
    const coach = value.coach!;
    const tips = [false, true];
    let n = 0;
    coach.coachTip = (_r, a) => ({
      mistake: null,
      fact: { kind: 'reason', reason: a.why[0], zone: null, fielder: null },
      action: coach.primaryInsight(a).recommendation,
      cleanContact: tips[Math.min(n++, 1)],
    });
    const inner = coach.compareAttempts;
    coach.compareAttempts = (p, x, clean) => {
      calls.push(clean);
      return inner(p, x, clean);
    };
    value.flow.init();
    value.swings.push(attack(0.6));
    await quickPlay(value.flow);
    await until(() => value.flow.getState().insight?.status === 'ready');
    value.swings.push(defend());
    value.flow.coachLoop.practiceThisBall();
    await until(
      () =>
        value.flow.getState().screen === 'coach' &&
        value.flow.getState().coach?.latest !== null &&
        value.flow.getState().phase === 'idle',
    );
    expect(calls).toEqual([{ previous: false, next: true }]);
  });
});

describe('a block met at 7–8 km/h is not flagged', () => {
  it('ref-2, a forward block met in the middle: not slow, clean, and its confirmation is shown (real coach and physics)', async () => {
    const record = referenceRecord('ref-2', 'real');
    const played = play(record, swingFor(record, { kind: 'defend', footwork: 'forward' }));
    expect(played.result.contact.kind).toBe('middle');
    expect(played.result.contact.batSpeedKph).toBeGreaterThan(6);
    expect(played.result.contact.batSpeedKph).toBeLessThan(10);
    const analysis = analyzeBall(played.record);
    const tip = coachTip(played.record, analysis);
    // A block asks for no stroke speed, so it can never be a slow fend.
    expect(requestedKph(analysis.attempted)).toBeNull();
    expect(tip.fact.kind).not.toBe('slow');
    expect(tip.cleanContact).toBe(true);
    const primary = primaryInsight(analysis);
    expect(praiseEarned(analysis, primary.recommendation, tip)).toBe(true);
    // And on the card: rendered with the real analysis and tip, nothing withholds what the block earned.
    const { value, last } = await deadBall();
    card(
      value,
      { ...last, record: played.record, result: played.result },
      { key: 'k', status: 'ready', analysis, primary, tip },
    );
    const shown = screen.getByTestId('practice-result-tip');
    expect(shown.textContent).not.toMatch(/km\/h/);
    expect(shown.getAttribute('data-confirm')).toBe(
      primary.recommendation.kind === 'repeat_it' || primary.recommendation.kind === 'well_played' ? 'true' : 'false',
    );
  }, 60_000);
});
