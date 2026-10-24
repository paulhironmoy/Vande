import { describe, expect, it } from 'vitest';
import { DAYS, SCHEDULE } from '@/content/daily';
import { getDayScenario, resolveDaily } from '@/engine/daily';
import { dailyBalance, playHeadless, type HeadlessStrategy } from '@/engine/dailyValidate';
import type { GameConfig } from '@/engine/types';

const STRATEGIES: HeadlessStrategy[] = ['principled', 'suppressive', 'idle', 'reckless'];

describe('daily balance across strategies', () => {
  const reports = SCHEDULE.order.map((id) => dailyBalance(DAYS[id]));
  // eslint-disable-next-line no-console
  console.log(
    '\n' +
      reports
        .map((r) => `${r.dayId} ${DAYS[r.dayId].dilemmaKey.padEnd(32)} principled=${String(r.principled).padStart(3)} suppressive=${String(r.suppressive).padStart(3)} idle=${String(r.idle).padStart(3)} reckless=${String(r.reckless).padStart(3)}`)
        .join('\n') +
      '\n',
  );

  it.each(reports.map((r) => [r.dayId, r] as const))('%s: a principled player clearly beats suppression and inaction', (_id, r) => {
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.principled).toBeGreaterThanOrEqual(60);
    expect(r.principled - r.suppressive).toBeGreaterThanOrEqual(12);
    expect(r.principled - r.idle).toBeGreaterThanOrEqual(12);
  });

  it('is deterministic for a given resolution', () => {
    const res = resolveDaily('2026-11-10');
    const scenario = getDayScenario(res.dayId);
    const config: GameConfig = { scenarioId: scenario.id, seed: res.seed, difficulty: res.difficulty, opponents: res.opponents, mode: 'daily' };
    const a = playHeadless(scenario, config, 'principled');
    const b = playHeadless(scenario, config, 'principled');
    expect(a.result.score).toBe(b.result.score);
    expect(a.result.fingerprint).toBe(b.result.fingerprint);
    expect(a.state.scores).toEqual(b.state.scores);
  });

  it('fingerprints follow the strategy on every day', () => {
    for (const id of SCHEDULE.order) {
      const scenario = getDayScenario(id);
      const config: GameConfig = { scenarioId: scenario.id, seed: 7, difficulty: 'standard', opponents: DAYS[id].opponents, mode: 'daily' };
      const fp = Object.fromEntries(STRATEGIES.map((s) => [s, playHeadless(scenario, config, s).result.fingerprint])) as Record<HeadlessStrategy, string>;
      expect(fp.idle, `${id} idle`).toMatch(/^W+$/);
      expect(fp.principled, `${id} principled`).not.toMatch(/X/);
      expect(fp.principled.length, `${id} principled`).toBeGreaterThanOrEqual(4);
      expect(fp.suppressive, `${id} suppressive`).toMatch(/[XP]/);
      for (const s of STRATEGIES) expect(fp[s], `${id} ${s}`).toMatch(/^[DESPXW]*$/);
    }
  });
});
