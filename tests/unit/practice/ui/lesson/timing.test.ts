/** The timing note: sizes and sides come from the physics' own label and sign; the scale only draws its bands. */
import { describe, expect, it } from 'vitest';
import type { AssistLevel } from '@/contracts';
import { activeBands, classifyTiming } from '@/physics';
import { TIMING_NOTE_BALLS, timingNote, timingScale, wantsTimingNote } from '@/practice/ui/lesson/timing';

describe('timingNote', () => {
  it('names the size from the physics label and the side from the sign (+ = late)', () => {
    expect(timingNote({ timing: 'perfect', timingErrorMs: -12 })).toMatchObject({
      size: 'on_time',
      side: 'early',
      key: 'on_time',
    });
    expect(timingNote({ timing: 'solid', timingErrorMs: -40 })).toMatchObject({
      size: 'small',
      side: 'early',
      key: 'early.small',
      ms: 40,
    });
    expect(timingNote({ timing: 'mistimed', timingErrorMs: 70 })).toMatchObject({
      size: 'medium',
      side: 'late',
      key: 'late.medium',
    });
    expect(timingNote({ timing: 'missed', timingErrorMs: 140.4 })).toMatchObject({
      size: 'large',
      side: 'late',
      key: 'late.large',
      ms: 140,
    });
    expect(timingNote({ timing: 'missed', timingErrorMs: -250 })).toMatchObject({
      size: 'large',
      side: 'early',
      key: 'early.large',
    });
  });

  it('says nothing for a leave (no error) or for "none"', () => {
    expect(timingNote({ timing: 'none', timingErrorMs: null })).toBeNull();
    expect(timingNote({ timing: 'perfect', timingErrorMs: null })).toBeNull();
    expect(timingNote({ timing: 'solid', timingErrorMs: Number.NaN })).toBeNull();
  });

  it('a zero error on time has no side; a label worse than perfect always has one', () => {
    expect(timingNote({ timing: 'perfect', timingErrorMs: 0 })).toMatchObject({ size: 'on_time', side: null });
    expect(timingNote({ timing: 'solid', timingErrorMs: 0 })?.side).toBe('late');
  });

  it('uses no window of its own: for every level and device allowance the size equals the physics’ classifyTiming of the raw error in the delivery’s bands, and only grows with the error', () => {
    const rank = { on_time: 0, small: 1, medium: 2, large: 3 } as const;
    const word = { perfect: 'on_time', solid: 'small', mistimed: 'medium', missed: 'large' } as const;
    for (const assist of ['learn', 'play', 'real'] as AssistLevel[])
      for (const tol of [0, 12, 20]) {
        const bands = activeBands(assist, tol);
        let last = 0;
        for (let err = 0; err <= 200; err += 0.5) {
          const label = classifyTiming(err, bands);
          const note = timingNote({ timing: label, timingErrorMs: err }, bands)!;
          expect(note.size, `${assist} +${tol} ${err} ms`).toBe(word[label]);
          expect(rank[note.size]).toBeGreaterThanOrEqual(last);
          last = rank[note.size];
          // The mirror image (early) reads the same size, on the other side.
          const early = timingNote({ timing: classifyTiming(-err, bands), timingErrorMs: -err }, bands)!;
          expect(early.size).toBe(note.size);
          if (err > 0) expect([early.side, note.side]).toEqual(['early', 'late']);
        }
        expect(last).toBe(3);
      }
  });

  it('the bands decide the size, not the physics’ label: a bat that met the ball is still "much too early" when it was', () => {
    const bands = activeBands('learn', 0);
    // The physics caps its label at "mistimed" where the bat met the ball (src/physics/timing.ts); the words follow the error.
    expect(timingNote({ timing: 'mistimed', timingErrorMs: -(bands.edgeMs + 6) }, bands)).toMatchObject({
      size: 'large',
      side: 'early',
    });
    // Without the bands the label is all there is.
    expect(timingNote({ timing: 'mistimed', timingErrorMs: -(bands.edgeMs + 6) })).toMatchObject({ size: 'medium' });
  });
});

describe('timingScale', () => {
  it('draws the delivery’s own bands, with the swing clamped to the ends', () => {
    const bands = activeBands('learn', 0);
    const early = timingNote({ timing: 'solid', timingErrorMs: -bands.solidMs })!;
    const sc = timingScale(early, bands);
    expect(sc).toMatchObject({ perfectMs: bands.perfectMs, solidMs: bands.solidMs, edgeMs: bands.edgeMs });
    expect(sc.halfMs).toBeGreaterThan(bands.edgeMs);
    expect(sc.at).toBeLessThan(0);
    expect(sc.at).toBeGreaterThan(-1);
    const far = timingScale(timingNote({ timing: 'missed', timingErrorMs: 5000 })!, bands);
    expect(far.at).toBe(1);
    expect(timingScale(timingNote({ timing: 'perfect', timingErrorMs: 0 })!, bands).at).toBe(0);
  });
});

describe('wantsTimingNote', () => {
  it('only for the first over with teaching on (the dead ball has counted the ball it follows)', () => {
    expect(TIMING_NOTE_BALLS).toBe(6);
    expect(wantsTimingNote(true, 0)).toBe(false);
    for (const n of [1, 2, 3, 4, 5, 6]) expect(wantsTimingNote(true, n)).toBe(true);
    expect(wantsTimingNote(true, 7)).toBe(false);
    expect(wantsTimingNote(false, 1)).toBe(false);
  });
});
