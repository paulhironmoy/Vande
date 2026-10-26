/**
 * Integration-review fixes: one release per ball in the planner (also across visits), Daily Six replays shown as a
 * solo attempt (score line, no Player of the Match, one innings), the durable Daily Six ball, and contract ballsLeft
 * for local innings.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { BattingInput, InningsState, MatchEventLog, OverPlan } from '@/contracts';
import { engine } from '@/engine';
import { memoryKeyValue } from '@/net';
import { createTranslator } from '@/i18n/translator';
import { ensureI18n } from '@/i18n/sources';
import { resultText } from '@/screens/reveal/text';
import { Scorecard } from '@/screens/reveal/Scorecard';
import { dailyTransport } from '@/screens/daily/dailyTransport';
import { localInnings } from '@/screens/local/localInnings';
import { BowlingPlannerScreen } from '@/screens/planner/BowlingPlannerScreen';
import { FIXTURE_PLAYERS } from '@/screens/dev/fixtures';
import { loadI18n, renderUi } from './helpers';

vi.mock('@/audio', async () => {
  const actual = await vi.importActual<typeof import('@/audio')>('@/audio');
  return { ...actual, playSealChime: () => undefined };
});

let now = 10_000;
beforeAll(async () => {
  await loadI18n();
});
beforeEach(() => {
  localStorage.clear();
  now = 10_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function release(meter: HTMLElement, ms: number) {
  fireEvent.keyDown(meter, { key: ' ' });
  now += ms;
  fireEvent.keyUp(meter, { key: ' ' });
}

describe('planner: one release per delivery (GAME_RULES 3.2)', () => {
  it('locks the meter once a ball has its release, and keeps it locked after leaving and coming back', () => {
    const props = { conditions: { pitch: 'hard' as const, weather: 'clear' as const }, unlocked: engine.STARTER_VARIANTS, onLock: vi.fn(), draftKey: 'match-abc' };
    renderUi(<BowlingPlannerScreen {...props} />);
    const meter = screen.getByTestId('execution-meter');
    release(meter, 520);
    expect(screen.getByTestId('plan-ball-0').hasAttribute('data-done')).toBe(true);
    fireEvent.click(screen.getByTestId('plan-ball-0'));
    const again = screen.getByTestId('execution-meter');
    expect(again.getAttribute('aria-disabled')).toBe('true');
    expect(again.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByText('One release per ball. This one is recorded and cannot be redone.')).toBeTruthy();
    // Trying again does nothing: the recorded trace stays.
    const stored = localStorage.getItem('vc:plan:match-abc');
    release(again, 800);
    expect(localStorage.getItem('vc:plan:match-abc')).toBe(stored);
    // Leaving the planner and opening it again keeps the recorded release.
    cleanup();
    renderUi(<BowlingPlannerScreen {...props} />);
    fireEvent.click(screen.getByTestId('plan-ball-0'));
    expect(screen.getByTestId('plan-ball-0').hasAttribute('data-done')).toBe(true);
    expect(screen.getByTestId('execution-meter').getAttribute('aria-disabled')).toBe('true');
  });
});

function dailyLog(): MatchEventLog {
  const { conditions, overs } = engine.dailyChallenge('2026-10-25', 'test-salt');
  let state: InningsState = engine.startInnings(0);
  const inputs: Array<BattingInput | null> = [];
  while (!state.mainDone) {
    const d = engine.revealDelivery(overs[0], state.nextBall, conditions);
    const input = engine.autoBat(`daily-${d.ball}`, d, overs[0].field);
    inputs.push(input);
    state = engine.resolveNextBall(state, { seed: 'daily-seed', conditions, plan: overs[0], input }).state;
  }
  return engine.buildDailyLog({
    attemptId: 'att1',
    day: '2026-10-25',
    attempt: 1,
    seed: 'daily-seed',
    serverSalt: 'test-salt',
    player: FIXTURE_PLAYERS[0],
    setter: { ...FIXTURE_PLAYERS[1], kind: 'daily' },
    inputs,
    innings: state,
    meta: { createdHour: '2026-10-25T10:00Z', revealedHour: '2026-10-25T10:00Z' },
  });
}

describe('Daily Six replays are a solo attempt', () => {
  it('say the score (never "tied"), show one innings and no Player of the Match', async () => {
    const log = dailyLog();
    expect(log.kind).toBe('daily');
    const { english } = await ensureI18n('en');
    const t = createTranslator('en', english, english);
    const text = resultText(log.result, log, t);
    expect(text).not.toMatch(/tie/i);
    expect(text).toContain(`${log.innings[0].runs}/${log.innings[0].wickets}`);
    renderUi(<Scorecard log={log} />);
    expect(screen.getAllByText(/^Innings \d$/)).toHaveLength(1);
    expect(screen.queryByText(log.players[1].alias)).toBeNull();
  });
});

describe('Daily Six ball survives a restart', () => {
  it('keeps the revealed ball in durable storage until it is answered', async () => {
    const kv = memoryKeyValue();
    const plan: OverPlan = engine.autoOver('kv', { pitch: 'hard', weather: 'clear' });
    const ball = { delivery: engine.revealDelivery(plan, 1, { pitch: 'hard', weather: 'clear' }), ballToken: 'tok1', field: 'balanced' as const, ballsLeft: 5 };
    const net = { api: { call: vi.fn().mockResolvedValue(ball) }, outbox: { drainGroup: vi.fn().mockResolvedValue(true), submit: vi.fn().mockResolvedValue({ status: 'sent', response: { feedback: { ball: 1, timing: 'good', contact: 'middle' }, inningsComplete: false } }) } };
    await dailyTransport(net as never, kv).next('att9');
    // A new transport (the app restarted) still finds the same ball.
    expect((await dailyTransport(net as never, kv).outstanding('att9'))?.ballToken).toBe('tok1');
    await dailyTransport(net as never, kv).shot('att9', 'tok1', { v: 1, ball: 1, shot: 'defend', zone: null, tapMs: 500, trace: { pointer: 'touch', samples: [[0, 0.5, 0.5], [60, 0.5, 0.5]] }, clientElapsedMs: 800 });
    expect(await dailyTransport(net as never, kv).outstanding('att9')).toBeNull();
  });
});

describe('local innings report ballsLeft like the server', () => {
  it('counts the Super Ball: 6 after the first ball down to 0 after the Super Ball', async () => {
    const conditions = { pitch: 'hard' as const, weather: 'clear' as const };
    const plan = engine.autoOver('bl', conditions);
    const inn = localInnings({ plan, conditions, seed: 'ab'.repeat(16), includeSuperBall: true });
    const seen: number[] = [];
    for (let i = 0; i < 7; i++) {
      const next = await inn.nextBall();
      if (!next) break;
      seen.push(next.ballsLeft);
      await inn.submitShot(engine.autoBat(`b${i}`, next.delivery, plan.field));
    }
    expect(seen).toEqual([6, 5, 4, 3, 2, 1, 0]);
  });
});

describe('Daily Six result card', () => {
  it('says plainly when an attempt does not count, and shows the "sealed before you batted" proof', async () => {
    const { useApp } = await import('@/app/store');
    const { dailyCommits } = await import('@/engine');
    const services = { analytics: { track: vi.fn() }, platform: { share: { share: vi.fn() } } };
    const log = dailyLog();
    const commits = dailyCommits('2026-10-25', 'test-salt');
    const view = { day: '2026-10-25', conditions: log.conditions, attemptsUsed: 1, attemptsMax: 3 as const, overCommits: commits.map((c) => c.hash) as [string, string, string], bestScore: null, streak: 2, resetsAt: '2026-10-25T18:30:00Z' };
    const call = vi.fn().mockResolvedValue({ score: 7, counted: false, bestScore: null, log });
    vi.doMock('@/app/services', () => ({ useServices: () => ({ ...services, net: { api: { call } } }), getServices: async () => null }));
    vi.resetModules();
    const { DailyResult } = await import('@/screens/daily/DailyRoute');
    useApp.setState({ player: null });
    renderUi(<DailyResult attempt={{ day: '2026-10-25', attemptId: 'att1', attempt: 1 }} me={FIXTURE_PLAYERS[0]} view={view} onWatch={vi.fn()} onAgain={vi.fn()} />);
    expect((await screen.findByTestId('daily-counted')).getAttribute('data-counted')).toBe('false');
    expect(screen.getByText(/does not count on the boards/)).toBeTruthy();
    expect(screen.getByText('No counted score yet today')).toBeTruthy();
    expect(log.commits[1].hash).toBe(commits[0].hash);
    expect(screen.getByTestId('daily-proof-line').textContent).toContain('Sealed before you batted');
    vi.doUnmock('@/app/services');
  });
});
