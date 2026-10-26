import { describe, expect, it } from 'vitest';
import type { DeliveryVariant, ExecutionGrade, Intensity, Length, Line, PitchId, WeatherId } from '@/contracts';
import { rngFromKey } from '@/engine/prng';
import { deliveryPath, deliveryTiming, executedPath } from '@/engine/v1/delivery';
import { FAMILY } from '@/engine/v1/tables';
import { CONTACT_Z, MATCH_RELEASE, MATCH_RESTITUTION, PITCH_HALF } from '@/physics/constants';
import { sampleAt } from '@/physics/delivery';
import { CONDITIONS_FOR_PITCH, flightFromPath } from '@/physics/matchPath';

const VARIANTS: DeliveryVariant[] = ['yorker', 'good_length', 'bouncer', 'slower', 'inswing', 'outswing', 'offspin', 'legspin'];
const LINES: Line[] = ['off'];
const LENGTHS: Length[] = ['full', 'good', 'short'];
const PITCHES_IDS: PitchId[] = ['green', 'hard', 'slow'];

function engineCase(variant: DeliveryVariant, intensity: Intensity, line: Line, length: Length, pitch: PitchId, weather: WeatherId = 'clear', grade: ExecutionGrade = 'perfect') {
  const d = { variant, line, length, intensity, intent: 'attack' as const };
  const c = { pitch, weather };
  const planned = deliveryPath(d, c);
  const path = grade === 'perfect' ? planned : executedPath(planned, d, grade, rngFromKey(`t|${variant}|${line}|${length}|${pitch}`));
  return { path, timing: deliveryTiming(d, c), family: FAMILY[variant], conditions: CONDITIONS_FOR_PITCH[pitch] };
}

describe('flightFromPath: multiplayer BallPaths through the one physics engine', () => {
  it('meets the hard targets for every engine delivery (time < 0.5 ms, bounce and line < 2 cm)', () => {
    const height: number[] = [];
    const speed: number[] = [];
    let n = 0;
    for (const variant of VARIANTS) {
      for (const intensity of [1, 2, 3] as const) {
        for (const line of LINES) {
          for (const length of LENGTHS) {
            for (const pitch of PITCHES_IDS) {
              for (const grade of ['perfect', 'loose'] as const) {
                if (grade === 'loose' && intensity !== 2) continue;
                const k = engineCase(variant, intensity, line, length, pitch, 'clear', grade);
                const f = flightFromPath(k.path, { family: k.family, releaseToContactMs: k.timing.releaseToContactMs, conditions: k.conditions });
                const at = sampleAt(f.samples, f.idealContactT).p;
                expect(Math.abs(f.idealContactT * 1000 - k.timing.releaseToContactMs)).toBeLessThan(0.5);
                expect(at.z).toBeCloseTo(CONTACT_Z, 3);
                expect(Math.abs(f.fit.bounceErrorM)).toBeLessThan(0.02);
                expect(Math.abs(at.x - k.path.lineAtBatM)).toBeLessThan(0.02);
                expect(f.fit.converged).toBe(true);
                expect(f.release.p.y).toBeCloseTo(Math.min(MATCH_RELEASE.heightMax, Math.max(MATCH_RELEASE.heightMin, k.path.releaseHeightM)), 9);
                expect(f.fit.restitution).toBeGreaterThanOrEqual(MATCH_RESTITUTION[0]);
                expect(f.fit.restitution).toBeLessThanOrEqual(MATCH_RESTITUTION[1]);
                expect(Math.abs(f.fit.swingM - k.path.swingM)).toBeLessThan(0.01);
                if (k.path.bounceAtM < PITCH_HALF + CONTACT_Z - 0.2) expect(Math.abs(f.fit.turnM - k.path.turnM)).toBeLessThan(0.01);
                height.push(f.fit.heightAtBatM - k.path.heightAtBatM);
                speed.push(f.fit.speedKph - k.path.speedKph);
                n++;
              }
            }
          }
        }
      }
    }
    // Soft targets: report how close the physics comes (heights within 2 cm unless the pitch's bounce is maxed out).
    const within2cm = height.filter((h) => Math.abs(h) < 0.02).length / n;
    const meanAbsSpeed = speed.reduce((a, b) => a + Math.abs(b), 0) / n;
    console.info(
      `flightFromPath over ${n} engine paths: height within 2 cm ${(within2cm * 100).toFixed(0)}%, worst ${Math.min(...height).toFixed(3)}…${Math.max(...height).toFixed(3)} m; speed |mean| ${meanAbsSpeed.toFixed(1)} km/h, range ${Math.min(...speed).toFixed(1)}…${Math.max(...speed).toFixed(1)}`,
    );
    expect(within2cm).toBeGreaterThan(0.6);
    expect(Math.min(...height)).toBeGreaterThan(-0.2);
    expect(Math.max(...height)).toBeLessThan(0.05);
    expect(meanAbsSpeed).toBeLessThan(8);
    expect(Math.max(...speed.map(Math.abs))).toBeLessThan(25);
  }, 60_000);

  it('is deterministic: the same path gives a byte-identical flight', () => {
    const k = engineCase('legspin', 1, 'off', 'good', 'slow');
    const a = flightFromPath(k.path, { family: k.family, releaseToContactMs: k.timing.releaseToContactMs, conditions: k.conditions, seed: 's' });
    const b = flightFromPath(k.path, { family: k.family, releaseToContactMs: k.timing.releaseToContactMs, conditions: k.conditions, seed: 's' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('flies the real thing: 1 ms samples to past the stumps, spin, the yorker reaching the bat before it pitches', () => {
    const y = engineCase('yorker', 2, 'off', 'full', 'green');
    const f = flightFromPath(y.path, { family: y.family, releaseToContactMs: y.timing.releaseToContactMs });
    expect(f.samples[1].t - f.samples[0].t).toBeCloseTo(0.001, 12);
    expect(f.samples.at(-1)!.p.z).toBeGreaterThan(PITCH_HALF);
    expect(f.bounce!.p.z).toBeCloseTo(-PITCH_HALF + y.path.bounceAtM, 2);
    expect(f.bounce!.t).toBeGreaterThan(f.idealContactT);
    expect(f.fit.heightAtBatM).toBeLessThan(0.2);
    expect(f.spin.release.x).toBeLessThan(0); // seam-up back-spin
    const s = engineCase('offspin', 2, 'off', 'good', 'slow');
    const fs = flightFromPath(s.path, { family: s.family, releaseToContactMs: s.timing.releaseToContactMs, conditions: s.conditions });
    expect(fs.fit.turnM).toBeCloseTo(s.path.turnM, 2);
    expect(fs.spin.afterBounce).not.toBeNull();
  });

  it('mirrors the release for a left-handed striker and maps every engine pitch', () => {
    const k = engineCase('good_length', 2, 'off', 'good', 'green');
    const r = flightFromPath(k.path, { family: k.family, releaseToContactMs: k.timing.releaseToContactMs });
    const l = flightFromPath(k.path, { family: k.family, releaseToContactMs: k.timing.releaseToContactMs, handedness: 'left' });
    expect(r.release.p.x).toBeCloseTo(MATCH_RELEASE.paceX, 9);
    expect(l.release.p.x).toBeCloseTo(-MATCH_RELEASE.paceX, 9);
    expect(Math.abs(sampleAt(l.samples, l.idealContactT).p.x - k.path.lineAtBatM)).toBeLessThan(0.02);
    expect(CONDITIONS_FOR_PITCH).toEqual({ green: 'green', hard: 'hard', slow: 'turning' });
  });
});
