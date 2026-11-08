/**
 * Drawing helpers for the field maps: bearings from the striker (degrees, 0 = straight down the ground, + = the
 * batter's off side) to points in the map's frame (x mirrored for a left-hander, so the off side is where the batter
 * sees it), and wedge paths for the field's protected arcs and gaps. Pure geometry over the physics' own numbers.
 */
import type { FieldArc } from '@/contracts';
import type { GroundGeometry } from '../context';

const RAD = Math.PI / 180;

/** Distance from the striker to a circle of radius r about the pitch centre, along a bearing. */
function distanceToCircle(g: GroundGeometry, bearing: number, r: number): number {
  const ux = Math.sin(bearing * RAD);
  const uz = -Math.cos(bearing * RAD);
  const b = g.striker.x * ux + g.striker.z * uz;
  const c = g.striker.x * g.striker.x + g.striker.z * g.striker.z - r * r;
  return -b + Math.sqrt(Math.max(0, b * b - c));
}

/** A ground point at a bearing and distance from the striker, in the map's frame. */
export function pointAt(g: GroundGeometry, bearing: number, d: number, mirror: 1 | -1): [number, number] {
  const x = g.striker.x + Math.sin(bearing * RAD) * d;
  const z = g.striker.z - Math.cos(bearing * RAD) * d;
  return [mirror * x, z];
}

const f = (n: number) => n.toFixed(2);

/** The wedge of an arc between two radii about the pitch centre (inner 0 = from the striker). */
export function wedgePath(
  g: GroundGeometry,
  arc: Pick<FieldArc, 'fromDeg' | 'toDeg'>,
  inner: number,
  outer: number,
  mirror: 1 | -1,
): string {
  const steps = Math.max(2, Math.ceil((arc.toDeg - arc.fromDeg) / 3));
  const outerPts: string[] = [];
  const innerPts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const b = arc.fromDeg + ((arc.toDeg - arc.fromDeg) * i) / steps;
    const [ox, oz] = pointAt(g, b, distanceToCircle(g, b, outer), mirror);
    outerPts.push(`${f(ox)} ${f(oz)}`);
    if (inner > 0) {
      const [ix, iz] = pointAt(g, b, distanceToCircle(g, b, inner), mirror);
      innerPts.push(`${f(ix)} ${f(iz)}`);
    }
  }
  const start = inner > 0 ? innerPts[0] : `${f(mirror * g.striker.x)} ${f(g.striker.z)}`;
  const back = inner > 0 ? innerPts.reverse().join(' L') : `${f(mirror * g.striker.x)} ${f(g.striker.z)}`;
  return `M${start} L${outerPts.join(' L')} L${back} Z`;
}

/** Where to write an arc's label: its middle bearing, a little inside the outer radius. */
export function arcLabelAt(
  g: GroundGeometry,
  arc: Pick<FieldArc, 'fromDeg' | 'toDeg'>,
  r: number,
  mirror: 1 | -1,
): [number, number] {
  const b = (arc.fromDeg + arc.toDeg) / 2;
  return pointAt(g, b, distanceToCircle(g, b, r) * 0.82, mirror);
}
