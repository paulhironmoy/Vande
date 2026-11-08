// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  CHASE_HISTORY_MAX,
  chaseReducer,
  chaseSeedAt,
  chaseSummary,
  dueBall,
  emptyChaseHistory,
  isChaseSummary,
  isSavedChase,
  lastChaseResult,
  makeChase,
  parseChaseHistory,
  recordChaseResult,
  startChase,
  startChaseInnings,
  type BallRuns,
  type ChaseDifficulty,
  type ChaseState,
  type ChaseSummary,
} from '@/practice/chase';

function finished(
  seed: string,
  difficulty: ChaseDifficulty,
  target: number,
  runs: BallRuns[],
  wicket = false,
): ChaseSummary {
  let s: ChaseState = startChase({ ...makeChase(seed, difficulty)!, target });
  for (const r of runs) s = chaseReducer(s, { type: 'ball', ...dueBall(s.ballsFaced), runs: r, dismissal: null });
  if (wicket) s = chaseReducer(s, { type: 'ball', ...dueBall(s.ballsFaced), runs: 0, dismissal: 'caught' });
  return chaseSummary(s, 'play')!;
}

describe('the local history', () => {
  const won = finished('c001', 'standard', 6, [4, 2]);
  const lost = finished('c001', 'standard', 40, [1], true);
  const lostBalls = finished('c002', 'easy', 30, Array<BallRuns>(12).fill(1));

  it('starts empty and keeps the last result of each chase, newest first', () => {
    let h = emptyChaseHistory();
    expect(h).toEqual({ v: 1, entries: [] });
    h = recordChaseResult(h, won, 1000);
    h = recordChaseResult(h, lostBalls, 2000);
    expect(h.entries.map((e) => `${e.seed}/${e.difficulty}`)).toEqual(['c002/easy', 'c001/standard']);
    // A second attempt at the same chase replaces the first and moves to the front.
    h = recordChaseResult(h, lost, 3000);
    expect(h.entries.map((e) => `${e.seed}/${e.difficulty}/${e.result}`)).toEqual([
      'c001/standard/lost_wicket',
      'c002/easy/lost_balls',
    ]);
    expect(lastChaseResult(h, 'c001', 'standard')).toMatchObject({ result: 'lost_wicket', finishedAtMs: 3000 });
    expect(lastChaseResult(h, 'c001', 'hard')).toBeNull();
    expect(lastChaseResult(h, 'c999', 'easy')).toBeNull();
  });

  it('keeps one entry for a seed at each difficulty separately', () => {
    let h = recordChaseResult(emptyChaseHistory(), finished('c001', 'easy', 4, [6]), 1);
    h = recordChaseResult(h, finished('c001', 'hard', 4, [6]), 2);
    expect(h.entries).toHaveLength(2);
  });

  it('forgets the oldest beyond its limit', () => {
    let h = emptyChaseHistory();
    for (let i = 0; i < CHASE_HISTORY_MAX + 8; i++)
      h = recordChaseResult(h, finished(chaseSeedAt(i), 'standard', 4, [6]), i);
    expect(h.entries).toHaveLength(CHASE_HISTORY_MAX);
    expect(h.entries[0].seed).toBe(chaseSeedAt(CHASE_HISTORY_MAX + 7));
    expect(lastChaseResult(h, chaseSeedAt(0), 'standard')).toBeNull();
  });

  it('does not change the history it is given, and takes the time it is told', () => {
    const h = emptyChaseHistory();
    const frozen = JSON.stringify(h);
    recordChaseResult(h, won, 5);
    expect(JSON.stringify(h)).toBe(frozen);
    expect(recordChaseResult(h, won, Number.NaN).entries[0].finishedAtMs).toBe(0);
    expect(recordChaseResult(h, won, -4).entries[0].finishedAtMs).toBe(0);
  });

  it('comes back from storage as it went in, and survives damage', () => {
    let h = emptyChaseHistory();
    h = recordChaseResult(h, won, 10);
    h = recordChaseResult(h, lost, 20);
    h = recordChaseResult(h, lostBalls, 30);
    expect(parseChaseHistory(JSON.parse(JSON.stringify(h)))).toEqual(h);
    for (const junk of [null, undefined, 7, 'x', [], {}, { v: 1 }, { v: 2, entries: [] }, { v: 1, entries: 'no' }])
      expect(parseChaseHistory(junk)).toEqual(emptyChaseHistory());
    const damaged = JSON.parse(JSON.stringify(h));
    damaged.entries[1].runs = 99; // the c001 entry no longer adds up
    damaged.entries.push({ v: 1, seed: 'c009' }, 12, null);
    const back = parseChaseHistory(damaged);
    expect(back.entries.map((e) => e.seed)).toEqual(['c002']);
    // Undamaged entries keep their order and their times.
    const clean = JSON.parse(JSON.stringify(h));
    clean.entries.push({ v: 1, seed: 'c009' }, 12, null);
    expect(parseChaseHistory(clean)).toEqual(h);
  });
});

describe('a chase summary is only believed when it adds up', () => {
  const good = finished('c003', 'standard', 8, [6, 4]);

  it('accepts a real one and rejects each way of being wrong', () => {
    expect(isChaseSummary(good)).toBe(true);
    const bad: Array<[string, (s: ChaseSummary) => unknown]> = [
      ['version', (s) => ({ ...s, v: 2 })],
      ['seed', (s) => ({ ...s, seed: '' })],
      ['difficulty', (s) => ({ ...s, difficulty: 'insane' })],
      ['target', (s) => ({ ...s, target: 0 })],
      ['result', (s) => ({ ...s, result: 'abandoned' })],
      ['won but short', (s) => ({ ...s, target: 99, runsShort: 0 })],
      ['lost but enough', (s) => ({ ...s, result: 'lost_balls' })],
      ['runs short', (s) => ({ ...s, runsShort: 3 })],
      ['balls left', (s) => ({ ...s, ballsLeft: 3 })],
      ['balls faced', (s) => ({ ...s, ballsFaced: 0 })],
      ['assist', (s) => ({ ...s, assist: 'cheat' })],
      ['deciding ball', (s) => ({ ...s, decidingBall: null })],
      ['deciding ball number', (s) => ({ ...s, decidingBall: { ...s.decidingBall, ballNumber: 5 } })],
      ['deciding ball key', (s) => ({ ...s, decidingBall: { ...s.decidingBall, key: '1:1' } })],
      ['deciding ball runs', (s) => ({ ...s, decidingBall: { ...s.decidingBall, runs: 5 } })],
    ];
    for (const [name, make] of bad) expect(isChaseSummary(make(good)), name).toBe(false);
    expect(isChaseSummary(null)).toBe(false);
    expect(isChaseSummary('won')).toBe(false);
  });

  it('wants a wicket loss to name the way out, and a balls loss to be the 12th ball', () => {
    const w = finished('c003', 'standard', 40, [1], true);
    expect(isChaseSummary(w)).toBe(true);
    expect(isChaseSummary({ ...w, decidingBall: { ...w.decidingBall, dismissal: null } })).toBe(false);
    const b = finished('c003', 'standard', 40, Array<BallRuns>(12).fill(1));
    expect(isChaseSummary(b)).toBe(true);
    expect(isChaseSummary({ ...b, result: 'lost_balls', ballsFaced: 11, ballsLeft: 1 })).toBe(false);
  });
});

describe('a saved chase', () => {
  it('has the shape of one only with a good definition and an innings', () => {
    const definition = makeChase('c004')!;
    const innings = startChaseInnings(definition, { id: 'a', assist: 'play', handedness: 'right' });
    expect(isSavedChase({ v: 1, definition, innings })).toBe(true);
    expect(isSavedChase({ v: 1, definition: { ...definition, target: 0 }, innings })).toBe(false);
    expect(isSavedChase({ v: 1, definition, innings: null })).toBe(false);
    expect(isSavedChase({ v: 2, definition, innings })).toBe(false);
    expect(isSavedChase(null)).toBe(false);
  });
});
