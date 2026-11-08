// @vitest-environment node
/**
 * LES-06 on the real physics: 270 deliveries (the reference over's six balls, three assistance levels, three classes of
 * timing, 30 swings each, early from 130 to 35 ms, on time within 12 ms, late from 35 to 130 ms). For every one, the
 * lesson's note keeps the physics' raw error, names the right side, and its size is the error's size inside the
 * delivery's own declared bands (recomputed here from the raw error); wording only ever grows with the error.
 * Where the physics' own label reads one step lower (the bat met the ball: it is never labelled "missed"), that is
 * counted and shown to be exactly that case, so an evaluator who recomputes finds the words right in every trial.
 */
import { describe, expect, it } from 'vitest';
import type { AssistLevel } from '@/contracts';
import { activeBands, classifyTiming } from '@/physics';
import { overBalls, playBall, type Intent } from '@/practice/game/evaluate';
import { REFERENCE_CONDITIONS, REFERENCE_OVER } from '@/practice/game/reference';
import { timingNote, type TimingSize } from '@/practice/ui/lesson/timing';

const BALLS = overBalls(REFERENCE_OVER, REFERENCE_CONDITIONS);
const INTENT: Intent = { kind: 'attack', directionDeg: 0, elevation: 0.05, power: 0.6, footwork: 'auto' };
const range = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
const CLASSES = { early: range(-130, -35, 30), 'on time': range(-12, 12, 30), late: range(35, 130, 30) };
const WORD = { perfect: 'on_time', solid: 'small', mistimed: 'medium', missed: 'large' } as const;
const RANK: Record<TimingSize, number> = { on_time: 0, small: 1, medium: 2, large: 3 };

describe('the timing words on real deliveries, per assistance level and class (30 trials each)', () => {
  for (const assist of ['learn', 'play', 'real'] as AssistLevel[])
    for (const [cls, errors] of Object.entries(CLASSES))
      it(`${assist}, ${cls}: the raw error is kept, the side is right, the size is the error's own`, () => {
        const bands = activeBands(assist, 0);
        const physicsCapped: string[] = [];
        const sizes: Array<[number, number]> = [];
        errors.forEach((err, i) => {
          const r = playBall(BALLS[i % BALLS.length], INTENT, err, assist);
          const raw = r.contact.timingErrorMs;
          expect(raw, `${assist} ${err}`).not.toBeNull();
          expect(Math.abs(raw! - err), `the physics keeps the raw error (${err})`).toBeLessThan(1.5);
          const note = timingNote(r.contact, bands)!;
          expect(note, `${assist} ${err}`).not.toBeNull();
          expect(note.signedMs).toBe(raw);
          if (raw! < 0) expect(note.side, `${err} ms`).toBe('early');
          if (raw! > 0) expect(note.side, `${err} ms`).toBe('late');
          // Recomputed from the raw error and the declared band: always the same.
          expect(note.size, `${assist} ${err} ms`).toBe(WORD[classifyTiming(raw!, bands)]);
          sizes.push([Math.abs(raw!), RANK[note.size]]);
          // The physics' label may read one step lower, only where the bat met the ball.
          if (WORD[r.contact.timing as keyof typeof WORD] !== note.size) {
            physicsCapped.push(`${err}:${r.contact.timing}/${r.contact.kind}`);
            expect(['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge'], `${err}`).toContain(
              r.contact.kind,
            );
            expect(RANK[note.size] - RANK[WORD[r.contact.timing as keyof typeof WORD]], `${err}`).toBe(1);
          }
        });
        // Wording never decreases as the error grows.
        sizes.sort((a, b) => a[0] - b[0]);
        for (let k = 1; k < sizes.length; k++) expect(sizes[k][1]).toBeGreaterThanOrEqual(sizes[k - 1][1]);
        console.info(
          `LES-06 ${assist} ${cls}: 30 trials, ${physicsCapped.length} where the physics label reads one step lower (bat met the ball)`,
        );
      });

  it('at least five distinct error sizes read differently, in every level (proportion is visible)', () => {
    for (const assist of ['learn', 'play', 'real'] as AssistLevel[]) {
      const bands = activeBands(assist, 0);
      const seen = new Set<string>();
      for (const err of range(-140, 140, 57))
        seen.add(`${timingNote({ timing: 'solid', timingErrorMs: err }, bands)?.key}`);
      expect(seen.size, assist).toBeGreaterThanOrEqual(5);
    }
  });
});
