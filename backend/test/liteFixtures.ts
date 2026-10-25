/** Builds real Lite dares by playing Chapter 1 with the app's own pure replay (scan every relied clue, best move). */
import { advanceToPending, applyToken, startLiteGame } from '@/lite/replay';
import { bestOf, evaluateAll } from '@/lite/points';

export interface PlayedStep {
  /** The dare a sender would share at this moment. */
  dare: { seed: number; path: string; step: string; deadline: number };
  /** Clue scans available before answering (tokens), and every answer token for the step. */
  scans: string[];
  answers: string[];
  /** The best answer token (for decisions: after the scans). */
  bestAnswer: string;
}

export const FIXTURE_DEADLINE = Math.floor(Date.UTC(2026, 9, 27) / 1000);

/** Every question of one full Chapter 1 run, in order, with the dare that would reach it. */
export function playChapter(seed: number): PlayedStep[] {
  const game = startLiteGame(seed);
  const { scenario } = game;
  let state = game.state;
  const path: string[] = [];
  const steps: PlayedStep[] = [];
  for (let guard = 0; guard < 40; guard++) {
    state = advanceToPending(state, scenario);
    if (state.status === 'ended') break;
    const rid = state.pendingRightsIds[0];
    if (rid) {
      const ri = scenario.rightsMoments.findIndex((r) => r.id === rid);
      const rm = scenario.rightsMoments[ri];
      const oi = Math.max(0, rm.options.findIndex((o) => o.correct));
      steps.push({ dare: { seed, path: path.join('.'), step: `r${ri}`, deadline: FIXTURE_DEADLINE }, scans: [], answers: rm.options.map((_, i) => `r${ri}-${i}`), bestAnswer: `r${ri}-${oi}` });
      state = applyToken(state, scenario, `r${ri}-${oi}`);
      path.push(`r${ri}-${oi}`);
      continue;
    }
    const did = state.pendingDecisionIds[0];
    const di = scenario.decisions.findIndex((d) => d.id === did);
    const d = scenario.decisions[di];
    const dare = { seed, path: path.join('.'), step: `d${di}`, deadline: FIXTURE_DEADLINE };
    const scans: string[] = [];
    for (const o of d.options)
      for (const evId of o.requiresEvidence ?? []) {
        const ei = scenario.evidence.findIndex((e) => e.id === evId);
        const es = state.evidence[evId];
        if (ei >= 0 && es?.visible && !es.destroyed && !scans.includes(`e${ei}`)) scans.push(`e${ei}`);
      }
    for (const s of scans) state = applyToken(state, scenario, s);
    const evals = evaluateAll(state, scenario, d);
    const best = bestOf(evals);
    const token = `d${di}-${best.index}`;
    steps.push({ dare, scans, answers: d.options.map((_, i) => `d${di}-${i}`), bestAnswer: token });
    path.push(...scans, token);
    state = applyToken(state, scenario, token);
  }
  return steps;
}
