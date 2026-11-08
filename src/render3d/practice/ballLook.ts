/**
 * The Practice ball as the batter reads it, one definition for every tier (READ2, READ3 ★, F-008, F-012): the 3D stage
 * (Premium and Balanced, every profile) and Classic 2D draw exactly this, so the ball, its trace and its focus aid are
 * the same on every device. Sizes are CSS pixels on the screen, so they hold at every resolution and pixel ratio.
 *
 *   size     the ball's own visual size (VISUAL_SCALE × the physics radius, about the size a batter perceives a
 *            moving ball), never drawn smaller than MIN_DIAMETER_PX across: at release a phone's batter's eye
 *            shows a 7.2 cm ball 19 m away at under 3 px, which the eye cannot hold (F-012). The minimum applies only
 *            far down the pitch; from about 11 m on (phones) the true size is larger and is drawn.
 *   shade    a soft dark surround (a shadow round the ball, never a glow), darkest at the ball's edge and gone SHADE_PX
 *            out: a white ball on the tan pitch is about 2:1, and the shade brings its local background down so the ball
 *            reads at 3:1 or better anywhere (against the dark sight screen it changes nothing). The rim is its first
 *            pixel or so, nearly black.
 *   trace    a short, faint trail of the ball's last positions: TRACE.samples points TRACE.stepMs apart, its opacity
 *            falling with the square of the distance from the ball, its width a fraction of the drawn ball.
 *   focus    the optional focus aid (a setting, off by default): a thin ring a little outside the shade, so the ball's
 *            position is easy to keep hold of. Never a glow, never animated.
 *
 * Pure: no three.js, no canvas (the 2D stage must not pull in three.js).
 */
import { BALL_R } from '../core/ground';

export const PRACTICE_BALL = Object.freeze({
  /** Drawn radius over the physics radius (never used by the physics). */
  visualScale: 1.22,
  /** The ball is never drawn smaller than this across (CSS px). */
  minDiameterPx: 3.6,
  /** The dark surround: how far out it reaches past the ball's edge (CSS px), its opacity there, and its colour. */
  shade: Object.freeze({ px: 12, rimPx: 1.25, rimOpacity: 0.86, opacity: 0.62, color: '#05060f' }),
  /** The trace. */
  trace: Object.freeze({ samples: 6, stepMs: 14, alpha: 0.3, widthOfBall: 0.55, minWidthPx: 1, color: '#52e2ff' }),
  /** The optional focus aid: a thin ring this far outside the ball's edge (CSS px). */
  focus: Object.freeze({ gapPx: 9, widthPx: 1.25, opacity: 0.7, color: '#e9fbff' }),
  /** The ball's own colour, for the 2D painter (the 3D ball is lit, but renders near this white). */
  color: '#f7f6f1',
});

/** The ball's true drawn diameter on screen (CSS px) at `depthM` along the view, for a focal length in CSS px. */
function trueBallDiameterPx(depthM: number, focalPx: number): number {
  return (2 * BALL_R * PRACTICE_BALL.visualScale * focalPx) / Math.max(1e-3, depthM);
}

/** The diameter the ball is drawn at (CSS px): its true visual size, never under PRACTICE_BALL.minDiameterPx. */
export function ballDiameterPx(depthM: number, focalPx: number): number {
  return Math.max(PRACTICE_BALL.minDiameterPx, trueBallDiameterPx(depthM, focalPx));
}

/** Training inspection size: deliberately large, bounded on both compact phones and desktop canvases. */
export function closeUpBallDiameterPx(viewHeightPx: number): number {
  return Math.min(260, Math.max(92, viewHeightPx * 0.32));
}

export interface ProjectedBallSurface {
  /** Direction on screen towards the centre of the polished half. */
  polishedAngle: number;
  /** −1: polished pole points away; 0: side-on; +1: points at the camera. */
  polishedFacing: number;
  /** Direction of the seam ellipse's major axis on screen. */
  seamAngle: number;
  /** Minor/major radius of the projected seam circle. */
  seamMinor: number;
  /** Fixed rough-side material marks, projected from the complete rigid surface basis. */
  roughScuffs: readonly (readonly { x: number; y: number; visible: boolean }[])[];
}

const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  a.x * b.x + a.y * b.y + a.z * b.z;
const bounded = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const unit = (v: { x: number; y: number; z: number }) => {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};
const rotated = (
  v: { x: number; y: number; z: number },
  rawAxis: { x: number; y: number; z: number },
  angle: number,
) => {
  const a = unit(rawAxis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = dot(a, v) * (1 - c);
  return {
    x: v.x * c + (a.y * v.z - a.z * v.y) * s + a.x * d,
    y: v.y * c + (a.z * v.x - a.x * v.z) * s + a.y * d,
    z: v.z * c + (a.x * v.y - a.y * v.x) * s + a.z * d,
  };
};

/**
 * The material tangent produced by Three's current shortest-arc rotation from local polished pole −X to `shine`.
 * Carrying this second axis makes the orientation complete while retaining the exact release appearance, including
 * Three's deterministic 180-degree fallback when the two pole vectors are antiparallel.
 */
export function releaseSurfaceTangent(shine: { x: number; y: number; z: number }) {
  const to = unit(shine);
  let qx = 0;
  let qy = to.z;
  let qz = -to.y;
  let qw = 1 - to.x;
  // Keep this threshold byte-for-byte compatible in intent with the installed Three Quaternion.setFromUnitVectors;
  // near-antiparallel vectors must choose the same deterministic axis as the renderer did before basis carry.
  if (qw < 1e-8) {
    qx = 0;
    qy = -1;
    qz = 0;
    qw = 0;
  } else {
    const n = Math.hypot(qx, qy, qz, qw) || 1;
    qx /= n;
    qy /= n;
    qz /= n;
    qw /= n;
  }
  // The +Y column of this unit quaternion's rotation matrix.
  return unit({
    x: 2 * (qx * qy - qz * qw),
    y: 1 - 2 * (qx * qx + qz * qz),
    z: 2 * (qy * qz + qx * qw),
  });
}

type SurfaceAxes = {
  spinAxis: { x: number; y: number; z: number };
  seamAxis: { x: number; y: number; z: number };
  shineAxis: { x: number; y: number; z: number };
  surfaceTangent?: { x: number; y: number; z: number };
};

export function rotatedBallSurface(spin: number, surface: SurfaceAxes) {
  const tangent = surface.surfaceTangent ?? releaseSurfaceTangent(surface.shineAxis);
  return {
    seamAxis: unit(rotated(surface.seamAxis, surface.spinAxis, spin)),
    shineAxis: unit(rotated(surface.shineAxis, surface.spinAxis, spin)),
    surfaceTangent: unit(rotated(tangent, surface.spinAxis, spin)),
  };
}

const cross = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

// Quadratic curves in the local tangent/binormal plane. Positive local X is the rough pole; solving X from the unit
// sphere keeps every sample on the physical ball rather than rotating a screen-space decoration.
const ROUGH_SCUFFS = [
  [
    [-0.42, -0.34],
    [-0.25, -0.5],
    [-0.02, -0.35],
  ],
  [
    [0.02, 0.55],
    [0.12, 0.34],
    [0.23, 0.1],
  ],
  [
    [0.42, 0.25],
    [0.5, 0.03],
    [0.37, -0.2],
  ],
] as const;

/** Orthographic screen projection of the exact seam plane and polished pole after the physics rotation. */
export function projectBallSurface(
  spin: number,
  surface: SurfaceAxes,
  camera: {
    forward: { x: number; y: number; z: number };
    right: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
  },
): ProjectedBallSurface {
  const rotatedSurface = rotatedBallSurface(spin, surface);
  const seam = rotatedSurface.seamAxis;
  const shine = rotatedSurface.shineAxis;
  const xAxis = { x: -shine.x, y: -shine.y, z: -shine.z };
  const tangentDotX = dot(rotatedSurface.surfaceTangent, xAxis);
  const yAxis = unit({
    x: rotatedSurface.surfaceTangent.x - xAxis.x * tangentDotX,
    y: rotatedSurface.surfaceTangent.y - xAxis.y * tangentDotX,
    z: rotatedSurface.surfaceTangent.z - xAxis.z * tangentDotX,
  });
  const zAxis = unit(cross(xAxis, yAxis));
  const major = {
    x: camera.forward.y * seam.z - camera.forward.z * seam.y,
    y: camera.forward.z * seam.x - camera.forward.x * seam.z,
    z: camera.forward.x * seam.y - camera.forward.y * seam.x,
  };
  const majorX = dot(major, camera.right);
  const majorY = -dot(major, camera.up);
  const shineX = dot(shine, camera.right);
  const shineY = -dot(shine, camera.up);
  const roughScuffs = ROUGH_SCUFFS.map(([from, control, to]) =>
    Array.from({ length: 9 }, (_, i) => {
      const t = i / 8;
      const k = 1 - t;
      const ly = k * k * from[0] + 2 * k * t * control[0] + t * t * to[0];
      const lz = k * k * from[1] + 2 * k * t * control[1] + t * t * to[1];
      const lx = Math.sqrt(Math.max(0, 1 - ly * ly - lz * lz));
      const world = {
        x: xAxis.x * lx + yAxis.x * ly + zAxis.x * lz,
        y: xAxis.y * lx + yAxis.y * ly + zAxis.y * lz,
        z: xAxis.z * lx + yAxis.z * ly + zAxis.z * lz,
      };
      return { x: dot(world, camera.right), y: -dot(world, camera.up), visible: -dot(world, camera.forward) > 0 };
    }),
  );
  return {
    polishedAngle: Math.atan2(shineY, shineX),
    polishedFacing: bounded(-dot(shine, camera.forward), -1, 1),
    seamAngle: Math.hypot(majorX, majorY) > 1e-9 ? Math.atan2(majorY, majorX) : 0,
    seamMinor: bounded(Math.abs(dot(seam, camera.forward)), 0, 1),
    roughScuffs,
  };
}

/**
 * The shade's opacity at `px` CSS pixels outside the ball's edge (0 at the edge): the rim, then a smooth fall to nothing
 * at shade.px. The 3D stage's shader and the 2D painter's gradient both follow this one curve.
 */
export function shadeOpacity(px: number): number {
  const s = PRACTICE_BALL.shade;
  if (px < 0) return 0;
  if (px <= s.rimPx) return s.rimOpacity;
  const u = Math.min(1, (px - s.rimPx) / (s.px - s.rimPx));
  const fall = 1 - u * u * (3 - 2 * u);
  return s.opacity * fall;
}

/** Opacity of the trace at sample i (0 at the ball) of n: the square of how near it is to the ball. */
export function traceAlpha(i: number, n: number): number {
  if (n <= 1) return 0;
  const k = 1 - Math.min(i, n - 1) / (n - 1);
  return PRACTICE_BALL.trace.alpha * k * k;
}

/** Width of the trace (CSS px) at sample i of n, for a drawn ball of `diameterPx`: full at the ball, a quarter at the tail. */
export function traceWidthPx(i: number, n: number, diameterPx: number): number {
  const k = n <= 1 ? 1 : 1 - Math.min(i, n - 1) / (n - 1);
  return Math.max(PRACTICE_BALL.trace.minWidthPx, diameterPx * PRACTICE_BALL.trace.widthOfBall) * (0.25 + 0.75 * k);
}
