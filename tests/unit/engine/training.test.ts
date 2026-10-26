// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BattingInput, DeliveryVariant, InputTrace, OverPlan } from '@/contracts';
import { canonicalJson, engine } from '@/engine';
import { rngFromKey } from '@/engine/prng';
import {
  buildTrainingLog,
  newTrainingSeed,
  TRAINING_CONDITIONS,
  TRAINING_GHOST_ID,
  TRAINING_LESSON,
  trainingCoachOver,
  trainingCoachRef,
  trainingPlan,
  trainingAutoBalls,
  trainingSetup,
  type TrainingDelivery,
  type TrainingSetup,
} from '@/engine/training';
import { battingInputFor } from '@/engine/v1/policies';
import { ALLOWED_LENGTHS, INTENSITIES, INTENTS, LINES, STARTER_VARIANTS } from '@/engine/v1/tables';
import { executionQuality, synthExecutionTrace } from '@/engine/v1/traces';
import { clone, hexSeed, PLAYERS, randomInput } from './helpers';

const legal = (plan: OverPlan) => engine.validatePlan(plan, STARTER_VARIANTS);
const COACH = trainingCoachRef('Coach', PLAYERS[1].kit);
const setupFor = (key: string) => trainingSetup(hexSeed(rngFromKey(`test/training|${key}`)));
const gesture = (key: string, release: number): InputTrace => synthExecutionTrace(rngFromKey(`test/training/gesture|${key}`), release);

/** What the bat step does (localInnings with maxBalls 1): reveal ball 1 of the coach's over, validate, resolve. */
function batFirstBall(setup: TrainingSetup, input: (d: ReturnType<typeof engine.revealDelivery>) => BattingInput | null) {
  const d = engine.revealDelivery(setup.coachOver, 0, setup.conditions);
  const raw = input(d);
  const checked = raw ? engine.validateBattingInput(raw, d) : null;
  const valid = checked && checked.ok ? checked.input : null;
  const r = engine.resolveNextBall(engine.startInnings(0), { seed: setup.seed, conditions: setup.conditions, plan: setup.coachOver, input: valid });
  return { inputs: [valid], outcome: r.outcome };
}

describe('training set-up', () => {
  it('uses the friendliest ghost, hard/clear conditions and a fresh 128-bit seed', () => {
    const a = trainingSetup();
    const b = trainingSetup();
    expect(a.seed).toMatch(/^[0-9a-f]{32}$/);
    expect(newTrainingSeed()).toMatch(/^[0-9a-f]{32}$/);
    expect(a.seed).not.toBe(b.seed);
    expect(a.conditions).toEqual(TRAINING_CONDITIONS);
    expect(a.ghostId).toBe(TRAINING_GHOST_ID);
    expect(engine.GHOSTS.find((g) => g.id === TRAINING_GHOST_ID)?.difficulty).toBe(1);
    expect(COACH).toMatchObject({ id: `ghost_${TRAINING_GHOST_ID}`, kind: 'ghost' });
  });

  it("the coach's over is legal with the starter variants, fixed, and opens with a half-volley", () => {
    const over = trainingCoachOver();
    expect(legal(over).ok).toBe(true);
    expect(canonicalJson(trainingSetup().coachOver)).toBe(canonicalJson(over));
    for (const d of [...over.balls, over.superBall]) expect(STARTER_VARIANTS).toContain(d.variant);
    const first = engine.revealDelivery(over, 0, TRAINING_CONDITIONS);
    expect([first.length, first.line, first.intensity]).toEqual(['full', 'off', 1]);
    const q = executionQuality(over.balls[0].gesture);
    expect(q.ok && q.grade).toBe('good');
  });

  it('a well-timed drive at the first ball is rewarded and rarely out', () => {
    let runs = 0;
    let wickets = 0;
    for (let k = 0; k < 200; k++) {
      const rng = rngFromKey(`test/training/drive|${k}`);
      const setup = trainingSetup(hexSeed(rng));
      const { outcome } = batFirstBall(setup, (d) => battingInputFor(rng, d, 'drive', 'mid_off', d.timing.releaseToContactMs + rng.normal() * 40));
      runs += outcome.runs;
      wickets += outcome.wicket ? 1 : 0;
    }
    expect(runs / 200).toBeGreaterThan(1.5);
    expect(wickets / 200).toBeLessThan(0.08);
  });
});

describe('training lesson plans', () => {
  it('every suggested lesson ball makes a legal over, with any gesture or none', () => {
    const gestures: Array<InputTrace | null> = [
      gesture('early', 690),
      gesture('sweet', 800),
      gesture('late', 905),
      null,
      { pointer: 'touch', samples: [] },
      { pointer: 'touch', samples: [[0, 0.5, 0.9], [20, 0.5, 0.8]] },
    ];
    for (const [name, choice] of Object.entries(TRAINING_LESSON.choices)) {
      expect(choice.variant).toBe(name);
      for (const [gi, g] of gestures.entries()) {
        for (let s = 0; s < 5; s++) {
          const seed = `seed-${s}`;
          const plan = trainingPlan(choice, g, seed);
          expect(legal(plan).ok, `${name} gesture ${gi} seed ${s}`).toBe(true);
          expect({ ...plan.balls[0], gesture: undefined }).toEqual({ ...choice, gesture: undefined });
          if (g && executionQuality(g).ok) expect(plan.balls[0].gesture).toBe(g);
          else expect(executionQuality(plan.balls[0].gesture).ok).toBe(true);
          expect(plan.field).toBe(TRAINING_LESSON.field);
        }
      }
    }
  });

  it('any starter delivery is legal as the lesson ball (every line, allowed length, intensity and intent)', () => {
    let n = 0;
    for (const variant of STARTER_VARIANTS)
      for (const line of LINES)
        for (const length of ALLOWED_LENGTHS[variant])
          for (const intensity of INTENSITIES)
            for (const intent of INTENTS) {
              const plan = trainingPlan({ variant, line, length, intensity, intent }, gesture(`${n}`, 760 + (n % 80)), `any-${n}`);
              expect(legal(plan).ok).toBe(true);
              n++;
            }
    expect(n).toBeGreaterThan(200);
  });

  it('a gesture copied from another ball of the over is replaced, so the over stays legal', () => {
    const base = trainingPlan(TRAINING_LESSON.choices.good_length, null, 'copy');
    const copied = base.balls[1].gesture;
    const plan = trainingPlan(TRAINING_LESSON.choices.good_length, copied, 'copy');
    expect(legal(plan).ok).toBe(true);
    expect(plan.balls[0].gesture).not.toEqual(copied);
  });

  it('the ordinary releases never look superhuman, even next to a perfect lesson release', () => {
    for (let s = 0; s < 300; s++) expect(legal(trainingPlan(TRAINING_LESSON.choices.yorker, gesture(`perfect-${s}`, 800), `superhuman-${s}`)).ok).toBe(true);
  });

  it('is deterministic for a seed and refuses non-starter or illegal lesson balls', () => {
    const g = gesture('det', 812);
    expect(canonicalJson(trainingPlan(TRAINING_LESSON.choices.offspin, g, 'x'))).toBe(canonicalJson(trainingPlan(TRAINING_LESSON.choices.offspin, g, 'x')));
    expect(canonicalJson(trainingPlan(TRAINING_LESSON.choices.offspin, g, 'x'))).not.toBe(canonicalJson(trainingPlan(TRAINING_LESSON.choices.offspin, g, 'y')));
    for (const variant of ['inswing', 'outswing', 'slower', 'legspin'] as DeliveryVariant[]) {
      expect(() => trainingPlan({ ...TRAINING_LESSON.choices.good_length, variant }, g, 'x')).toThrow(/not a starter/);
    }
    const bad: TrainingDelivery = { ...TRAINING_LESSON.choices.yorker, length: 'short' };
    expect(() => trainingPlan(bad, g, 'x')).toThrow(/not legal/);
  });
});

describe('buildTrainingLog', () => {
  const lessonFor = (setup: TrainingSetup, k: number) => {
    const choices = Object.values(TRAINING_LESSON.choices);
    return trainingPlan(choices[k % choices.length], k % 3 === 0 ? null : gesture(`lesson-${k}`, 740 + ((k * 37) % 130)), setup.seed);
  };

  it('verifies with the bat step’s real input, and every plan in it is legal', async () => {
    for (let k = 0; k < 24; k++) {
      const rng = rngFromKey(`test/training/log|${k}`);
      const setup = setupFor(`log-${k}`);
      const bat = batFirstBall(setup, (d) => (k % 7 === 6 ? null : randomInput(rng, d, 50)));
      const plan = lessonFor(setup, k);
      const log = await buildTrainingLog({ setup, player: PLAYERS[0], coach: COACH, plan, inputs: bat.inputs, finish: k % 2 ? 'leave' : 'auto', hour: '2026-10-25T09:00Z' });
      expect(await engine.verifyMatchLog(log)).toEqual({ ok: true });
      expect(await engine.verifyMatchLog(clone(log))).toEqual({ ok: true });
      expect(log.kind).toBe('training');
      expect(log.seed).toBe(setup.seed);
      expect(log.players).toEqual([PLAYERS[0], COACH]);
      for (const p of log.plans) expect(legal(p).ok).toBe(true);
      expect(log.plans[1]).toEqual(setup.coachOver);
      for (const c of log.commits) {
        expect(c.salt).toMatch(/^[0-9a-f]{32}$/);
        expect(c.hash).toBe(await engine.commitHash(log.plans[c.player], c.salt as string));
      }
      expect(log.commits[0].salt).not.toBe(log.commits[1].salt);
      // The first ball in the log is exactly the ball the player saw in the bat step.
      const first = log.innings[0].balls[0];
      expect([first.ball, first.runs, first.wicket, first.timing, first.contact]).toEqual([0, bat.outcome.runs, bat.outcome.wicket, bat.outcome.timing, bat.outcome.contact]);
      // The coach's answer to the lesson ball.
      expect(log.innings[1].balls[0].ball).toBe(0);
      expect(log.innings[1].batter).toBe(1);
    }
  });

  it('verifies when the player bats the whole innings, and with an input for the wrong ball', async () => {
    const setup = setupFor('whole');
    const rng = rngFromKey('test/training/whole');
    const inputs = [0, 1, 2, 3, 4, 5, 6].map((b) => randomInput(rng, engine.revealDelivery(setup.coachOver, b, setup.conditions), 45));
    const plan = trainingPlan(TRAINING_LESSON.choices.bouncer, gesture('whole', 790), setup.seed);
    const whole = await buildTrainingLog({ setup, player: PLAYERS[0], coach: COACH, plan, inputs });
    expect(await engine.verifyMatchLog(whole)).toEqual({ ok: true });
    expect(whole.inputs[0].map((i) => i.ball)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const wrong = await buildTrainingLog({ setup, player: PLAYERS[0], coach: COACH, plan, inputs: [inputs[3]], finish: 'leave' });
    expect(await engine.verifyMatchLog(wrong)).toEqual({ ok: true });
    expect(wrong.innings[0].balls[0].timing).toBe('interrupted');
  });

  it("'leave' leaves the rest unanswered (safe dots); 'auto' bats it with Auto XI", async () => {
    const setup = setupFor('finish');
    const plan = trainingPlan(TRAINING_LESSON.choices.good_length, null, setup.seed);
    const left = await buildTrainingLog({ setup, player: PLAYERS[0], coach: COACH, plan, inputs: [], finish: 'leave' });
    expect(await engine.verifyMatchLog(left)).toEqual({ ok: true });
    const mine = [...left.innings[0].balls, left.superBall.outcomes?.[0]];
    expect(mine.map((b) => b?.timing)).toEqual(Array(mine.length).fill('interrupted'));
    expect([left.innings[0].runs, left.innings[0].wickets]).toEqual([0, 0]);
    expect(left.inputs[0]).toEqual([]);
    const auto = await buildTrainingLog({ setup, player: PLAYERS[0], coach: COACH, plan, inputs: [] });
    expect(await engine.verifyMatchLog(auto)).toEqual({ ok: true });
    expect(auto.inputs[0].length).toBeGreaterThan(0);
  });

  it('is deterministic for fixed salts; fresh salts change only the commits', async () => {
    const setup = setupFor('det');
    const plan = trainingPlan(TRAINING_LESSON.choices.yorker, gesture('det-log', 821), setup.seed);
    const args = { setup, player: PLAYERS[0], coach: COACH, plan, inputs: batFirstBall(setup, () => null).inputs };
    const a = await buildTrainingLog({ ...args, salts: ['salt-a', 'salt-b'] });
    const b = await buildTrainingLog({ ...args, salts: ['salt-a', 'salt-b'] });
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    const c = await buildTrainingLog(args);
    expect(c.commits[0].hash).not.toBe(a.commits[0].hash);
    expect(c.innings).toEqual(a.innings);
    expect(c.events).toEqual(a.events);
    expect(a.meta).toEqual({ createdHour: '2026-01-01T00:00Z', revealedHour: '2026-01-01T00:00Z' });
  });

  it('a tampered training log fails verification', async () => {
    const setup = setupFor('tamper');
    const plan = trainingPlan(TRAINING_LESSON.choices.offspin, gesture('tamper', 777), setup.seed);
    const log = await buildTrainingLog({ setup, player: PLAYERS[0], coach: COACH, plan, inputs: [] });
    const runs = clone(log);
    runs.innings[0].runs += 4;
    expect((await engine.verifyMatchLog(runs)).ok).toBe(false);
    const over = clone(log);
    over.plans[0].balls[1].line = over.plans[0].balls[1].line === 'leg' ? 'off' : 'leg';
    const r = await engine.verifyMatchLog(over);
    expect(r.ok === false && r.errors).toContain('commit0.hash_mismatch');
  });

  it('refuses an over that is not legal with the starter variants', async () => {
    const setup = setupFor('illegal');
    const plan = trainingPlan(TRAINING_LESSON.choices.good_length, null, setup.seed);
    const locked: OverPlan = { ...plan, balls: plan.balls.map((b, i) => (i === 2 ? { ...b, variant: 'inswing' as const } : b)) as OverPlan['balls'] };
    await expect(buildTrainingLog({ setup, player: PLAYERS[0], coach: COACH, plan: locked, inputs: [] })).rejects.toThrow(/not legal/);
    const heavy: OverPlan = { ...plan, balls: plan.balls.map((b) => ({ ...b, variant: 'yorker' as const, length: 'full' as const })) as OverPlan['balls'] };
    await expect(buildTrainingLog({ setup, player: PLAYERS[0], coach: COACH, plan: heavy, inputs: [] })).rejects.toThrow(/energy_over_budget/);
  });
});

describe('trainingAutoBalls', () => {
  it('finds the balls Auto XI batted and the lesson bowled, from the log alone', async () => {
    const setup = setupFor('auto');
    const plan = trainingPlan(TRAINING_LESSON.choices.bouncer, gesture('auto', 790), setup.seed);
    const rng = rngFromKey('test/training/auto');
    const bat = batFirstBall(setup, (d) => randomInput(rng, d, 50));
    const auto = await buildTrainingLog({ setup, player: PLAYERS[0], coach: COACH, plan, inputs: bat.inputs });
    // Ball 1 is the player's own; Auto XI batted the rest (dead balls and the Super Ball included).
    expect(trainingAutoBalls(clone(auto))).toEqual({ batted: [1, 2, 3, 4, 5, 6], bowled: [1, 2, 3, 4, 5, 6] });
    const left = await buildTrainingLog({ setup, player: PLAYERS[0], coach: COACH, plan, inputs: bat.inputs, finish: 'leave' });
    expect(trainingAutoBalls(left).batted).toEqual([]);
    const whole = [0, 1, 2, 3, 4, 5, 6].map((b) => randomInput(rng, engine.revealDelivery(setup.coachOver, b, setup.conditions), 45));
    expect(trainingAutoBalls(await buildTrainingLog({ setup, player: PLAYERS[0], coach: COACH, plan, inputs: whole })).batted).toEqual([]);
    // Not a training log, or a hand-made over: nothing is labelled.
    expect(trainingAutoBalls({ ...auto, kind: 'duel' })).toEqual({ batted: [], bowled: [] });
    const custom = { ...plan, balls: plan.balls.map((b, i) => (i === 2 ? { ...b, gesture: gesture('custom', 777) } : b)) as OverPlan['balls'] };
    expect(trainingAutoBalls(await buildTrainingLog({ setup, player: PLAYERS[0], coach: COACH, plan: custom, inputs: [] })).bowled).toEqual([1, 3, 4, 5, 6]);
  });
});

describe('training stays lean', () => {
  const sources = import.meta.glob<string>('/src/engine/**/*.ts', { query: '?raw', import: 'default', eager: true });
  /** Runtime imports only (type-only imports are erased). */
  const runtimeImports = (code: string): string[] => {
    const out: string[] = [];
    for (const m of code.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) if (!m[1]) out.push(m[2]);
    return out;
  };
  const resolve = (from: string, spec: string): string | null => {
    let p: string;
    if (spec.startsWith('@/')) p = `/src/${spec.slice(2)}`;
    else if (spec.startsWith('.')) {
      const parts = from.split('/').slice(0, -1);
      for (const s of spec.split('/')) {
        if (s === '..') parts.pop();
        else if (s !== '.') parts.push(s);
      }
      p = parts.join('/');
    } else return null;
    for (const c of [`${p}.ts`, `${p}/index.ts`, p]) if (c in sources) return c;
    return p;
  };

  it('pulls in no ranking, simulation, registry, verifier or daily code', () => {
    const seen = new Set<string>();
    const queue = ['/src/engine/training.ts'];
    while (queue.length) {
      const f = queue.pop() as string;
      if (seen.has(f)) continue;
      seen.add(f);
      const code = sources[f];
      if (code === undefined) continue;
      for (const spec of runtimeImports(code)) {
        const r = resolve(f, spec);
        if (r) queue.push(r);
      }
    }
    const engineFiles = [...seen].filter((f) => f.startsWith('/src/engine/'));
    expect(engineFiles).toContain('/src/engine/v1/match.ts');
    for (const f of engineFiles) expect(f).not.toMatch(/\/(ranking|registry|index)\.ts$|\/sim\/|\/v1\/(verify|daily|performance)\.ts$/);
    expect([...seen].filter((f) => !f.startsWith('/src/engine/') && !f.startsWith('/src/contracts/'))).toEqual([]);
  });
});
