/**
 * Scoring areas: the ground split into the physics' regions (REGION_EDGES), each shaded by the share of runs scored
 * there, with the same numbers listed in words beside it.
 */
import type { Handedness } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import type { Region, ScoringAreaLike } from '../flow/types';
import { useKit, type RegionEdges } from '../context';
import { areaWord } from '../coaching';
import s from './WagonWheel.module.css';

/** Each region's bearing range (degrees from straight, + = off side) from the edges. */
export function regionSectors(e: RegionEdges): Record<Region, [number, number]> {
  return {
    straight: [-e.straight, e.straight],
    mid_off: [e.straight, e.midOff],
    cover: [e.midOff, e.cover],
    point: [e.cover, e.point],
    third_man: [e.point, e.behind],
    behind: [e.behind, 360 - e.behind],
    fine_leg: [-e.behind, -e.point],
    square_leg: [-e.point, -e.cover],
    midwicket: [-e.cover, -e.midOff],
    mid_on: [-e.midOff, -e.straight],
  };
}

function arc(r: number, a0: number, a1: number, mirror: number): string {
  // Bearing 0 points up the screen (down the ground); + towards the off side.
  const p = (a: number) => {
    const rad = (a * Math.PI) / 180;
    return `${(mirror * Math.sin(rad) * r).toFixed(2)} ${(-Math.cos(rad) * r).toFixed(2)}`;
  };
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = mirror > 0 ? 1 : 0;
  return `M0 0L${p(a0)}A${r} ${r} 0 ${large} ${sweep} ${p(a1)}Z`;
}

export interface WagonWheelProps {
  areas: readonly ScoringAreaLike[];
  handedness: Handedness;
  testId?: string;
}

export function WagonWheel({ areas, handedness, testId }: WagonWheelProps) {
  const t = usePracticeT();
  const { regionEdges } = useKit();
  const sectors = regionSectors(regionEdges);
  const scored = areas.filter((a) => a.runs > 0);
  const max = Math.max(1, ...scored.map((a) => a.runs));
  const mirror = handedness === 'left' ? -1 : 1;
  if (!scored.length) return <p className={s.none} data-testid={testId}>{t.t('practice.over.areas_none')}</p>;
  return (
    <div className={s.wrap} data-testid={testId}>
      <svg className={s.wheel} viewBox="-52 -52 104 104" aria-hidden="true">
        <circle className={s.ground} cx={0} cy={0} r={48} />
        {(Object.keys(sectors) as Region[]).map((r) => {
          const a = scored.find((x) => x.region === r);
          const [a0, a1] = sectors[r];
          return <path key={r} className={a ? s.sector : s.spoke} d={arc(48, a0, a1, mirror)} style={a ? { fillOpacity: 0.25 + 0.75 * (a.runs / max) } : { fill: 'none' }} />;
        })}
      </svg>
      <ul className={s.list}>
        {scored.map((a) => (
          <li key={a.region} className={s.row}>
            <span>{areaWord(t, a.region)}</span>
            <span className={s.runs}>{t.t('practice.common.runs', { count: a.runs })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
