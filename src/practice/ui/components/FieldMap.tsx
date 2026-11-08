/**
 * The field before the over (constitution §5, the North Star's field intelligence): all eleven fielders (with their
 * named positions, once the cricket words have been met), the batter's orientation (the off side where the batter
 * sees it), the rope and the ring, the catchers, the arcs the field protects and the gaps it leaves. A picture, not a
 * set of controls: its gaps and catchers are also said in words (its name here, and the setup's field section), so no
 * small target is ever needed. Everything is told by shape and words as well as colour. The data is the physics' own.
 */
import type { FieldIntent, FieldLayout, Fielder, Handedness } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { useKit } from '../context';
import { zoneWord } from '../coaching';
import { arcLabelAt, wedgePath } from './fieldGeometry';
import s from './FieldMap.module.css';

export interface FieldMapProps {
  field: FieldLayout;
  intent: FieldIntent | null;
  handedness: Handedness;
  labels?: boolean;
  testId?: string;
}

export function FieldMap({ field, intent, handedness, labels = true, testId = 'practice-field-map' }: FieldMapProps) {
  const t = usePracticeT();
  const { ground: g, fielderClass } = useKit();
  const mirror: 1 | -1 = handedness === 'left' ? -1 : 1;
  const R = g.boundaryR + 7;
  const catchers = new Set(intent?.attacking ?? []);
  const pos = (f: Fielder) => t.tk(`practice.pos.${f.role}`);
  const kindOf = (f: Fielder) => (catchers.has(f.id) ? 'catcher' : fielderClass(f));
  const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).join(', ');
  const deep = uniq((intent?.gaps ?? []).filter((gp) => gp.depth === 'deep').map((gp) => zoneWord(t, gp.region) ?? ''));
  const ring = uniq((intent?.gaps ?? []).filter((gp) => gp.depth === 'ring').map((gp) => zoneWord(t, gp.region) ?? ''));
  const close = uniq(field.fielders.filter((f) => catchers.has(f.id) && f.role !== 'keeper').map(pos));
  const name = [
    t.t('practice.field.map_label', { count: field.fielders.length }),
    deep ? t.t('practice.setup.gaps', { list: deep }) : '',
    ring ? t.t('practice.setup.ring_gaps', { list: ring }) : '',
    close ? t.t('practice.setup.catchers', { list: close }) : '',
  ]
    .filter(Boolean)
    .join('. ');
  const offX = mirror * g.boundaryR * 0.62;
  return (
    <div className={s.wrap} data-testid={testId}>
      <svg className={s.map} viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} role="img" aria-label={name}>
        <circle className={s.grass} cx={0} cy={0} r={g.boundaryR} />
        {intent?.protected.map((a, i) => (
          <path
            key={`p${i}`}
            className={s.protected}
            d={wedgePath(g, a, a.depth === 'deep' ? g.ringR : 0, a.depth === 'deep' ? g.boundaryR : g.ringR, mirror)}
            aria-hidden="true"
          />
        ))}
        <circle className={s.ring} cx={0} cy={0} r={g.ringR} />
        {intent?.gaps.map((gap, i) => (
          <path
            key={`g${i}`}
            className={gap.depth === 'deep' ? s.gapDeep : s.gapRing}
            d={wedgePath(g, gap, 0, gap.depth === 'deep' ? g.boundaryR : g.ringR, mirror)}
            data-testid={`practice-field-gap-${i}`}
          />
        ))}
        <rect className={s.pitch} x={-1.6} y={-g.pitchHalf} width={3.2} height={2 * g.pitchHalf} rx={0.6} />
        <circle className={s.batter} cx={mirror * g.striker.x} cy={g.striker.z} r={1.8} aria-hidden="true" />
        {field.fielders.map((f) => {
          const k = kindOf(f);
          const x = mirror * f.x;
          const cls =
            k === 'catcher'
              ? s.catcher
              : k === 'deep'
                ? s.deepDot
                : k === 'keeper' || k === 'bowler'
                  ? s.keeper
                  : s.dot;
          // Shapes as well as colours: catchers are squares, boundary riders diamonds, the rest circles.
          const shape =
            k === 'catcher' ? (
              <rect className={cls} x={x - 2.4} y={f.z - 2.4} width={4.8} height={4.8} rx={0.6} />
            ) : k === 'deep' ? (
              <path className={cls} d={`M${x} ${f.z - 3.2}L${x + 3.2} ${f.z}L${x} ${f.z + 3.2}L${x - 3.2} ${f.z}Z`} />
            ) : (
              <circle className={cls} cx={x} cy={f.z} r={2.5} />
            );
          const lx = x + (x >= 0 ? 3.6 : -3.6);
          return (
            <g key={f.id} className={s.fielder} data-testid={`practice-field-fielder-${f.id}`}>
              {shape}
              {labels && (
                <text className={s.label} x={lx} y={f.z + 1.5} textAnchor={x >= 0 ? 'start' : 'end'}>
                  {pos(f)}
                </text>
              )}
            </g>
          );
        })}
        {intent?.gaps
          .filter((gap) => gap.depth === 'deep')
          .slice(0, 4)
          .map((gap, i) => {
            const [x, y] = arcLabelAt(g, gap, g.boundaryR, mirror);
            return (
              <text key={`gl${i}`} className={s.sideLabel} x={x} y={y} textAnchor="middle" aria-hidden="true">
                {t.t('practice.field.gap_short')}
              </text>
            );
          })}
        <text className={s.sideLabel} x={offX} y={g.boundaryR + 5.5} textAnchor="middle" aria-hidden="true">
          {t.t('practice.field.off')}
        </text>
        <text className={s.sideLabel} x={-offX} y={g.boundaryR + 5.5} textAnchor="middle" aria-hidden="true">
          {t.t('practice.field.leg')}
        </text>
      </svg>
      <ul className={s.legend} aria-hidden="true">
        <li>
          <svg className={s.swatch} viewBox="0 0 10 10">
            <rect x={1} y={1} width={8} height={8} rx={1} className={s.gapDeep} />
          </svg>
          {t.t('practice.field.legend_gap')}
        </li>
        <li>
          <svg className={s.swatch} viewBox="0 0 10 10">
            <rect x={0} y={0} width={10} height={10} className={s.protected} />
          </svg>
          {t.t('practice.field.legend_protected')}
        </li>
        <li>
          <svg className={s.swatch} viewBox="0 0 10 10">
            <rect x={2} y={2} width={6} height={6} rx={0.8} className={s.catcher} />
          </svg>
          {t.t('practice.field.legend_catcher')}
        </li>
      </ul>
    </div>
  );
}
