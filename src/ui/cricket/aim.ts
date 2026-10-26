/**
 * Swipe-to-zone mapping. The UI ships local copies of the engine's rules (so the design system does not pull the
 * engine into the app shell); screens that use the engine register the engine's own functions at load time
 * (src/screens/engineRules.ts), and tests assert the local tables match the engine.
 */
import type { FieldZone, ShotType } from '@/contracts';

/** Sector order clockwise from straight up in the batter's view (x right, y down): mirrors the engine table. */
export const SECTOR_ORDER: readonly FieldZone[] = ['mid_off', 'cover', 'point', 'third_man', 'fine_leg', 'square_leg', 'midwicket', 'mid_on'];

export const LOCAL_LEGAL_ZONES: Record<ShotType, readonly FieldZone[]> = {
  defend: [],
  leave: [],
  rotate: ['third_man', 'point', 'cover', 'mid_off', 'mid_on', 'midwicket', 'square_leg', 'fine_leg'],
  drive: ['point', 'cover', 'mid_off', 'mid_on', 'midwicket'],
  cut_pull: ['third_man', 'point', 'cover', 'midwicket', 'square_leg', 'fine_leg'],
  sweep: ['third_man', 'point', 'midwicket', 'square_leg', 'fine_leg'],
  loft: ['third_man', 'point', 'cover', 'mid_off', 'mid_on', 'midwicket', 'square_leg', 'fine_leg'],
};

interface AimRules {
  legal?: Record<ShotType, readonly FieldZone[]>;
  fromSwipe?: (dx: number, dy: number) => FieldZone | null;
}
let rules: AimRules = {};

/** Called by engine-using screens so the UI applies the engine's exact rules. */
export function registerAimRules(r: AimRules) {
  rules = r;
}

export function legalZones(shot: ShotType): readonly FieldZone[] {
  return rules.legal?.[shot] ?? LOCAL_LEGAL_ZONES[shot];
}

/** Sector 0-7 clockwise from straight up (x right, y down) using the engine's exact comparisons; -1 for no swipe. */
export function localSectorOf(dx: number, dy: number): number {
  const X = dx;
  const Y = -dy;
  if (X === 0 && Y === 0) return -1;
  if (X >= 0 && Y > 0) return X < Y ? 0 : 1;
  if (X > 0 && Y <= 0) return X > -Y ? 2 : 3;
  if (X <= 0 && Y < 0) return -X < -Y ? 4 : 5;
  return -X > Y ? 6 : 7;
}

export function localZoneFromSwipe(dx: number, dy: number): FieldZone | null {
  const s = localSectorOf(dx, dy);
  return s < 0 ? null : SECTOR_ORDER[s];
}

export function zoneFromSwipe(dx: number, dy: number): FieldZone | null {
  return rules.fromSwipe ? rules.fromSwipe(dx, dy) : localZoneFromSwipe(dx, dy);
}

const C = 0.9238795325112867;
const S = 0.3826834323650898;
/** Unit vectors (x right, y up) at each sector centre, in SECTOR_ORDER. */
const SECTOR_VECTORS: ReadonlyArray<readonly [number, number]> = [
  [S, C],
  [C, S],
  [C, -S],
  [S, -C],
  [-S, -C],
  [-C, -S],
  [-C, S],
  [-S, C],
];

/** Unit swipe vector (y down) at the centre of a zone's sector. */
export function vectorForZone(zone: FieldZone): { dx: number; dy: number } {
  const v = SECTOR_VECTORS[Math.max(0, SECTOR_ORDER.indexOf(zone))];
  return { dx: v[0], dy: -v[1] };
}

/** Sector distance (0 = same, 1 = adjacent ...). */
export function sectorDistance(a: FieldZone, b: FieldZone): number {
  const d = Math.abs(SECTOR_ORDER.indexOf(a) - SECTOR_ORDER.indexOf(b)) % 8;
  return Math.min(d, 8 - d);
}

/** Nearest legal zone to `zone` for a shot (null for shots without a zone). */
export function nearestLegal(shot: ShotType, zone: FieldZone | null): FieldZone | null {
  const legal = legalZones(shot);
  if (legal.length === 0) return null;
  if (!zone) return legal[0];
  if (legal.includes(zone)) return zone;
  let best = legal[0];
  for (const z of legal) if (sectorDistance(z, zone) < sectorDistance(best, zone)) best = z;
  return best;
}
