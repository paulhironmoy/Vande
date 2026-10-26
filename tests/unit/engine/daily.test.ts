// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BattingInput, InningsState, MatchEventLog, PlayerRef } from '@/contracts';
import { SUPER_BALL_INDEX } from '@/contracts/cricket';
import { dailyCommits, engine } from '@/engine';
import { sha256Hex } from '@/engine/sha256';
import { dayIndex } from '@/engine/v1/policies';
import { ALL_VARIANTS, clone } from './helpers';
import golden from './fixtures/golden-v1.json';

const PLAYER: PlayerRef = { id: 'p-daily-tester', alias: 'Tester', avatar: { seed: 't' }, kit: { id: 'k', primary: '#123456', secondary: '#abcdef', pattern: 'plain' }, kind: 'human' };
const SETTER: PlayerRef = { id: 'p-daily-six', alias: 'Daily Six', avatar: { seed: 'dailysix' }, kit: { id: 'starter', primary: '#1E2A78', secondary: '#FFB020', pattern: 'chevron' }, kind: 'daily' };
const SALT = 'server-secret-0f3a9c';

function playDaily(day: string, attempt: 1 | 2 | 3, seed: string, answer: (ball: number) => 'auto' | null = () => 'auto') {
  const { conditions, overs } = engine.dailyChallenge(day, SALT);
  const plan = overs[attempt - 1];
  let state: InningsState = engine.startInnings(0);
  const inputs: Array<BattingInput | null> = [];
  while (!state.done) {
    const d = engine.revealDelivery(plan, state.mainDone ? SUPER_BALL_INDEX : state.nextBall, conditions);
    const input = answer(d.ball) === 'auto' ? engine.autoBat(`${seed}-${d.ball}`, d, plan.field) : null;
    inputs.push(input);
    state = engine.resolveNextBall(state, { seed, conditions, plan, input }).state;
  }
  return { state, inputs };
}

function dailyLog(day: string, attempt: 1 | 2 | 3, seed: string, answer?: (ball: number) => 'auto' | null): MatchEventLog {
  const { state, inputs } = playDaily(day, attempt, seed, answer);
  return engine.buildDailyLog({ attemptId: `att-${day}-${attempt}`, day, attempt, seed, serverSalt: SALT, player: PLAYER, setter: SETTER, inputs, innings: state, meta: { createdHour: `${day}T08`, revealedHour: `${day}T09` } });
}

describe('dailyChallenge with a server salt', () => {
  it('is identical for everyone with the same salt and unpredictable without it', () => {
    const a = engine.dailyChallenge('2026-10-25', SALT);
    expect(engine.dailyChallenge('2026-10-25', SALT)).toEqual(a);
    const practice = engine.dailyChallenge('2026-10-25');
    expect(practice.overs).not.toEqual(a.overs);
    expect(engine.dailyChallenge('2026-10-25', 'another-salt').overs).not.toEqual(a.overs);
    for (const over of a.overs) expect(engine.validatePlan(over, ALL_VARIANTS).ok).toBe(true);
  });

  it('keeps the unsalted practice version exactly as before (deterministic, rotating pitches)', () => {
    expect(engine.dailyChallenge('2026-10-25')).toEqual(engine.dailyChallenge('2026-10-25', ''));
    expect(engine.dailyChallenge('2026-10-25').conditions.pitch).toBe(['green', 'hard', 'slow'][dayIndex('2026-10-25') % 3]);
  });

  it('salts the pitch order too, but still plays each pitch once in every three-day block', () => {
    const orders = new Set<string>();
    for (let block = 0; block < 12; block++) {
      const first = 20751 + block * 3 - (20751 % 3);
      const days = [0, 1, 2].map((k) => {
        const n = first + k;
        const date = new Date(Date.UTC(1970, 0, 1 + n)).toISOString().slice(0, 10);
        return engine.dailyChallenge(date, SALT).conditions.pitch;
      });
      expect(new Set(days).size).toBe(3);
      orders.add(days.join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('publishes one-way commits for the three overs', () => {
    const commits = dailyCommits('2026-10-25', SALT);
    const { overs } = engine.dailyChallenge('2026-10-25', SALT);
    expect(commits.map((c) => c.attempt)).toEqual([1, 2, 3]);
    commits.forEach((c, i) => {
      expect(c.hash).toBe(sha256Hex(engine.canonicalPlan(overs[i]) + c.salt));
      expect(c.salt).not.toContain(SALT);
    });
  });
});

describe('buildDailyLog', () => {
  it('builds a solo replay that verifies and never contains the server salt', async () => {
    for (const attempt of [1, 2, 3] as const) {
      const log = dailyLog('2026-10-25', attempt, `seed-${attempt}`);
      expect(log.kind).toBe('daily');
      expect(log.players[1]).toEqual(SETTER);
      expect(log.innings[1]).toEqual({ batter: 1, bowler: 0, balls: [], runs: 0, wickets: 0, ballsFaced: 0 });
      expect(log.superBall).toEqual({ used: false, outcomes: null });
      expect(log.result.decidedBy).toBe('forfeit_none');
      expect(log.result.dailyScore).toBe(engine.dailyScore(log.innings[0]));
      expect(log.result.marginRuns).toBe(0);
      expect(log.events.find((e) => e.t === 'result')).toEqual({ t: 'result', result: log.result });
      expect(log.commits[1].hash).toBe(dailyCommits('2026-10-25', SALT)[attempt - 1].hash);
      expect(JSON.stringify(log)).not.toContain(SALT);
      expect(log.events.some((e) => e.t === 'commentary' && e.key === 'commentary.daily_score')).toBe(true);
      expect(await engine.verifyMatchLog(log)).toEqual({ ok: true });
      expect(await engine.verifyMatchLog(clone(log))).toEqual({ ok: true });
    }
  });

  it('verifies attempts with unanswered balls and an all-out innings', async () => {
    const log = dailyLog('2026-10-26', 2, 'gappy', (ball) => (ball % 2 ? null : 'auto'));
    expect(await engine.verifyMatchLog(log)).toEqual({ ok: true });
  });

  it('detects tampering with the score, the over, an input or the seed', async () => {
    const log = dailyLog('2026-10-25', 1, 'tamper-me');
    const a = clone(log);
    a.result.dailyScore = (a.result.dailyScore ?? 0) + 10;
    expect(await engine.verifyMatchLog(a)).toMatchObject({ ok: false, errors: expect.arrayContaining(['result.daily_score']) });
    const a2 = clone(log);
    a2.result.marginRuns = a2.result.dailyScore ?? 1;
    expect(await engine.verifyMatchLog(a2)).toMatchObject({ ok: false, errors: expect.arrayContaining(['result.daily_margin_not_zero']) });
    const a3 = clone(log);
    delete a3.result.dailyScore;
    expect(await engine.verifyMatchLog(a3)).toMatchObject({ ok: false, errors: expect.arrayContaining(['result.daily_score']) });
    const b = clone(log);
    b.plans[1].balls[0].intent = b.plans[1].balls[0].intent === 'attack' ? 'contain' : 'attack';
    b.plans[0] = clone(b.plans[1]);
    expect((await engine.verifyMatchLog(b)).ok).toBe(false);
    const c = clone(log);
    c.plans[0].field = c.plans[0].field === 'sweeper' ? 'attacking' : 'sweeper';
    expect((await engine.verifyMatchLog(c)).ok).toBe(false);
    const d = clone(log);
    d.seed = `${d.seed}x`;
    expect((await engine.verifyMatchLog(d)).ok).toBe(false);
    const e = clone(log);
    if (e.inputs[0][0] && e.inputs[0][0].tapMs !== null) {
      e.inputs[0][0].tapMs += 150;
      e.inputs[0][0].clientElapsedMs += 200;
      expect((await engine.verifyMatchLog(e)).ok).toBe(false);
    }
  });

  it('leaves duel and cup results without dailyScore, and rejects one added afterwards', async () => {
    const logs = (golden as unknown as { logs: MatchEventLog[] }).logs;
    for (const log of logs) expect('dailyScore' in log.result).toBe(false);
    const tampered = clone(logs[0]);
    tampered.result.dailyScore = 50;
    expect((await engine.verifyMatchLog(tampered)).ok).toBe(false);
  });

  it('refuses an unfinished innings', () => {
    expect(() =>
      engine.buildDailyLog({ attemptId: 'x', day: '2026-10-25', attempt: 1, seed: 's', serverSalt: SALT, player: PLAYER, setter: SETTER, inputs: [], innings: engine.startInnings(0), meta: { createdHour: 'h', revealedHour: 'h' } }),
    ).toThrow();
  });
});
