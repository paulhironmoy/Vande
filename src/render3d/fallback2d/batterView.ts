/**
 * Classic Practice's batter's view on Canvas 2D: the same camera pose the 3D stage uses (core/camera.ts, the
 * batter's eye and its gaze), projected through a pinhole onto simple shapes — the sight screen, the pitch and
 * creases, the far stumps, the bowler and the fielders, the ball (larger than its collision radius, outlined, with a
 * ground shadow and a short trace), the Learn landing cue, and the batter's own bat and gloves. The ball, the bat
 * and every event come from the same physics data as the 3D stage.
 */
import type { KitSpec } from '@/contracts';
import { evaluateActor } from '../core/actors';
import type { CameraPose } from '../core/camera';
import { type BallScript, sampleBall } from '../core/choreo';
import {
  BALL_R,
  BOUNDARY_R,
  PITCH_HALF,
  PITCH_WIDTH,
  POPPING,
  POPPING_CREASE_HALF,
  RETURN_CREASE_X,
  STUMP_H,
  STUMP_SPACING,
} from '../core/ground';
import { type Vec3, clamp } from '../core/math';
import { glovesOf } from '../practice/bat';
import type { BatPose } from '../practice/frame';

interface Projected {
  x: number;
  y: number;
  /** Depth along the view (m). */
  d: number;
}

export interface BatterViewOptions {
  bat: BatPose | null;
  landing: Vec3 | null;
  landingUntil: number;
  /** Actors not drawn (the batter's own body). */
  hidden: ReadonlySet<string>;
  visualScale: number;
}

const NEAR = 0.25;

export class BatterViewPainter {
  w = 1;
  h = 1;
  dpr = 1;
  calls = 0;
  private pos: Vec3 = { x: 0, y: 1.7, z: 9 };
  private f: Vec3 = { x: 0, y: 0, z: -1 };
  private r: Vec3 = { x: 1, y: 0, z: 0 };
  private u: Vec3 = { x: 0, y: 1, z: 0 };
  private focal = 1;

  constructor(readonly ctx: CanvasRenderingContext2D) {}

  resize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
  }

  private setCamera(cam: CameraPose) {
    this.pos = cam.pos;
    const f = { x: cam.target.x - cam.pos.x, y: cam.target.y - cam.pos.y, z: cam.target.z - cam.pos.z };
    const fl = Math.hypot(f.x, f.y, f.z) || 1;
    this.f = { x: f.x / fl, y: f.y / fl, z: f.z / fl };
    // right = f × up, up' = right × f
    const r = { x: -this.f.z, y: 0, z: this.f.x };
    const rl = Math.hypot(r.x, r.z) || 1;
    this.r = { x: r.x / rl, y: 0, z: r.z / rl };
    this.u = { x: this.r.y * this.f.z - this.r.z * this.f.y, y: this.r.z * this.f.x - this.r.x * this.f.z, z: this.r.x * this.f.y - this.r.y * this.f.x };
    this.focal = this.h / 2 / Math.tan((cam.fov * Math.PI) / 360);
  }

  project(p: Vec3): Projected | null {
    const dx = p.x - this.pos.x;
    const dy = p.y - this.pos.y;
    const dz = p.z - this.pos.z;
    const d = dx * this.f.x + dy * this.f.y + dz * this.f.z;
    if (d < NEAR) return null;
    const x = dx * this.r.x + dy * this.r.y + dz * this.r.z;
    const y = dx * this.u.x + dy * this.u.y + dz * this.u.z;
    return { x: this.w / 2 + (x / d) * this.focal, y: this.h / 2 - (y / d) * this.focal, d };
  }

  /** Screen size (px) of `metres` at depth d. */
  private px(metres: number, d: number) {
    return (metres / d) * this.focal;
  }

  private poly(points: Vec3[], fill: string) {
    const g = this.ctx;
    const pts = points.map((p) => this.project(p));
    if (pts.some((p) => !p)) return;
    g.fillStyle = fill;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p!.x, p!.y) : g.moveTo(p!.x, p!.y)));
    g.closePath();
    g.fill();
    this.calls++;
  }

  private line(a: Vec3, b: Vec3, color: string, width: number) {
    const pa = this.project(a);
    const pb = this.project(b);
    if (!pa || !pb) return;
    const g = this.ctx;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(pa.x, pa.y);
    g.lineTo(pb.x, pb.y);
    g.stroke();
    this.calls++;
  }

  paint(script: BallScript, t: number, cam: CameraPose, kits: [KitSpec, KitSpec], o: BatterViewOptions) {
    const g = this.ctx;
    this.calls = 0;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.setCamera(cam);
    // Sky above the horizon, floodlit grass below it.
    const ahead = { x: this.pos.x + this.f.x * 1000, y: this.pos.y, z: this.pos.z + this.f.z * 1000 };
    const hz = this.project(ahead);
    const horizon = clamp(hz ? hz.y : this.h * 0.3, -this.h, this.h * 2);
    const sky = g.createLinearGradient(0, 0, 0, Math.max(1, horizon));
    sky.addColorStop(0, '#0b0929');
    sky.addColorStop(1, '#1d1850');
    g.fillStyle = sky;
    g.fillRect(0, 0, this.w, this.h);
    const grass = g.createLinearGradient(0, horizon, 0, this.h);
    grass.addColorStop(0, '#103b25');
    grass.addColorStop(1, '#1f7a43');
    g.fillStyle = grass;
    g.fillRect(0, horizon, this.w, this.h - horizon);
    // Stands: a dark band just above the horizon with a light speckle.
    g.fillStyle = '#120f3a';
    g.fillRect(0, horizon - this.h * 0.09, this.w, this.h * 0.09);
    this.calls += 3;
    // Sight screen behind the bowler: dark, so the white ball reads against it.
    const sz = -(BOUNDARY_R + 6.5);
    this.poly([{ x: -5.5, y: 0, z: sz }, { x: 5.5, y: 0, z: sz }, { x: 5.5, y: 6.5, z: sz }, { x: -5.5, y: 6.5, z: sz }], '#07061c');
    // The pitch (clipped short of the batter's feet) and the creases.
    const nearZ = Math.min(PITCH_HALF + 1.2, this.pos.z - 0.6);
    const hw = (PITCH_WIDTH + 0.4) / 2;
    this.poly([{ x: -hw, y: 0, z: -PITCH_HALF - 1.2 }, { x: hw, y: 0, z: -PITCH_HALF - 1.2 }, { x: hw, y: 0, z: nearZ }, { x: -hw, y: 0, z: nearZ }], '#c9a26b');
    // Popping creases (Law 7.2) and the bowler's bowling crease, which runs between the return creases (Law 7.3).
    for (const [z, half] of [
      [-(PITCH_HALF - POPPING), POPPING_CREASE_HALF],
      [PITCH_HALF - POPPING, POPPING_CREASE_HALF],
      [-PITCH_HALF, RETURN_CREASE_X],
    ] as const) {
      if (z < nearZ) this.line({ x: -half, y: 0, z }, { x: half, y: 0, z }, '#f7f5ef', 1.4);
    }
    // The bowler's stumps.
    for (const x of [-STUMP_SPACING, 0, STUMP_SPACING]) this.line({ x, y: 0, z: -PITCH_HALF }, { x, y: STUMP_H, z: -PITCH_HALF }, '#f1eee4', 2);
    // Players, far to near.
    const actors = script.actors
      .filter((a) => !o.hidden.has(a.id))
      .map((a) => ({ a, st: evaluateActor(a, t) }))
      .map((x) => ({ ...x, p: this.project({ x: x.st.pos.x, y: 0, z: x.st.pos.z }) }))
      .filter((x) => x.p)
      .sort((p, q) => q.p!.d - p.p!.d);
    for (const { a, st, p } of actors) {
      const kit = kits[a.look.team];
      const fill = a.look.gear === 'umpire' ? '#9fb6d8' : kit.primary;
      const head = this.project({ x: st.pos.x, y: 1.72, z: st.pos.z });
      const hip = this.project({ x: st.pos.x, y: 0.95, z: st.pos.z });
      if (!head || !hip) continue;
      const bw = Math.max(1.5, this.px(0.44, p!.d));
      g.strokeStyle = kit.secondary;
      g.lineWidth = Math.max(1, bw * 0.35);
      g.beginPath();
      g.moveTo(hip.x - bw * 0.18, hip.y);
      g.lineTo(p!.x - bw * 0.25, p!.y);
      g.moveTo(hip.x + bw * 0.18, hip.y);
      g.lineTo(p!.x + bw * 0.25, p!.y);
      g.stroke();
      g.fillStyle = fill;
      g.fillRect(hip.x - bw / 2, head.y + bw * 0.4, bw, hip.y - head.y - bw * 0.4);
      g.beginPath();
      g.arc(head.x, head.y, Math.max(1, bw * 0.3), 0, Math.PI * 2);
      g.fillStyle = '#b07650';
      g.fill();
      this.calls += 3;
      if (a.id === 'bowler') this.bowlingArm(script, t, st.pos, bw);
    }
    // Learn: where the ball will pitch.
    if (o.landing && t >= script.times.release && t < o.landingUntil) {
      const c = this.project({ x: o.landing.x, y: 0.01, z: o.landing.z });
      if (c) {
        g.strokeStyle = 'rgba(126,240,197,0.9)';
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(c.x, c.y, Math.max(3, this.px(0.12, c.d)), Math.max(1.5, this.px(0.12, c.d) * 0.35), 0, 0, Math.PI * 2);
        g.stroke();
        this.calls++;
      }
    }
    // The ball: trace, shadow, then the ball itself.
    const ball = sampleBall(script, t);
    if (ball.visible && ball.inFlight) {
      const trail: Projected[] = [];
      for (let i = 1; i <= 6; i++) {
        const s = sampleBall(script, t - i * 14);
        if (!s.visible || !s.inFlight) break;
        const q = this.project(s.pos);
        if (q) trail.push(q);
      }
      const head = this.project(ball.pos);
      if (head && trail.length) {
        // A short, faint trace that thins away from the ball (and never wider than a few pixels close up).
        g.lineCap = 'round';
        let prev = head;
        trail.forEach((q, i) => {
          const k = 1 - i / trail.length;
          g.strokeStyle = `rgba(82,226,255,${0.32 * k})`;
          g.lineWidth = Math.min(4, Math.max(1, this.px(BALL_R * o.visualScale, head.d) * 0.8)) * (0.4 + 0.6 * k);
          g.beginPath();
          g.moveTo(prev.x, prev.y);
          g.lineTo(q.x, q.y);
          g.stroke();
          prev = q;
        });
        this.calls++;
      }
      const sh = this.project({ x: ball.pos.x, y: 0.005, z: ball.pos.z });
      if (sh) {
        const rr = Math.max(2, this.px(BALL_R * o.visualScale * (1.5 + ball.pos.y * 0.4), sh.d));
        g.fillStyle = `rgba(0,0,0,${0.55 * (1 - clamp(ball.pos.y / 7, 0, 0.85))})`;
        g.beginPath();
        g.ellipse(sh.x, sh.y, rr, rr * 0.4, 0, 0, Math.PI * 2);
        g.fill();
        this.calls++;
      }
      if (head) {
        const rr = Math.max(2.2, this.px(BALL_R * o.visualScale, head.d));
        g.fillStyle = '#f6f4ee';
        g.strokeStyle = '#07081a';
        g.lineWidth = Math.max(1, rr * 0.25);
        g.beginPath();
        g.arc(head.x, head.y, rr, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        this.calls++;
      }
    }
    // Contact flashes at the moment the physics says.
    for (const e of script.events) {
      const dt = t - e.t;
      if (dt < 0 || dt > 240 || !e.at || (e.kind !== 'bat' && e.kind !== 'edge' && e.kind !== 'pad')) continue;
      const c = this.project(e.at);
      if (!c) continue;
      const u = dt / 240;
      g.fillStyle = e.kind === 'pad' ? `rgba(200,205,220,${0.6 * (1 - u)})` : `rgba(255,255,255,${(e.kind === 'bat' ? 0.9 : 0.55) * (1 - u)})`;
      g.beginPath();
      g.arc(c.x, c.y, Math.max(4, this.px(0.12 + u * 0.25, c.d) * (e.kind === 'bat' ? e.intensity : 0.6)), 0, Math.PI * 2);
      g.fill();
      this.calls++;
    }
    // The batter's own bat and gloves.
    if (o.bat) {
      const gl = glovesOf(o.bat);
      this.line(o.bat.grip, gl.bottom, '#171a3d', 4);
      const a = this.project(gl.bottom);
      const b = this.project(o.bat.toe);
      if (a && b) {
        g.strokeStyle = '#e3c48e';
        g.lineWidth = Math.max(3, this.px(0.108, (a.d + b.d) / 2));
        g.lineCap = 'butt';
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
        this.calls++;
      }
      for (const p of [gl.top, gl.bottom]) {
        const q = this.project(p);
        if (!q) continue;
        g.fillStyle = '#f4f5f8';
        g.beginPath();
        g.arc(q.x, q.y, Math.max(3, this.px(0.05, q.d)), 0, Math.PI * 2);
        g.fill();
        this.calls++;
      }
    }
  }

  /** The bowler's arm: down in the run-up, over the top through the release, through to the front after it. */
  private bowlingArm(script: BallScript, t: number, at: Vec3, bw: number) {
    const rel = script.times.release;
    const u = clamp((t - (rel - 320)) / 470, 0, 1);
    const ang = (-170 + u * 230) * (Math.PI / 180);
    const shoulder = { x: at.x - 0.2, y: 1.5, z: at.z };
    const hand = { x: shoulder.x + Math.sin(ang) * 0.1, y: shoulder.y + Math.cos(ang) * 0.72, z: shoulder.z + Math.sin(ang) * 0.6 };
    this.line(shoulder, hand, '#b07650', Math.max(1, bw * 0.22));
  }
}
