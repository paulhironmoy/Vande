/**
 * The lesson changes pacing before the delivery and nothing else (LES-04, FAIR1/FAIR2/SYS1/SYS2 style), on the REAL
 * physics: the reference over (its six balls, as many as the innings lets be bowled) under four different swings, played
 * three ways: with the lesson shown and "Bowl the first ball" chosen, with the lesson skipped ("Skip all teaching"), and with
 * no lesson at all (a returning player). Every delivery's flight, record, result (bat and ball samples included) and the
 * score are bit-identical across the three. The lesson's own modules import nothing from the physics.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedSwing } from '@/contracts';
import { normalizeGesture, pointerIsDown, resolveCalibrations } from '@/input';
import { autoField, batTravelMs, fieldIntent, flight, regionOf, resolveDelivery } from '@/physics';
import {
  REFERENCE_BALLS,
  REFERENCE_OVER,
  ballSeed,
  coachingFacts,
  inningsReducer,
  inningsSummary,
  makeRecord,
  newInnings,
  nextDelivery,
  overSummary,
  randomOver,
  repeatDelivery,
  replayDelivery,
  resumeInnings,
} from '@/practice/game';
import { memoryStore, updatePracticeSettings } from '@/practice/store';
import { PracticeFlow } from '@/practice/ui/flow/controller';
import type { PracticeEngine } from '@/practice/ui/flow/types';
import { assessment, stageFactory } from '../fakes';
import { until, useFakeTimers } from '../flowSetup';

beforeEach(useFakeTimers);
afterEach(() => vi.useRealTimers());

/** The same engine ports.ts binds: the real physics and the real innings rules. */
const engine: PracticeEngine = {
  flight,
  resolveDelivery,
  autoField,
  fieldIntent,
  regionOf,
  randomOver: ({ seed, conditions, assist, difficulty, family }) =>
    randomOver({ seed, conditions, assist, family, difficulty }),
  referenceOver: () => REFERENCE_OVER,
  referenceBalls: () => REFERENCE_BALLS,
  ballSeed,
  newInnings,
  inningsReducer,
  resumeInnings,
  nextDelivery,
  makeRecord,
  replayDelivery,
  repeatDelivery: (record, swing) => repeatDelivery(record, swing),
  overSummary,
  inningsSummary,
  coachingFacts,
  normalizeGesture,
  resolveCalibrations: (set) => resolveCalibrations(set),
  pointerIsDown,
};

type Way = 'lesson_bowl' | 'lesson_skipped' | 'no_lesson';
const WAYS: Way[] = ['lesson_bowl', 'lesson_skipped', 'no_lesson'];

/** Eight swings (a leave, defences, drives, a lofted pull, each timed to its own ball): every ball of the over is met by several. */
const SWINGS: Array<{ name: string; make: (idealContactT: number) => NormalizedSwing | 'leave' }> = [
  { name: 'leave', make: () => 'leave' },
  {
    name: 'defend',
    make: (t) => ({
      kind: 'defend',
      startT: t - batTravelMs('defend', 0.2) / 1000,
      directionDeg: 0,
      power: 0.2,
      elevation: 0,
      footwork: 'auto',
    }),
  },
  {
    name: 'drive',
    make: (t) => ({
      kind: 'attack',
      startT: t - batTravelMs('attack', 0.7) / 1000,
      directionDeg: 8,
      power: 0.7,
      elevation: 0,
      footwork: 'auto',
    }),
  },
  {
    name: 'defend, 12 ms early',
    make: (t) => ({
      kind: 'defend',
      startT: t - batTravelMs('defend', 0.2) / 1000 - 0.012,
      directionDeg: 0,
      power: 0.2,
      elevation: 0,
      footwork: 'auto',
    }),
  },
  {
    name: 'defend, 12 ms late',
    make: (t) => ({
      kind: 'defend',
      startT: t - batTravelMs('defend', 0.2) / 1000 + 0.012,
      directionDeg: 0,
      power: 0.2,
      elevation: 0,
      footwork: 'auto',
    }),
  },
  {
    name: 'drive, 15 ms early',
    make: (t) => ({
      kind: 'attack',
      startT: t - batTravelMs('attack', 0.7) / 1000 - 0.015,
      directionDeg: 8,
      power: 0.7,
      elevation: 0,
      footwork: 'auto',
    }),
  },
  {
    name: 'cut to the off side',
    make: (t) => ({
      kind: 'attack',
      startT: t - batTravelMs('attack', 0.6) / 1000,
      directionDeg: 70,
      power: 0.6,
      elevation: 0,
      footwork: 'auto',
    }),
  },
  {
    name: 'lofted pull, 25 ms late',
    make: (t) => ({
      kind: 'attack',
      startT: t - batTravelMs('attack', 0.9) / 1000 + 0.025,
      directionDeg: -55,
      power: 0.9,
      elevation: 0.8,
      footwork: 'auto',
    }),
  },
];

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Plays the reference over (and on, until the over or the innings ends) one way; returns each ball's hashes. */
async function play(way: Way, swing: (typeof SWINGS)[number]) {
  const store = memoryStore();
  updatePracticeSettings({ teach: true, demoSeen: true, lessonSeen: way === 'no_lesson' }, store);
  const hashes: Array<{ flight: string; record: string; result: string; runs: number }> = [];
  const flow = new PracticeFlow({
    engine,
    coach: null,
    createStage: stageFactory(store),
    appVersion: 'test',
    store,
    benchmark: async () => assessment('full'),
    hooks: {
      takeSwing: (f) => {
        hashes.push({ flight: sha(JSON.stringify(f)), record: '', result: '', runs: 0 });
        return swing.make(f.idealContactT);
      },
    },
    newSeed: () => 'no-change',
    newId: () => 'inn',
    isLandscape: () => true,
    frameSampler: () => ({ start() {}, stop() {}, running: false }),
    lesson: way === 'no_lesson' ? undefined : { input: () => 'mouse' as const },
  });
  let canvas = -1;
  flow.subscribe(() => {
    const k = flow.getState().canvasKey;
    if (k !== canvas) {
      canvas = k;
      flow.attachCanvas(document.createElement('canvas'));
    }
  });
  flow.attachCanvas(document.createElement('canvas'));
  flow.init();
  flow.prepareOver({ kind: 'reference' });
  await until(() => flow.getState().stageReady);
  void flow.play();
  if (way !== 'no_lesson') {
    await until(() => flow.getState().phase === 'lesson');
    // Nothing is bowled while the card is open.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(hashes).toHaveLength(0);
    if (way === 'lesson_bowl') flow.lessonEvent({ type: 'bowl' });
    else flow.skipTeaching(true);
  }
  for (let ball = 0; ball < 6; ball++) {
    await until(() => flow.getState().phase === 'dead');
    const last = flow.getState().last!;
    const h = hashes[ball];
    h.record = sha(JSON.stringify(last.record));
    h.result = sha(JSON.stringify(last.result));
    h.runs = flow.getState().innings!.runs;
    if (flow.getState().innings!.status !== 'batting') break;
    flow.nextBall();
    if (ball < 5) await until(() => flow.getState().phase !== 'dead');
  }
  const out = { hashes, score: flow.getState().innings!.runs, status: flow.getState().innings!.status };
  flow.dispose();
  return out;
}

describe('the same ball, the same swing: the lesson never changes the delivery (real physics)', () => {
  let compared = 0;
  /** How many of the swings reached each of the six balls (an innings ends at its first wicket). */
  const coverage = [0, 0, 0, 0, 0, 0];
  for (const swing of SWINGS)
    it(`${swing.name}: flight, record, result and score are bit-identical shown, skipped and absent`, async () => {
      const ref = await play('no_lesson', swing);
      expect(ref.hashes.length).toBeGreaterThanOrEqual(1);
      for (const way of WAYS.slice(0, 2)) {
        const other = await play(way, swing);
        expect(other.hashes, way).toEqual(ref.hashes);
        expect(other.score, way).toBe(ref.score);
        expect(other.status, way).toBe(ref.status);
      }
      compared += ref.hashes.length * 3;
      for (let i = 0; i < ref.hashes.length; i++) coverage[i]++;
    }, 240_000);

  it('every one of the six reference balls was compared under at least four swings, and 24 or more deliveries in all', () => {
    expect(
      coverage.every((n) => n >= 4),
      `balls reached per swing: ${coverage.join(',')}`,
    ).toBe(true);
    expect(compared / 3).toBeGreaterThanOrEqual(24);
    console.info(
      `LES-04: ${compared} deliveries compared (${compared / 3} per way) across lesson shown, skipped and absent; swings reaching ball 1 to 6: ${coverage.join(', ')}`,
    );
  });
});

describe('the lesson imports nothing from the physics', () => {
  it('no lesson module imports @/physics (the bands reach the card through the kit, as numbers)', () => {
    const dir = join(__dirname, '../../../../../src/practice/ui/lesson');
    for (const f of readdirSync(dir).filter((n) => /\.(ts|tsx)$/.test(n)))
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/from '@\/physics|from '\.\.\/\.\.\/\.\.\/physics/);
  });
});
