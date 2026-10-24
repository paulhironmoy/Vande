import { useId, useMemo, useState, type PointerEvent } from 'react';
import type { Dimension, Pulse, Scores } from '@/engine/types';
import { DIMENSIONS, DIMENSION_LABELS } from '@/engine/types';
import { DIMENSION_ICON, PlayIcon, type PlayIconName } from './icons';
import { balanceWord, instabilityWord, pulseSummary, trendOf, trendWord, type Trend } from './format';
import { useSmoothedScores } from './hooks';
import styles from './RepublicPulse.module.css';

export interface RepublicPulseProps {
  pulse: Pulse;
  scores: Scores;
  variant?: 'full' | 'compact';
  reducedMotion?: boolean;
  alwaysShowValues?: boolean;
  /** Compact variant: called when tapped (e.g. to open a detail sheet). */
  onExpand?: () => void;
  testId?: string;
  valuesTestId?: string;
  className?: string;
}

const CX = 120;
const CY = 120;
const R_MIN = 14;
const R_MAX = 84;
const R_RING = 96;
const R_ICON = 110;

function polar(r: number, i: number): { x: number; y: number } {
  const a = (-90 + i * 60) * (Math.PI / 180);
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}

function radiusFor(value: number): number {
  const v = Math.max(0, Math.min(100, value));
  return R_MIN + ((R_MAX - R_MIN) * v) / 100;
}

const TREND_ICON: Record<Trend, PlayIconName> = { rising: 'up', falling: 'down', steady: 'steady' };
const TREND_LABEL: Record<Trend, string> = { rising: 'Rising', falling: 'Falling', steady: 'Steady' };

export function PulseValues({ pulse, scores, testId = 'pulse-values', id }: { pulse: Pulse; scores: Scores; testId?: string; id?: string }) {
  return (
    <div className={styles.values} data-testid={testId} id={id}>
      <dl className={styles.valueList}>
        {DIMENSIONS.map((d: Dimension) => {
          const t = trendOf(pulse.momentum[d]);
          return (
            <div className={styles.row} key={d} data-dim={d}>
              <dt className={styles.dt}>
                <PlayIcon name={DIMENSION_ICON[d]} size={16} className={styles.dimIcon} style={{ color: `var(--o-${d})` }} />
                <span>{DIMENSION_LABELS[d]}</span>
              </dt>
              <dd className={styles.num}>{Math.round(scores[d])}</dd>
              <dd className={styles.trend} data-trend={t}>
                <PlayIcon name={TREND_ICON[t]} size={14} />
                <span>{trendWord(t)}</span>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className={styles.meta}>
        <span>
          Balance: <strong>{balanceWord(pulse.balance)}</strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Instability: <strong>{instabilityWord(pulse.instability)}</strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Weakest: <strong>{DIMENSION_LABELS[pulse.weakest]}</strong>
        </span>
      </p>
    </div>
  );
}

export function RepublicPulse({ pulse, scores, variant = 'full', reducedMotion = false, alwaysShowValues = false, onExpand, testId = 'pulse', valuesTestId = 'pulse-values', className }: RepublicPulseProps) {
  const shown = useSmoothedScores(scores, !reducedMotion);
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const panelId = useId();
  const gradId = useId();
  const summary = useMemo(() => pulseSummary(pulse, scores), [pulse, scores]);
  const mean = Math.round(pulse.mean);
  const direction: Trend = pulse.direction;

  const geometry = useMemo(() => {
    const tips = DIMENSIONS.map((d, i) => ({ d, i, r: radiusFor(shown[d]), ...polar(radiusFor(shown[d]), i) }));
    const area = tips.map((t) => `${t.x.toFixed(2)},${t.y.toFixed(2)}`).join(' ');
    const ringPts = DIMENSIONS.map((d, i) => polar(R_RING + (shown[d] - pulse.mean) * 0.18, i));
    const ring = ringPts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    const sectors = tips.map((t, i) => {
      const n = tips[(i + 1) % tips.length];
      return { d: t.d, path: `M${CX},${CY} L${t.x.toFixed(2)},${t.y.toFixed(2)} L${n.x.toFixed(2)},${n.y.toFixed(2)} Z` };
    });
    return { tips, area, ring, sectors };
  }, [shown, pulse.mean]);

  const instability = Math.max(0, Math.min(1, pulse.instability));
  const dashOn = 8 + 48 * (1 - instability);
  const dashOff = 1.5 + 14 * instability;
  const amp = (0.012 + 0.05 * instability).toFixed(3);

  if (variant === 'compact') {
    return (
      <button
        type="button"
        className={[styles.compact, className ?? ''].filter(Boolean).join(' ')}
        data-testid={testId}
        onClick={onExpand}
        aria-label={`${summary} Show details.`}
      >
        <svg viewBox="0 0 240 240" className={styles.compactSvg} aria-hidden="true" focusable="false">
          <circle cx={CX} cy={CY} r={R_MAX} className={styles.guide} />
          {geometry.sectors.map((s) => (
            <path key={s.d} d={s.path} className={styles.sector} style={{ fill: `var(--o-${s.d})` }} />
          ))}
          <polygon points={geometry.area} className={styles.area} />
          <polygon points={geometry.ring} className={styles.ring} style={{ strokeDasharray: `${dashOn} ${dashOff}` }} />
        </svg>
        <span className={styles.compactText} aria-hidden="true">
          <span className={styles.compactMean}>{mean}</span>
          <span className={styles.compactTrend} data-trend={direction}>
            <PlayIcon name={TREND_ICON[direction]} size={14} />
          </span>
        </span>
      </button>
    );
  }

  const showPanel = alwaysShowValues || pinned || hover || focus;
  const onPointerEnter = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') setHover(true);
  };
  const onPointerLeave = () => setHover(false);

  return (
    <div className={[styles.root, className ?? ''].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={styles.figure}
        data-testid={testId}
        aria-expanded={showPanel}
        aria-controls={panelId}
        aria-label={showPanel ? 'Hide Republic Pulse values' : 'Show Republic Pulse values'}
        onClick={() => setPinned((p) => !p)}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
      >
        <svg viewBox="0 0 240 240" className={styles.svg} role="img" aria-label={summary}>
          <defs>
            <radialGradient id={`${gradId}-area`} cx="50%" cy="50%" r="60%">
              <stop offset="0%" stopColor="var(--c-cyan)" stopOpacity="0.32" />
              <stop offset="70%" stopColor="var(--c-electric)" stopOpacity="0.14" />
              <stop offset="100%" stopColor="var(--c-blue)" stopOpacity="0.05" />
            </radialGradient>
            <filter id={`${gradId}-glow`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g className={styles.guides}>
            <circle cx={CX} cy={CY} r={R_MIN + (R_MAX - R_MIN) * 0.25} className={styles.guide} />
            <circle cx={CX} cy={CY} r={R_MIN + (R_MAX - R_MIN) * 0.5} className={styles.guide} />
            <circle cx={CX} cy={CY} r={R_MIN + (R_MAX - R_MIN) * 0.75} className={styles.guide} />
            <circle cx={CX} cy={CY} r={R_MAX} className={styles.guideStrong} />
            {DIMENSIONS.map((d, i) => {
              const p = polar(R_MAX, i);
              return <line key={d} x1={CX} y1={CY} x2={p.x} y2={p.y} className={styles.spoke} />;
            })}
          </g>
          <g className={reducedMotion ? undefined : styles.wobble} style={{ ['--amp' as string]: amp }}>
            {geometry.sectors.map((s) => (
              <path key={s.d} d={s.path} className={styles.sector} style={{ fill: `var(--o-${s.d})` }} />
            ))}
            <polygon points={geometry.area} className={styles.area} fill={`url(#${gradId}-area)`} filter={`url(#${gradId}-glow)`} />
          </g>
          <polygon points={geometry.ring} className={styles.ring} style={{ strokeDasharray: `${dashOn} ${dashOff}` }} />
          {geometry.tips.map((t) => {
            const trend = trendOf(pulse.momentum[t.d]);
            const angle = -90 + t.i * 60 + 90; // chevron paths point "up" in local space; rotate so up = outward
            const mag = Math.min(1, Math.abs(pulse.momentum[t.d]) / 8);
            return (
              <g key={t.d} className={styles.tip} style={{ transform: `translate(${CX}px, ${CY}px) rotate(${angle}deg) translate(0, -${t.r.toFixed(2)}px)`, color: `var(--o-${t.d})` }}>
                {trend === 'steady' ? (
                  <circle r={3.2} className={styles.tipDot} />
                ) : trend === 'rising' ? (
                  <g style={{ opacity: 0.45 + 0.55 * mag }}>
                    <line x1={0} y1={0} x2={0} y2={-9 - 8 * mag} className={styles.trail} />
                    <path d={`M-4.5,${-6 - 8 * mag} L0,${-11 - 8 * mag} L4.5,${-6 - 8 * mag}`} className={styles.arrow} />
                  </g>
                ) : (
                  <g style={{ opacity: 0.45 + 0.55 * mag }}>
                    <line x1={0} y1={0} x2={0} y2={9 + 8 * mag} className={styles.trail} />
                    <path d={`M-4.5,${6 + 8 * mag} L0,${11 + 8 * mag} L4.5,${6 + 8 * mag}`} className={styles.arrow} />
                  </g>
                )}
              </g>
            );
          })}
          {DIMENSIONS.map((d, i) => {
            const p = polar(R_ICON, i);
            return <PlayIcon key={d} name={DIMENSION_ICON[d]} size={17} x={p.x - 8.5} y={p.y - 8.5} className={styles.dimGlyph} style={{ color: `var(--o-${d})` }} />;
          })}
          <text x={CX} y={CY + 9} textAnchor="middle" className={styles.mean}>
            {mean}
          </text>
          <g className={styles.dir} data-trend={direction} transform={`translate(${CX}, ${CY + 28})`}>
            <PlayIcon name={TREND_ICON[direction]} size={12} x={-26} y={-9} />
            <text x={-11} y={0} className={styles.dirText}>
              {TREND_LABEL[direction]}
            </text>
          </g>
        </svg>
      </button>
      {showPanel ? <PulseValues pulse={pulse} scores={scores} testId={valuesTestId} id={panelId} /> : <div id={panelId} hidden />}
    </div>
  );
}

export default RepublicPulse;
