/**
 * Pure Lite replay: the exact game the Lite screen plays, without the store, the DOM or storage.
 *
 * It mirrors, step for step:
 *   - `startLite` in src/app/store.ts: chapter seed = chapterSeed(seed, 0) (which is `seed >>> 0` for the first
 *     chapter), standard difficulty, DEFAULT_OPPONENTS, campaign mode, then the 'start' action;
 *   - the Lite screen's `advance` loop: resume when paused, tick one at a time, stop at a pending decision or
 *     fair-play moment or the end, with the same 400-step guard;
 *   - the screen's `scanEvidence` (inspect, compare, preserve) and `applyToken` (e<i>, d<i>-<o>, r<i>-<o>).
 *
 * One deliberate difference: the store's Simple style auto-pauses the clock when something new needs an answer and
 * resumes it after the answer. Pause and resume change only `status`, never ticks, scores, evidence or pending ids,
 * and decisions resolve the same whether the clock is paused or running, so the pure replay simply never pauses.
 *
 * Used by the toughness generator, tests and (later) the verified-dares server.
 */
import { DEFAULT_OPPONENTS, createGame, evidenceActions, getScenario, reduce, tick } from '@/engine';
import type { GameConfig, GameState, Scenario } from '@/engine/types';

/** Lite plays Chapter 1. */
export const LITE_SCENARIO_ID = 'examination-crisis';

/** Same guard as the Lite screen's advance loop. */
export const MAX_ADVANCE_STEPS = 400;

export interface LiteGame {
  state: GameState;
  scenario: Scenario;
}

/** A new Lite game for a campaign seed, exactly as `startLite({ seed })` creates and starts it. */
export function startLiteGame(campaignSeed: number): LiteGame {
  const scenario = getScenario(LITE_SCENARIO_ID);
  const config: GameConfig = {
    scenarioId: LITE_SCENARIO_ID,
    // chapterSeed(seed, 0) === seed >>> 0 (src/app/store.ts); a parity test pins this.
    seed: campaignSeed >>> 0,
    difficulty: 'standard',
    opponents: [...DEFAULT_OPPONENTS],
    mode: 'campaign',
  };
  const made = createGame(config, scenario);
  return { state: reduce(made, { type: 'start', tick: made.tick }, scenario), scenario };
}

/** Advance game time until something needs an answer, or the chapter ends (the Lite screen's `advance`). */
export function advanceToPending(state: GameState, scenario: Scenario): GameState {
  let g = state;
  let guard = 0;
  while (guard++ < MAX_ADVANCE_STEPS) {
    if (g.status === 'ended') break;
    if (g.pendingDecisionIds.length || g.pendingRightsIds.length) break;
    if (g.status === 'paused') g = reduce(g, { type: 'resume', tick: g.tick }, scenario);
    const before = g.tick;
    g = tick(g, scenario, 1);
    if (g.tick === before) break;
  }
  return g;
}

/** Scan a clue exactly the way the Lite screen's Scan button does: inspect, then compare, then keep safe. */
export function scanEvidence(state: GameState, scenario: Scenario, evidenceId: string): GameState {
  let g = state;
  for (const verb of ['inspect', 'compare', 'preserve'] as const) {
    const acts = evidenceActions(g, scenario, evidenceId).filter((a) => a.enabled && a.verb === verb);
    for (const a of acts) g = reduce(g, { type: 'evidence', tick: g.tick, evidenceId, verb, compareWith: a.compareWith }, scenario);
  }
  return g;
}

/** Replays one recorded token: `e<i>` scan, `d<i>-<o>` move, `r<i>-<o>` fair-play answer. Throws on anything invalid. */
export function applyToken(state: GameState, scenario: Scenario, token: string): GameState {
  if (/^e\d+$/.test(token)) {
    const ev = scenario.evidence[Number(token.slice(1))];
    if (!ev) throw new Error('bad clue');
    return scanEvidence(state, scenario, ev.id);
  }
  const m = /^([dr])(\d+)-(\d+)$/.exec(token);
  if (!m) throw new Error('bad token');
  if (m[1] === 'd') {
    const d = scenario.decisions[Number(m[2])];
    const o = d?.options[Number(m[3])];
    if (!d || !o) throw new Error('bad move');
    return reduce(state, { type: 'decide', tick: state.tick, decisionId: d.id, optionId: o.id }, scenario);
  }
  const rm = scenario.rightsMoments[Number(m[2])];
  const o = rm?.options[Number(m[3])];
  if (!rm || !o) throw new Error('bad answer');
  return reduce(state, { type: 'rights', tick: state.tick, momentId: rm.id, optionId: o.id }, scenario);
}

/** True when `step` (`d<i>` or `r<i>`) is waiting for an answer in `state`. */
export function isStepPending(state: GameState, scenario: Scenario, step: string): boolean {
  const m = /^([dr])(\d+)$/.exec(step);
  if (!m) return false;
  const idx = Number(m[2]);
  return m[1] === 'd' ? state.pendingDecisionIds.includes(scenario.decisions[idx]?.id ?? '') : state.pendingRightsIds.includes(scenario.rightsMoments[idx]?.id ?? '');
}

/**
 * The state at a dared question, replayed exactly like the Lite screen's `takeDare`: start the seed, then for each
 * token advance and apply it, then advance once more. Throws when the path is invalid or the step is not pending.
 */
export function replayDare(dare: { seed: number; path: string; step: string }): LiteGame {
  const game = startLiteGame(dare.seed);
  const { scenario } = game;
  let state = game.state;
  const tokens = dare.path ? dare.path.split('.') : [];
  for (const tok of tokens) {
    state = advanceToPending(state, scenario);
    state = applyToken(state, scenario, tok);
  }
  state = advanceToPending(state, scenario);
  if (!isStepPending(state, scenario, dare.step)) throw new Error('mismatch');
  return { state, scenario };
}
