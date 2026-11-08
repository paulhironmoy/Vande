/**
 * The field on the live screen.
 *
 * FieldPip is the field inset (picture-in-picture, constitution §4–5's compact field radar): the first-person view
 * shows only part of the field, so a corner shows all of it from above, every fielder with the keeper and the bowler,
 * both batters and the umpires, and after a stroke the ball and who is chasing it. The stage paints it on every frame
 * from the physics (render3d/fallback2d/topDown.ts paintFieldInset, found through the `[data-pip]` element inside the
 * play root), and reports the moment it shows on that element: `data-pip-moment` calm, quiet (the run-up: dimmed and
 * frozen), hidden (from the release until the fielding camera takes over), chase, or full (the dead ball). Until a
 * stage paints, or on a stage that does not, it shows the field as set (the physics layout) and steps out of the live
 * ball by the flow's phase. A picture, never a control: no pointer events, no text, and the field's plan is said in
 * words by the conditions control beside it (so it is hidden from assistive technology, like the radar it replaces).
 *
 * MiniRadar is the compact radar inside that conditions control. While the inset is on screen it draws the ground
 * only (an icon for the setup it opens), so the field's players are never shown twice.
 */
import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import type { FieldLayout, Handedness } from '@/contracts';
import { useKit } from '../context';
import s from './MiniRadar.module.css';

/** True while the live screen shows the field inset (Play provides it around the rail). */
export const FieldPipShown = createContext(false);

export function MiniRadar({
  field,
  handedness,
  size = 40,
}: {
  field: FieldLayout;
  handedness: Handedness;
  size?: number;
}) {
  const { ground: g, fielderClass } = useKit();
  const inset = useContext(FieldPipShown);
  const R = g.boundaryR + 3;
  const mirror = handedness === 'left' ? -1 : 1;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`}
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none' }}
      data-inset={inset ? 'true' : 'false'}
    >
      <circle cx={0} cy={0} r={g.boundaryR} fill="#10261d" stroke="rgba(243,239,231,0.5)" strokeWidth={2} />
      <circle
        cx={0}
        cy={0}
        r={g.ringR}
        fill="none"
        stroke="rgba(243,239,231,0.3)"
        strokeWidth={1.4}
        strokeDasharray="4 4"
      />
      <rect x={-2} y={-g.pitchHalf} width={4} height={2 * g.pitchHalf} fill="#b48c5a" />
      {!inset &&
        field.fielders.map((f) => {
          const c = fielderClass(f);
          return (
            <circle
              key={f.id}
              cx={mirror * f.x}
              cy={f.z}
              r={c === 'deep' ? 4.2 : 3.6}
              fill={c === 'close' ? '#f2ad41' : c === 'keeper' || c === 'bowler' ? '#8d8982' : '#f3efe7'}
            />
          );
        })}
    </svg>
  );
}

/** The flow's phase as the inset's static picture needs it (the stage's own moment takes over once it paints). */
export type FieldPipPhase = 'calm' | 'quiet' | 'live' | 'dead';

export interface FieldPipProps {
  field: FieldLayout;
  handedness: Handedness;
  phase: FieldPipPhase;
  /** The top corner it sits in, below the rail on that side: the side the dead ball's card does not use. */
  side: 'left' | 'right';
  /** Whether there is room for it below the rail (a large text size can leave none); Play gives the radar back then. */
  onRoom?: (room: boolean) => void;
  /** In the run-up: whether the rail and the inset would exceed the run-up budget (it steps aside; the radar shows). */
  onQuietOver?: (over: boolean) => void;
}

/**
 * The inset's floor: its bottom edge stays above this share of the screen's height. Measured on the first-person
 * views (release/product-sequence/stage-1-practice/wedge/humans/PIP/): in the top-right column the batter's own bat
 * and gloves, the near pitch and the ball's path never come higher than 61% of the height at a dead ball or 71% in the
 * run-up; Classic's documented composition puts the batter's corner from 55% down (practice-layout.spec corridor).
 * Below this line the inset would cover them. At the default text size it never binds (the inset ends by 53%).
 */
export const FIELD_PIP_FLOOR = 0.55;
/** Smaller than this (CSS px) the eleven fielders are no longer clearly told apart: no inset, the radar instead. */
export const FIELD_PIP_MIN = 72;

/**
 * The run-up's screen budget (owner decision, 2026-11-04): in the run-up the quiet rail and the inset together cover at
 * most this share of the screen. Where they would cover more (640×360 and 844×390 at the default text size), the
 * inset steps aside from the start of the run-up to the release, and the conditions control's radar keeps the field.
 */
export const FIELD_PIP_QUIET_BUDGET = 0.08;

/** Whether the rail's boxes (`railArea`, CSS px²) and an inset `side` px square cover more than the run-up budget. */
export function quietBudgetOver(railArea: number, side: number, width: number, height: number): boolean {
  if (side <= 0 || width <= 0 || height <= 0) return false;
  return (railArea + side * side) / (width * height) > FIELD_PIP_QUIET_BUDGET;
}

/** The quiet rail's boxes the budget counts: the score corner, the conditions control and pause. */
const RAIL_IDS = ['practice-status', 'practice-conditions', 'practice-pause'] as const;

/** The inset's side (CSS px) for a screen `height` and the `top` it sits at, or 0 when there is no room for it. */
export function fieldPipSize(height: number, top: number): number {
  const want = Math.min(148, Math.max(88, height * 0.29));
  const side = Math.floor(Math.min(want, height * FIELD_PIP_FLOOR - top));
  return side >= FIELD_PIP_MIN ? side : 0;
}

export function FieldPip({ field, handedness, phase, side, onRoom, onQuietOver }: FieldPipProps) {
  const { ground: g, fielderClass } = useKit();
  const R = g.boundaryR + 3;
  const mirror = handedness === 'left' ? -1 : 1;
  // The static picture uses the painter's language (topDown.ts INSET_LOOK): fielders warm white, the keeper an amber
  // square, the bowler grey, the batters in the accent.
  const striker = { x: mirror * g.striker.x, z: g.striker.z + 1 };
  const ref = useRef<HTMLDivElement>(null);
  const roomRef = useRef(onRoom);
  roomRef.current = onRoom;
  const quietRef = useRef(onQuietOver);
  quietRef.current = onQuietOver;
  // It sits below the tallest the rail on its side has been during this visit (--pip-rail), never its current height:
  // the rail drops its words in the run-up and gains a line at the dead ball, and the picture must not jump with it.
  // Its side is then what fits above the floor (fieldPipSize); with no room it is not drawn and says so.
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.closest<HTMLElement>('[data-play-root]');
    if (!el || !host) return;
    const name = side === 'right' ? '--p-rail-bottom' : '--p-rail-left-bottom';
    let hold = 0;
    let room: boolean | null = null;
    const fit = () => {
      const size = fieldPipSize(host.clientHeight || window.innerHeight, el.offsetTop);
      el.style.width = el.style.height = `${size}px`;
      el.dataset.room = size > 0 ? 'ok' : 'none';
      if (room !== size > 0) {
        room = size > 0;
        roomRef.current?.(room);
      }
    };
    const read = () => {
      const v = parseFloat(host.style.getPropertyValue(name));
      if (Number.isFinite(v) && v > hold) {
        hold = v;
        el.style.setProperty('--pip-rail', `${v}px`);
      }
      fit();
    };
    read();
    const offs: Array<() => void> = [];
    if (typeof MutationObserver !== 'undefined') {
      const mo = new MutationObserver(read);
      mo.observe(host, { attributes: true, attributeFilter: ['style'] });
      offs.push(() => mo.disconnect());
    }
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(fit);
      ro.observe(host);
      offs.push(() => ro.disconnect());
    }
    return () => offs.forEach((off) => off());
  }, [side]);
  // The run-up's budget, measured on the quiet rail as it is drawn (its words gone), in the same commit that quietens
  // it and before the frame is painted, so the inset never shows for a frame it should not.
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.closest<HTMLElement>('[data-play-root]');
    if (!el || !host || phase !== 'quiet') return;
    const check = () => {
      let rail = 0;
      for (const id of RAIL_IDS) {
        const r = host.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
        if (r) rail += r.width * r.height;
      }
      const over = quietBudgetOver(
        rail,
        el.offsetWidth,
        host.clientWidth || window.innerWidth,
        host.clientHeight || window.innerHeight,
      );
      el.dataset.quietBudget = over ? 'over' : 'ok';
      quietRef.current?.(over);
    };
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(host);
    return () => ro.disconnect();
  }, [phase]);
  return (
    <div
      ref={ref}
      className={s.pip}
      data-pip=""
      data-side={side}
      data-phase={phase}
      aria-hidden="true"
      data-testid="practice-pip"
    >
      <svg
        className={s.fill}
        viewBox={`${-R - 2} ${-R - 2} ${2 * R + 4} ${2 * R + 4}`}
        focusable="false"
        data-testid="practice-pip-static"
      >
        <rect
          x={-R - 2}
          y={-R - 2}
          width={2 * R + 4}
          height={2 * R + 4}
          rx={(2 * R + 4) * 0.1}
          fill="rgba(8,9,13,0.72)"
        />
        <circle cx={0} cy={0} r={g.boundaryR} fill="#1b6038" stroke="rgba(243,239,231,0.78)" strokeWidth={1.4} />
        <circle
          cx={0}
          cy={0}
          r={g.ringR}
          fill="none"
          stroke="rgba(243,239,231,0.34)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <rect x={-1.6} y={-g.pitchHalf} width={3.2} height={2 * g.pitchHalf} fill="#c9a26b" />
        {field.fielders.map((f) => {
          const c = fielderClass(f);
          const x = mirror * f.x;
          return c === 'keeper' ? (
            <rect
              key={f.id}
              x={x - 2.6}
              y={f.z - 2.6}
              width={5.2}
              height={5.2}
              rx={1}
              fill="#f2ad41"
              stroke="#0b0d12"
              strokeWidth={0.9}
            />
          ) : (
            <circle
              key={f.id}
              cx={x}
              cy={f.z}
              r={2.7}
              fill={c === 'bowler' ? '#aaa69e' : '#f3efe7'}
              stroke="#0b0d12"
              strokeWidth={0.9}
            />
          );
        })}
        <circle cx={striker.x} cy={striker.z} r={2.7} fill="#52d3f2" stroke="#0b0d12" strokeWidth={0.9} />
        <circle cx={striker.x} cy={striker.z} r={4.3} fill="none" stroke="#f3efe7" strokeWidth={1} />
      </svg>
      <canvas className={s.fill} data-pip-canvas="" data-testid="practice-pip-canvas" />
    </div>
  );
}
