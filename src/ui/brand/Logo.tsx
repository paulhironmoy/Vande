import { useId } from 'react';
import { BRAND_COLORS, MARK } from './mark';
import s from './Logo.module.css';

export interface LogoProps {
  /** Mark size in px. */
  size?: number;
  /** Show the "VANDE Cricket" wordmark next to the mark. */
  wordmark?: boolean;
  /** Accessible name; decorative when omitted and a wordmark is shown. */
  title?: string;
  className?: string;
}

/** The VANDE Cricket mark (and optional wordmark). Original artwork; see src/ui/brand/mark.ts. */
export function Logo({ size = 32, wordmark, title, className }: LogoProps) {
  const id = useId().replace(/:/g, '');
  const c = BRAND_COLORS;
  const mark = (
    <svg viewBox="0 0 120 120" width={size} height={size} role={title && !wordmark ? 'img' : undefined} aria-label={!wordmark ? title : undefined} aria-hidden={wordmark || !title ? true : undefined} focusable="false">
      <defs>
        <radialGradient id={`${id}b`} cx="50%" cy="30%" r="75%">
          <stop offset="0" stopColor={c.indigo} />
          <stop offset="0.6" stopColor={c.night2} />
          <stop offset="1" stopColor={c.night} />
        </radialGradient>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c.amberLight} />
          <stop offset="0.45" stopColor={c.amber} />
          <stop offset="1" stopColor={c.amberDeep} />
        </linearGradient>
        <radialGradient id={`${id}w`} cx="38%" cy="30%" r="80%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#e9e7fb" />
          <stop offset="1" stopColor="#a9a3e6" />
        </radialGradient>
      </defs>
      <path d={MARK.hex} fill={`url(#${id}b)`} stroke={`url(#${id}g)`} strokeWidth={6} strokeLinejoin="round" />
      <circle cx={MARK.ball.cx} cy={MARK.ball.cy} r={MARK.ball.r} fill={`url(#${id}w)`} />
      <path d={MARK.seam} fill="none" stroke={c.seam} strokeWidth={6.5} strokeLinecap="round" />
      <path d={MARK.stitches} fill="none" stroke={c.seam} strokeWidth={1.5} strokeLinecap="round" opacity={0.8} />
    </svg>
  );
  if (!wordmark) return <span className={[s.logo, className].filter(Boolean).join(' ')}>{mark}</span>;
  return (
    <span className={[s.logo, className].filter(Boolean).join(' ')} role={title ? 'img' : undefined} aria-label={title}>
      {mark}
      <span className={s.word} aria-hidden={title ? true : undefined}>
        <span className={s.vande}>VANDE</span>
        <span className={s.cricket}>Cricket</span>
      </span>
    </span>
  );
}
