import { useId } from 'react';
import type { RepublicCondition, Scores } from '@/engine/types';
import styles from './CityScene.module.css';

export interface SceneValues {
  freedom: number;
  safety: number;
  trust: number;
  economy: number;
  legitimacy: number;
}

interface CitySceneProps extends SceneValues {
  /** 0..1 — how built-up the city is (grows with the player's history). */
  detail?: number;
  animated?: boolean;
  title: string;
  className?: string;
}

export function sceneFromScores(s: Scores): SceneValues {
  return { freedom: s.freedom, safety: s.safety, trust: s.trust, economy: s.economy, legitimacy: (s.grievance + s.evidence) / 2 };
}

export function sceneFromCondition(r: RepublicCondition): SceneValues {
  return { freedom: r.freedom, safety: r.safety, trust: r.trust, economy: r.economy, legitimacy: r.legitimacy };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const k = clamp01(t);
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  return `rgb(${r}, ${g}, ${bl})`;
}

function hash(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) {
    h ^= Math.floor(v * 1000) + 0x9e3779b9;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 10000) / 10000;
}

const STARS = Array.from({ length: 30 }, (_, i) => ({ x: hash(i, 1) * 800, y: hash(i, 2) * 170, r: 0.6 + hash(i, 3) * 1.1 }));

interface Building {
  x: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  minDetail: number;
}

const FAR: Building[] = [
  { x: -10, w: 70, h: 110, cols: 0, rows: 0, minDetail: 0 },
  { x: 70, w: 44, h: 80, cols: 0, rows: 0, minDetail: 0 },
  { x: 122, w: 72, h: 140, cols: 0, rows: 0, minDetail: 0.1 },
  { x: 204, w: 50, h: 100, cols: 0, rows: 0, minDetail: 0.3 },
  { x: 262, w: 40, h: 70, cols: 0, rows: 0, minDetail: 0.5 },
  { x: 500, w: 40, h: 76, cols: 0, rows: 0, minDetail: 0.5 },
  { x: 548, w: 62, h: 122, cols: 0, rows: 0, minDetail: 0 },
  { x: 620, w: 46, h: 92, cols: 0, rows: 0, minDetail: 0.2 },
  { x: 676, w: 74, h: 150, cols: 0, rows: 0, minDetail: 0 },
  { x: 760, w: 50, h: 86, cols: 0, rows: 0, minDetail: 0.35 },
];

const NEAR: Building[] = [
  { x: 14, w: 52, h: 82, cols: 3, rows: 5, minDetail: 0 },
  { x: 76, w: 72, h: 132, cols: 4, rows: 8, minDetail: 0.15 },
  { x: 158, w: 46, h: 96, cols: 2, rows: 6, minDetail: 0 },
  { x: 214, w: 64, h: 70, cols: 3, rows: 4, minDetail: 0.4 },
  { x: 522, w: 62, h: 84, cols: 3, rows: 5, minDetail: 0.4 },
  { x: 594, w: 52, h: 120, cols: 3, rows: 7, minDetail: 0 },
  { x: 656, w: 78, h: 100, cols: 4, rows: 6, minDetail: 0.2 },
  { x: 742, w: 46, h: 142, cols: 2, rows: 9, minDetail: 0 },
];

const CROWD = Array.from({ length: 40 }, (_, i) => {
  const c = i % 10;
  const r = Math.floor(i / 10);
  return {
    x: 306 + c * 21 + (hash(i, 7) - 0.5) * 8,
    y: 309 + r * 10 + (hash(i, 8) - 0.5) * 5,
    cluster: i % 2 === 0 ? { x: 352, y: 330 } : { x: 452, y: 324 },
  };
});

const BASE_Y = 300;
const FAR_Y = 262;

/**
 * Living city illustration shared by the final-result scene and the persistent Republic.
 * Abstract and premium: no flags, seals or emblems. People are dots in a plaza; nothing represents a person as a threat.
 */
export function CityScene({ freedom, safety, trust, economy, legitimacy, detail = 0.6, animated = true, title, className }: CitySceneProps) {
  const uid = useId().replace(/:/g, '');
  const f = clamp01(freedom / 100);
  const s = clamp01(safety / 100);
  const t = clamp01(trust / 100);
  const e = clamp01(economy / 100);
  const l = clamp01(legitimacy / 100);
  const health = (f + s + t + e + l) / 5;
  const d = clamp01(detail);

  const skyMid = mix('#140f1e', '#0b1d36', health);
  const skyHorizon = mix('#4a1f2e', '#1d4e8f', health);
  const tilt = (1 - l) * 6;
  const tense = s < 0.5;
  const crowdColor = mix('#e0405a', '#2ed3c4', s);
  const litColor = '#bfe9ff';
  const bridgeBroken = t < 0.4;
  const bridgeCracked = t >= 0.4 && t < 0.62;

  const windows: { x: number; y: number; lit: boolean; flicker: boolean; key: string }[] = [];
  NEAR.forEach((b, bi) => {
    if (b.minDetail > d) return;
    const cw = (b.w - 12) / b.cols;
    const rh = (b.h - 16) / b.rows;
    for (let c = 0; c < b.cols; c++) {
      for (let r = 0; r < b.rows; r++) {
        const h = hash(bi + 1, c + 1, r + 1);
        windows.push({
          key: `${bi}-${c}-${r}`,
          x: b.x + 6 + c * cw + cw / 2 - 2,
          y: BASE_Y - b.h + 8 + r * rh + rh / 2 - 3,
          lit: h < 0.12 + e * 0.8,
          flicker: h > 0.93,
        });
      }
    }
  });

  return (
    <svg className={[styles.svg, className].filter(Boolean).join(' ')} viewBox="0 0 800 400" role="img" aria-label={title} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#07111f" />
          <stop offset="0.55" stopColor={skyMid} />
          <stop offset="1" stopColor={skyHorizon} />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#4da3ff" stopOpacity={0.12 + f * 0.5} />
          <stop offset="1" stopColor="#4da3ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-dome`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix('#1f3a66', '#38a0ff', f)} />
          <stop offset="1" stopColor="#0b1d36" />
        </linearGradient>
        <linearGradient id={`${uid}-water`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a1830" />
          <stop offset="1" stopColor="#050b14" />
        </linearGradient>
        <linearGradient id={`${uid}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#050b14" stopOpacity="0" />
          <stop offset="1" stopColor="#050b14" stopOpacity="1" />
        </linearGradient>
        <radialGradient id={`${uid}-vignette`} cx="0.5" cy="0.5" r="0.75">
          <stop offset="0.55" stopColor="#07111f" stopOpacity="0" />
          <stop offset="1" stopColor="#07111f" stopOpacity="0.6" />
        </radialGradient>
        <filter id={`${uid}-blur`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
        <linearGradient id={`${uid}-building`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#142a4d" />
          <stop offset="1" stopColor="#0a1830" />
        </linearGradient>
      </defs>

      {/* Sky */}
      <rect width="800" height="400" fill={`url(#${uid}-sky)`} />
      <g opacity={0.25 + health * 0.5} fill="#f7f9fc">
        {STARS.map((st, i) => (
          <circle key={i} cx={st.x} cy={st.y} r={st.r} />
        ))}
      </g>
      <g filter={`url(#${uid}-blur)`} fill="#aab6c8" opacity={0.08 + (1 - health) * 0.08}>
        <ellipse className={animated ? styles.cloud : undefined} cx="190" cy="78" rx="130" ry="20" />
        <ellipse className={animated ? `${styles.cloud} ${styles.cloud2}` : undefined} cx="600" cy="118" rx="150" ry="18" />
      </g>

      {/* Forum glow */}
      <circle cx="400" cy="270" r="190" fill={`url(#${uid}-glow)`} />

      {/* Far skyline */}
      <g fill="#0f223f" opacity="0.9">
        {FAR.filter((b) => b.minDetail <= d).map((b, i) => (
          <rect key={i} x={b.x} y={FAR_Y - b.h} width={b.w} height={b.h} rx="2" />
        ))}
      </g>

      {/* Near skyline */}
      <g>
        {NEAR.filter((b) => b.minDetail <= d).map((b, i) => (
          <rect key={i} x={b.x} y={BASE_Y - b.h} width={b.w} height={b.h} rx="2" fill={`url(#${uid}-building)`} stroke="rgba(98,214,255,0.12)" strokeWidth="1" />
        ))}
        {windows.map((w) => (
          <rect
            key={w.key}
            x={w.x}
            y={w.y}
            width="4"
            height="6"
            rx="0.6"
            fill={w.lit ? litColor : 'rgba(98,214,255,0.09)'}
            opacity={w.lit ? 0.85 : 1}
            className={animated && w.lit && w.flicker ? styles.flicker : undefined}
          />
        ))}
      </g>

      {/* Forum */}
      <g>
        <rect x="316" y="288" width="168" height="14" rx="2" fill="#142a4d" />
        <rect x="326" y="278" width="148" height="12" rx="2" fill="#1a3560" />
        <rect x="336" y="246" width="128" height="34" fill="#0f223f" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect key={i} x={344 + i * 22} y="248" width="6" height="30" rx="1" fill="#2a4a7a" />
        ))}
        <path d="M352 246 a48 48 0 0 1 96 0 z" fill={`url(#${uid}-dome)`} stroke="rgba(98,214,255,0.35)" strokeWidth="1" />
        <circle className={animated ? styles.domeGlow : undefined} cx="400" cy="214" r={10 + f * 10} fill="#62d6ff" opacity={0.25 + f * 0.6} />
        <rect x="398" y="186" width="4" height="14" rx="1" fill="#aab6c8" opacity="0.7" />
      </g>

      {/* Bridges (trust) */}
      <g fill="none" strokeWidth="3" strokeLinecap="round" stroke={mix('#e0405a', '#62d6ff', t)} opacity="0.9">
        {bridgeBroken ? (
          <>
            <path d="M20 352 Q 78 326 118 324" />
            <path d="M158 326 Q 210 334 250 352" />
            <path d="M550 352 Q 592 330 640 324" />
            <path d="M684 326 Q 740 336 780 352" />
            <g className={animated ? styles.fragment : undefined} stroke="#e0405a" strokeWidth="2">
              <path d="M128 328 l6 2" />
              <path d="M654 330 l6 1" />
            </g>
          </>
        ) : (
          <>
            <path d="M20 352 Q 135 316 250 352" />
            <path d="M550 352 Q 665 316 780 352" />
            {bridgeCracked && (
              <g stroke="#e0405a" strokeWidth="1.5">
                <path d="M132 334 l5 6 l-3 4" />
                <path d="M662 333 l-4 6 l3 4" />
              </g>
            )}
          </>
        )}
        <g stroke="rgba(170,182,200,0.35)" strokeWidth="1">
          {[60, 100, 140, 180, 220].map((x) => (
            <path key={x} d={`M${x} 352 V ${352 - (1 - Math.abs(x - 135) / 115) * 30}`} />
          ))}
          {[590, 630, 670, 710, 750].map((x) => (
            <path key={x} d={`M${x} 352 V ${352 - (1 - Math.abs(x - 665) / 115) * 30}`} />
          ))}
        </g>
      </g>

      {/* Plaza & crowd (safety) */}
      <rect x="260" y="302" width="280" height="46" fill="#0d1f3a" />
      <g fill={crowdColor} className={animated && tense ? styles.tense : undefined}>
        {CROWD.map((p, i) => {
          const k = Math.pow(1 - s, 1.3) * 0.8;
          const x = p.x + (p.cluster.x - p.x) * k;
          const y = p.y + (p.cluster.y - p.y) * k;
          return <circle key={i} cx={x} cy={y} r="2.4" opacity={0.6 + hash(i, 9) * 0.4} />;
        })}
      </g>

      {/* Balance line (legitimacy) */}
      <g className={styles.balance} style={{ transform: `rotate(${tilt}deg)`, transformOrigin: '400px 350px', transformBox: 'view-box' }}>
        <path d="M268 350 H532" stroke={mix('#e0405a', '#a9e4ff', l)} strokeWidth="3" strokeLinecap="round" />
        <path d="M268 350 v-6 M532 350 v-6" stroke={mix('#e0405a', '#a9e4ff', l)} strokeWidth="2" strokeLinecap="round" />
      </g>
      <path d="M392 352 L408 352 L400 364 Z" fill="#aab6c8" opacity="0.9" />

      {/* Water with reflections */}
      <rect x="0" y="362" width="800" height="38" fill={`url(#${uid}-water)`} />
      <g opacity="0.14" transform="translate(0 724) scale(1 -1)">
        {windows
          .filter((w) => w.lit)
          .map((w) => (
            <rect key={`r-${w.key}`} x={w.x} y={w.y} width="4" height="6" fill={litColor} />
          ))}
        <circle cx="400" cy="214" r={10 + f * 10} fill="#62d6ff" />
      </g>
      <rect x="0" y="362" width="800" height="38" fill={`url(#${uid}-fade)`} opacity="0.6" />

      {/* Vignette */}
      <rect width="800" height="400" fill={`url(#${uid}-vignette)`} />
    </svg>
  );
}
