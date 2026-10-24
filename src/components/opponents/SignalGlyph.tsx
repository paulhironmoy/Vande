import type { OpponentMeta } from '@/engine/types';
import styles from './SignalGlyph.module.css';

interface SignalGlyphProps {
  kind: OpponentMeta['signal'];
  size?: number;
  animated?: boolean;
  className?: string;
  title?: string;
}

const SIGNAL_NAMES: Record<OpponentMeta['signal'], string> = {
  pulse: 'Pulse pattern: pressure spreading outward',
  spike: 'Spike pattern: sudden confrontations',
  swarm: 'Swarm pattern: many small false signals',
  fracture: 'Fracture pattern: systems breaking under confusion',
  bait: 'Bait pattern: lures for disproportionate reaction',
};

/**
 * Abstract signal pattern for an opponent behaviour. Bug glyphs (swarm) stand for automated misinformation —
 * never for people. Animation stops under reduced motion (CSS) or when `animated` is false.
 */
export function SignalGlyph({ kind, size = 48, animated = true, className, title }: SignalGlyphProps) {
  const cls = [styles.svg, animated ? '' : styles.static, className].filter(Boolean).join(' ');
  const a11y = title === '' ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title ?? SIGNAL_NAMES[kind] };
  const common = { width: size, height: size, viewBox: '0 0 64 64', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  switch (kind) {
    case 'pulse':
      return (
        <svg {...common} {...a11y} className={cls}>
          <circle cx="32" cy="32" r="4" fill="currentColor" stroke="none" />
          <circle className={styles.ring} cx="32" cy="32" r="24" opacity="0.5" />
          <circle className={`${styles.ring} ${styles.ring2}`} cx="32" cy="32" r="24" opacity="0.5" />
          <circle className={`${styles.ring} ${styles.ring3}`} cx="32" cy="32" r="24" opacity="0.5" />
          <circle cx="32" cy="32" r="12" opacity="0.35" />
        </svg>
      );
    case 'spike':
      return (
        <svg {...common} {...a11y} className={cls}>
          <path d="M6 32h10l4-14 6 28 6-22 4 8h22" opacity="0.25" />
          <path className={styles.spike} d="M6 32h10l4-14 6 28 6-22 4 8h22" />
        </svg>
      );
    case 'swarm':
      return (
        <svg {...common} {...a11y} className={cls}>
          <g className={styles.bug}>
            <ellipse cx="22" cy="24" rx="3.2" ry="4.4" />
            <path d="M22 19.6v-3M19.5 17l-1.5-1.5M24.5 17l1.5-1.5M18.8 23h-3M18.8 26h-2.5M25.2 23h3M25.2 26h2.5" />
          </g>
          <g className={`${styles.bug} ${styles.bug2}`}>
            <ellipse cx="42" cy="20" rx="2.6" ry="3.6" />
            <path d="M42 16.4v-2.4M40 14.6l-1.2-1.2M44 14.6l1.2-1.2M39.4 19h-2.4M44.6 19h2.4" />
          </g>
          <g className={`${styles.bug} ${styles.bug3}`}>
            <ellipse cx="34" cy="42" rx="3.4" ry="4.6" />
            <path d="M34 37.4v-3M31.4 34.8l-1.5-1.5M36.6 34.8l1.5-1.5M30.6 41h-3M30.6 44h-2.6M37.4 41h3M37.4 44h2.6" />
          </g>
          <g className={`${styles.bug} ${styles.bug4}`}>
            <ellipse cx="18" cy="46" rx="2.4" ry="3.2" />
            <path d="M18 42.8v-2M16 41l-1-1M20 41l1-1M15.6 45h-2.2M20.4 45h2.2" />
          </g>
          <path d="M10 56c8-4 18-4 26-2s14 2 20-2" opacity="0.3" strokeDasharray="2 3" />
        </svg>
      );
    case 'fracture':
      return (
        <svg {...common} {...a11y} className={cls}>
          <g className={styles.halfL}>
            <path d="M32 8 L13 19 L13 45 L32 56" opacity="0.6" />
          </g>
          <g className={styles.halfR}>
            <path d="M32 8 L51 19 L51 45 L32 56" opacity="0.6" />
          </g>
          <path d="M20 20h24M20 32h24M20 44h24M26 14v36M38 14v36" opacity="0.18" />
          <path className={styles.crack} d="M32 10 L29 22 L35 30 L28 40 L33 54" strokeWidth="2.2" />
        </svg>
      );
    case 'bait':
      return (
        <svg {...common} {...a11y} className={cls}>
          <circle cx="32" cy="32" r="22" strokeDasharray="4 5" opacity="0.5" />
          <circle cx="32" cy="32" r="11" opacity="0.4" />
          <path d="M32 6v8M32 50v8M6 32h8M50 32h8" opacity="0.5" />
          <circle className={styles.bait} cx="32" cy="32" r="3.5" fill="currentColor" stroke="none" />
          <g className={styles.lure}>
            <path d="M32 10c6 0 8 4 8 8" opacity="0.8" />
            <circle cx="40" cy="19" r="2.6" fill="currentColor" stroke="none" />
          </g>
        </svg>
      );
  }
}
