import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetPersistenceForTests } from '@/app/persistence';
import { __resetStoreForTests, chapterSeed, useApp } from '@/app/store';
import { createRng, evidenceActions, hashString, rngFloat } from '@/engine';
import type { GameState, RngState, Scenario } from '@/engine/types';
import { evaluateAll, bestOf } from '@/lite/points';
import { MAX_ADVANCE_STEPS, advanceToPending, applyToken, isStepPending, replayDare, startLiteGame } from '@/lite/replay';

async function freshStore() {
  await __resetPersistenceForTests(true);
  __resetStoreForTests();
  window.history.replaceState(null, '', '/');
  await useApp.getState().hydrate();
}

/** The Lite screen's `advance`, driven through the real store. */
function storeAdvance() {
  let guard = 0;
  while (guard++ < MAX_ADVANCE_STEPS) {
    const g = useApp.getState().game;
    if (!g || g.status === 'ended') break;
    if (g.pendingDecisionIds.length || g.pendingRightsIds.length) break;
    if (g.status === 'paused') useApp.getState().resumeGame();
    const before = useApp.getState().game?.tick;
    useApp.getState().tickGame(1);
    if (useApp.getState().game?.tick === before) break;
  }
}

/** The Lite screen's `applyToken`, driven through the real store. */
function storeApply(tok: string) {
  const sc = useApp.getState().scenario!;
  const tick = useApp.getState().game!.tick;
  if (/^e\d+$/.test(tok)) {
    const ev = sc.evidence[Number(tok.slice(1))];
    for (const verb of ['inspect', 'compare', 'preserve'] as const) {
      const acts = evidenceActions(useApp.getState().game!, sc, ev.id).filter((a) => a.enabled && a.verb === verb);
      for (const a of acts) useApp.getState().dispatch({ type: 'evidence', tick: useApp.getState().game!.tick, evidenceId: ev.id, verb, compareWith: a.compareWith });
    }
    return;
  }
  const m = /^([dr])(\d+)-(\d+)$/.exec(tok)!;
  if (m[1] === 'd') {
    const d = sc.decisions[Number(m[2])];
    useApp.getState().dispatch({ type: 'decide', tick, decisionId: d.id, optionId: d.options[Number(m[3])].id });
  } else {
    const rm = sc.rightsMoments[Number(m[2])];
    useApp.getState().dispatch({ type: 'rights', tick, momentId: rm.id, optionId: rm.options[Number(m[3])].id });
  }
}

function snapshot(g: GameState) {
  return { tick: g.tick, scores: g.scores, decisions: [...g.pendingDecisionIds], rights: [...g.pendingRightsIds], ended: g.status === 'ended', evidence: Object.values(g.evidence).map((e) => `${e.state}:${e.inspected}:${e.preserved}`) };
}

/** Builds a replay path with the pure replay: random scans, random moves, random fair-play answers. */
function randomPath(seed: number, salt: number, maxTokens = 24): string[] {
  let rng: RngState = createRng(hashString(`replay-test:${seed}:${salt}`) >>> 0);
  const next = () => {
    const r = rngFloat(rng);
    rng = r.next;
    return r.value;
  };
  const { scenario } = startLiteGame(seed);
  let state = startLiteGame(seed).state;
  const tokens: string[] = [];
  for (let i = 0; i < 64 && tokens.length < maxTokens; i++) {
    state = advanceToPending(state, scenario);
    if (state.status === 'ended') break;
    const rid = state.pendingRightsIds[0];
    if (rid) {
      const ri = scenario.rightsMoments.findIndex((r) => r.id === rid);
      const tok = `r${ri}-${Math.floor(next() * scenario.rightsMoments[ri].options.length)}`;
      state = applyToken(state, scenario, tok);
      tokens.push(tok);
      continue;
    }
    const d = scenario.decisions.find((x) => x.id === state.pendingDecisionIds[0])!;
    for (const id of new Set(d.options.flatMap((o) => o.requiresEvidence ?? []))) {
      const ei = scenario.evidence.findIndex((e) => e.id === id);
      if (state.evidence[id]?.visible && !state.evidence[id].inspected && next() < 0.6) {
        state = applyToken(state, scenario, `e${ei}`);
        tokens.push(`e${ei}`);
      }
    }
    const di = scenario.decisions.findIndex((x) => x.id === d.id);
    const oi = salt === 0 ? bestOf(evaluateAll(state, scenario, d)).index : Math.floor(next() * d.options.length);
    const tok = `d${di}-${oi}`;
    state = applyToken(state, scenario, tok);
    tokens.push(tok);
  }
  return tokens;
}

describe('pure Lite replay', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    await freshStore();
  });

  it('uses the same chapter seed as the store', () => {
    for (const s of [0, 1, 42, 0xffffffff, 123456789]) expect(chapterSeed(s, 0)).toBe(s >>> 0);
  });

  it('matches the real store step for step over several seeds and paths', async () => {
    let steps = 0;
    for (const seed of [3, 42, 2026, 0xdeadbeef]) {
      for (const salt of [0, 1, 2]) {
        const path = randomPath(seed, salt);
        await freshStore();
        useApp.getState().startLite({ seed });
        const { scenario } = startLiteGame(seed);
        let state: GameState = startLiteGame(seed).state;
        expect(snapshot(useApp.getState().game!)).toEqual(snapshot(state));
        for (const tok of path) {
          storeAdvance();
          state = advanceToPending(state, scenario);
          expect(snapshot(useApp.getState().game!)).toEqual(snapshot(state));
          storeApply(tok);
          state = applyToken(state, scenario, tok);
          expect(snapshot(useApp.getState().game!)).toEqual(snapshot(state));
          steps++;
        }
        storeAdvance();
        state = advanceToPending(state, scenario);
        expect(snapshot(useApp.getState().game!)).toEqual(snapshot(state));
      }
    }
    expect(steps).toBeGreaterThan(60);
  }, 120_000);

  it('replays a dare to the dared question and refuses a step that is not pending', () => {
    const seed = 77;
    const path = randomPath(seed, 0, 6);
    // The dared question is whatever is pending after the path.
    const { scenario } = startLiteGame(seed);
    let state = startLiteGame(seed).state;
    for (const tok of path) state = applyToken(advanceToPending(state, scenario), scenario, tok);
    state = advanceToPending(state, scenario);
    const pendingD = state.pendingDecisionIds[0];
    const pendingR = state.pendingRightsIds[0];
    const step = pendingR ? `r${scenario.rightsMoments.findIndex((r) => r.id === pendingR)}` : `d${scenario.decisions.findIndex((d) => d.id === pendingD)}`;
    const replayed = replayDare({ seed, path: path.join('.'), step });
    expect(isStepPending(replayed.state, replayed.scenario, step)).toBe(true);
    expect(replayed.state.tick).toBe(state.tick);
    expect(replayed.state.scores).toEqual(state.scores);
    const other = step.startsWith('d') ? `d${(Number(step.slice(1)) + 1) % scenario.decisions.length}` : 'd0';
    expect(() => replayDare({ seed, path: path.join('.'), step: other })).toThrow(/mismatch/);
  });

  it('throws on invalid tokens, like the screen does', () => {
    const { state, scenario } = startLiteGame(5);
    const at = advanceToPending(state, scenario);
    for (const bad of ['x1', 'e999', 'd99-0', 'd0-9', 'r9-0', 'r0-9', 'd0', '']) expect(() => applyToken(at, scenario as Scenario, bad), bad).toThrow();
    expect(() => replayDare({ seed: 5, path: 'zz', step: 'd0' })).toThrow();
  });
});
