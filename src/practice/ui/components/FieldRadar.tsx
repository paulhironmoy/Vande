/**
 * The pre-over field radar: the whole ground from above, as the batter sees it (the bowler's end at the top, the
 * striker at the bottom, the batter's off side on the off side: right for a right-hander, left for a left-hander).
 * Fielders are shaped and coloured by kind and listed in words, so nothing depends on colour.
 */
import type { FieldLayout, Handedness } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { useKit } from '../context';
import s from './FieldRadar.module.css';

export interface FieldCounts {
  off: number;
  leg: number;
  deep: number;
}

/** Off-side, leg-side and boundary fielders (keeper and bowler excluded), by the physics' own fielder classes. */
export function fieldCounts(field: FieldLayout, cls: (f: FieldLayout['fielders'][number]) => string): FieldCounts {
  let off = 0;
  let leg = 0;
  let deep = 0;
  for (const f of field.fielders) {
    const c = cls(f);
    if (c === 'keeper' || c === 'bowler') continue;
    if (f.x > 0.5) off++;
    else if (f.x < -0.5) leg++;
    if (c === 'deep') deep++;
  }
  return { off, leg, deep };
}

export interface FieldRadarProps {
  field: FieldLayout;
  handedness: Handedness;
  className?: string;
}

export function FieldRadar({ field, handedness, className }: FieldRadarProps) {
  const t = usePracticeT();
  const { ground, fielderClass } = useKit();
  const R = ground.boundaryR + 4;
  const mirror = handedness === 'left' ? -1 : 1;
  const roles = field.fielders.map((f) => t.tk(`practice.fielder.${f.role}`)).join(', ');
  const counts = fieldCounts(field, fielderClass);
  const label = `${t.t('practice.live.field_title')}: ${t.t('practice.live.field_summary', { ...counts })}. ${roles}.`;
  return (
    <svg className={[s.radar, className ?? ''].join(' ')} viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} role="img" aria-label={label} data-testid="field-radar">
      <circle className={s.grass} cx={0} cy={0} r={ground.boundaryR} />
      <circle className={s.ring} cx={0} cy={0} r={ground.ringR} />
      <rect className={s.pitch} x={-1.6} y={-ground.pitchHalf} width={3.2} height={2 * ground.pitchHalf} rx={0.6} />
      <circle className={s.striker} cx={0} cy={ground.pitchHalf - 1.2} r={1.6} />
      {field.fielders.map((f) => {
        const c = fielderClass(f);
        const x = mirror * f.x;
        const cls = [s.fielder, c === 'deep' ? s.deep : '', c === 'close' ? s.close : '', c === 'keeper' || c === 'bowler' ? s.keeper : ''].join(' ');
        // Shapes as well as colours: deep fielders are diamonds, close catchers squares, the rest circles.
        if (c === 'deep') return <path key={f.id} className={cls} d={`M${x} ${f.z - 3.4}L${x + 3.4} ${f.z}L${x} ${f.z + 3.4}L${x - 3.4} ${f.z}Z`} />;
        if (c === 'close') return <rect key={f.id} className={cls} x={x - 2.4} y={f.z - 2.4} width={4.8} height={4.8} rx={0.8} />;
        return <circle key={f.id} className={cls} cx={x} cy={f.z} r={2.7} />;
      })}
      <text className={s.label} x={mirror * (ground.boundaryR * 0.55)} y={ground.boundaryR * 0.92} textAnchor="middle" aria-hidden="true">
        {t.t('practice.live.off')}
      </text>
      <text className={s.label} x={-mirror * (ground.boundaryR * 0.55)} y={ground.boundaryR * 0.92} textAnchor="middle" aria-hidden="true">
        {t.t('practice.live.leg')}
      </text>
    </svg>
  );
}
