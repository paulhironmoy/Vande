/**
 * The first-swing silhouette (ball 1 only; the first-ball lesson embeds it as `LessonCameraPort.Cue`). A body drawn from
 * the front with two hands holding the bat: the hands rise ("hands up and back"), wait, then swing forward and down to the
 * player's off side, and the loop rests before it starts again. It never ends, never speeds up and never judges.
 *
 * Reduced Motion (`play` false) draws no motion at all: the top of the backlift and the finish of the swing on one body,
 * the first numbered 1 and the second 2, with a dotted arrow for each move. The picture is decoration for the words beside
 * it (the lesson card names both steps in text), so it is hidden from screen readers; the lesson's wrapper labels the still.
 */
import { useEffect, useRef } from 'react';
import type { Handedness } from '@/contracts';
import { loadPracticeSettings } from '@/practice/store';
import { CUE, CUE_BOX, armPath, arrowHead, poseAt, stillPoses, type ArmPose, type Pt } from './cue';
import s from './camera.module.css';

export interface CameraCueProps {
  play: boolean;
  /** The lesson's accessible name for the still picture (its wrapper applies it). */
  label?: string;
  handedness?: Handedness;
}

const at = (p: Pt) => `translate(${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10})`;
const f = (n: number) => Math.round(n * 10) / 10;

function Hand({ refTo, p }: { refTo?: (el: SVGGElement | null) => void; p: Pt }) {
  return (
    <g ref={refTo} transform={at(p)}>
      <circle r="5.4" className={s.cueRing} />
      <circle r="2.8" className={s.cueHand} />
    </g>
  );
}

function Moving({ hand }: { hand: Handedness }) {
  const arms = useRef<[SVGPathElement | null, SVGPathElement | null]>([null, null]);
  const hands = useRef<[SVGGElement | null, SVGGElement | null]>([null, null]);
  const start = poseAt(0, hand);

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const draw = (pose: ArmPose) => {
      arms.current[0]?.setAttribute('d', armPath(pose.left));
      arms.current[1]?.setAttribute('d', armPath(pose.right));
      hands.current[0]?.setAttribute('transform', at(pose.left[2]));
      hands.current[1]?.setAttribute('transform', at(pose.right[2]));
    };
    const tick = (now: number) => {
      draw(poseAt(now - t0, hand));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hand]);

  return (
    <>
      <path ref={(el) => void (arms.current[0] = el)} className={s.cueLimb} d={armPath(start.left)} />
      <path ref={(el) => void (arms.current[1] = el)} className={s.cueLimb} d={armPath(start.right)} />
      <Hand refTo={(el) => void (hands.current[0] = el)} p={start.left[2]} />
      <Hand refTo={(el) => void (hands.current[1] = el)} p={start.right[2]} />
    </>
  );
}

function Still({ hand }: { hand: Handedness }) {
  const { first, second, from, to, bow } = stillPoses(hand);
  const rest = hand === 'left' ? { x: 100 - CUE.rest.x, y: CUE.rest.y } : { x: CUE.rest.x, y: CUE.rest.y };
  const up = from;
  const [r1, r2] = arrowHead(rest, up);
  const [b1, b2] = arrowHead(bow, to);
  const mid = (a: ArmPose) => ({ x: (a.left[2].x + a.right[2].x) / 2, y: (a.left[2].y + a.right[2].y) / 2 });
  const one = mid(first);
  const two = mid(second);
  return (
    <>
      {/* The first picture, a little faded: the top of the backlift. The second is the finish of the swing. */}
      <g opacity="0.5">
        <path className={s.cueLimb} d={armPath(first.left)} />
        <path className={s.cueLimb} d={armPath(first.right)} />
      </g>
      <path className={s.cueLimb} d={armPath(second.left)} />
      <path className={s.cueLimb} d={armPath(second.right)} />
      <path className={s.cueTrail} d={`M${f(rest.x)} ${f(rest.y)} L${f(up.x)} ${f(up.y)}`} />
      <path className={s.cueArrow} d={`M${f(r1.x)} ${f(r1.y)} L${f(up.x)} ${f(up.y)} L${f(r2.x)} ${f(r2.y)}`} />
      <path className={s.cueTrail} d={`M${f(up.x)} ${f(up.y)} Q${f(bow.x)} ${f(bow.y)} ${f(to.x)} ${f(to.y)}`} />
      <path className={s.cueArrow} d={`M${f(b1.x)} ${f(b1.y)} L${f(to.x)} ${f(to.y)} L${f(b2.x)} ${f(b2.y)}`} />
      {(
        [
          [one, '1'],
          [two, '2'],
        ] as const
      ).map(([p, n]) => (
        <g key={n} transform={at(p)}>
          <circle r="5.6" className={s.cueRing} />
          <text className={s.cueNum} textAnchor="middle" dominantBaseline="central">
            {n}
          </text>
        </g>
      ))}
    </>
  );
}

export function CameraCue({ play, handedness }: CameraCueProps) {
  const hand: Handedness = handedness ?? loadPracticeSettings().handedness;
  return (
    <svg
      className={s.cue}
      viewBox={`0 0 ${CUE_BOX.w} ${CUE_BOX.h}`}
      aria-hidden="true"
      focusable="false"
      data-testid="camera-cue"
      data-motion={play ? 'loop' : 'still'}
      data-hand={hand}
    >
      <circle className={s.cueBody} cx={CUE.head.x} cy={CUE.head.y} r={CUE.head.r} />
      <rect
        className={s.cueBody}
        x={CUE.torso.x}
        y={CUE.torso.y}
        width={CUE.torso.w}
        height={CUE.torso.h}
        rx={CUE.torso.r}
      />
      {play ? <Moving hand={hand} /> : <Still hand={hand} />}
    </svg>
  );
}

export default CameraCue;
