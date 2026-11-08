import { describe, expect, it } from 'vitest';
import type { CoachAnalysis, DeliveryRecord, NormalizedSwing } from '@/contracts/practice';
import { analyzeBall } from '@/practice/coach';
import { play, referenceRecord, swingFor, type SwingOpts } from './fixtures';

const OUTSWINGER = referenceRecord('ref-1');
const INSWINGER = referenceRecord('ref-2');
const BOUNCER = referenceRecord('ref-5');

function attempt(record: DeliveryRecord, o: SwingOpts | null): CoachAnalysis {
  const swing: NormalizedSwing | null = o ? swingFor(record, o) : null;
  const { record: r, result } = play(record, swing);
  return analyzeBall(r, result);
}

const bad = (a: CoachAnalysis) => a.attempted.dismissal !== null || ['miss', 'pad', 'body', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge'].includes(a.attempted.contact);

describe('the read: line', () => {
  it('leaving a ball that misses the stumps is right; the why is the physics own', () => {
    const a = attempt(OUTSWINGER, null);
    expect(a.ball.wouldHitStumps).toBe(false);
    expect(a.read.line).toBe('right');
    expect(a.read.length).toBe('unclear');
    expect(a.read.pace).toBe('unclear');
    expect(a.why[0]).toBe('left_well');
  });

  it('leaving the inswinger that hits the stumps is wrong, and the swing is named', () => {
    const a = attempt(INSWINGER, null);
    expect(a.ball.wouldHitStumps).toBe(true);
    expect(a.read.line).toBe('wrong');
    expect(a.read.movement).toBe('wrong');
    expect(a.why[0]).toBe('left_and_bowled');
    expect(a.why).toContain('beaten_by_swing');
  });

  it('a pull at a ball outside off, or a cut at the stumps, is across the line', () => {
    expect(attempt(OUTSWINGER, { directionDeg: -70 }).read.line).toBe('wrong');
    expect(attempt(INSWINGER, { directionDeg: 90 }).read.line).toBe('wrong');
  });

  it('playing at the stumps is right; blocking a ball far outside off is fishing', () => {
    expect(attempt(INSWINGER, { kind: 'defend' }).read.line).toBe('right');
    expect(attempt(OUTSWINGER, { kind: 'defend' }).read.line).toBe('wrong');
    expect(attempt(OUTSWINGER, { directionDeg: 45 }).read.line).toBe('right');
  });
});

describe('the read: length (the player own footwork only)', () => {
  it('automatic footwork is the physics choice, not evidence', () => {
    expect(attempt(OUTSWINGER, { directionDeg: 45 }).read.length).toBe('unclear');
  });

  it('forward to the full ball is right, back to it is wrong, forward to the bouncer is wrong', () => {
    expect(attempt(OUTSWINGER, { directionDeg: 45, footwork: 'forward' }).read.length).toBe('right');
    expect(attempt(OUTSWINGER, { directionDeg: 45, footwork: 'back' }).read.length).toBe('wrong');
    expect(attempt(BOUNCER, { directionDeg: 0, footwork: 'forward' }).read.length).toBe('wrong');
  });
});

describe('the read: pace (timing against the active bands)', () => {
  it('inside the perfect band is right', () => {
    expect(attempt(OUTSWINGER, { directionDeg: 45, errorMs: 15 }).read.pace).toBe('right');
  });

  it('far too late or far too early is wrong, and says which', () => {
    const late = attempt(referenceRecord('ref-1', 'real'), { directionDeg: 45, errorMs: 150 });
    expect(late.read.pace).toBe('wrong');
    expect(late.why.some((w) => w === 'too_late' || w === 'beaten_by_pace')).toBe(true);
    const early = attempt(referenceRecord('ref-1', 'real'), { directionDeg: 45, errorMs: -150 });
    expect(early.read.pace).toBe('wrong');
    expect(early.why).toContain('too_early');
  });
});

describe('the read: movement', () => {
  it('playing to leg against the ball moving away is across the movement', () => {
    const a = attempt(OUTSWINGER, { directionDeg: -35 });
    expect(a.read.movement).toBe('wrong');
  });

  it('driving with the swing, off the middle, is right', () => {
    const a = attempt(OUTSWINGER, { directionDeg: 45 });
    if (a.attempted.contact === 'middle') expect(a.read.movement).toBe('right');
    else expect(a.read.movement).not.toBe('right');
  });

  it('a ball that barely moves gives no movement evidence', () => {
    const a = attempt(BOUNCER, null);
    expect(Math.abs(a.ball.airMovementM + (a.ball.pitchMovementM ?? 0))).toBeLessThan(0.05);
    expect(a.read.movement).toBe('unclear');
  });
});

describe('the read: bounce', () => {
  it('leaving the bouncer that passes over the stumps is right', () => {
    const a = attempt(BOUNCER, null);
    expect(a.ball.heightAtBatM).toBeGreaterThan(1.3);
    expect(a.read.bounce).toBe('right');
  });

  it('getting forward to the bouncer is wrong; when it goes wrong, the bounce leads the why', () => {
    for (const errorMs of [0, 25, -25]) {
      const a = attempt(BOUNCER, { directionDeg: 0, footwork: 'forward', errorMs });
      expect(a.read.bounce).toBe('wrong');
      if (bad(a)) expect(a.why[0]).toBe('beaten_by_bounce');
    }
  });

  it('a normal-height ball gives no bounce evidence unless it beat the bat over the top', () => {
    const a = attempt(INSWINGER, { kind: 'defend' });
    expect(a.ball.heightAtBatM).toBeLessThan(1);
    if (!a.why.includes('beaten_by_bounce')) expect(a.read.bounce).toBe('unclear');
  });
});

describe('the why', () => {
  it('is never empty, has no repeats, and a good stroke is explained by its outcome alone', () => {
    for (const o of [null, { directionDeg: 45 }, { kind: 'defend' as const }, { directionDeg: -70, errorMs: 60 }]) {
      for (const r of [OUTSWINGER, INSWINGER, BOUNCER]) {
        const a = attempt(r, o);
        expect(a.why.length).toBeGreaterThan(0);
        expect(new Set(a.why).size).toBe(a.why.length);
        if (!bad(a)) expect(a.why.length).toBe(1);
      }
    }
  });
});
