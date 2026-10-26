/**
 * The pitch map: tap (or drag, or use the arrow keys) where the ball should pitch. Drawn in the batter's own
 * orientation (the striker's stumps at the bottom, the batter's off side on the off side), with the game's legal
 * area and its own length and line bands (sampled from src/practice/game, never re-defined here).
 */
import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { BowlerFamily, Handedness } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import type { BuildKit, LengthBand } from '../flow/types';
import s from './BuildOver.module.css';

const W = 60;
const H = 150;

export interface Target {
  lineM: number;
  lengthM: number;
}

export function targetWords(t: ReturnType<typeof usePracticeT>, build: BuildKit, family: BowlerFamily, target: Target): string {
  return t.t('practice.map.target', { length: t.tk(`practice.length.${build.lengthBand(target.lengthM, family)}`), line: t.tk(`practice.lineband.${build.lineBand(target.lineM)}`) });
}

/** Where the length bands change along v (0 = the striker's stumps … 1 = the far end of the map). */
function lengthEdges(build: BuildKit, family: BowlerFamily): Array<{ v: number; band: LengthBand }> {
  const out: Array<{ v: number; band: LengthBand }> = [];
  let prev: LengthBand | null = null;
  for (let i = 0; i <= 200; i++) {
    const v = i / 200;
    const band = build.lengthBand(build.targetFromTap(0.5, v, family).lengthM, family);
    if (band !== prev) out.push({ v, band });
    prev = band;
  }
  return out;
}

export interface PitchMapProps {
  build: BuildKit;
  family: BowlerFamily;
  handedness: Handedness;
  target: Target;
  ballNumber: number;
  onChange: (t: Target) => void;
}

export function PitchMap({ build, family, handedness, target, ballNumber, onChange }: PitchMapProps) {
  const t = usePracticeT();
  const ref = useRef<SVGSVGElement>(null);
  const mirror = handedness === 'left';
  const ux = (u: number) => (mirror ? 1 - u : u) * W;
  const vy = (v: number) => (1 - v) * H;
  // The legal area: the tap clamps into it, so its corners are where the extreme taps land.
  const lo = build.tapFromTarget(build.targetFromTap(0, 0, family));
  const hi = build.tapFromTarget(build.targetFromTap(1, 1, family));
  const edges = useMemo(() => lengthEdges(build, family), [build, family]);
  const stumpU = build.tapFromTarget({ lineM: 0, lengthM: 0 }).u;
  const pos = build.tapFromTarget(target);

  const fromEvent = (e: PointerEvent<SVGSVGElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return;
    let u = (e.clientX - r.left) / r.width;
    if (mirror) u = 1 - u;
    const v = 1 - (e.clientY - r.top) / r.height;
    onChange(build.targetFromTap(u, v, family));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const offSide = mirror ? -1 : 1;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-0.05 * offSide, 0],
      ArrowRight: [0.05 * offSide, 0],
      ArrowUp: [0, 0.25],
      ArrowDown: [0, -0.25],
    };
    const d = step[e.key];
    if (!d) return;
    e.preventDefault();
    const next = { lineM: target.lineM + d[0], lengthM: target.lengthM + d[1] };
    const p = build.tapFromTarget(next);
    onChange(build.targetFromTap(p.u, p.v, family));
  };
  const words = targetWords(t, build, family, target);
  const offLabelX = mirror ? 3 : W - 3;
  const legLabelX = mirror ? W - 3 : 3;
  return (
    <svg
      ref={ref}
      className={s.map}
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      tabIndex={0}
      aria-label={t.t('practice.build.map_label', { n: ballNumber, target: words })}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        fromEvent(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons || e.pointerType === 'touch') fromEvent(e);
      }}
      onKeyDown={onKey}
      data-testid="practice-pitch-map"
    >
      <rect className={s.mapGrass} x={0} y={0} width={W} height={H} rx={4} />
      <rect className={s.mapPitch} x={W * 0.08} y={0} width={W * 0.84} height={H} />
      {/* Outside the legal area (shaded). */}
      <rect className={s.mapIllegal} x={0} y={0} width={W} height={vy(hi.v)} />
      <rect className={s.mapIllegal} x={0} y={vy(lo.v)} width={W} height={H - vy(lo.v)} />
      <rect className={s.mapIllegal} x={Math.min(ux(0), ux(lo.u))} y={0} width={Math.abs(ux(lo.u) - ux(0))} height={H} />
      <rect className={s.mapIllegal} x={Math.min(ux(hi.u), ux(1))} y={0} width={Math.abs(ux(1) - ux(hi.u))} height={H} />
      {edges.map((e, i) => {
        const next = edges[i + 1]?.v ?? 1;
        const mid = (e.v + next) / 2;
        return (
          <g key={e.band + e.v}>
            {i > 0 && <line className={s.mapBand} x1={0} x2={W} y1={vy(e.v)} y2={vy(e.v)} />}
            <text className={s.mapLabel} x={W / 2} y={vy(mid) + 1.5} textAnchor="middle" aria-hidden="true">
              {t.tk(`practice.length.${e.band}`)}
            </text>
          </g>
        );
      })}
      <line className={s.mapCrease} x1={W * 0.08} x2={W * 0.92} y1={vy(build.tapFromTarget({ lineM: 0, lengthM: 1.22 }).v)} y2={vy(build.tapFromTarget({ lineM: 0, lengthM: 1.22 }).v)} />
      <rect className={s.mapStumps} x={ux(stumpU) - 1.6} y={H - 3} width={3.2} height={2.4} rx={0.4} />
      <text className={s.mapLabel} x={offLabelX} y={H - 6} textAnchor={mirror ? 'start' : 'end'} aria-hidden="true">
        {t.t('practice.line.off_side')}
      </text>
      <text className={s.mapLabel} x={legLabelX} y={H - 6} textAnchor={mirror ? 'end' : 'start'} aria-hidden="true">
        {t.t('practice.line.leg_side')}
      </text>
      <circle className={s.mapTargetRing} cx={ux(pos.u)} cy={vy(pos.v)} r={5} />
      <circle className={s.mapTarget} cx={ux(pos.u)} cy={vy(pos.v)} r={2.6} data-testid="practice-pitch-target" />
    </svg>
  );
}
