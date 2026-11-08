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
import { ClassicVenue } from './venuePaint';
import type { BatPose } from '../practice/frame';
import {
  ballDiameterPx,
  closeUpBallDiameterPx,
  PRACTICE_BALL,
  projectBallSurface,
  shadeOpacity,
  traceAlpha,
  traceWidthPx,
  type ProjectedBallSurface,
} from '../practice/ballLook';

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
  focusAid?: boolean;
  ballColour?: 'red' | 'white';
  /** Coach demonstration: draw this complete actor as the translucent teaching body. */
  coachActor?: string | null;
  /** Training inspection: held and released ball fill the view and expose the complete surface. */
  closeUp?: boolean;
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

  /** The painted bowl behind the bowler (venuePaint.ts); painted once, here, never inside a delivery. */
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    private readonly venue = new ClassicVenue(),
  ) {
    this.venue.prepare(ctx);
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
  }

  /** Points the pinhole at a pose without painting (the frame's own paint does this first; tests use it to project). */
  useCamera(cam: CameraPose) {
    this.setCamera(cam);
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
    this.u = {
      x: this.r.y * this.f.z - this.r.z * this.f.y,
      y: this.r.z * this.f.x - this.r.x * this.f.z,
      z: this.r.x * this.f.y - this.r.y * this.f.x,
    };
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

  /** Polished/rough halves, scuffs and raised seam, all turned by the sampled physics spin. */
  private detailedBall(x: number, y: number, r: number, colour: 'red' | 'white', surface: ProjectedBallSurface) {
    const g = this.ctx;
    const polished = colour === 'red' ? '#b52b34' : '#faf9f4';
    const rough = colour === 'red' ? '#8d1f28' : '#dedbd2';
    const seam = colour === 'red' ? '#e1c6a3' : '#1f5d3f';
    const scuff = colour === 'red' ? '#51151b' : '#77716a';
    g.save();
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = rough;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.translate(x, y);
    // Local +X points towards the projected polished pole. The near half of the great-circle seam is
    // x = −facing·sqrt(r²−y²), from one limb intersection to the other. That same path divides polished from rough,
    // draws the visible seam and clips scuffs to the rough side, so the three cues cannot contradict one another.
    const surfacePath = () => {
      for (let i = 0; i <= 24; i++) {
        const yy = -r + (2 * r * i) / 24;
        const xx = -surface.polishedFacing * Math.sqrt(Math.max(0, r * r - yy * yy));
        if (i === 0) g.moveTo(xx, yy);
        else g.lineTo(xx, yy);
      }
      for (let i = 0; i <= 24; i++) {
        const a = Math.PI / 2 - (Math.PI * i) / 24;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
    };
    g.save();
    g.rotate(surface.polishedAngle);
    g.beginPath();
    surfacePath();
    g.fillStyle = polished;
    g.fill();
    g.beginPath();
    surfacePath();
    g.clip();
    const shine = g.createRadialGradient(r * 0.25, -r * 0.28, 0, r * 0.25, -r * 0.28, r * 0.9);
    shine.addColorStop(0, 'rgba(255,255,255,0.5)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = shine;
    g.fillRect(-r, -r, r * 2, r * 2);
    g.restore();
    g.strokeStyle = scuff;
    g.lineWidth = Math.max(1, r * 0.025);
    // These are fixed rough-side points on the sphere, projected through the complete carried material basis. Hidden
    // samples stop at the limb; no screen-space rotation can make a scuff jump or appear through the back of the ball.
    for (const mark of surface.roughScuffs) {
      g.beginPath();
      let drawing = false;
      for (const point of mark) {
        if (!point.visible) {
          drawing = false;
          continue;
        }
        if (drawing) g.lineTo(point.x * r, point.y * r);
        else g.moveTo(point.x * r, point.y * r);
        drawing = true;
      }
      g.stroke();
    }
    g.strokeStyle = seam;
    g.lineWidth = Math.max(2, r * 0.065);
    g.save();
    g.rotate(surface.polishedAngle);
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const yy = -r + (2 * r * i) / 24;
      const xx = -surface.polishedFacing * Math.sqrt(Math.max(0, r * r - yy * yy));
      if (i === 0) g.moveTo(xx, yy);
      else g.lineTo(xx, yy);
    }
    g.stroke();
    g.restore();
    g.restore();
    g.strokeStyle = 'rgba(5,6,15,0.72)';
    g.lineWidth = Math.max(1, r * 0.025);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
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
    // Stands, roof, pavilion and boards, painted from the batter's eye (venuePaint.ts); where there is no picture (a host
    // without a real canvas, the close-up training view) the plain dark band just above the horizon stays.
    const venueCalls = o.closeUp ? -1 : this.venue.paint(this, cam);
    if (venueCalls < 0) {
      g.fillStyle = '#120f3a';
      g.fillRect(0, horizon - this.h * 0.09, this.w, this.h * 0.09);
    }
    this.calls += 3 + Math.max(0, venueCalls);
    // Sight screen behind the bowler: dark, so the white ball reads against it.
    const sz = -(BOUNDARY_R + 6.5);
    this.poly(
      [
        { x: -9, y: 0, z: sz },
        { x: 9, y: 0, z: sz },
        { x: 9, y: 7.5, z: sz },
        { x: -9, y: 7.5, z: sz },
      ],
      o.ballColour === 'red' ? '#e7e6de' : '#07061c',
    );
    // The pitch (clipped short of the batter's feet) and the creases.
    const nearZ = Math.min(PITCH_HALF + 1.2, this.pos.z - 0.6);
    const hw = (PITCH_WIDTH + 0.4) / 2;
    this.poly(
      [
        { x: -hw, y: 0, z: -PITCH_HALF - 1.2 },
        { x: hw, y: 0, z: -PITCH_HALF - 1.2 },
        { x: hw, y: 0, z: nearZ },
        { x: -hw, y: 0, z: nearZ },
      ],
      '#c9a26b',
    );
    // Popping creases (Law 7.2) and the bowler's bowling crease, which runs between the return creases (Law 7.3).
    for (const [z, half] of [
      [-(PITCH_HALF - POPPING), POPPING_CREASE_HALF],
      [PITCH_HALF - POPPING, POPPING_CREASE_HALF],
      [-PITCH_HALF, RETURN_CREASE_X],
    ] as const) {
      if (z < nearZ) this.line({ x: -half, y: 0, z }, { x: half, y: 0, z }, '#f7f5ef', 1.4);
    }
    // The bowler's stumps.
    for (const x of [-STUMP_SPACING, 0, STUMP_SPACING])
      this.line({ x, y: 0, z: -PITCH_HALF }, { x, y: STUMP_H, z: -PITCH_HALF }, '#f1eee4', 2);
    // Players, far to near.
    const actors = (o.closeUp ? [] : script.actors)
      .filter((a) => !o.hidden.has(a.id))
      .map((a) => ({ a, st: evaluateActor(a, t) }))
      .map((x) => ({ ...x, p: this.project({ x: x.st.pos.x, y: 0, z: x.st.pos.z }) }))
      .filter((x) => x.p)
      .sort((p, q) => q.p!.d - p.p!.d);
    for (const { a, st, p } of actors) {
      const ghost = a.id === o.coachActor;
      g.save();
      if (ghost) g.globalAlpha = 0.46;
      const kit = kits[a.look.team];
      const fill = ghost ? '#7fe0ff' : a.look.gear === 'umpire' ? '#9fb6d8' : kit.primary;
      const head = this.project({ x: st.pos.x, y: 1.72, z: st.pos.z });
      const hip = this.project({ x: st.pos.x, y: 0.95, z: st.pos.z });
      if (!head || !hip) {
        g.restore();
        continue;
      }
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
      // The Coach body remains a complete figure: both arms meet the exact physics bat's handle rather than ending
      // as an icon. The feet/torso/head above still come from the same actor track and demo-side camera.
      if (ghost && o.bat) {
        const leftShoulder = this.project({ x: st.pos.x - 0.16, y: 1.42, z: st.pos.z });
        const rightShoulder = this.project({ x: st.pos.x + 0.16, y: 1.42, z: st.pos.z });
        const hand = this.project(o.bat.grip);
        if (leftShoulder && rightShoulder && hand) {
          g.strokeStyle = '#7fe0ff';
          g.lineWidth = Math.max(2, bw * 0.28);
          g.beginPath();
          g.moveTo(leftShoulder.x, leftShoulder.y);
          g.lineTo(hand.x - bw * 0.08, hand.y);
          g.moveTo(rightShoulder.x, rightShoulder.y);
          g.lineTo(hand.x + bw * 0.08, hand.y);
          g.stroke();
          this.calls++;
        }
      }
      g.restore();
    }
    // Learn: where the ball will pitch.
    if (o.landing && t >= script.times.release && t < o.landingUntil) {
      const c = this.project({ x: o.landing.x, y: 0.01, z: o.landing.z });
      if (c) {
        g.strokeStyle = 'rgba(126,240,197,0.9)';
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(
          c.x,
          c.y,
          Math.max(3, this.px(0.12, c.d)),
          Math.max(1.5, this.px(0.12, c.d) * 0.35),
          0,
          0,
          Math.PI * 2,
        );
        g.stroke();
        this.calls++;
      }
    }
    // The ball: trace, shadow, then the ball itself.
    const sampled = sampleBall(script, t);
    const ball =
      o.closeUp && t < (script.practice?.releaseScene ?? script.times.release) && script.practice
        ? { ...sampled, pos: script.practice.releaseWorld }
        : sampled;
    if (ball.visible && (ball.inFlight || o.closeUp)) {
      const trail: Projected[] = [];
      for (let i = 1; i < PRACTICE_BALL.trace.samples; i++) {
        const s = sampleBall(script, t - i * PRACTICE_BALL.trace.stepMs);
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
          g.strokeStyle = `rgba(82,226,255,${traceAlpha(i, trail.length + 1)})`;
          g.lineWidth = traceWidthPx(i, trail.length + 1, ballDiameterPx(head.d, this.focal));
          g.beginPath();
          g.moveTo(prev.x, prev.y);
          g.lineTo(q.x, q.y);
          g.stroke();
          prev = q;
        });
        this.calls++;
      }
      const sh = ball.inFlight ? this.project({ x: ball.pos.x, y: 0.005, z: ball.pos.z }) : null;
      if (sh && !o.closeUp) {
        const rr = Math.max(2, this.px(BALL_R * o.visualScale * (1.5 + ball.pos.y * 0.4), sh.d));
        g.fillStyle = `rgba(0,0,0,${0.55 * (1 - clamp(ball.pos.y / 7, 0, 0.85))})`;
        g.beginPath();
        g.ellipse(sh.x, sh.y, rr, rr * 0.4, 0, 0, Math.PI * 2);
        g.fill();
        this.calls++;
      }
      if (head) {
        const rr = (o.closeUp ? closeUpBallDiameterPx(this.h) : ballDiameterPx(head.d, this.focal)) / 2;
        const extent = rr + PRACTICE_BALL.shade.px;
        const shade = g.createRadialGradient(head.x, head.y, rr, head.x, head.y, extent);
        for (let px = 0; px <= PRACTICE_BALL.shade.px; px += 0.25)
          shade.addColorStop(px / PRACTICE_BALL.shade.px, `rgba(5,6,15,${shadeOpacity(px)})`);
        g.fillStyle = shade;
        g.beginPath();
        g.arc(head.x, head.y, extent, 0, Math.PI * 2);
        g.fill();
        let releaseSurface: { spinAxis: Vec3; seamAxis: Vec3; shineAxis: Vec3; surfaceTangent?: Vec3 } | null = null;
        if (o.closeUp) {
          for (const segment of script.ball) {
            if (segment.k === 'path' && segment.spinAxis && segment.seamAxis && segment.shineAxis) {
              releaseSurface = {
                spinAxis: segment.spinAxis,
                seamAxis: segment.seamAxis,
                shineAxis: segment.shineAxis,
                surfaceTangent: segment.surfaceTangent,
              };
              break;
            }
          }
        }
        const surface =
          ball.spinAxis && ball.seamAxis && ball.shineAxis
            ? {
                spinAxis: ball.spinAxis,
                seamAxis: ball.seamAxis,
                shineAxis: ball.shineAxis,
                surfaceTangent: ball.surfaceTangent,
              }
            : releaseSurface;
        if (o.closeUp && surface)
          this.detailedBall(
            head.x,
            head.y,
            rr,
            o.ballColour === 'red' ? 'red' : 'white',
            projectBallSurface(ball.spin, surface, { forward: this.f, right: this.r, up: this.u }),
          );
        else {
          g.fillStyle = o.ballColour === 'red' ? '#a8242b' : PRACTICE_BALL.color;
          g.beginPath();
          g.arc(head.x, head.y, rr, 0, Math.PI * 2);
          g.fill();
        }
        if (o.focusAid) {
          g.strokeStyle = `rgba(233,251,255,${PRACTICE_BALL.focus.opacity})`;
          g.lineWidth = PRACTICE_BALL.focus.widthPx;
          g.beginPath();
          g.arc(head.x, head.y, rr + PRACTICE_BALL.focus.gapPx, 0, Math.PI * 2);
          g.stroke();
        }
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
      g.fillStyle =
        e.kind === 'pad'
          ? `rgba(200,205,220,${0.6 * (1 - u)})`
          : `rgba(255,255,255,${(e.kind === 'bat' ? 0.9 : 0.55) * (1 - u)})`;
      g.beginPath();
      g.arc(
        c.x,
        c.y,
        Math.max(4, this.px(0.12 + u * 0.25, c.d) * (e.kind === 'bat' ? e.intensity : 0.6)),
        0,
        Math.PI * 2,
      );
      g.fill();
      this.calls++;
    }
    // The batter's own bat and gloves.
    if (o.bat) {
      const coachBat = Boolean(o.coachActor);
      g.save();
      if (coachBat) g.globalAlpha = 0.62;
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
      for (const p of coachBat ? [] : [gl.top, gl.bottom]) {
        const q = this.project(p);
        if (!q) continue;
        g.fillStyle = '#f4f5f8';
        g.beginPath();
        g.arc(q.x, q.y, Math.max(3, this.px(0.05, q.d)), 0, Math.PI * 2);
        g.fill();
        this.calls++;
      }
      g.restore();
    }
  }

  /** The bowler's arm: down in the run-up, over the top through the release, through to the front after it. */
  private bowlingArm(script: BallScript, t: number, at: Vec3, bw: number) {
    const rel = script.times.release;
    const u = clamp((t - (rel - 320)) / 470, 0, 1);
    const ang = (-170 + u * 230) * (Math.PI / 180);
    const shoulder = { x: at.x - 0.2, y: 1.5, z: at.z };
    const hand = {
      x: shoulder.x + Math.sin(ang) * 0.1,
      y: shoulder.y + Math.cos(ang) * 0.72,
      z: shoulder.z + Math.sin(ang) * 0.6,
    };
    this.line(shoulder, hand, '#b07650', Math.max(1, bw * 0.22));
  }
}
