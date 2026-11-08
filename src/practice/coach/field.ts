/**
 * The field as the coach aims through it, from the physics' own field intelligence (src/physics field.ts
 * `fieldIntent`): the arcs a fielder protects (ring fielders against a well-hit ground stroke, boundary riders) and the
 * gaps between them. Used to choose where candidate strokes aim and to flag an aim into a protected arc; whether a
 * stroke actually scores is always the simulated fielding's verdict.
 */
import type { DeliveryRecord, FieldArc } from '@/contracts/practice';
import { fieldIntent, type Region } from '@/physics';

export const FIELD_COVER = {
  /** Narrower openings are not aimed at (deg). */
  minGapDeg: 10,
  /** Gaps are aimed at within this bearing either side of straight (deg): fine leg and third man included. */
  scoringArcDeg: 140,
} as const;

interface CoachGap extends FieldArc {
  region: Region;
  centreDeg: number;
  widthDeg: number;
}

export interface CoachField {
  /** fieldIntent's protected arcs: 'ring' against ground strokes, 'deep' the boundary riders. */
  protected: FieldArc[];
  /** Gaps to aim at, ordered by bearing ('deep': nobody stops a ground stroke; 'ring': it beats the ring only). */
  gaps: CoachGap[];
}

const round1 = (v: number) => Math.round(v * 10) / 10 || 0;

/** The coach's view of the record's field (deterministic in the layout, the bowler, the pitch and the handedness). */
export function coachField(r: Pick<DeliveryRecord, 'field' | 'bowler' | 'conditions' | 'handedness'>): CoachField {
  const intent = fieldIntent(r.field, r.bowler, r.conditions, r.handedness);
  const lim = FIELD_COVER.scoringArcDeg;
  const gaps: CoachGap[] = [];
  for (const g of intent.gaps) {
    const from = Math.max(g.fromDeg, -lim);
    const to = Math.min(g.toDeg, lim);
    if (to - from < FIELD_COVER.minGapDeg) continue;
    gaps.push({
      fromDeg: from,
      toDeg: to,
      depth: g.depth,
      region: g.region,
      centreDeg: round1((from + to) / 2),
      widthDeg: round1(to - from),
    });
  }
  return { protected: intent.protected.map((a) => ({ ...a })), gaps };
}

/**
 * Whether a stroke aimed at this bearing goes straight into a protected arc: a ring fielder's for a stroke along the
 * ground, a boundary rider's for a lofted one.
 */
export function intoProtected(field: CoachField, directionDeg: number, lofted: boolean): boolean {
  const depth: FieldArc['depth'] = lofted ? 'deep' : 'ring';
  return field.protected.some((a) => a.depth === depth && directionDeg >= a.fromDeg && directionDeg <= a.toDeg);
}

/** Angular clearance of an aim from the protected ring arcs (deg, + = clear inside a gap, − = inside a protected arc). */
export function aimClearanceDeg(field: CoachField, directionDeg: number): number {
  const ring = field.protected.filter((a) => a.depth === 'ring');
  const holder = ring.find((a) => directionDeg >= a.fromDeg && directionDeg <= a.toDeg);
  if (holder) return round1(-Math.min(directionDeg - holder.fromDeg, holder.toDeg - directionDeg));
  let best = 90;
  for (const a of ring)
    best = Math.min(best, directionDeg < a.fromDeg ? a.fromDeg - directionDeg : directionDeg - a.toDeg);
  return round1(best);
}
