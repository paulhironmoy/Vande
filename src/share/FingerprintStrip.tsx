import type { FingerprintCode } from '@/engine/types';
import { GLYPHS, fingerprintAlt, parseFingerprint } from './fingerprint';
import styles from './FingerprintStrip.module.css';

export interface FingerprintStripProps {
  fingerprint: string;
  /** Used for the accessible description. */
  outcomeLabel?: string;
  score?: number;
  simple?: boolean;
  /** Glyph box size in px. */
  size?: number;
  /** Hide the real pattern (friend's result before you finish): neutral placeholders with a lock-free label. */
  hidden?: boolean;
  /** Number of placeholders to show when hidden (defaults to the fingerprint length or 5). */
  hiddenCount?: number;
  className?: string;
  testId?: string;
}

function GlyphShape({ code, size }: { code: FingerprintCode; size: number }) {
  const meta = GLYPHS[code];
  const r = size / 2;
  const common = { fill: meta.color };
  switch (meta.shape) {
    case 'diamond':
      return <polygon points={`${r},${r * 0.08} ${r * 1.92},${r} ${r},${r * 1.92} ${r * 0.08},${r}`} {...common} />;
    case 'circle':
      return <circle cx={r} cy={r} r={r * 0.9} {...common} />;
    case 'square':
      return <rect x={r * 0.2} y={r * 0.2} width={r * 1.6} height={r * 1.6} rx={r * 0.12} {...common} />;
    case 'triangle':
      return <polygon points={`${r},${r * 0.08} ${r * 1.9},${r * 1.74} ${r * 0.1},${r * 1.74}`} {...common} />;
    case 'cross':
      return (
        <path
          d={`M${r * 0.3} ${r * 0.3} L${r * 1.7} ${r * 1.7} M${r * 1.7} ${r * 0.3} L${r * 0.3} ${r * 1.7}`}
          stroke={meta.color}
          strokeWidth={Math.max(2, size * 0.2)}
          strokeLinecap="round"
          fill="none"
        />
      );
    case 'ring':
      return <circle cx={r} cy={r} r={r * 0.72} stroke={meta.color} strokeWidth={Math.max(2, size * 0.16)} fill="none" />;
  }
}

/** The glyph row: a compact, recognisable pattern of a run without revealing any decision text. */
export function FingerprintStrip({ fingerprint, outcomeLabel = '', score, simple = false, size = 22, hidden = false, hiddenCount, className, testId = 'fingerprint-strip' }: FingerprintStripProps) {
  const codes = parseFingerprint(fingerprint);
  const label = hidden
    ? simple
      ? "Your friend's pattern is hidden until you finish."
      : "Your friend's pattern unlocks when you finish."
    : fingerprintAlt(fingerprint, outcomeLabel, score, simple);
  const count = hidden ? (hiddenCount ?? (codes.length || 5)) : codes.length;
  return (
    <span className={[styles.strip, className ?? ''].filter(Boolean).join(' ')} role="img" aria-label={label} data-testid={testId} data-hidden={hidden ? 'true' : undefined}>
      {hidden
        ? Array.from({ length: count }).map((_, i) => <span key={i} className={styles.placeholder} style={{ width: size, height: size }} aria-hidden="true" />)
        : codes.map((code, i) => (
            <svg key={`${code}-${i}`} className={styles.glyph} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false" data-code={code}>
              <GlyphShape code={code} size={size} />
            </svg>
          ))}
      {!hidden && codes.length === 0 ? <span className={styles.empty}>—</span> : null}
    </span>
  );
}

export function FingerprintLegend({ simple = false, className }: { simple?: boolean; className?: string }) {
  return (
    <ul className={[styles.legend, className ?? ''].filter(Boolean).join(' ')} aria-label={simple ? 'What the shapes mean' : 'Glyph legend'}>
      {(Object.keys(GLYPHS) as FingerprintCode[]).map((code) => (
        <li key={code} className={styles.legendItem}>
          <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true" focusable="false">
            <GlyphShape code={code} size={14} />
          </svg>
          <span>{simple ? GLYPHS[code].simple : GLYPHS[code].full}</span>
        </li>
      ))}
    </ul>
  );
}
