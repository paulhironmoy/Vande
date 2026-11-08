/**
 * The camera fixtures' expected classes, checked WITHOUT Blender or a browser: the authored clips' own joints (the tracked "ideal"
 * traces in tests/fixtures/camera/traces, made by scripts/blender/camera/swing_clips.py) are played through the real camera pipeline
 * pieces (CameraBatter -> PoseMapper -> GestureTracker -> normalizeGesture) and must come out as the class each clip stands for:
 * a drive goes to the off side, a pull to the leg side, a loft is straight and high, a defence is a push, a leave and a still
 * person make no swing, a left-hander's mirror image is the same swing, and distance does not change it.
 * Synthetic landmarks: this is a check of the fixtures against the mapper, not a player result.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Handedness, NormalizedSwing } from '@/contracts/practice';
import { traceCamera } from '@/input/camera/simulate';
import { traceToPoseFrames, type LandmarkTrace } from '../../fixtures/camera/trace';

const dir = path.resolve(__dirname, '../../fixtures/camera/traces');
const load = (id: string): LandmarkTrace => JSON.parse(readFileSync(path.join(dir, `${id}.ideal.trace.json`), 'utf8'));

/** One delivery that goes live after a second of stance and ends before the clip does. */
function play(id: string, hand: Handedness): NormalizedSwing | null {
  const frames = traceToPoseFrames(load(id));
  return traceCamera({ frames, armAtMs: 900, disarmAtMs: 3900, handedness: hand }).swing;
}

describe('the rendered-clip fixtures through the camera pipeline (ideal landmarks)', () => {
  it('a drive is an attack to the off side with real power', () => {
    const s = play('rh_drive', 'right');
    expect(s?.kind).toBe('attack');
    expect(s!.directionDeg).toBeGreaterThan(20);
    expect(s!.power).toBeGreaterThan(0.5);
  });

  it('a pull is an attack to the leg side', () => {
    const s = play('rh_pull', 'right');
    expect(s?.kind).toBe('attack');
    expect(s!.directionDeg).toBeLessThan(-20);
  });

  it('a loft is an attack roughly straight, and lifted at least as much as the drive', () => {
    const s = play('rh_loft', 'right');
    const d = play('rh_drive', 'right');
    expect(s?.kind).toBe('attack');
    expect(Math.abs(s!.directionDeg)).toBeLessThan(20);
    expect(s!.elevation).toBeGreaterThanOrEqual(d!.elevation);
  });

  it('a defence is a defensive push', () => {
    expect(play('rh_defence', 'right')?.kind).toBe('defend');
  });

  it('a held backlift that comes back slowly, and a person standing still, make no swing', () => {
    expect(play('rh_leave', 'right')).toBeNull();
    expect(play('still', 'right')).toBeNull();
  });

  it("a left-hander's mirror image is exactly the right-hander's swing", () => {
    for (const stroke of ['drive', 'pull', 'loft', 'defence', 'leave']) {
      expect(play(`lh_${stroke}`, 'left'), stroke).toEqual(play(`rh_${stroke}`, 'right'));
    }
  });

  it('distance from the camera changes the swing only a little (shoulder width is the unit)', () => {
    const mid = play('rh_drive', 'right')!;
    for (const id of ['rh_drive_near', 'rh_drive_far', 'rh_drive_portrait']) {
      const s = play(id, 'right')!;
      expect(s.kind, id).toBe('attack');
      expect(Math.abs(s.directionDeg - mid.directionDeg), id).toBeLessThan(12);
      expect(Math.abs(s.power - mid.power), id).toBeLessThan(0.2);
    }
  });

  it('the same trace always gives the same swing', () => {
    expect(play('rh_pull', 'right')).toEqual(play('rh_pull', 'right'));
  });
});
