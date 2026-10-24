import type { ReactNode } from 'react';
import s from './FingerprintGlyphs.module.css';

/** D dialogue, E evidence, S services, P proportionate, X harsh, W waited. */
const GLYPH: Record<string, { shape: ReactNode; name: string; tone: string }> = {
  D: { shape: <circle cx="12" cy="12" r="6" />, name: 'talked', tone: 'd' },
  E: { shape: <path d="M12 5l7 12H5z" />, name: 'checked', tone: 'e' },
  S: { shape: <rect x="6" y="6" width="12" height="12" rx="2" />, name: 'protected', tone: 's' },
  P: { shape: <path d="M12 4l8 8-8 8-8-8z" />, name: 'fair enforcement', tone: 'p' },
  X: { shape: <path d="M6 6l12 12M18 6L6 18" strokeWidth="3" fill="none" stroke="currentColor" />, name: 'harsh', tone: 'x' },
  W: { shape: <circle cx="12" cy="12" r="5" fill="none" strokeWidth="2.5" stroke="currentColor" />, name: 'waited', tone: 'w' },
};

export interface FingerprintGlyphsProps {
  fingerprint: string;
  size?: number;
  className?: string;
  /** Render-prop hook so the share package's `FingerprintStrip` can replace this. */
  render?: (fingerprint: string) => ReactNode;
}

/** Spoiler-free strategy pattern: one glyph per decision in order. */
export function FingerprintGlyphs({ fingerprint, size = 22, className, render }: FingerprintGlyphsProps) {
  if (render) return <>{render(fingerprint)}</>;
  const letters = fingerprint.split('').filter((c) => GLYPH[c]);
  if (letters.length === 0) return null;
  const alt = letters.map((c) => GLYPH[c].name).join(', ');
  return (
    <span className={[s.row, className ?? ''].filter(Boolean).join(' ')} role="img" aria-label={`Your pattern: ${alt}`} data-testid="fingerprint-glyphs" data-fingerprint={letters.join('')}>
      {letters.map((c, i) => (
        <svg key={i} viewBox="0 0 24 24" width={size} height={size} className={s.glyph} data-tone={GLYPH[c].tone} aria-hidden="true" fill="currentColor">
          {GLYPH[c].shape}
        </svg>
      ))}
    </span>
  );
}
