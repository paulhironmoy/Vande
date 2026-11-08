/**
 * Shared by the camera tests: the gaze integrator as it shipped before A3 (frozen; the reference for the owner's
 * comfort condition) and the measures the condition is checked with. Not a test file.
 */
import { practiceGaze } from '@/render3d/core/camera';
import { sampleBall, type BallScript } from '@/render3d/core/choreo';
import { simToScene } from '@/render3d/practice/frame';

export type V = { x: number; y: number; z: number };
export const DEG = Math.PI / 180;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp(b === a ? 0 : (v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const unit = (x: number, y: number, z: number): V => {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
};
export const yawPitch = (d: V) => ({ yaw: Math.atan2(d.x, -d.z), pitch: Math.asin(clamp(d.y, -1, 1)) });
export const dirOf = (yaw: number, pitch: number): V => ({ x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) });
export const wrap = (a: number) => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const cross = (a: V, b: V): V => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
export const turn = (a: V, b: V): V => {
  const c = cross(a, b);
  const s = Math.hypot(c.x, c.y, c.z);
  const k = s > 1e-15 ? Math.atan2(s, dot(a, b)) / s : 0;
  return { x: c.x * k, y: c.y * k, z: c.z * k };
};

export interface Table { from: number; yaw: Float32Array; pitch: Float32Array; base: { yaw: number; pitch: number } }

/** The gaze integrator before A3, frozen (camera.ts buildGaze as shipped at 38924bd+4d9dd5cbfe14). */
export function shippedTable(script: BallScript, reducedMotion: boolean): Table {
  const p = script.practice!;
  const eye = p.eye;
  const rel = p.releaseWorld;
  const tr = yawPitch(unit(rel.x - eye.x, rel.y - eye.y, rel.z - eye.z));
  const base = { yaw: tr.yaw, pitch: tr.pitch - 14 * DEG };
  const from = p.releaseScene;
  const until = Math.min(script.duration, from + 9000);
  const n = Math.max(2, Math.ceil((until - from) / 4) + 1);
  const yaws = new Float32Array(n);
  const pitches = new Float32Array(n);
  const gain = reducedMotion ? 0.65 : 0.9;
  const follow = reducedMotion ? 0.65 : 0.9;
  const maxStep = 300 * DEG * 0.004;
  let yaw = base.yaw;
  let pitch = base.pitch;
  for (let i = 0; i < n; i++) {
    const t = from + i * 4;
    let bx = 0;
    let by = 0;
    let bz = 0;
    for (let k = 0; k < 3; k++) {
      const s = sampleBall(script, t - 10 - k * 12).pos;
      bx += s.x;
      by += s.y;
      bz += s.z;
    }
    const b = { x: bx / 3, y: by / 3, z: bz / 3 };
    const dist = Math.hypot(b.x - eye.x, b.y - eye.y, b.z - eye.z);
    let w = p.flight ? gain * smooth(24, 12, dist) : 0;
    if (p.contactScene !== null && t > p.contactScene) w = w + (follow - w) * smooth(p.contactScene, p.contactScene + 140, t);
    const to = yawPitch(unit(b.x - eye.x, b.y - eye.y, b.z - eye.z));
    const wantYaw = base.yaw + clamp(wrap(to.yaw - base.yaw) * w, -60 * DEG, 60 * DEG);
    const wantPitch = clamp(base.pitch + (to.pitch - base.pitch) * w, -65 * DEG, 30 * DEG);
    yaw += clamp(wrap(wantYaw - yaw), -maxStep, maxStep);
    pitch += clamp(wantPitch - pitch, -maxStep, maxStep);
    yaws[i] = yaw;
    pitches[i] = pitch;
  }
  return { from, yaw: yaws, pitch: pitches, base };
}
export function shippedGaze(table: Table, t: number): V {
  const x = (t - table.from) / 4;
  if (x <= 0) return dirOf(table.base.yaw, table.base.pitch);
  const i = Math.min(table.yaw.length - 2, Math.floor(x));
  const u = Math.min(1, x - i);
  return dirOf(table.yaw[i] + wrap(table.yaw[i + 1] - table.yaw[i]) * u, table.pitch[i] + (table.pitch[i + 1] - table.pitch[i]) * u);
}

/** Peak angular speed (°/s) and peak angular acceleration (°/s²) of directions sampled `dtMs` apart. */
export function peaksOf(dirs: V[], dtMs: number) {
  const dt = dtMs / 1000;
  let rate = 0;
  let acc = 0;
  let prev: V | null = null;
  for (let i = 1; i < dirs.length; i++) {
    const r = turn(dirs[i - 1], dirs[i]);
    rate = Math.max(rate, Math.hypot(r.x, r.y, r.z) / dt);
    if (prev) acc = Math.max(acc, Math.hypot(r.x - prev.x, r.y - prev.y, r.z - prev.z) / dt / dt);
    prev = r;
  }
  return { rate: rate / DEG, acc: acc / DEG };
}

/**
 * The windows the condition is checked over, from the release: to the ideal contact, to the end of the first-person
 * view, and to the end of the gaze (a replay from the batter's eye shows all of it).
 */
export function windows(script: BallScript, table: Table): Array<[string, number]> {
  const p = script.practice!;
  const end = table.from + (table.yaw.length - 1) * 4;
  const fp = Number.isFinite(p.firstPersonUntil) ? Math.min(p.firstPersonUntil, script.duration) : script.duration;
  return [['to ideal contact', Math.min(end, simToScene(p, p.flight!.idealContactT))], ['first person', Math.min(end, fp)], ['whole gaze', end]];
}

/** Every measure of the condition for a gaze given as a function of scene time (grid values for the grid measures). */
export function measures(script: BallScript, at: (t: number) => V, grid: (i: number) => { yaw: number; pitch: number }, gridLength: number, end: number, phases = 4) {
  const from = script.practice!.releaseScene;
  const last = Math.min(gridLength - 1, Math.ceil((end - from) / 4));
  const cells = Array.from({ length: last + 1 }, (_, i) => grid(i));
  const g = peaksOf(cells.map((c) => dirOf(c.yaw, c.pitch)), 4);
  let yp = 0;
  for (let i = 1; i < cells.length; i++) yp = Math.max(yp, Math.hypot(wrap(cells[i].yaw - cells[i - 1].yaw), cells[i].pitch - cells[i - 1].pitch) / 0.004 / DEG);
  const out: Record<string, number> = { 'grid rate': g.rate, 'grid acceleration': g.acc, 'grid yaw-pitch rate': yp };
  for (const [hz, frame] of [[60, 1000 / 60], [30, 1000 / 30]] as const) {
    let rate = 0;
    let acc = 0;
    for (let k = 0; k < phases; k++) {
      const dirs: V[] = [];
      for (let t = from + 1 + (k * frame) / phases; t <= end; t += frame) dirs.push(at(t));
      const m = peaksOf(dirs, frame);
      rate = Math.max(rate, m.rate);
      acc = Math.max(acc, m.acc);
    }
    out[`${hz} fps rate`] = rate;
    out[`${hz} fps acceleration`] = acc;
  }
  return out;
}

/** The production gaze's grid values, read back through practiceGaze at the grid times (exact at grid points). */
export function productionGrid(script: BallScript, reducedMotion: boolean) {
  const from = script.practice!.releaseScene;
  return (i: number) => yawPitch(practiceGaze(script, from + i * 4 + (i === 0 ? 1e-9 : 0), reducedMotion));
}
