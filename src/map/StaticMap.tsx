/**
 * SVG rendering of the city — used before Pixi is ready, when WebGL is unavailable,
 * or after a context loss. Shares layout and palette with the Pixi scene.
 */
import type { ReactElement } from 'react';
import type { MapState } from '@/engine/types';
import {
  CROWD_MAX,
  crowdCount,
  crowdPositions,
  curvePathD,
  curvePoint,
  curveTangent,
  districtBlocks,
  fabricBlocks,
  footprintPoints,
  hexCss,
  institutionOffset,
  personScale,
  plazaOffset,
  riverPoints,
  roadCurve,
  signalColor,
  signalCurve,
  smoothPathD,
  trustColor,
  type Curve,
  type Layout,
  type MapPalette,
} from './layout';
import styles from './CityMap.module.css';

export interface StaticMapProps {
  map: MapState;
  layout: Layout;
  palette: MapPalette;
  focus?: string;
  reducedMotion: boolean;
}

export function StaticMap({ map, layout, palette: p, focus, reducedMotion }: StaticMapProps) {
  const { width, height, unit } = layout;
  const positions = new Map(map.districts.map((d) => [d.id, layout.project(d.x, d.y)]));
  const roadCurves = new Map<string, Curve>();
  for (const r of map.roads) {
    const a = positions.get(r.from);
    const b = positions.get(r.to);
    if (a && b) roadCurves.set(r.id, roadCurve(r.id, a, b));
  }
  const roadWidth = Math.max(1.2, unit * 0.045);
  const hex = (n: number) => hexCss(n);
  const river = riverPoints(layout);
  const riverD = river.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
  const fabric = fabricBlocks(layout, map.districts);
  const arterials: string[] = [];
  {
    const cell = unit * 0.46 * 3;
    const { x: bx, y: by, w: bw, h: bh } = layout.box;
    for (let x = bx + cell; x < bx + bw; x += cell) arterials.push(`M${x.toFixed(1)} ${by.toFixed(1)} V${(by + bh).toFixed(1)}`);
    for (let y = by + cell; y < by + bh; y += cell) arterials.push(`M${bx.toFixed(1)} ${y.toFixed(1)} H${(bx + bw).toFixed(1)}`);
  }

  return (
    <svg
      className={styles.svg}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      data-motion={reducedMotion ? 'reduced' : 'full'}
    >
      <defs>
        <radialGradient id="vande-glow">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="45%" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* River & urban fabric */}
      <path d={riverD} fill="none" stroke={hex(p.river)} strokeOpacity={0.1} strokeWidth={unit * 0.5 + 6} strokeLinecap="round" strokeLinejoin="round" />
      <path d={riverD} fill="none" stroke={hex(p.river)} strokeOpacity={0.26} strokeWidth={unit * 0.5} strokeLinecap="round" strokeLinejoin="round" />
      {arterials.map((d, i) => (
        <path key={`a${i}`} d={d} fill="none" stroke={hex(p.footprintEdge)} strokeOpacity={0.035 * p.lineAlpha} strokeWidth={1} />
      ))}
      {fabric.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={hex(p.fabric)} fillOpacity={0.12 * b.alpha} stroke={hex(p.footprintEdge)} strokeOpacity={0.04 * b.alpha * p.lineAlpha} />
      ))}

      {/* District glows */}
      {map.districts.map((d) => {
        const pos = positions.get(d.id)!;
        return (
          <circle
            key={`g-${d.id}`}
            cx={pos.x}
            cy={pos.y + unit * 0.1}
            r={unit * 1.45}
            fill="url(#vande-glow)"
            style={{ color: hex(trustColor(d.trust, p)) }}
            opacity={(0.25 + 0.5 * d.trust) * p.glowAlpha}
          />
        );
      })}

      {/* Roads */}
      {map.roads.map((r) => {
        const cv = roadCurves.get(r.id);
        if (!cv) return null;
        const d = curvePathD(cv);
        const color = r.status === 'open' ? hex(p.roadOpen) : r.status === 'congested' ? hex(p.roadCongested) : hex(p.roadClosed);
        const w = r.status === 'congested' ? roadWidth * 2.4 : roadWidth;
        const dash = r.status === 'open' ? undefined : `${unit * 0.18} ${unit * 0.22}`;
        const ticks: ReactElement[] = [];
        if (r.status === 'closed') {
          const tl = unit * 0.17;
          for (const t of [0.42, 0.5, 0.58]) {
            const c = curvePoint(cv, t);
            const ang = curveTangent(cv, t);
            const nx = -Math.sin(ang);
            const ny = Math.cos(ang);
            ticks.push(<line key={t} x1={c.x - nx * tl} y1={c.y - ny * tl} x2={c.x + nx * tl} y2={c.y + ny * tl} stroke={hex(p.roadClosed)} strokeWidth={Math.max(2, roadWidth * 1.6)} strokeLinecap="round" />);
          }
        }
        return (
          <g key={r.id}>
            <path d={d} fill="none" stroke="#000" strokeOpacity={0.2} strokeWidth={roadWidth * 5} strokeLinecap="round" />
            {r.status === 'open' && <path d={d} fill="none" stroke={color} strokeOpacity={Math.min(1, 0.07 * p.lineAlpha)} strokeWidth={roadWidth * 2.4} strokeLinecap="round" />}
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeOpacity={Math.min(1, (r.status === 'open' ? 0.38 : 0.6) * p.lineAlpha)}
              strokeWidth={w}
              strokeLinecap="round"
              strokeDasharray={dash}
              className={r.status === 'congested' ? styles.flow : undefined}
            />
            {ticks}
          </g>
        );
      })}

      {/* Districts */}
      {map.districts.map((d) => {
        const pos = positions.get(d.id)!;
        const r = unit;
        const pts = footprintPoints(d.id, r);
        const blocks = districtBlocks(d.id, d.kind, r, Boolean(d.institution));
        const ws = Math.max(1.8, r * 0.058);
        const lit = d.incident === 'outage' ? 0 : d.services;
        const inst = institutionOffset(r);
        const plaza = plazaOffset(r);
        const isFocus = focus === d.id;
        return (
          <g key={d.id}>
            <path d={smoothPathD(pts, pos.x, pos.y + r * 0.07)} fill="#000" fillOpacity={0.4} />
            <path d={smoothPathD(pts, pos.x, pos.y)} fill={hex(p.footprint)} fillOpacity={0.96} stroke={hex(p.footprintEdge)} strokeOpacity={Math.min(1, 0.22 * p.lineAlpha)} strokeWidth={1.2} />
            <ellipse cx={pos.x + plaza.x} cy={pos.y + plaza.y} rx={r * 0.5} ry={r * 0.36} fill={hex(p.footprintEdge)} fillOpacity={0.045} stroke={hex(p.footprintEdge)} strokeOpacity={0.08} />
            {blocks.map((b, i) => {
              const total = b.cols * b.rows;
              const litCount = Math.round(total * lit);
              const padX = (b.w - b.cols * ws) / (b.cols + 1);
              const padY = (b.h - b.rows * ws) / (b.rows + 1);
              return (
                <g key={i}>
                  <rect x={pos.x + b.x + 1.5} y={pos.y + b.y + 2} width={b.w} height={b.h} fill="#000" fillOpacity={0.35} />
                  <rect x={pos.x + b.x} y={pos.y + b.y} width={b.w} height={b.h} fill={hex(p.blockFill)} stroke={hex(p.blockEdge)} strokeOpacity={Math.min(1, 0.55 * p.lineAlpha)} strokeWidth={1} />
                  <line x1={pos.x + b.x + 1} y1={pos.y + b.y + 0.5} x2={pos.x + b.x + b.w - 1} y2={pos.y + b.y + 0.5} stroke={hex(p.footprintEdge)} strokeOpacity={Math.min(1, 0.42 * p.lineAlpha)} />
                  {Array.from({ length: total }, (_, k) => {
                    const idx = b.order[k];
                    const col = idx % b.cols;
                    const row = Math.floor(idx / b.cols);
                    return (
                      <rect
                        key={k}
                        x={pos.x + b.x + padX + col * (ws + padX)}
                        y={pos.y + b.y + padY + row * (ws + padY)}
                        width={ws}
                        height={ws}
                        fill={k < litCount ? hex(p.windowLit) : hex(p.windowDark)}
                        fillOpacity={k < litCount ? 0.95 : 0.75}
                      />
                    );
                  })}
                </g>
              );
            })}
            {d.institution && (
              <g>
                <polygon points={hexPoints(pos.x + inst.x, pos.y + inst.y, r * 0.28)} fill={hex(p.blockFill)} stroke={hex(d.institutionActive ? p.institutionActive : p.institution)} strokeOpacity={Math.min(1, (d.institutionActive ? 0.95 : 0.65) * p.lineAlpha)} strokeWidth={d.institutionActive ? 2 : 1.4} />
                <polygon points={hexPoints(pos.x + inst.x, pos.y + inst.y, r * 0.157)} fill={hex(d.institutionActive ? p.institutionActive : p.institution)} fillOpacity={d.institutionActive ? 0.6 : 0.24} />
              </g>
            )}
            {crowdPositions(d.id, CROWD_MAX, r)
              .slice(0, crowdCount(d.crowd))
              .map((c, i) => (
                <circle key={i} cx={pos.x + c.x} cy={pos.y + c.y} r={Math.max(1.4, r * 0.052) * personScale(i)} fill={hex(d.mood === 'hopeful' ? p.safety : p.person)} fillOpacity={0.86} />
              ))}
            {(d.mood === 'volatile' || d.incident === 'intimidation') && (
              <circle cx={pos.x + plaza.x} cy={pos.y + plaza.y} r={r * 0.85} fill="url(#vande-glow)" style={{ color: hex(p.danger) }} opacity={d.mood === 'volatile' ? 0.35 : 0.2} />
            )}
            {d.incident && (
              <g>
                <circle cx={pos.x + plaza.x} cy={pos.y + plaza.y} r={r * 0.5} fill="none" stroke={hex(d.incident === 'fire' ? p.saffron : p.danger)} strokeWidth={2} strokeOpacity={0.9} />
                <circle cx={pos.x + plaza.x} cy={pos.y + plaza.y} r={r * 0.62} fill="none" stroke={hex(d.incident === 'fire' ? p.saffron : p.danger)} strokeWidth={1} strokeOpacity={0.45} />
              </g>
            )}
            {isFocus && (
              <g>
                <circle cx={pos.x} cy={pos.y} r={r * 1.2} fill="none" stroke={hex(p.focus)} strokeWidth={2} strokeOpacity={0.9} />
                <circle cx={pos.x} cy={pos.y} r={r * 1.2 + 5} fill="none" stroke={hex(p.focus)} strokeWidth={1} strokeOpacity={0.35} />
              </g>
            )}
          </g>
        );
      })}

      {/* Signals */}
      {map.signals.map((s) => {
        const cv = signalCurve(map, roadCurves, s.from, s.to, layout);
        const color = hex(signalColor(s.kind, p));
        const head = curvePoint(cv, s.progress);
        const ang = curveTangent(cv, s.progress);
        const strong = s.kind === 'verified' || s.kind === 'official';
        const bugCount = s.kind === 'rumor' ? 4 : s.kind === 'manipulated' ? 7 : 0;
        return (
          <g key={s.id}>
            <path d={curvePathD(cv, s.progress)} fill="none" stroke={color} strokeOpacity={strong ? 0.75 : 0.55} strokeWidth={strong ? 2.5 : 2} strokeDasharray={`${unit * 0.12} ${unit * 0.14}`} strokeLinecap="round" className={styles.flow} />
            <circle cx={head.x} cy={head.y} r={strong ? unit * 0.11 : unit * 0.08} fill={color} />
            <circle cx={head.x} cy={head.y} r={unit * 0.3} fill="url(#vande-glow)" style={{ color }} opacity={strong ? 0.8 : 0.45} />
            {Array.from({ length: bugCount }, (_, i) => {
              const lag = 0.025 + i * 0.022;
              const pt = curvePoint(cv, Math.max(0, s.progress - lag));
              const off = (i % 2 ? 1 : -1) * unit * 0.05;
              return <polygon key={i} points={bugPoints(pt.x - Math.sin(ang) * off, pt.y + Math.cos(ang) * off, Math.max(2.5, unit * 0.07))} fill={color} fillOpacity={0.9} />;
            })}
          </g>
        );
      })}
    </svg>
  );
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** Abstract manipulation glyph (asymmetric), never a human figure. */
function bugPoints(cx: number, cy: number, s: number): string {
  const pts = [
    [-0.6, 0.1],
    [-0.2, -0.6],
    [0.5, -0.4],
    [0.7, 0.2],
    [0.1, 0.65],
    [-0.4, 0.45],
  ];
  return pts.map(([x, y]) => `${(cx + x * s).toFixed(1)},${(cy + y * s).toFixed(1)}`).join(' ');
}
