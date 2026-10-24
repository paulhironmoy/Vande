import { useId } from 'react';
import styles from './Logo.module.css';

/**
 * VANDE mark — two opposing arcs held in balance (a "V"), an equilibrium beam resting across them,
 * a fulcrum point and a quiet 24-point rhythm of short rim ticks. Geometry mirrors scripts/brand.mjs.
 */
const ARM_LEFT = 'M62 78C70 128 92 164 128 190';
const ARM_RIGHT = 'M194 78C186 128 164 164 128 190';
const BEAM = 'M46 108H210';

const TICKS = Array.from({ length: 24 }, (_, i) => {
  const a = ((i * 15 - 90) * Math.PI) / 180;
  return {
    x1: +(128 + 110 * Math.cos(a)).toFixed(2),
    y1: +(128 + 110 * Math.sin(a)).toFixed(2),
    x2: +(128 + 118 * Math.cos(a)).toFixed(2),
    y2: +(128 + 118 * Math.sin(a)).toFixed(2),
  };
});

export type LogoVariant = 'dark' | 'light' | 'mono';

export interface LogoProps {
  size?: number;
  /** Plays the settle animation (slightly unbalanced → equilibrium, < 700 ms). Respects reduced motion. */
  animated?: boolean;
  variant?: LogoVariant;
  title?: string;
  className?: string;
  /** Hide the rim ticks (useful below ~40 px). */
  compact?: boolean;
}

export function Logo({ size = 96, animated = false, variant = 'dark', title = 'VANDE', className, compact = false }: LogoProps) {
  const uid = useId().replace(/:/g, '');
  const gradId = `vande-grad-${uid}`;
  const titleId = `vande-title-${uid}`;
  const colours =
    variant === 'dark'
      ? { arm: `url(#${gradId})`, beam: 'var(--c-cyan, #62D6FF)', fulcrum: 'var(--c-paper, #F7F9FC)', tick: 'var(--c-steel, #AAB6C8)', tickOpacity: 0.32 }
      : variant === 'light'
        ? { arm: 'var(--c-navy, #0B1D36)', beam: 'var(--c-blue, #136EF6)', fulcrum: 'var(--c-blue, #136EF6)', tick: 'var(--c-navy, #0B1D36)', tickOpacity: 0.3 }
        : { arm: 'currentColor', beam: 'currentColor', fulcrum: 'currentColor', tick: 'currentColor', tickOpacity: 0.35 };

  const classes = [styles.logo, animated ? styles.animated : '', className ?? ''].filter(Boolean).join(' ');

  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 256 256"
      role="img"
      aria-labelledby={titleId}
      focusable="false"
      data-testid="logo"
    >
      <title id={titleId}>{title}</title>
      {variant === 'dark' && (
        <defs>
          <linearGradient id={gradId} x1="46" y1="78" x2="210" y2="190" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--c-cyan, #62D6FF)" />
            <stop offset="0.55" stopColor="var(--c-electric, #38A0FF)" />
            <stop offset="1" stopColor="var(--c-blue, #136EF6)" />
          </linearGradient>
        </defs>
      )}
      {!compact && (
        <g className={styles.ticks} stroke={colours.tick} strokeWidth="3.5" strokeLinecap="round" opacity={colours.tickOpacity}>
          {TICKS.map((t, i) => (
            <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />
          ))}
        </g>
      )}
      <g fill="none" stroke={colours.arm} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round">
        <path className={styles.armLeft} d={ARM_LEFT} />
        <path className={styles.armRight} d={ARM_RIGHT} />
      </g>
      <path className={styles.beam} d={BEAM} fill="none" stroke={colours.beam} strokeWidth="12" strokeLinecap="round" />
      <circle className={styles.fulcrum} cx="128" cy="108" r="7.5" fill={colours.fulcrum} />
    </svg>
  );
}

export interface WordmarkProps {
  /** "VANDE//REPUBLIC" instead of "VANDE". */
  compact?: boolean;
  className?: string;
}

export function Wordmark({ compact = false, className }: WordmarkProps) {
  const classes = [styles.wordmark, className ?? ''].filter(Boolean).join(' ');
  if (compact) {
    return (
      <span className={classes} aria-label="VANDE: Republic Under Pressure">
        <span aria-hidden="true">VANDE</span>
        <span className={styles.slash} aria-hidden="true">
          //
        </span>
        <span aria-hidden="true">REPUBLIC</span>
      </span>
    );
  }
  return <span className={classes}>VANDE</span>;
}

export default Logo;
