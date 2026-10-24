import { useId } from 'react';
import s from './Medal.module.css';

export type MedalTier = 'gold' | 'silver' | 'bronze' | 'steel';

const TIERS: Record<MedalTier, { hi: string; mid: string; lo: string; rim: string; label: string }> = {
  gold: { hi: '#FFF3C4', mid: '#F5C25B', lo: '#B77A1C', rim: '#8A5A12', label: 'Gold' },
  silver: { hi: '#FFFFFF', mid: '#CDD6E3', lo: '#7F8EA6', rim: '#5A687F', label: 'Silver' },
  bronze: { hi: '#FFE1C8', mid: '#D99263', lo: '#8A4F25', rim: '#6B3A18', label: 'Bronze' },
  steel: { hi: '#C6D0DF', mid: '#6E7F99', lo: '#33415A', rim: '#232E40', label: 'Steel' },
};

export function medalTierFor(stars: number): MedalTier {
  return stars >= 3 ? 'gold' : stars === 2 ? 'silver' : stars === 1 ? 'bronze' : 'steel';
}

/** An award medal in the spirit of activity badges: metallic disc, ribbon, VANDE mark, one shine sweep. */
export function Medal({ tier, size = 148, label }: { tier: MedalTier; size?: number; label?: string }) {
  const id = useId().replace(/:/g, '');
  const t = TIERS[tier];
  return (
    <svg className={s.medal} width={size} height={size * 1.18} viewBox="0 0 160 189" role="img" aria-label={label ?? `${t.label} medal`} data-tier={tier}>
      <defs>
        <linearGradient id={`${id}-rib-a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#38A0FF" />
          <stop offset="1" stopColor="#136EF6" />
        </linearGradient>
        <linearGradient id={`${id}-rib-b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#62D6FF" />
          <stop offset="1" stopColor="#2A8FD8" />
        </linearGradient>
        <radialGradient id={`${id}-disc`} cx="38%" cy="30%" r="80%">
          <stop offset="0" stopColor={t.hi} />
          <stop offset="0.45" stopColor={t.mid} />
          <stop offset="1" stopColor={t.lo} />
        </radialGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={t.hi} />
          <stop offset="0.5" stopColor={t.rim} />
          <stop offset="1" stopColor={t.mid} />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="80" cy="112" r="56" />
        </clipPath>
        <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>
      {/* ribbon */}
      <path d="M44 4 L74 4 L92 70 L68 78 Z" fill={`url(#${id}-rib-a)`} />
      <path d="M116 4 L86 4 L68 70 L92 78 Z" fill={`url(#${id}-rib-b)`} />
      <path d="M44 4 L74 4 L77 15 L47 15 Z" fill="#fff" opacity="0.12" />
      {/* glow */}
      <circle cx="80" cy="112" r="58" fill={t.mid} opacity="0.35" filter={`url(#${id}-glow)`} />
      {/* disc */}
      <circle cx="80" cy="112" r="60" fill={`url(#${id}-rim)`} />
      <circle cx="80" cy="112" r="52" fill={`url(#${id}-disc)`} />
      <circle cx="80" cy="112" r="52" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.2" />
      {/* 24-point rhythm */}
      {Array.from({ length: 24 }).map((_, i) => {
        const a = (i / 24) * Math.PI * 2;
        return <line key={i} x1={80 + Math.cos(a) * 46} y1={112 + Math.sin(a) * 46} x2={80 + Math.cos(a) * 49} y2={112 + Math.sin(a) * 49} stroke={t.rim} strokeOpacity="0.55" strokeWidth="1.4" strokeLinecap="round" />;
      })}
      {/* V mark */}
      <path d="M58 98 C63 116 70 126 80 134 C90 126 97 116 102 98" fill="none" stroke={t.rim} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      <path d="M58 98 C63 116 70 126 80 134 C90 126 97 116 102 98" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round" />
      <line x1="54" y1="107" x2="106" y2="107" stroke={t.rim} strokeWidth="5" strokeLinecap="round" opacity="0.85" />
      <circle cx="80" cy="107" r="4" fill="#fff" opacity="0.9" />
      {/* specular */}
      <ellipse cx="62" cy="88" rx="22" ry="11" fill="#fff" opacity="0.28" transform="rotate(-24 62 88)" />
      <g clipPath={`url(#${id}-clip)`}>
        <rect className={s.shine} x="-60" y="40" width="40" height="150" fill={`url(#${id}-shine)`} transform="rotate(18 80 112)" />
      </g>
    </svg>
  );
}
