// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BowlerProfile, Handedness, PitchCondition } from '@/contracts/practice';
import { RING_R } from '@/physics/constants';
import { autoField, distanceFromStriker, fieldIntent, validateField } from '@/physics/field';
import { fielderClass } from '@/physics/fielding';

const CONDITIONS: PitchCondition[] = ['balanced', 'green', 'hard', 'turning'];
const HANDS: Handedness[] = ['right', 'left'];
const pace = (paceBand: 'controlled' | 'fast' | 'express', arm: 'right' | 'left' = 'right'): BowlerProfile => ({ family: 'pace', paceBand, arm, lookSeed: 'w' });
const spin = (spinType: 'finger' | 'wrist', arm: 'right' | 'left' = 'right'): BowlerProfile => ({ family: 'spin', spinType, arm, lookSeed: 'w' });
const BOWLERS = [pace('controlled'), pace('fast'), pace('express', 'left'), spin('finger'), spin('wrist'), spin('finger', 'left'), spin('wrist', 'left')];
const WHITE = { colour: 'white', age: 'new' } as const;
const RED = { colour: 'red', age: 'new' } as const;

describe('white-ball (limited-overs) fields', () => {
  it('are the default, legal for every bowler, pitch and hand, with four out and five inside the ring', () => {
    for (const b of BOWLERS)
      for (const c of CONDITIONS)
        for (const h of HANDS) {
          const f = autoField(b, c, h);
          expect(f).toEqual(autoField(b, c, h, WHITE));
          expect(f.id).toContain('-white-');
          expect(validateField(f)).toEqual([]);
          const others = f.fielders.filter((x) => x.role !== 'keeper' && x.role !== 'bowler');
          expect(others.filter((x) => fielderClass(x) === 'deep')).toHaveLength(4);
          expect(others.filter((x) => distanceFromStriker(x.x, x.z) <= RING_R + 2)).toHaveLength(5);
        }
  });

  it('a red ball keeps the Test fields', () => {
    for (const b of BOWLERS)
      for (const c of CONDITIONS) {
        const f = autoField(b, c, 'right', RED);
        expect(f.id).not.toContain('-white-');
        expect(f.fielders.filter((x) => fielderClass(x) === 'deep').length).toBeLessThanOrEqual(2);
      }
  });

  it('pace bowls the channel to an off-side field: deep cover, deep point and third man back, a short-ball trap on a hard pitch', () => {
    const roles = (c: PitchCondition) => autoField(pace('fast'), c).fielders.map((f) => f.role);
    for (const r of ['deep_cover', 'deep_point', 'third_man', 'fine_leg']) expect(roles('balanced')).toContain(r);
    expect(roles('green')).toContain('slip');
    expect(roles('hard')).toEqual(expect.arrayContaining(['deep_square', 'fine_leg']));
    expect(roles('balanced')).toEqual(roles('turning'));
  });

  it('spin keeps long-off, long-on, a sweeper at deep cover and deep midwicket, with a close catcher on a turner', () => {
    for (const s of [spin('finger'), spin('wrist')]) {
      const roles = autoField(s, 'balanced').fielders.map((f) => f.role);
      for (const r of ['long_off', 'long_on', 'deep_cover', 'deep_midwicket']) expect(roles).toContain(r);
    }
    expect(autoField(spin('finger'), 'turning').fielders.map((f) => f.role)).toContain('short_leg');
    expect(autoField(spin('wrist'), 'turning').fielders.map((f) => f.role)).toContain('slip');
  });

  it('reads the intention: protect the boundaries, a short-ball trap on a hard pitch, close catchers for the off-break on a turner', () => {
    for (const b of BOWLERS)
      for (const c of CONDITIONS)
        for (const h of HANDS) {
          const i = fieldIntent(autoField(b, c, h), b, c, h).intention;
          const turnsIn = b.family === 'spin' && (b.spinType === 'finger') === ((h === 'left' ? (b.arm === 'right' ? 'left' : 'right') : b.arm) === 'right');
          const want = b.family === 'pace' ? (c === 'hard' ? 'short_ball_trap' : 'protect_boundaries') : c === 'turning' && turnsIn ? 'spin_close_catchers' : 'protect_boundaries';
          expect(i, `${b.family} ${b.paceBand ?? b.spinType} ${b.arm} ${c} ${h}`).toBe(want);
        }
  });
});
