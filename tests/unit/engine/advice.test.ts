// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BattingInput, Conditions, InningsState, MatchEventLog, OverPlan, PitchId } from '@/contracts';
import { autoXiSeed, engine } from '@/engine';
import { ADVICE, overSummary, PITCH_ADVICE, pitchHints, pitchKind, UNLOCKS, unlocksEarned, unlockHint, type OverShape } from '@/engine/advice';
import { rngFromKey } from '@/engine/prng';
import { ARCHETYPES, optimisedSpec, overValue, randomOverSpec, type OverSpec } from '@/engine/sim/harness';
import { energyCost } from '@/engine/v1/plan';
import { bowlingChoice, optionRange, wicketCost } from '@/engine/v1/performance';
import { ALLOWED_LENGTHS, FIELD_SETTINGS, INTENSITIES, LINES, STARTER_VARIANTS, VARIANTS } from '@/engine/v1/tables';
import en from '@/i18n/engine/en.json';
import { CONDITIONS, hexSeed, logFor, randomInput, randomMatch, randomPlan, type PlayedMatch } from './helpers';

const PITCHES: PitchId[] = ['green', 'hard', 'slow'];
const WEATHERS = ['clear', 'humid', 'dew'] as const;
const hasKey = (key: string) => Object.prototype.hasOwnProperty.call(en, key);
const keysOf = (s: { reads: Array<{ key: string }> }) => s.reads.map((r) => r.key);
const neutral = (k: number) => ({ ball: k, superBall: false, lastBall: k >= 5, newBatter: k === 0, prev: null, repeats: 0 });

describe('unlock hints and rules', () => {
  it('every delivery beyond the starters has an achievement and copy; starters have none', () => {
    expect(Object.keys(UNLOCKS).sort()).toEqual(VARIANTS.filter((v) => !STARTER_VARIANTS.includes(v)).sort());
    for (const v of VARIANTS) {
      const hint = unlockHint(v);
      if (STARTER_VARIANTS.includes(v)) expect(hint).toBeNull();
      else expect(hint && hasKey(hint.key)).toBe(true);
    }
    expect(hasKey('advice.unlock.where')).toBe(true);
    // Earned in play, never bought: the copy says so and names no price.
    expect(en['advice.unlock.where']).toMatch(/never be bought/);
  });

  it('a bowler earns exactly what their over did, in official matches only', async () => {
    let seen = { caught: 0, stumps: 0, spin: 0, tight: 0, none: 0 };
    for (let k = 0; k < 60; k++) {
      const log = await logFor(randomMatch(`unlock|${k}`));
      for (const bowler of [0, 1] as const) {
        const inn = log.innings.find((i) => i.bowler === bowler)!;
        const wickets = inn.balls.filter((o) => o.wicket && o.wicket !== 'run_out');
        const expected = new Set<string>();
        if (wickets.some((o) => o.wicket === 'caught')) expected.add('outswing');
        if (wickets.some((o) => o.wicket === 'bowled' || o.wicket === 'lbw')) expected.add('inswing');
        if (wickets.some((o) => o.delivery.variant === 'offspin')) expected.add('legspin');
        if (inn.runs <= 6) expected.add('slower');
        expect(new Set(unlocksEarned(log, bowler))).toEqual(expected);
        seen = { caught: seen.caught + Number(expected.has('outswing')), stumps: seen.stumps + Number(expected.has('inswing')), spin: seen.spin + Number(expected.has('legspin')), tight: seen.tight + Number(expected.has('slower')), none: seen.none + Number(expected.size === 0) };
      }
      for (const kind of ['ghost', 'training', 'daily'] as const) expect(unlocksEarned({ ...log, kind }, 0)).toEqual([]);
      expect(unlocksEarned({ ...log, kind: 'cup' }, 0)).toEqual(unlocksEarned(log, 0));
      // An Auto Over earns its owner nothing.
      expect(unlocksEarned({ ...log, commits: [{ ...log.commits[0], auto: true }, log.commits[1]] }, 0)).toEqual([]);
    }
    // The sample exercised every rule.
    expect(Math.min(seen.caught, seen.stumps, seen.tight, seen.none)).toBeGreaterThan(0);
  });

  it('run-outs and balls Auto XI batted never count', async () => {
    // Player 0 misses the batting deadline from the first ball: Auto XI bats all of innings 0 against player 1.
    const rng = rngFromKey('test/advice/auto');
    const conditions = CONDITIONS[0];
    const plans: [OverPlan, OverPlan] = [randomPlan(rng), randomPlan(rng)];
    const seed = hexSeed(rng);
    const states: [InningsState, InningsState] = [engine.startInnings(0), engine.startInnings(1)];
    const inputs: [Array<BattingInput | null>, Array<BattingInput | null>] = [[], []];
    for (const seat of [0, 1] as const) {
      const over = plans[seat === 0 ? 1 : 0];
      let state = states[seat];
      while (!state.done) {
        const d = engine.revealDelivery(over, state.nextBall, conditions);
        const raw = seat === 0 ? engine.autoBat(autoXiSeed(seed, 0, d.ball), d, over.field) : randomInput(rng, d, 50);
        const checked = engine.validateBattingInput(raw, d);
        const input = checked.ok ? checked.input : null;
        inputs[seat].push(input);
        state = engine.resolveNextBall(state, { seed, conditions, plan: over, input }).state;
      }
      states[seat] = state;
    }
    const played: PlayedMatch = { seed, conditions, plans, inputs, states };
    const log = await logFor(played);
    expect(unlocksEarned(log, 1)).toEqual([]);
    // A run-out is not the bowler's wicket.
    const real = await logFor(randomMatch('unlock|runout'));
    const runOut: MatchEventLog = JSON.parse(JSON.stringify(real));
    const inn = runOut.innings.find((i) => i.bowler === 1)!;
    inn.balls.forEach((o) => (o.wicket = null));
    inn.runs = 30;
    inn.balls[0].wicket = 'run_out';
    expect(unlocksEarned(runOut, 1)).toEqual([]);
  });
});

describe('pitch hints are true to the model', () => {
  it('one line per pitch, plus the weather when it matters', () => {
    for (const pitch of PITCHES)
      for (const weather of WEATHERS) {
        const hints = pitchHints({ pitch, weather });
        expect(hints[0].key).toBe(`advice.pitch.${pitch}`);
        expect(hints).toHaveLength(weather === 'clear' ? 1 : 2);
        for (const h of hints) expect(hasKey(h.key)).toBe(true);
      }
  });

  it("every ball a pitch hint recommends is harder to score from than every ball it warns against, in every weather", () => {
    const ctx = neutral(2);
    const lambda = wicketCost(ctx, 0);
    const value = (variant: OverPlan['balls'][0]['variant'], length: OverPlan['balls'][0]['length'], cond: Conditions) => {
      let best = Number.POSITIVE_INFINITY;
      for (const line of LINES)
        for (const intensity of INTENSITIES)
          for (const field of FIELD_SETTINGS) best = Math.min(best, optionRange({ variant, line, length, intensity, intent: 'contain' }, 'good', field, cond, ctx, lambda).best);
      return best;
    };
    for (const pitch of PITCHES)
      for (const weather of WEATHERS) {
        const cond = { pitch, weather };
        const good = Math.max(...PITCH_ADVICE[pitch].good.map(([v, l]) => value(v, l, cond)));
        const poor = Math.min(...PITCH_ADVICE[pitch].poor.map(([v, l]) => value(v, l, cond)));
        expect(good, `${pitch}/${weather}`).toBeLessThan(poor);
      }
  });

  it("the simulation's best over for each pitch follows that pitch's hint; an over of the balls it warns against concedes more", () => {
    for (const pitch of PITCHES) {
      const cond: Conditions = { pitch, weather: 'clear' };
      const best = optimisedSpec(cond, false, 300);
      const s = overSummary(best, cond);
      expect(keysOf(s), pitch).toContain('advice.read.fits_pitch');
      expect(keysOf(s)).not.toContain('advice.read.against_pitch');
      expect(s.pitchBalls.good).toBeGreaterThanOrEqual(ADVICE.fitsPitch);
      // Six balls the hint warns against (different lines, so they are not repeats), on the same field.
      const poorKinds = PITCH_ADVICE[pitch].poor;
      const poor: OverSpec = { field: best.field, balls: [0, 1, 2, 3, 4, 5].map((k) => ({ variant: poorKinds[k % poorKinds.length][0], length: poorKinds[k % poorKinds.length][1], line: LINES[k % 4], intensity: 1, intent: 'contain' })), superBall: best.superBall };
      expect(keysOf(overSummary(poor, cond))).toContain('advice.read.against_pitch');
      expect(overValue(poor, cond)).toBeGreaterThan(overValue(best, cond) + 1);
    }
  }, 60_000);

  it('humid air helps swing most, and dew makes batting easier with spin hurt most', () => {
    for (const pitch of PITCHES) {
      const delta = (name: string, weather: 'humid' | 'dew') => overValue(ARCHETYPES[name], { pitch, weather }) - overValue(ARCHETYPES[name], { pitch, weather: 'clear' });
      const others = ['stock', 'pace_barrage', 'spin_only', 'slower_mix', 'contain_all', 'starter_mix'];
      for (const o of others) expect(delta('swing_only', 'humid')).toBeLessThan(delta(o, 'humid'));
      for (const o of ['stock', 'pace_barrage', 'swing_only', 'slower_mix', 'contain_all', 'starter_mix']) {
        expect(delta(o, 'dew')).toBeGreaterThan(0);
        expect(delta('spin_only', 'dew')).toBeGreaterThan(delta(o, 'dew'));
      }
    }
  });
});

describe('overSummary', () => {
  const ball = (variant: OverPlan['balls'][0]['variant'], line: OverPlan['balls'][0]['line'], length: OverPlan['balls'][0]['length'], intensity: 1 | 2 | 3, intent: OverPlan['balls'][0]['intent']) => ({ variant, line, length, intensity, intent });

  it('counts families, energy, lengths, lines, the field and the Super Ball', () => {
    const over: OverShape = {
      field: 'balanced',
      balls: [ball('good_length', 'off', 'good', 2, 'contain'), ball('inswing', 'middle', 'full', 2, 'attack'), ball('outswing', 'off', 'good', 1, 'setup'), ball('offspin', 'wide_off', 'good', 2, 'attack'), ball('yorker', 'middle', 'full', 1, 'attack'), ball('bouncer', 'leg', 'short', 1, 'contain')],
      superBall: ball('yorker', 'middle', 'full', 1, 'attack'),
    };
    const s = overSummary(over, { pitch: 'green', weather: 'humid' });
    expect(s.families).toEqual({ pace: 3, swing: 2, spin: 1 });
    expect(s.energy).toEqual({ used: over.balls.reduce((n, d) => n + energyCost(d), 0), budget: 15 });
    expect(s.lengths).toEqual({ full: 2, good: 3, short: 1 });
    expect(s.lines).toBe(4);
    expect(s.field).toBe('balanced');
    expect(s.superBall).toEqual({ variant: 'yorker', cost: 3, allowance: 3 });
    expect(s.reads.length).toBeLessThanOrEqual(3);
    for (const r of s.reads) expect(hasKey(r.key)).toBe(true);
    expect(overSummary(over, { pitch: 'green', weather: 'humid' })).toEqual(s);
  });

  it('reads repeats, set-ups and intent the way the engine scores them', () => {
    const cond: Conditions = { pitch: 'hard', weather: 'clear' };
    const same = ball('yorker', 'middle', 'full', 1, 'contain');
    const predictable = overSummary({ field: 'balanced', balls: [same, ball('good_length', 'off', 'good', 1, 'contain'), same, same, ball('offspin', 'off', 'good', 1, 'contain'), ball('good_length', 'wide_off', 'good', 1, 'contain')], superBall: same }, cond);
    expect(predictable.reads[0]).toEqual({ key: 'advice.read.predictable', params: { count: 3 } });

    // Short set-up, then a full attacking ball: ready. A set-up followed by a ball like it: wasted.
    const ready = overSummary({ field: 'balanced', balls: [ball('bouncer', 'middle', 'short', 1, 'setup'), ball('yorker', 'middle', 'full', 1, 'attack'), ball('good_length', 'off', 'good', 1, 'contain'), ball('offspin', 'off', 'good', 1, 'contain'), ball('good_length', 'wide_off', 'good', 1, 'contain'), ball('offspin', 'middle', 'good', 1, 'contain')], superBall: same }, cond);
    expect(ready.reads).toContainEqual({ key: 'advice.read.setup_ready', params: { n: 1, next: 2 } });
    const wasted = overSummary({ field: 'balanced', balls: [ball('good_length', 'off', 'good', 1, 'setup'), ball('good_length', 'middle', 'good', 1, 'attack'), ball('yorker', 'off', 'full', 1, 'contain'), ball('offspin', 'off', 'good', 1, 'contain'), ball('good_length', 'wide_off', 'good', 1, 'contain'), ball('offspin', 'middle', 'good', 1, 'contain')], superBall: same }, cond);
    expect(wasted.reads).toContainEqual({ key: 'advice.read.setup_wasted', params: { n: 1 } });

    const attack = overSummary({ field: 'attacking', balls: [0, 1, 2, 3, 4, 5].map((k) => ball(k % 2 ? 'yorker' : 'bouncer', LINES[k % 4], k % 2 ? 'full' : 'short', 1, 'attack')), superBall: same }, cond);
    expect(keysOf(attack)).toContain('advice.read.attack');
    // Six cheap spinners on a Slow pitch: safe, suited to the pitch, and 9 energy unused.
    const contain = overSummary({ field: 'balanced', balls: [0, 1, 2, 3, 4, 5].map((k) => ball('offspin', LINES[k % 4], k < 4 ? 'good' : 'full', 1, 'contain')), superBall: same }, { pitch: 'slow', weather: 'clear' });
    expect(keysOf(contain)).toContain('advice.read.contain');
    expect(contain.reads).toContainEqual({ key: 'advice.read.energy_left', params: { n: 9 } });
    expect(keysOf(contain)).toContain('advice.read.fits_pitch');
  });

  it('a ball it calls easy to hit really is: swapping it for the best ball of the same cost concedes less in the simulation', () => {
    let flagged = 0;
    for (const pitch of PITCHES) {
      const cond: Conditions = { pitch, weather: 'clear' };
      const rng = rngFromKey(`test/advice/weak|${pitch}`);
      for (let i = 0; i < 25; i++) {
        const spec = randomOverSpec(rng);
        const weak = overSummary(spec, cond).reads.find((r) => r.key === 'advice.read.weak_ball');
        if (!weak) continue;
        const k = Number(weak.params?.n) - 1;
        const d = spec.balls[k];
        let alt = d;
        let altV = Number.POSITIVE_INFINITY;
        for (const variant of VARIANTS)
          for (const length of ALLOWED_LENGTHS[variant])
            for (const intensity of INTENSITIES)
              for (const line of LINES) {
                const a = { variant, line, length, intensity, intent: d.intent };
                if (energyCost(a) !== energyCost(d)) continue;
                const v = optionRange(a, 'good', spec.field, cond, neutral(k), wicketCost(neutral(k), 0)).best;
                if (v < altV) [alt, altV] = [a, v];
              }
        const fixed = { ...spec, balls: spec.balls.map((b, j) => (j === k ? alt : b)) };
        expect(overValue(fixed, cond)).toBeLessThan(overValue(spec, cond));
        flagged++;
      }
    }
    expect(flagged).toBeGreaterThan(20);
  });

  it('a field it suggests really suits the over better in the simulation', () => {
    let suggested = 0;
    for (const pitch of PITCHES) {
      const cond: Conditions = { pitch, weather: 'clear' };
      const rng = rngFromKey(`test/advice/field|${pitch}`);
      for (let i = 0; i < 25; i++) {
        const spec = randomOverSpec(rng);
        const read = overSummary(spec, cond).reads.find((r) => r.key.startsWith('advice.read.field_'));
        if (!read) continue;
        const field = read.key.slice('advice.read.field_'.length) as OverSpec['field'];
        expect(overValue({ ...spec, field }, cond)).toBeLessThan(overValue(spec, cond));
        suggested++;
      }
    }
    expect(suggested).toBeGreaterThan(5);
  });

  it('compares only with deliveries the player can bowl', () => {
    const cond: Conditions = { pitch: 'green', weather: 'humid' };
    const ctx = neutral(1);
    const lambda = wicketCost(ctx, 0);
    const d = { variant: 'good_length' as const, line: 'off' as const, length: 'good' as const, intensity: 2 as const, intent: 'attack' as const };
    const minOver = (variants: readonly string[]) => {
      let min = Number.POSITIVE_INFINITY;
      for (const variant of VARIANTS.filter((v) => variants.includes(v)))
        for (const length of ALLOWED_LENGTHS[variant])
          for (const intensity of INTENSITIES)
            for (const line of LINES) {
              const a = { variant, line, length, intensity, intent: d.intent };
              if (energyCost(a) === energyCost(d)) min = Math.min(min, optionRange(a, 'good', 'attacking', cond, ctx, lambda).best);
            }
      return min;
    };
    expect(bowlingChoice(d, 'attacking', cond, ctx, lambda, STARTER_VARIANTS).min).toBeCloseTo(minOver(STARTER_VARIANTS), 9);
    expect(bowlingChoice(d, 'attacking', cond, ctx, lambda).min).toBeCloseTo(minOver(VARIANTS), 9);
    // On a humid Green pitch a locked swing ball beats every starter of the same cost.
    expect(minOver(VARIANTS)).toBeLessThan(minOver(STARTER_VARIANTS));
    expect(pitchKind({ variant: 'offspin', length: 'good' }, 'slow')).toBe('good');
    expect(pitchKind({ variant: 'bouncer', length: 'short' }, 'slow')).toBe('poor');
    expect(pitchKind({ variant: 'yorker', length: 'full' }, 'slow')).toBeNull();
  });
});
