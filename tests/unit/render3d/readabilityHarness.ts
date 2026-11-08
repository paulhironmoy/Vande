/**
 * Measures the batter's-eye view the way the readability criteria read it (READ2, EMB1, F-012, F-024), on real physics
 * deliveries: for each rubric viewport, the field of view, the ball's drawn diameter (CSS px) at release, at the bounce
 * and 5 m before the bat, and how long before contact the ball is still inside the frame. Pure (no WebGL): the camera
 * director, the physics flight and the shared ball look (practice/ballLook.ts) are the same code the stages run.
 */
import type { BallFlight, BowlerProfile, DeliveryResult, Handedness, PracticeDeliveryPlan } from '@/contracts/practice';
import { cameraAt, practicePlan, type CameraPose } from '@/render3d/core/camera';
import { sampleBall, type BallScript } from '@/render3d/core/choreo';
import { BALL_R } from '@/render3d/core/ground';
import { ballDiameterPx, PRACTICE_BALL } from '@/render3d/practice/ballLook';
import { ballAt, simToScene } from '@/render3d/practice/frame';
import { buildPracticeScript } from '@/render3d/practice/script';
import type { PracticeSceneSetup } from '@/render3d/practice/types';
import { autoField, flight as physicsFlight } from '@/physics';

/** The rubric's landscape viewports (ceiling rubric §3), CSS px. */
export const VIEWPORTS = [
  { name: '640x360', w: 640, h: 360 },
  { name: '844x390', w: 844, h: 390 },
  { name: '915x412', w: 915, h: 412 },
  { name: '1280x800', w: 1280, h: 800 },
  { name: '1920x1080', w: 1920, h: 1080 },
] as const;

export interface ViewPoint {
  /** Normalised device coordinates (−1..1), y up. */
  x: number;
  y: number;
  /** Depth along the view (m). */
  depth: number;
}

const unit = (x: number, y: number, z: number) => {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
};

/** Projects a world point through a camera pose (the same pinhole as three's PerspectiveCamera without roll). */
export function project(cam: CameraPose, p: { x: number; y: number; z: number }, aspect: number): ViewPoint | null {
  const f = unit(cam.target.x - cam.pos.x, cam.target.y - cam.pos.y, cam.target.z - cam.pos.z);
  const r = unit(-f.z, 0, f.x);
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const d = { x: p.x - cam.pos.x, y: p.y - cam.pos.y, z: p.z - cam.pos.z };
  const depth = d.x * f.x + d.y * f.y + d.z * f.z;
  if (depth <= 0.05) return null;
  const tanV = Math.tan((cam.fov * Math.PI) / 360);
  return { x: (d.x * r.x + d.y * r.y + d.z * r.z) / depth / (tanV * aspect), y: (d.x * u.x + d.y * u.y + d.z * u.z) / depth / tanV, depth };
}

/** Horizontal field of view (deg) for a vertical one and an aspect. */
export const horizontalFov = (vfov: number, aspect: number) => (2 * Math.atan(Math.tan((vfov * Math.PI) / 360) * aspect) * 180) / Math.PI;

/** Focal length in CSS px for a vertical field of view and a viewport height. */
export const focalPx = (vfov: number, h: number) => h / 2 / Math.tan((vfov * Math.PI) / 360);

export interface DeliveryCase {
  name: string;
  bowler: BowlerProfile;
  plan: PracticeDeliveryPlan;
  handedness: Handedness;
}

const PACE: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'read-pace' };
const SPIN: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'read-spin' };
const WRIST: BowlerProfile = { family: 'spin', spinType: 'wrist', arm: 'left', lookSeed: 'read-wrist' };

/** A spread of real deliveries: yorker to bouncer at pace, flighted to quick spin, both batting hands. */
export function deliveryCases(): DeliveryCase[] {
  const out: DeliveryCase[] = [];
  const pace: Array<[string, PracticeDeliveryPlan]> = [
    ['yorker', { variation: 'yorker', lengthM: 0.9, lineM: 0.02, speedKph: 139.5 }],
    ['full', { variation: 'outswing', lengthM: 3.5, lineM: 0.12, speedKph: 136 }],
    ['good', { variation: 'stock', lengthM: 6, lineM: 0.1, speedKph: 140 }],
    ['back', { variation: 'seam', lengthM: 7.5, lineM: 0.2, speedKph: 142 }],
    ['bouncer', { variation: 'bouncer', lengthM: 10.7, lineM: 0.04, speedKph: 141.5 }],
    ['wide-off', { variation: 'stock', lengthM: 5.5, lineM: 0.45, speedKph: 134 }],
    ['leg', { variation: 'inswing', lengthM: 5, lineM: -0.25, speedKph: 133 }],
  ];
  const spin: Array<[string, PracticeDeliveryPlan]> = [
    ['flighted', { variation: 'flighted', lengthM: 3.2, lineM: 0.1, speedKph: 80 }],
    ['stock', { variation: 'stock', lengthM: 4.5, lineM: 0.12, speedKph: 86 }],
    ['quicker', { variation: 'quicker', lengthM: 5.5, lineM: 0.05, speedKph: 95 }],
  ];
  for (const handedness of ['right', 'left'] as const) {
    for (const [n, plan] of pace) out.push({ name: `pace ${n} ${handedness}`, bowler: PACE, plan, handedness });
    for (const [n, plan] of spin) out.push({ name: `spin ${n} ${handedness}`, bowler: handedness === 'right' ? SPIN : WRIST, plan, handedness });
  }
  return out;
}

export function caseScript(c: DeliveryCase, result: DeliveryResult | null = null): { script: BallScript; flight: BallFlight; setup: PracticeSceneSetup } {
  const fl = result?.flight ?? physicsFlight({ plan: c.plan, bowler: c.bowler, conditions: 'balanced', seed: `read:${c.name}`, handedness: c.handedness });
  const setup: PracticeSceneSetup = { field: autoField(c.bowler, 'balanced', c.handedness), bowler: c.bowler, conditions: 'balanced', handedness: c.handedness };
  return { script: buildPracticeScript({ setup, flight: fl, result }), flight: fl, setup };
}

export interface ViewMeasure {
  viewport: string;
  hfov: number;
  vfov: number;
  /** Drawn ball diameter (CSS px): at release, at the bounce (null without one), 5 m before the ideal contact. */
  releasePx: number;
  bouncePx: number | null;
  fiveMPx: number;
  /** The true visual size at release (no minimum), for reference. */
  releaseTruePx: number;
  /** The last moment before the ideal contact the ball's centre is in the frame, as ms before contact (0: to contact). */
  lastInViewMsBeforeContact: number;
  /** Whether the ball is in the frame at every sampled moment from release to that point (no gap). */
  continuous: boolean;
  /** Where the release sits (0 top … 1 bottom of the frame). */
  releaseFromTop: number;
  bounceFromTop: number | null;
}

/** Measures one delivery in one viewport (live, before the result: the ball as the batter reads it). */
export function measureView(script: BallScript, fl: BallFlight, vp: { name: string; w: number; h: number }, reducedMotion = false): ViewMeasure {
  const aspect = vp.w / vp.h;
  const plan = practicePlan(script, reducedMotion);
  const p = script.practice!;
  const ctx = { aspect, reducedMotion };
  const at = (t: number) => {
    const scene = simToScene(p, t);
    const cam = cameraAt(script, scene, plan, ctx);
    const pos = sampleBall(script, scene).pos;
    return { cam, pos, q: project(cam, pos, aspect) };
  };
  const px = (cam: CameraPose, q: ViewPoint | null, minimum = true) => {
    if (!q) return 0;
    const f = focalPx(cam.fov, vp.h);
    return minimum ? ballDiameterPx(q.depth, f) : (2 * BALL_R * PRACTICE_BALL.visualScale * f) / q.depth;
  };
  const rel = at(0.0005);
  const contactT = fl.idealContactT;
  // A bounce after the contact plane (a yorker, a full toss) is not part of what the batter reads before playing.
  const bounce = fl.bounce && fl.bounce.t < contactT ? at(fl.bounce.t) : null;
  const contactP = ballAt(fl.samples, contactT)!;
  // 5 m before the bat: when the ball is 5 m (along the pitch) short of the ideal contact.
  let fiveT = 0;
  for (let t = 0; t < contactT; t += 0.001) {
    const b = ballAt(fl.samples, t)!;
    if (contactP.z - b.z <= 5) {
      fiveT = t;
      break;
    }
  }
  const five = at(fiveT);
  let last = 0;
  let continuous = true;
  let gone = false;
  for (let t = 0; t <= contactT + 1e-9; t += 0.002) {
    const { q } = at(t);
    const inView = q !== null && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1;
    if (inView) {
      if (gone) continuous = false;
      last = t;
    } else gone = true;
  }
  return {
    viewport: vp.name,
    hfov: horizontalFov(rel.cam.fov, aspect),
    vfov: rel.cam.fov,
    releasePx: px(rel.cam, rel.q),
    bouncePx: bounce ? px(bounce.cam, bounce.q) : null,
    fiveMPx: px(five.cam, five.q),
    releaseTruePx: px(rel.cam, rel.q, false),
    lastInViewMsBeforeContact: Math.max(0, (contactT - last) * 1000),
    continuous,
    releaseFromTop: rel.q ? (1 - rel.q.y) / 2 : NaN,
    bounceFromTop: bounce?.q ? (1 - bounce.q.y) / 2 : null,
  };
}
