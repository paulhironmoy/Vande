// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@/engine/sha256';
import type { DeliveryOutcome } from '@/contracts/practice';
import { nextDelivery, replayDelivery, repeatDelivery, resolveNext, verifyRecord } from '@/practice/game';
import {
  CHASE_DIFFICULTIES,
  CHASE_SEED_COUNT,
  chaseFromInnings,
  chaseInningsAction,
  chaseInningsReducer,
  chaseSeedAt,
  chaseSituation,
  chaseStep,
  makeChase,
  type BallRuns,
  type ChaseDefinition,
} from '@/practice/chase';
import {
  DEFEND_ALL,
  DEFEND_LATE,
  DRIVE_ALL,
  MIXED,
  makeRecord,
  playChase,
  startRun,
  swingFor,
  syntheticInnings,
  type Batter,
  type PlayedChase,
} from './helpers';
import { BATTERS as ALL_BATTERS } from './batters';

const SEEDS = ['c000', 'c007', 'c101', 'c255'];
const BATTERS: Array<[string, Batter]> = [
  ['drive', DRIVE_ALL],
  ['mixed', MIXED],
];
const everything = (p: PlayedChase) =>
  JSON.stringify({ innings: p.innings, state: p.state, summary: p.summary, records: p.records });
const high = (seed: string): ChaseDefinition => ({ ...makeChase(seed)!, target: 72 });

describe('the same seed and the same inputs give the same chase (FAIR1, FAIR2, SYS2)', () => {
  it('byte for byte: the innings, the chase, the summary and every record', () => {
    for (const seed of SEEDS)
      for (const [name, batter] of BATTERS)
        for (const d of CHASE_DIFFICULTIES) {
          const def = makeChase(seed, d)!;
          const a = playChase(def, batter, { id: 'one' });
          const b = playChase(def, batter, { id: 'one' });
          expect(everything(a), `${seed} ${name} ${d}`).toBe(everything(b));
          expect(sha256Hex(everything(a))).toBe(sha256Hex(everything(b)));
          expect(a.state.result).not.toBe('in_progress');
        }
  });

  it('whichever assistance and hand: each is its own chase, and each repeats exactly', () => {
    for (const assist of ['learn', 'play', 'real'] as const)
      for (const handedness of ['right', 'left'] as const) {
        const def = makeChase('c042')!;
        const a = playChase(def, MIXED, { assist, handedness });
        const b = playChase(def, MIXED, { assist, handedness });
        expect(everything(a), `${assist} ${handedness}`).toBe(everything(b));
      }
  });

  it('every ball of a chase re-simulates to the runs and the wicket it recorded', () => {
    for (const seed of SEEDS) {
      const p = playChase(high(seed), MIXED);
      for (const r of p.records) {
        expect(verifyRecord(r), `${seed} ${r.overIndex}:${r.ballIndex}`).toBe(true);
        const again = replayDelivery(r);
        expect(again.outcome.runs).toBe(r.runs);
        expect(again.outcome.dismissal).toBe(r.dismissal);
      }
    }
  });

  it('the chase read from the saved innings is the chase that was played', () => {
    for (const seed of SEEDS) {
      const def = makeChase(seed)!;
      const p = playChase(def, MIXED);
      const viaJson = chaseFromInnings(def, JSON.parse(JSON.stringify(p.innings)));
      expect(JSON.stringify(viaJson)).toBe(JSON.stringify(p.state));
    }
  });
});

describe("a left-hander faces the mirror image of the right-hander's chase", () => {
  it('with the same swings he gets the same runs, wickets and result on every ball', () => {
    let compared = 0;
    for (const seed of ['c000', 'c006', 'c091', 'c255'])
      for (const [name, batter] of [ALL_BATTERS[3], ALL_BATTERS[6], ALL_BATTERS[14], ALL_BATTERS[15]]) {
        const def = high(seed);
        const r = playChase(def, batter, { id: 'hand', handedness: 'right' });
        const l = playChase(def, batter, { id: 'hand', handedness: 'left' });
        expect(l.records.length, `${seed} ${name}`).toBe(r.records.length);
        l.records.forEach((rec, i) => {
          expect([rec.runs, rec.dismissal], `${seed} ${name} ball ${i + 1}`).toEqual([
            r.records[i].runs,
            r.records[i].dismissal,
          ]);
          // Same ball, other hand: the bowler's arm is the other one and nothing else about the delivery differs.
          expect(rec.plan).toEqual(r.records[i].plan);
          expect(rec.bowler.arm).not.toBe(r.records[i].bowler.arm);
          expect(rec.handedness).toBe('left');
        });
        expect(l.state, `${seed} ${name}`).toEqual(r.state);
        compared++;
      }
    expect(compared).toBe(16);
  });
});

describe('different seeds are different chases', () => {
  it('give different balls and different games', () => {
    const outcomes = new Set<string>();
    const plans = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const def = high(chaseSeedAt(i * 21));
      const p = playChase(def, MIXED);
      plans.add(JSON.stringify(p.records.map((r) => [r.plan, r.seed])));
      outcomes.add(JSON.stringify(p.records.map((r) => [r.runs, r.dismissal])));
    }
    expect(plans.size).toBe(12);
    expect(outcomes.size).toBeGreaterThanOrEqual(5);
  });
});

describe('a chase carries nothing from another (no leaked state)', () => {
  it('two chases played ball by ball in turn come out as each does alone', () => {
    const defA = high('c003');
    const defB = high('c200');
    const aloneA = playChase(defA, MIXED, { id: 'A' });
    const aloneB = playChase(defB, DRIVE_ALL, { id: 'B' });
    const runA = startRun(defA, MIXED, { id: 'A' });
    const runB = startRun(defB, DRIVE_ALL, { id: 'B' });
    for (let guard = 0; guard < 40; guard++) {
      const moreA = runA.step();
      const moreB = runB.step();
      if (!moreA && !moreB) break;
    }
    expect(everything(runA.played())).toBe(everything(aloneA));
    expect(everything(runB.played())).toBe(everything(aloneB));
  });

  it('a lost chase and a won chase leave the next one untouched', () => {
    const before = JSON.stringify(
      Array.from({ length: CHASE_SEED_COUNT }, (_, i) => makeChase(chaseSeedAt(i), 'hard')),
    );
    const first = playChase({ ...makeChase('c010')!, target: 1 }, DRIVE_ALL);
    const second = playChase({ ...makeChase('c010')!, target: 72 }, DEFEND_ALL);
    expect(first.state.result).not.toBe(second.state.result);
    const fresh = playChase(makeChase('c010')!, MIXED);
    // The same chase after a win and a loss elsewhere is the same as the same chase on its own.
    expect(everything(fresh)).toBe(everything(playChase(makeChase('c010')!, MIXED)));
    const after = JSON.stringify(Array.from({ length: CHASE_SEED_COUNT }, (_, i) => makeChase(chaseSeedAt(i), 'hard')));
    expect(after).toBe(before);
  });
});

describe('nothing in a chase adapts to the player (SYS1, FAIR5, CTL8)', () => {
  it('the target of a seed never depends on what has been played', () => {
    const targets = () => CHASE_DIFFICULTIES.map((d) => makeChase('c077', d)!.target);
    const before = targets();
    for (const batter of [DRIVE_ALL, DEFEND_ALL, MIXED]) playChase(makeChase('c077')!, batter);
    expect(targets()).toEqual(before);
  });

  it('the second over, its field and every ball are the same whatever happened in the first', () => {
    // One batter hits a six off every ball of the first over, the other scores nothing; the chase is out of reach
    // for both, so both reach the second over.
    const def = high('c050');
    const great = syntheticInnings(def, Array(6).fill({ runs: 6 }));
    const poor = syntheticInnings(def, Array(6).fill({ runs: 0 }));
    expect(great.runs).toBe(36);
    expect(poor.runs).toBe(0);
    const overTwo = (innings: typeof great) => {
      const after = chaseInningsReducer(def, innings, { type: 'nextOver' });
      const step = chaseStep(def, after);
      if (step.kind !== 'choose_over') throw new Error(step.kind);
      return step.setup;
    };
    expect(JSON.stringify(overTwo(great))).toBe(JSON.stringify(overTwo(poor)));
    // ... and every delivery of it, up to the physics inputs of each ball.
    const balls = (innings: typeof great) => {
      let inn = chaseInningsReducer(def, innings, { type: 'nextOver' });
      inn = chaseInningsReducer(def, inn, chaseInningsAction(def, inn)!);
      const out: unknown[] = [];
      for (let k = 0; k < 6; k++) {
        const next = nextDelivery(inn)!;
        out.push(next);
        inn = chaseInningsReducer(def, inn, { type: 'deliveryStarted' });
        inn = chaseInningsReducer(def, inn, {
          type: 'deliveryResolved',
          record: makeRecord(next, null, 0, { outcome: { runs: 0, dismissal: null } as DeliveryOutcome }),
        });
      }
      return out;
    };
    expect(JSON.stringify(balls(great))).toBe(JSON.stringify(balls(poor)));
    // The same holds when the batters really played the first over, through the physics.
    let compared = 0;
    for (let i = 0; i < 40 && compared < 2; i++) {
      const d = high(chaseSeedAt(i));
      const a = playChase(d, DEFEND_ALL);
      const b = playChase(d, DEFEND_LATE);
      if (a.records.length < 12 || b.records.length < 12) continue;
      compared++;
      const inputs = (p: PlayedChase) => p.records.map(({ swing: _s, runs: _r, dismissal: _d, ...rest }) => rest);
      expect(inputs(a)).toEqual(inputs(b));
    }
    expect(compared).toBe(2);
  });

  it('the same swing at the same ball gives the same result whatever the score is', () => {
    const def = high('c050');
    const resolveBall7 = (first: BallRuns) => {
      let inn = syntheticInnings(def, Array(6).fill({ runs: first }));
      inn = chaseInningsReducer(def, inn, { type: 'nextOver' });
      inn = chaseInningsReducer(def, inn, chaseInningsAction(def, inn)!);
      const next = nextDelivery(inn)!;
      return resolveNext(next, swingFor(next, { kind: 'attack', directionDeg: 20, power: 0.8 }), 0).result;
    };
    expect(JSON.stringify(resolveBall7(6))).toBe(JSON.stringify(resolveBall7(0)));
  });

  it('the situation is read from the score and never feeds back into a ball', () => {
    const def = high('c050');
    const p = playChase(def, MIXED);
    // The situation exists after every ball ...
    expect(chaseSituation(p.state).result).toBe(p.state.result);
    // ... and a ball re-simulated without any knowledge of it gives the recorded result.
    for (const r of p.records) expect(verifyRecord(r)).toBe(true);
  });
});

describe('a replay never changes a chase score', () => {
  it('practising the deciding ball afterwards leaves the finished chase exactly as it was', () => {
    for (const seed of SEEDS) {
      const def = makeChase(seed)!;
      const p = playChase(def, MIXED);
      const frozen = everything(p);
      const deciding = p.records[p.records.length - 1];
      // The practice-only repeat: the same ball with other swings.
      for (const kind of ['attack', 'defend'] as const) {
        const swing = swingFor(deciding, { kind, directionDeg: 30, power: 0.9 });
        const result = repeatDelivery(deciding, swing);
        expect(result.flight.seed).toBe(deciding.seed);
      }
      expect(everything(p)).toBe(frozen);
      expect(JSON.stringify(chaseFromInnings(def, p.innings))).toBe(JSON.stringify(p.state));
    }
  });
});
