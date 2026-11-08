/**
 * The first-ball lesson's picture: a ghost hand, cursor, pen, key press or pair of hands doing the move the game
 * reads, in a loop that waits for the player (a rest between loops; it never ends, never speeds up, never judges).
 *
 * Reduced Motion: no animation at all. The same numbers draw the move as a still: the pull-down, the flick and the
 * three points of the stroke numbered 1, 2, 3. Everything here is decoration for the words beside it (aria-hidden);
 * the card's text says the same in plain words.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { Handedness } from '@/contracts';
import {
  GHOST,
  GHOST_BOX,
  arrowHead,
  badgePoints,
  ghostPoints,
  headKeyframes,
  handKeyframes,
  keyKeyframes,
  pointerKeyframes,
  trailKeyframes,
  wordKeyframes,
  type GhostKey,
  type GhostKeyframe,
} from './ghostMove';
import { lessonCameraPort, type LessonInput } from './inputType';
import s from './Lesson.module.css';

type Animatable = Element & { animate?: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => Animation };

/** Loops these keyframes on the element for as long as it is mounted (when the browser can animate and `play` is on). */
function useLoop<T extends Element>(frames: readonly GhostKeyframe[], play: boolean) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current as Animatable | null;
    if (!el || !play || typeof el.animate !== 'function') return;
    const animation = el.animate(frames as unknown as Keyframe[], {
      duration: GHOST.show.periodMs,
      iterations: Infinity,
    });
    return () => animation.cancel();
  }, [frames, play]);
  return ref;
}

const at = (p: { x: number; y: number }) => `translate(${p.x}px, ${p.y}px)`;

/** The three things the start of the flick sets, lit as the stroke reaches each (the hints are for screen readers). */
export function Words({
  labels,
  hints,
  input,
  play,
}: {
  labels: { direction: string; power: string; loft: string };
  hints: { direction: string; power: string; loft: string };
  input: LessonInput;
  play: boolean;
}) {
  const loft = useLoop<HTMLLIElement>(
    useMemo(() => wordKeyframes('lift'), []),
    play,
  );
  const power = useLoop<HTMLLIElement>(
    useMemo(() => wordKeyframes('power'), []),
    play,
  );
  const direction = useLoop<HTMLLIElement>(
    useMemo(() => wordKeyframes('aim'), []),
    play,
  );
  // The keyboard sets direction (the arrow) and loft (Shift); its power is fixed, so it has no word.
  return (
    <ul className={s.words} data-testid="lesson-words">
      <li ref={loft} data-word="loft" title={hints.loft} aria-label={`${labels.loft}. ${hints.loft}`}>
        {labels.loft}
      </li>
      {input !== 'keyboard' && (
        <li ref={power} data-word="power" title={hints.power} aria-label={`${labels.power}. ${hints.power}`}>
          {labels.power}
        </li>
      )}
      <li
        ref={direction}
        data-word="direction"
        title={hints.direction}
        aria-label={`${labels.direction}. ${hints.direction}`}
      >
        {labels.direction}
      </li>
    </ul>
  );
}

function PointerSprite({ kind }: { kind: 'touch' | 'mouse' | 'pen' }) {
  if (kind === 'touch')
    return (
      <>
        <circle r="10" className={s.fingerRing} />
        <circle r="5.4" className={s.fingerPad} />
      </>
    );
  if (kind === 'mouse')
    return (
      <>
        <circle r="8" className={s.fingerRing} />
        <path d="M0 0 L0 15 L4 11.2 L7 17.5 L10 16 L7 9.8 L12.5 9.8 Z" className={s.cursor} />
      </>
    );
  return (
    <>
      <circle r="4.4" className={s.fingerRing} />
      <path d="M0 0 L11 -18 L15.4 -15.4 L4.2 3 Z" className={s.cursor} />
    </>
  );
}

function PointerGhost({
  kind,
  handedness,
  play,
}: {
  kind: 'touch' | 'mouse' | 'pen';
  handedness: Handedness;
  play: boolean;
}) {
  const { s: p0, b, f } = ghostPoints(handedness);
  const sprite = useLoop<SVGGElement>(
    useMemo(() => pointerKeyframes(handedness), [handedness]),
    play,
  );
  const pull = useLoop<SVGPathElement>(
    useMemo(() => trailKeyframes('pull'), []),
    play,
  );
  const flick = useLoop<SVGPathElement>(
    useMemo(() => trailKeyframes('flick'), []),
    play,
  );
  const pullHead = useLoop<SVGPolygonElement>(
    useMemo(() => headKeyframes('pull'), []),
    play,
  );
  const flickHead = useLoop<SVGPolygonElement>(
    useMemo(() => headKeyframes('flick'), []),
    play,
  );
  const badges = badgePoints(handedness);
  const resting = !play;
  return (
    <svg
      className={s.ghostSvg}
      viewBox={`${GHOST_BOX.x} ${GHOST_BOX.y} ${GHOST_BOX.w} ${GHOST_BOX.h}`}
      aria-hidden="true"
      focusable="false"
      data-testid="lesson-ghost"
      data-ghost={kind}
      data-motion={play ? 'loop' : 'still'}
    >
      <path
        ref={pull}
        className={s.trailPull}
        d={`M${p0.x} ${p0.y} L${b.x} ${b.y}`}
        strokeDasharray={GHOST.pullUnits}
        strokeDashoffset={resting ? 0 : GHOST.pullUnits}
        style={{ opacity: resting ? 1 : 0 }}
      />
      <path
        ref={flick}
        className={s.trailFlick}
        d={`M${b.x} ${b.y} L${f.x} ${f.y}`}
        strokeDasharray={GHOST.flickUnits}
        strokeDashoffset={resting ? 0 : GHOST.flickUnits}
        style={{ opacity: resting ? 1 : 0 }}
      />
      <polygon ref={pullHead} className={s.headPull} points={arrowHead(p0, b)} style={{ opacity: resting ? 1 : 0 }} />
      <polygon ref={flickHead} className={s.headFlick} points={arrowHead(b, f)} style={{ opacity: resting ? 1 : 0 }} />
      {[
        { n: 1, at: badges.pull },
        { n: 2, at: badges.flick },
      ].map(({ n, at: pt }) => (
        <g key={n} transform={`translate(${pt.x} ${pt.y})`}>
          <circle r="5" className={s.badge} />
          <text className={s.badgeNum} textAnchor="middle" dominantBaseline="central">
            {n}
          </text>
        </g>
      ))}
      {resting ? (
        [p0, b, f].map((pt, i) => <circle key={i} cx={pt.x} cy={pt.y} r="3" className={s.stillDot} />)
      ) : (
        <g ref={sprite} style={{ transform: at(p0), opacity: 0 }}>
          <PointerSprite kind={kind} />
        </g>
      )}
    </svg>
  );
}

const KEY_BOXES: Record<
  'up' | 'left' | 'right' | 'down' | 'shift' | 'space',
  { x: number; y: number; w: number; label: string }
> = {
  up: { x: 44, y: 4, w: 14, label: '↑' },
  left: { x: 28, y: 20, w: 14, label: '←' },
  down: { x: 44, y: 20, w: 14, label: '↓' },
  right: { x: 60, y: 20, w: 14, label: '→' },
  shift: { x: 4, y: 20, w: 22, label: 'Shift' },
  space: { x: 20, y: 38, w: 60, label: 'Space' },
};

function KeyOverlay({ keyName, name, play }: { keyName: GhostKey; name: keyof typeof KEY_BOXES; play: boolean }) {
  const ref = useLoop<SVGRectElement>(
    useMemo(() => keyKeyframes(keyName), [keyName]),
    play,
  );
  const k = KEY_BOXES[name];
  return (
    <rect
      ref={ref}
      className={s.keyOn}
      x={k.x}
      y={k.y}
      width={k.w}
      height={12}
      rx={2.5}
      style={{ opacity: play ? 0 : name === 'up' ? 1 : 0 }}
    />
  );
}

function KeyboardGhost({ play }: { play: boolean }) {
  return (
    <svg
      className={s.ghostSvg}
      style={{ aspectRatio: '100 / 60' }}
      viewBox="0 0 100 60"
      aria-hidden="true"
      focusable="false"
      data-testid="lesson-ghost"
      data-ghost="keyboard"
      data-motion={play ? 'loop' : 'still'}
    >
      {Object.entries(KEY_BOXES).map(([name, k]) => (
        <g key={name}>
          <rect className={s.keyCap} x={k.x} y={k.y} width={k.w} height={12} rx={2.5} />
          <text className={s.keyLabel} x={k.x + k.w / 2} y={k.y + 6.4} textAnchor="middle" dominantBaseline="central">
            {k.label}
          </text>
        </g>
      ))}
      {/* One key at a time: an arrow hits, a side arrow hits that way, Shift with an arrow lifts it, Space defends. */}
      <KeyOverlay keyName="up" name="up" play={play} />
      <KeyOverlay keyName="right" name="right" play={play} />
      <KeyOverlay keyName="shift" name="shift" play={play} />
      <KeyOverlay keyName="shift" name="up" play={play} />
      <KeyOverlay keyName="space" name="space" play={play} />
    </svg>
  );
}

function Hand({ side }: { side: 'near' | 'far' }) {
  const ref = useLoop<SVGGElement>(
    useMemo(() => handKeyframes(side), [side]),
    true,
  );
  return (
    <g ref={ref} style={{ opacity: 0, transform: at({ x: side === 'near' ? 44 : 51, y: 26 }) }}>
      <circle r="4.2" className={s.fingerPad} />
      <circle r="7.5" className={s.fingerRing} />
    </g>
  );
}

/** The hands' two resting points (raised and back, then through) for the still picture. */
const STILL_HANDS = [
  { back: { x: 36, y: 0 }, through: { x: 52, y: 40 } },
  { back: { x: 43, y: 0 }, through: { x: 59, y: 40 } },
] as const;

/** Skeleton-free: a body outline and two dots for the hands. No limbs, no landmarks, no video. */
function CameraGhost({ play }: { play: boolean }) {
  return (
    <svg
      className={s.ghostSvg}
      style={{ aspectRatio: '100 / 70' }}
      viewBox="0 -12 100 70"
      aria-hidden="true"
      focusable="false"
      data-testid="lesson-ghost"
      data-ghost="camera"
      data-motion={play ? 'loop' : 'still'}
    >
      <circle className={s.body} cx="50" cy="-2" r="7" />
      <rect className={s.body} x="36" y="7" width="28" height="42" rx="10" />
      {play ? (
        <>
          <Hand side="near" />
          <Hand side="far" />
        </>
      ) : (
        STILL_HANDS.map((h, i) => (
          <g key={i}>
            <path className={s.trailFlick} d={`M${h.back.x} ${h.back.y} L${h.through.x} ${h.through.y}`} />
            {([h.back, h.through] as const).map((pt, n) => (
              <g key={n} transform={`translate(${pt.x} ${pt.y})`}>
                <circle r="5.5" className={s.stillDot} />
                {i === 0 && (
                  <text className={s.stillNum} textAnchor="middle" dominantBaseline="central">
                    {n + 1}
                  </text>
                )}
              </g>
            ))}
          </g>
        ))
      )}
    </svg>
  );
}

/** CAMERA-UX's silhouette when the camera input registered one, else two dots on a body outline of the lesson's own. */
function CameraPicture({ play, label, handedness }: { play: boolean; label: string; handedness: Handedness }) {
  const Cue = lessonCameraPort()?.Cue;
  return Cue ? <Cue play={play} label={label} handedness={handedness} /> : <CameraGhost play={play} />;
}

export function Ghost({
  input,
  handedness,
  play,
  label,
}: {
  input: LessonInput;
  handedness: Handedness;
  play: boolean;
  label: string;
}) {
  // Moving, the picture is decoration for the words; still (Reduced Motion), it is the picture, and it is described.
  const a11y = play ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label };
  return (
    <span className={s.ghostBox} {...a11y}>
      {input === 'keyboard' ? (
        <KeyboardGhost play={play} />
      ) : input === 'camera' ? (
        <CameraPicture play={play} label={label} handedness={handedness} />
      ) : (
        <PointerGhost kind={input} handedness={handedness} play={play} />
      )}
    </span>
  );
}
