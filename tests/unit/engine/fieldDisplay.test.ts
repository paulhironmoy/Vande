// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FieldSetting, FieldZone } from '@/contracts';
import { FIELD_POSITIONS } from '@/engine';
import { FIELD_LAYOUTS, FIELD_SETTINGS } from '@/engine/v1/tables';
import { zoneFromSwipe } from '@/engine/v1/traces';
import { CONTACT_Z, RING_R, ZONES, zoneForBearing } from '@/render3d/core/ground';

const DEG = Math.PI / 180;
/** Where ground.ts puts a fielder (before its boundary clamp): metres from the centre of the pitch. */
const fromCentre = (bearingDeg: number, distanceM: number) => Math.hypot(Math.sin(bearingDeg * DEG) * distanceM, CONTACT_Z - Math.cos(bearingDeg * DEG) * distanceM);

describe('FIELD_POSITIONS: the field players see is the field the engine plays', () => {
  it('nine fielders per setting, each a unique position', () => {
    for (const f of FIELD_SETTINGS) {
      expect(FIELD_POSITIONS[f]).toHaveLength(9);
      expect(new Set(FIELD_POSITIONS[f].map((p) => p.role)).size).toBe(9);
    }
  });

  it('every zone is covered exactly as FIELD_LAYOUTS says: ring, deep, both, or a gap with nobody in it', () => {
    for (const f of FIELD_SETTINGS) {
      for (const zone of ZONES as readonly FieldZone[]) {
        const here = FIELD_POSITIONS[f].filter((p) => p.zone === zone && p.kind !== 'close');
        const ring = here.some((p) => p.kind === 'ring');
        const deep = here.some((p) => p.kind === 'deep');
        const coverage = ring && deep ? 'both' : ring ? 'ring' : deep ? 'deep' : 'gap';
        expect(coverage, `${f} ${zone}`).toBe(FIELD_LAYOUTS[f].zones[zone]);
      }
    }
  });

  it('each fielder stands inside its zone for the batting swipe and for the renderer', () => {
    for (const f of FIELD_SETTINGS)
      for (const p of FIELD_POSITIONS[f]) {
        // Surface coordinates of a swipe towards that bearing: x right (off side), y down (straight is up).
        expect(zoneFromSwipe(Math.sin(p.bearingDeg * DEG), -Math.cos(p.bearingDeg * DEG)), `${f} ${p.role} swipe`).toBe(p.zone);
        expect(zoneForBearing(p.bearingDeg), `${f} ${p.role} renderer`).toBe(p.zone);
      }
  });

  it('ring fielders inside the circle, deep ones near the rope, close catchers next to the bat', () => {
    for (const f of FIELD_SETTINGS)
      for (const p of FIELD_POSITIONS[f]) {
        if (p.kind === 'ring') expect(fromCentre(p.bearingDeg, p.distanceM), `${f} ${p.role}`).toBeLessThan(RING_R);
        if (p.kind === 'deep') expect(fromCentre(p.bearingDeg, p.distanceM), `${f} ${p.role}`).toBeGreaterThan(45);
        if (p.kind === 'close') expect(p.distanceM, `${f} ${p.role}`).toBeLessThanOrEqual(12);
      }
  });

  it('more slips where edges carry more often (slipCatch)', () => {
    const slips = (f: FieldSetting) => FIELD_POSITIONS[f].filter((p) => p.role.startsWith('slip')).length;
    const order = [...FIELD_SETTINGS].sort((a, b) => FIELD_LAYOUTS[b].slipCatch - FIELD_LAYOUTS[a].slipCatch);
    for (let i = 1; i < order.length; i++) expect(slips(order[i - 1])).toBeGreaterThan(slips(order[i]));
    // Close catchers exist only where the engine gives close catches.
    for (const f of FIELD_SETTINGS) if (FIELD_LAYOUTS[f].closeCatch === 0 && FIELD_LAYOUTS[f].slipCatch < 0.2) expect(FIELD_POSITIONS[f].filter((p) => p.kind === 'close')).toEqual([]);
  });
});
