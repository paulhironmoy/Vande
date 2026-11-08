// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  batSpeed,
  batTravelMs,
  buildBatTrack,
  idealTimeFor,
  incomingSpin,
  solveFace,
  solveProjectedFace,
  targetElevationDeg,
} from '@/physics/bat';
import { faceCor as materialFaceCor, swingArm as materialSwingArm } from '@/physics/batMaterial';
import { faceCor as contactFaceCor, swingArm as contactSwingArm } from '@/physics/contact';
import { SWEET_U } from '@/physics/constants';
import { bearingDelta, bearingDeg, dot, elevationDeg } from '@/physics/vec';
import { fly } from './physics-helpers';

describe('material-consistent cross-bat face solve', () => {
  it('keeps the authoritative contact-material exports on one implementation', () => {
    expect(contactFaceCor).toBe(materialFaceCor);
    expect(contactSwingArm).toBe(materialSwingArm);
    expect(contactFaceCor('attack', SWEET_U, 0, 1)).toBe(materialFaceCor('attack', SWEET_U, 0, 1));
    expect(contactSwingArm(SWEET_U)).toEqual({ speed: 1, mass: 1 });
  });

  it('solves the projected cut velocity and real contact material to the authored outcome', () => {
    const flight = fly({ variation: 'bouncer', lengthM: 10.5, lineM: 0.3, speedKph: 136 });
    const power = 0.65;
    const directionDeg = 90;
    const elevation = 0.2;
    const speed = batSpeed('attack', power);
    const swing = {
      kind: 'attack',
      directionDeg,
      elevation,
      power,
      footwork: 'back',
      startT: idealTimeFor(flight, 'back') - batTravelMs('attack', power) / 1000,
    } as const;
    const track = buildBatTrack(flight, swing, { assist: 'real' });
    const targetElevation = targetElevationDeg('attack', elevation) + track.shot.popDeg;
    const spin = incomingSpin(flight, track.idealT);
    const oldFace = solveFace(track.read.u, spin, directionDeg, targetElevation, 'attack', speed, track.balance);
    const request = {
      incomingVelocity: track.read.u,
      incomingSpin: spin,
      contactAim: track.contactAim,
      intendedBearingDeg: directionDeg,
      targetElevationDeg: targetElevation,
      kind: 'attack' as const,
      speedMps: speed,
      balance: track.balance,
      horizontal: 1,
      semanticRollRad: 0,
      requestedContactU: 0.475,
      physicalTimingErrorMs: 0,
      initialNormal: oldFace.n,
    };
    const solved = solveProjectedFace(request);
    const repeated = solveProjectedFace(request);

    expect(solved).not.toBeNull();
    expect(repeated).toEqual(solved);
    expect(Math.abs(dot(solved!.surfaceV, solved!.a))).toBeLessThan(1e-12);
    expect(solved!.contactU).toBeCloseTo(0.475, 12);
    expect(Math.abs(bearingDelta(bearingDeg(solved!.exit.x, solved!.exit.z), directionDeg))).toBeLessThan(1e-6);
    expect(Math.abs(elevationDeg(solved!.exit) - targetElevation)).toBeLessThan(1e-6);
    // The old unprojected/sweet-material face is only an initial guess; a coherent cut requires a materially
    // different normal once the exact projected point velocity and U=.475 material are used.
    expect(Math.hypot(solved!.n.x - oldFace.n.x, solved!.n.y - oldFace.n.y, solved!.n.z - oldFace.n.z)).toBeGreaterThan(
      0.02,
    );
  });
});
