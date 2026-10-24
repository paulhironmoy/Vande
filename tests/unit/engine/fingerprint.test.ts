import { describe, expect, it } from 'vitest';
import { MINI } from '../fixtures/mini-scenario';
import { computeChapterResult, computeFingerprint } from '@/engine/scoring';
import { createGame, reduce, tick } from '@/engine/simulation';
import type { GameConfig, Scenario } from '@/engine/types';

const config: GameConfig = { scenarioId: 'examination-crisis', seed: 5, difficulty: 'standard', opponents: ['disinfo', 'exploiter'], mode: 'campaign' };

type Choice = { tick: number; decisionId: string; optionId: string };

function play(scenario: Scenario, choices: Choice[], until = 60) {
  let g = reduce(createGame(config, scenario), { type: 'start', tick: 0 }, scenario);
  for (const c of [...choices].sort((a, b) => a.tick - b.tick)) {
    g = tick(g, scenario, c.tick - g.tick);
    g = reduce(g, { type: 'decide', ...c }, scenario);
  }
  return tick(g, scenario, until - g.tick);
}

describe('strategy fingerprint', () => {
  it('is empty before any decision resolves', () => {
    expect(computeFingerprint(createGame(config, MINI), MINI)).toBe('');
  });

  it('writes one letter per resolved decision in order of appearance', () => {
    // d-accuse appears at 6 (wait → W), d-force at 8 (dialogue + protect-assembly → S), d-expire at 10 (service → S).
    const state = play(MINI, [
      { tick: 9, decisionId: 'd-accuse', optionId: 'o-wait' },
      { tick: 9, decisionId: 'd-force', optionId: 'o-dialogue' },
      { tick: 11, decisionId: 'd-expire', optionId: 'o-act' },
    ]);
    expect(computeFingerprint(state, MINI)).toBe('WSS');
  });

  it('marks pure dialogue or transparency as D, and protection as S', () => {
    const talk: Scenario = JSON.parse(JSON.stringify(MINI));
    const dialogue = talk.decisions[1].options.find((o) => o.id === 'o-dialogue')!;
    dialogue.tags = ['dialogue'];
    const state = play(talk, [
      { tick: 9, decisionId: 'd-accuse', optionId: 'o-wait' },
      { tick: 9, decisionId: 'd-force', optionId: 'o-dialogue' },
    ]);
    expect(computeFingerprint(state, talk)).toBe('WDW');
    const protect = play(MINI, [{ tick: 9, decisionId: 'd-force', optionId: 'o-dialogue' }]);
    expect(computeFingerprint(protect, MINI)[1]).toBe('S');
  });

  it('marks expired decisions as waits', () => {
    const state = play(MINI, [{ tick: 9, decisionId: 'd-force', optionId: 'o-dialogue' }]);
    // d-accuse expires at 46 onto its wait default, d-expire expires at 15 onto its idle default.
    expect(computeFingerprint(state, MINI)).toBe('WSW');
    expect(state.decisions['d-accuse'].status).toBe('expired');
    expect(state.decisions['d-expire'].status).toBe('expired');
  });

  it('marks disproportionate force as X and proportionate force as P', () => {
    const early = play(MINI, [{ tick: 9, decisionId: 'd-force', optionId: 'o-force' }]);
    expect(early.decisions['d-force'].disproportionate).toBe(true);
    expect(computeFingerprint(early, MINI)).toBe('WXW');
    // After stones fly at tick 30 the flag violence-active makes the same option proportionate.
    const late = play(MINI, [{ tick: 31, decisionId: 'd-force', optionId: 'o-force' }]);
    expect(late.flags['violence-active']).toBe(true);
    expect(late.decisions['d-force'].disproportionate).toBeFalsy();
    expect(computeFingerprint(late, MINI)).toBe('WPW');
  });

  it('marks a false accusation as X and an evidence-backed one as E', () => {
    const falseState = play(MINI, [{ tick: 9, decisionId: 'd-accuse', optionId: 'o-accuse' }]);
    expect(computeFingerprint(falseState, MINI)[0]).toBe('X');
    const backed: Scenario = JSON.parse(JSON.stringify(MINI));
    backed.decisions[0].options[0].requiresEvidence = ['ev-official'];
    const trueState = play(backed, [{ tick: 9, decisionId: 'd-accuse', optionId: 'o-accuse' }]);
    expect(computeFingerprint(trueState, backed)[0]).toBe('E');
  });

  it('uses only the six published letters and is carried on the chapter result', () => {
    const state = play(MINI, [
      { tick: 9, decisionId: 'd-accuse', optionId: 'o-wait' },
      { tick: 9, decisionId: 'd-force', optionId: 'o-dialogue' },
    ]);
    const fp = computeFingerprint(state, MINI);
    expect(fp).toMatch(/^[DESPXW]+$/);
    expect(computeChapterResult(state, MINI, '2026-10-24T00:00:00.000Z').fingerprint).toBe(fp);
  });
});
