/**
 * The Chase surfaces as rendered: the entry on the home, the resume card, the rail line, the briefing, the dead-ball
 * card inside a chase, and the win and loss screen with its actions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import type { CoachRecommendation, PrimaryInsight } from '@/contracts';
import { chaseReducer, makeChase, startChase, type ChaseDefinition } from '@/practice/chase';
import type { CoachTip } from '@/practice/coach';
import { memoryStore, updatePracticeSettings } from '@/practice/store';
import { PracticeKitContext, type PracticeKit } from '@/practice/ui/context';
import { ResultLayer } from '@/practice/ui/components/ResultLayer';
import type { LastBall } from '@/practice/ui/flow/state';
import { ChaseBrief } from '@/practice/ui/chase/ChaseBrief';
import { ChaseEntry } from '@/practice/ui/chase/ChaseEntry';
import { ChaseNeed } from '@/practice/ui/chase/ChaseNeed';
import { ChaseResult } from '@/practice/ui/chase/ChaseResult';
import type { CoachKit, GestureSurfaceProps } from '@/practice/ui/flow/types';
import { Home } from '@/practice/ui/screens/Home';
import { Play } from '@/practice/ui/screens/Play';
import type { TesterApi } from '@/practice/ui/tester/useTester';
import { attack, caught, defend, useFakeTimers } from '../flowSetup';
import { chaseRig, openChase, playOut, untilDead, type ChaseRig } from './harness';

vi.mock('@/render3d', () => ({ preloadPracticeStage: () => () => undefined }));

const GestureProbe: ComponentType<GestureSurfaceProps> = () => <div />;
const def = makeChase('c021') as ChaseDefinition;

function tester(): TesterApi {
  return {
    enabled: false,
    active: false,
    consentNeeded: false,
    begin: vi.fn(),
    decline: vi.fn(),
    current: null,
    answer: vi.fn(),
    skip: vi.fn(),
    marker: vi.fn(),
    endSession: vi.fn(),
    gesture: vi.fn(),
    nextOver: vi.fn(),
    abandon: vi.fn(),
  };
}

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

beforeEach(() => useFakeTimers());
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the rail line', () => {
  it('says what is needed, in the words COPY wrote, and the rate it asks for', () => {
    render(<ChaseNeed chase={{ runsNeeded: 14, ballsLeft: 9, requiredRateX100: 933 }} quiet={false} />);
    expect(screen.getByTestId('practice-chase-need-main').textContent).toBe('Need 14 off 9 balls');
    expect(screen.getByTestId('practice-chase-rate').textContent).toBe('9.3 an over');
    // Screen readers get one full sentence; the two short lines are not read out as well.
    expect(screen.getByTestId('practice-chase-need-main').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('practice-chase-need-said').textContent).toMatch(/14 runs from 9 balls/);
  });

  it('is one ball: "1 ball", and no rate when nothing is needed or no ball is left', () => {
    const { rerender } = render(<ChaseNeed chase={{ runsNeeded: 4, ballsLeft: 1, requiredRateX100: 2400 }} quiet />);
    expect(screen.getByTestId('practice-chase-need-main').textContent).toBe('Need 4 off 1 ball');
    expect(screen.getByTestId('practice-chase-need').getAttribute('data-quiet')).toBe('true');
    // Delivery Quiet Mode keeps one short line (the stylesheet shows it and hides the full line and the rate).
    expect(screen.getByTestId('practice-chase-need-compact').textContent).toBe('4 off 1');
    rerender(<ChaseNeed chase={{ runsNeeded: 4, ballsLeft: 0, requiredRateX100: null }} quiet={false} />);
    expect(screen.queryByTestId('practice-chase-rate')).toBeNull();
  });

  it('never colours or flags pressure: nothing in it carries a state but quiet', () => {
    render(<ChaseNeed chase={{ runsNeeded: 70, ballsLeft: 2, requiredRateX100: 21000 }} quiet={false} />);
    const el = screen.getByTestId('practice-chase-need');
    expect(
      Array.from(el.attributes)
        .map((a) => a.name)
        .sort(),
    ).toEqual(['class', 'data-quiet', 'data-testid']);
  });
});

describe('the home', () => {
  const props = (over: Partial<Parameters<typeof Home>[0]> = {}) => ({
    mode: 'new' as const,
    resumable: null,
    notice: null,
    storageOk: true,
    onChoose: vi.fn(),
    onContinue: vi.fn(),
    onDiscard: vi.fn(),
    onSettings: vi.fn(),
    onBack: null,
    ...over,
  });

  it('offers Chase as a third choice with its one-line promise; Random Over stays the first', () => {
    const p = props();
    render(<Home {...p} />);
    const choices = ['practice-random', 'practice-predefined', 'practice-chase'].map((id) => screen.getByTestId(id));
    expect(choices[2].textContent).toContain('Chase');
    expect(choices[2].textContent).toContain('Reach a target in 12 balls. One wicket.');
    expect(choices[0].compareDocumentPosition(choices[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(choices[1].compareDocumentPosition(choices[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(choices[2]);
    expect(p.onChoose).toHaveBeenCalledWith('chase');
  });

  it('a chase left half way is offered as that chase, and starting something new asks first', () => {
    const innings = { runs: 3, balls: 3 } as never;
    const p = props({ resumable: innings, chaseResume: { runsNeeded: 11, ballsLeft: 9 } });
    render(<Home {...p} />);
    expect(screen.getByTestId('practice-resume-card').textContent).toContain('Chase in progress');
    expect(screen.getByTestId('practice-chase-resume-need').textContent).toBe('Need 11 off 9 balls');
    fireEvent.click(screen.getByTestId('practice-continue'));
    expect(p.onContinue).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('practice-new-innings-choices-toggle'));
    fireEvent.click(screen.getByTestId('practice-chase'));
    expect(p.onChoose).not.toHaveBeenCalled();
    expect(screen.getByTestId('practice-discard-dialog').textContent).toContain('This ends your chase');
  });
});

describe('the entry and the briefing', () => {
  it('the entry is a plain choice with no badge, counter or reward', () => {
    const onClick = vi.fn();
    render(<ChaseEntry onClick={onClick} />);
    fireEvent.click(screen.getByTestId('practice-chase'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('practice-chase').querySelectorAll('[data-badge], [class*="badge"]')).toHaveLength(0);
  });

  it('the briefing says the target, what is needed, the rules, that the target stays, and why there is no retry', () => {
    render(<ChaseBrief chase={{ state: startChase(def), previous: null, summary: null }} />);
    expect(screen.getByTestId('practice-chase-brief-target').textContent).toBe(`Target ${def.target}`);
    // The difficulty is shown and fixed: Standard, chosen once.
    expect(screen.getByTestId('practice-chase-brief-level').textContent).toBe('Difficulty: Standard');
    expect(screen.getByTestId('practice-chase-brief-need').textContent).toBe(`Need ${def.target} off 12 balls`);
    expect(screen.getByTestId('practice-chase-brief').textContent).toMatch(/never changes/);
    expect(screen.getByTestId('practice-chase-no-retry').textContent).toMatch(/Practice this ball is off/);
  });
});

/** Plays a chase on the fake physics to the point wanted and renders the play surface on its state. */
async function renderAt(rig: ChaseRig, finish: 'dead1' | 'dead6' | 'won' | 'lost_wicket') {
  const { flow, swings } = rig;
  if (finish === 'dead1') swings.push(defend());
  else if (finish === 'dead6') swings.push(...Array.from({ length: 6 }, () => defend()));
  else if (finish === 'won') swings.push(...Array.from({ length: Math.ceil(rig.target / 6) }, () => attack(0.9)));
  else swings.push(defend(), caught());
  await openChase(flow);
  if (finish === 'dead1') await untilDead(flow, 1);
  else await playOut(flow, finish === 'dead6' ? 6 : 12);
  vi.spyOn(flow, 'attachCanvas').mockImplementation(() => undefined);
  vi.spyOn(flow, 'attachCoachCanvas').mockImplementation(() => undefined);
  const onHome = vi.fn();
  const view = (state = flow.getState()) => (
    <PracticeKitContext.Provider value={kitOf(rig)}>
      <Play
        flow={flow}
        state={state}
        onHome={onHome}
        onSettings={vi.fn()}
        appVersion="test"
        onNextOver={vi.fn()}
        onChooseOver={vi.fn()}
        onHarder={null}
        tester={tester()}
      />
    </PracticeKitContext.Provider>
  );
  return { ...render(view()), view, onHome };
}

describe('the play surface in a chase', () => {
  it('the rail keeps the ball marks and adds "Need X off Y", with no second mode label while the chase is on', async () => {
    const rig = chaseRig();
    await renderAt(rig, 'dead1');
    expect(screen.getByTestId('practice-chase-need-main').textContent).toBe(`Need ${rig.target} off 11 balls`);
    expect(screen.queryByTestId('practice-status-mode')).toBeNull();
    expect(screen.getByTestId('practice-status').querySelectorAll('li')).toHaveLength(6);
  });

  it('a left-hander gets the same rail: the chase line is the same element in the same place (the HUD is not mirrored)', async () => {
    const right = await renderAt(chaseRig(), 'dead1');
    const rail = (id: string) => screen.getByTestId(id);
    const rightLine = rail('practice-chase-need').outerHTML;
    // The ball marks and the chase line live in the rail's left cluster: the line is a child of the same element.
    const rightParent = rail('practice-chase-need').parentElement!.className;
    right.unmount();
    cleanup();
    const store = memoryStore();
    updatePracticeSettings({ teach: false, demoSeen: true, handedness: 'left' }, store);
    const leftRig = chaseRig({ store });
    await renderAt(leftRig, 'dead1');
    expect(leftRig.flow.getState().handedness).toBe('left');
    expect(rail('practice-chase-need').outerHTML).toBe(rightLine);
    expect(rail('practice-chase-need').parentElement!.className).toBe(rightParent);
  });

  it('the dead-ball card has no "Practice this ball", says so, and the action is "Next ball"', async () => {
    await renderAt(chaseRig(), 'dead1');
    expect(screen.queryByTestId('practice-practice-ball')).toBeNull();
    expect(screen.getByTestId('practice-chase-no-practice').textContent).toBe('Practice this ball is off in a chase.');
    expect(screen.getByTestId('practice-next-ball').textContent).toContain('Next ball');
  });

  it('after the sixth ball the action is "Next over"', async () => {
    await renderAt(chaseRig(), 'dead6');
    expect(screen.getByTestId('practice-next-ball').textContent).toContain('Next over');
  });

  it('after the deciding ball the action is "See result" and the rail no longer asks for runs', async () => {
    await renderAt(chaseRig(), 'lost_wicket');
    expect(screen.getByTestId('practice-next-ball').textContent).toContain('See result');
    expect(screen.queryByTestId('practice-chase-need')).toBeNull();
    expect(screen.getByTestId('practice-status-mode').textContent).toBe('Chase');
  });

  it('pausing a chase offers Resume and Leave, never "Restart over"', async () => {
    const rig = chaseRig();
    const { rerender, view } = await renderAt(rig, 'dead1');
    rig.flow.pause();
    rerender(view());
    expect(screen.getByTestId('practice-paused')).toBeTruthy();
    expect(screen.queryByTestId('practice-restart-over')).toBeNull();
    expect(screen.getByTestId('practice-leave')).toBeTruthy();
  });

  it('the camera notice (batting moved to the standard graphics) shows on the dead ball like the other graphics notices', async () => {
    const rig = chaseRig();
    const { rerender, view } = await renderAt(rig, 'dead1');
    expect(screen.queryByTestId('practice-result-notice')).toBeNull();
    rerender(view({ ...rig.flow.getState(), notice: 'camera_web' }));
    expect(screen.getByTestId('practice-result-notice').textContent).toBe('Camera batting uses the standard graphics.');
    // A notice that is not one of the calm dead-ball ones is still kept off the card.
    rerender(view({ ...rig.flow.getState(), notice: 'updated' }));
    expect(screen.queryByTestId('practice-result-notice')).toBeNull();
  });
});

/**
 * R-44 item 5, R-45: nothing a chase shows may read as the coach's choice being a way to win. The coach judges the ball,
 * so in a chase its green-tick confirmation and the tag of its first alternative say "this ball"; elsewhere they are as
 * they were.
 */
describe('the coach in a chase speaks about this ball only', () => {
  const REPEAT_IT: CoachRecommendation = {
    kind: 'repeat_it',
    decision: 'defend',
    footwork: 'forward',
    shiftMs: null,
    directionDeg: null,
    region: null,
    lofted: null,
  };
  async function deadBallCard(inChase: boolean) {
    const rig = chaseRig();
    rig.swings.push(defend());
    await openChase(rig.flow);
    await untilDead(rig.flow, 1);
    const last = rig.flow.getState().last as LastBall;
    const base = rig.coach!.analyzeBall(last.record, last.result);
    // A solid block that suits the ball, with no risk the coach's choice avoids: the tick is earned.
    const analysis = {
      ...base,
      attempted: { ...base.attempted, decision: 'defend' as const, contact: 'middle' as const, dismissal: null },
      options: base.options.map((o) => ({ ...o, risks: [] })),
    };
    const primary: PrimaryInsight = { reason: 'solid_defence', timingMs: 2, recommendation: REPEAT_IT };
    const tip: CoachTip = {
      mistake: null,
      fact: { kind: 'reason', reason: 'solid_defence', zone: null, fielder: null },
      action: REPEAT_IT,
      cleanContact: true,
    };
    return render(
      <PracticeKitContext.Provider value={kitOf(rig)}>
        <ResultLayer
          last={last}
          insight={{ key: 'k', status: 'ready', analysis, primary, tip }}
          score="0/0"
          nextLabel="Next ball"
          canPractice={!inChase}
          practiceOff={inChase ? 'Practice this ball is off in a chase.' : null}
          onPractice={vi.fn()}
          onNext={vi.fn()}
          onDemo={vi.fn()}
          onCloseUp={vi.fn()}
          onSlowMo={vi.fn()}
        />
      </PracticeKitContext.Provider>,
    );
  }

  it('the green tick says the shot was the coach’s choice for this ball, not "play it the same way again"', async () => {
    await deadBallCard(true);
    const tip = screen.getByTestId('practice-result-tip');
    expect(tip.getAttribute('data-confirm')).toBe('true');
    expect(tip.textContent).toMatch(/: that was the coach’s choice for this ball\.$/);
    expect(tip.textContent).not.toMatch(/same way again/i);
    // The measured fact is still the tip's own: only the action changed.
    expect(screen.getByTestId('practice-result-reason').textContent).toBeTruthy();
    expect(screen.getByTestId('practice-result-recommendation').textContent).toBe(
      'that was the coach’s choice for this ball',
    );
  });

  it('the first alternative is "Coach’s pick for this ball", not "Recommended", and keeps its numbers', async () => {
    await deadBallCard(true);
    fireEvent.click(screen.getByTestId('practice-alternatives-toggle'));
    const list = screen.getByTestId('practice-alternatives').textContent ?? '';
    expect(list).toContain('Coach’s pick for this ball');
    expect(list).not.toContain('Recommended');
    expect(list).toMatch(/About 0\.4 runs/);
  });

  it('outside a chase both are as they were', async () => {
    await deadBallCard(false);
    const tip = screen.getByTestId('practice-result-tip');
    expect(tip.getAttribute('data-confirm')).toBe('true');
    expect(tip.textContent).toMatch(/play it the same way again\.$/);
    fireEvent.click(screen.getByTestId('practice-alternatives-toggle'));
    const list = screen.getByTestId('practice-alternatives').textContent ?? '';
    expect(list).toContain('Recommended');
    expect(list).not.toContain('this ball');
  });
});

describe('the win and loss screen', () => {
  async function resultOf(finish: 'won' | 'lost_wicket') {
    const rig = chaseRig();
    const ctx = await renderAt(rig, finish);
    rig.flow.nextBall();
    const onAgain = vi.spyOn(rig.flow.chase, 'retry').mockImplementation(() => undefined);
    // The deciding ball is replayed first (the stage's replay), then the result is shown: step the flow's clock.
    const calls = () => rig.createStage.stages[0].calls();
    for (let i = 0; i < 200 && !calls().includes('replay'); i++) await vi.advanceTimersByTimeAsync(50);
    for (let i = 0; i < 200 && !screen.queryByTestId('practice-chase-result'); i++) {
      ctx.rerender(ctx.view());
      await vi.advanceTimersByTimeAsync(50);
    }
    return { ...ctx, rig, onAgain };
  }

  it('a loss: one primary "Try this chase again", one secondary "Back to Practice", the reason in one sentence', async () => {
    const { rig, onAgain, onHome } = await resultOf('lost_wicket');
    const root = screen.getByTestId('practice-chase-result');
    expect(root.getAttribute('data-result')).toBe('lost_wicket');
    expect(root.querySelector('h1')!.textContent).toBe(`${rig.target - 0} runs short`);
    expect(screen.getByTestId('practice-chase-why').textContent).toMatch(/^Out: Caught\./);
    const primary = screen.getByTestId('practice-chase-again');
    expect(primary.textContent).toContain('Try this chase again');
    fireEvent.click(primary);
    expect(onAgain).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('practice-chase-back'));
    expect(onHome).toHaveBeenCalledTimes(1);
    // The deciding ball (watch it again, practise it) is one quiet disclosure; practising is offered as practice only.
    expect(screen.queryByTestId('practice-chase-practise')).toBeNull();
    fireEvent.click(screen.getByTestId('practice-chase-deciding-toggle'));
    expect(screen.getByTestId('practice-chase-practise-note').textContent).toMatch(/Practice only/);
    expect(screen.getByTestId('practice-chase-watch')).toBeTruthy();
    expect(screen.getAllByRole('button').filter((b) => /Try this chase again/.test(b.textContent ?? ''))).toHaveLength(
      1,
    );
  });

  it('a win: the title, the score and the balls to spare; no reason is asked for', async () => {
    const { rig } = await resultOf('won');
    const root = screen.getByTestId('practice-chase-result');
    expect(root.getAttribute('data-result')).toBe('won');
    expect(root.querySelector('h1')!.textContent).toBe('Target reached');
    expect(screen.getByTestId('practice-chase-line').textContent).toContain(`The target was ${rig.target}`);
    expect(screen.queryByTestId('practice-chase-why')).toBeNull();
    expect(screen.getByTestId('practice-chase-balls').querySelectorAll('li').length).toBe(Math.ceil(rig.target / 6));
  });

  it('keyboard: the primary action holds focus when the screen opens', async () => {
    await resultOf('lost_wicket');
    const primary = screen.getByTestId('practice-chase-again');
    expect(document.activeElement).toBe(primary);
  });
});

describe('ChaseResult on its own', () => {
  it('renders nothing without a decided chase', () => {
    const state = {
      chase: { state: chaseReducer(startChase(def), { type: 'abandon' }), previous: null, summary: null },
      innings: null,
    };
    const { container } = render(
      <ChaseResult
        flow={{ resultOf: vi.fn() }}
        state={state as never}
        onAgain={vi.fn()}
        onBack={vi.fn()}
        onWatch={vi.fn()}
        onPractise={null}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});
