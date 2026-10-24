import { DIMENSIONS, type Dimension, type GameState, type Pulse, type Scores } from './types';
import { clamp01, round1 } from './state';

const WINDOW = 15;

function meanOf(s: Scores): number {
  let sum = 0;
  for (const d of DIMENSIONS) sum += s[d];
  return sum / DIMENSIONS.length;
}

/** Sample at or before `tick - WINDOW`, else the earliest sample. */
function reference(state: GameState): Scores {
  const target = state.tick - WINDOW;
  let ref = state.history[0]?.scores ?? state.scores;
  for (const sample of state.history) {
    if (sample.tick <= target) ref = sample.scores;
    else break;
  }
  return ref;
}

export function derivePulse(state: GameState): Pulse {
  const scores = state.scores;
  const values = DIMENSIONS.map((d) => scores[d]);
  const mean = meanOf(scores);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const closeness = 1 - Math.min(1, (max - min) / 60);
  const health = clamp01(mean / 100);
  const balance = clamp01(0.6 * closeness + 0.4 * health);

  const ref = reference(state);
  const momentum = {} as Scores;
  for (const d of DIMENSIONS) momentum[d] = round1(scores[d] - ref[d]);

  // Volatility: spread of consecutive changes of the mean over the last ~30 ticks.
  const recent = state.history.slice(-7);
  const deltas: number[] = [];
  for (let i = 1; i < recent.length; i++) deltas.push(meanOf(recent[i].scores) - meanOf(recent[i - 1].scores));
  if (recent.length) deltas.push(mean - meanOf(recent[recent.length - 1].scores));
  const avg = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
  const variance = deltas.length ? deltas.reduce((a, b) => a + (b - avg) ** 2, 0) / deltas.length : 0;
  const volatility = Math.sqrt(variance);
  const incidents = Object.values(state.districts).filter((d) => d.incident).length;
  const instability = clamp01(volatility / 4 + incidents * 0.15 + (min < 35 ? 0.15 : 0));

  const trend = mean - meanOf(ref);
  const direction: Pulse['direction'] = trend > 1.5 ? 'rising' : trend < -1.5 ? 'falling' : 'steady';

  let weakest: Dimension = DIMENSIONS[0];
  let strongest: Dimension = DIMENSIONS[0];
  for (const d of DIMENSIONS) {
    if (scores[d] < scores[weakest]) weakest = d;
    if (scores[d] > scores[strongest]) strongest = d;
  }
  return { balance: round1(balance * 100) / 100, momentum, instability: round1(instability * 100) / 100, direction, mean: round1(mean), weakest, strongest };
}
