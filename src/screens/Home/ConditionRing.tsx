import type { RepublicCondition } from '@/engine/types';

const SEGMENTS: { key: keyof Pick<RepublicCondition, 'freedom' | 'safety' | 'trust' | 'economy' | 'legitimacy'>; label: string; colour: string }[] = [
  { key: 'freedom', label: 'Freedom', colour: 'var(--o-freedom)' },
  { key: 'safety', label: 'Safety', colour: 'var(--o-safety)' },
  { key: 'trust', label: 'Trust', colour: 'var(--o-trust)' },
  { key: 'economy', label: 'Economy', colour: 'var(--o-economy)' },
  { key: 'legitimacy', label: 'Legitimacy', colour: 'var(--o-legitimacy)' },
];

function arc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const toRad = (d: number) => ((d - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startDeg));
  const y1 = cy + r * Math.sin(toRad(startDeg));
  const x2 = cx + r * Math.cos(toRad(endDeg));
  const y2 = cy + r * Math.sin(toRad(endDeg));
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Compact five-value glyph of the long-term Republic condition (not a bar chart). */
export function ConditionRing({ condition, className }: { condition: RepublicCondition; className?: string }) {
  const span = 360 / SEGMENTS.length;
  const gap = 10;
  const r = 40;
  const cx = 50;
  const cy = 50;
  const mean = Math.round(SEGMENTS.reduce((a, s) => a + condition[s.key], 0) / SEGMENTS.length);
  const desc = SEGMENTS.map((s) => `${s.label} ${Math.round(condition[s.key])}`).join(', ');
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={`Republic condition: ${desc}`}>
      <circle cx={cx} cy={cy} r={r} fill="rgba(7,17,31,0.5)" stroke="rgba(170,182,200,0.12)" strokeWidth="1" />
      {SEGMENTS.map((seg, i) => {
        const start = i * span + gap / 2;
        const end = (i + 1) * span - gap / 2;
        const v = Math.max(0, Math.min(100, condition[seg.key])) / 100;
        const filledEnd = start + (end - start) * Math.max(0.04, v);
        return (
          <g key={seg.key}>
            <path d={arc(cx, cy, r, start, end)} fill="none" stroke="rgba(170,182,200,0.16)" strokeWidth="7" strokeLinecap="round" />
            <path d={arc(cx, cy, r, start, filledEnd)} fill="none" stroke={seg.colour} strokeWidth="7" strokeLinecap="round" />
          </g>
        );
      })}
      <text x="50" y="47" textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--c-paper)" className="tabular">
        {mean}
      </text>
      <text x="50" y="62" textAnchor="middle" fontSize="8" fontWeight="700" letterSpacing="1" fill="var(--t-tertiary)">
        CONDITION
      </text>
    </svg>
  );
}
