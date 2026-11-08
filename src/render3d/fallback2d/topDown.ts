/**
 * The top-down Canvas 2D painter behind every 2D presentation: a floodlit field seen from above that zooms on the
 * pitch for the delivery and follows the ball after the shot, plus a side-on inset of the ball's height. The match's
 * 2D fallback (Fallback2DRenderer) and Classic Practice (Fallback2DPracticeStage) both paint through it.
 * Deterministic and cheap; no external assets.
 *
 * It also paints Practice's field inset (the picture-in-picture, below): the whole field from straight above with
 * every player and the ball where the physics put them, on every tier (the 3D tiers add a real overhead camera pass
 * of the ground underneath, three/pip.ts).
 */
import type { KitSpec } from '@/contracts';
import { type ActorTrack, evaluateActor } from '../core/actors';
import { type BallScript, crowdAt, sampleBall } from '../core/choreo';
import { BOUNDARY_R, CONTACT_Z, PITCH_HALF, PITCH_WIDTH, POPPING, POPPING_CREASE_HALF, RING_R } from '../core/ground';
import { clamp, lerp, smoothstep } from '../core/math';

export interface View {
  cx: number;
  cz: number;
  scale: number;
}

export class TopDownPainter {
  w = 1;
  h = 1;
  dpr = 1;
  calls = 0;
  private bg: HTMLCanvasElement | null = null;
  private bgKey = '';

  constructor(readonly ctx: CanvasRenderingContext2D) {}

  resize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.bg = null;
  }

  view(script: BallScript, t: number, reducedMotion: boolean): View {
    const fitAll = (Math.min(this.w, this.h * 0.78) / 2 / (BOUNDARY_R + 10)) * 0.98;
    const pitchFit = Math.min(this.w / 9, (this.h * 0.7) / (PITCH_HALF * 2 + 8));
    if (reducedMotion || script.kind === 'ambient') return { cx: 0, cz: 6, scale: fitAll };
    const c = script.times.contact;
    const out = smoothstep(c + 150, c + 900, t);
    const ball = sampleBall(script, t).pos;
    const s = lerp(pitchFit, fitAll * 1.15, out);
    return { cx: lerp(0, ball.x * 0.35, out), cz: lerp(1.5, ball.z * 0.35 + 6, out), scale: s };
  }

  /** World (x, z) to screen. The pitch runs up the screen: bowler at the bottom, striker at the top. */
  sx(v: View, x: number) {
    return this.w / 2 - (x - v.cx) * v.scale;
  }
  sy(v: View, z: number) {
    return this.h * 0.42 - (z - v.cz) * v.scale;
  }

  background(v: View): void {
    const key = `${this.w}x${this.h}:${v.scale.toFixed(3)}:${v.cx.toFixed(2)}:${v.cz.toFixed(2)}`;
    const g = this.ctx;
    if (key === this.bgKey && this.bg) {
      g.drawImage(this.bg, 0, 0, this.w, this.h);
      return;
    }
    const c = document.createElement('canvas');
    c.width = Math.round(this.w * this.dpr);
    c.height = Math.round(this.h * this.dpr);
    const b = c.getContext('2d')!;
    b.scale(this.dpr, this.dpr);
    const sky = b.createLinearGradient(0, 0, 0, this.h);
    sky.addColorStop(0, '#0b0929');
    sky.addColorStop(1, '#151143');
    b.fillStyle = sky;
    b.fillRect(0, 0, this.w, this.h);
    const ox = this.sx(v, 0);
    const oy = this.sy(v, 0);
    // Stands ring with crowd speckle.
    b.fillStyle = '#100d36';
    b.beginPath();
    b.arc(ox, oy, (BOUNDARY_R + 26) * v.scale, 0, Math.PI * 2);
    b.fill();
    const colors = ['#ffb347', '#5fe3ff', '#ff5d8f', '#ffd36e', '#e9edf5', '#7ef0c5'];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      const a = rnd() * Math.PI * 2;
      const r = (BOUNDARY_R + 9 + rnd() * 16) * v.scale;
      b.fillStyle = colors[i % colors.length];
      b.globalAlpha = 0.25 + rnd() * 0.35;
      b.fillRect(ox + Math.cos(a) * r, oy + Math.sin(a) * r, 1.6, 1.6);
    }
    b.globalAlpha = 1;
    // Floodlit grass with mowing stripes.
    b.save();
    b.beginPath();
    b.arc(ox, oy, (BOUNDARY_R + 4) * v.scale, 0, Math.PI * 2);
    b.clip();
    const grass = b.createRadialGradient(ox, oy, 4, ox, oy, (BOUNDARY_R + 4) * v.scale);
    grass.addColorStop(0, '#2a8a4c');
    grass.addColorStop(0.7, '#17603a');
    grass.addColorStop(1, '#0d3f27');
    b.fillStyle = grass;
    b.fillRect(0, 0, this.w, this.h);
    b.globalAlpha = 0.08;
    b.fillStyle = '#ffffff';
    const stripe = 7 * v.scale;
    for (let x = ox - (BOUNDARY_R + 4) * v.scale; x < ox + (BOUNDARY_R + 4) * v.scale; x += stripe * 2) b.fillRect(x, 0, stripe, this.h);
    b.restore();
    b.globalAlpha = 1;
    // Rope, 30-yard circle, pitch and creases.
    b.strokeStyle = '#52e2ff';
    b.lineWidth = 2;
    b.beginPath();
    b.arc(ox, oy, BOUNDARY_R * v.scale, 0, Math.PI * 2);
    b.stroke();
    b.setLineDash([4, 6]);
    b.strokeStyle = 'rgba(255,255,255,0.5)';
    b.lineWidth = 1;
    b.beginPath();
    b.arc(this.sx(v, 0), this.sy(v, CONTACT_Z), RING_R * v.scale, 0, Math.PI * 2);
    b.stroke();
    b.setLineDash([]);
    const px = this.sx(v, PITCH_WIDTH / 2);
    const pw = PITCH_WIDTH * v.scale;
    const top = this.sy(v, PITCH_HALF + 1.2);
    const bottom = this.sy(v, -PITCH_HALF - 1.2);
    b.fillStyle = '#c9a26b';
    b.fillRect(px, top, pw, bottom - top);
    b.strokeStyle = '#f7f5ef';
    b.lineWidth = Math.max(1, v.scale * 0.05);
    for (const z of [PITCH_HALF - POPPING, -(PITCH_HALF - POPPING)]) {
      b.beginPath();
      b.moveTo(this.sx(v, POPPING_CREASE_HALF), this.sy(v, z));
      b.lineTo(this.sx(v, -POPPING_CREASE_HALF), this.sy(v, z));
      b.stroke();
    }
    for (const z of [PITCH_HALF, -PITCH_HALF]) {
      b.fillStyle = '#f7f5ef';
      b.fillRect(this.sx(v, 0.14), this.sy(v, z) - 2, 0.28 * v.scale, 4);
    }
    this.bg = c;
    this.bgKey = key;
    g.drawImage(c, 0, 0, this.w, this.h);
  }

  /** One frame of a script at scene time t (the match fallback's whole picture). */
  paint(script: BallScript, t: number, kits: [KitSpec, KitSpec], reducedMotion: boolean, view?: View): void {
    const g = this.ctx;
    this.calls = 0;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const v = view ?? this.view(script, t, reducedMotion);
    this.background(v);
    this.calls++;
    // Players
    for (const a of script.actors) {
      const st = evaluateActor(a, t);
      const x = this.sx(v, st.pos.x);
      const y = this.sy(v, st.pos.z);
      const r = clamp(v.scale * 0.42, 3, 11);
      const kit = kits[a.look.team];
      const fill = a.look.gear === 'umpire' ? '#9fb6d8' : kit.primary;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(x + r * 0.35, y + r * 0.35, r, r * 0.8, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = fill;
      g.strokeStyle = a.look.hero ? '#ffffff' : kit.secondary;
      g.lineWidth = a.look.hero ? 2 : 1.4;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      // Facing tick.
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - Math.sin(st.heading) * r * 1.5, y - Math.cos(st.heading) * r * 1.5);
      g.stroke();
      if (a.role === 'batter') {
        g.strokeStyle = '#e3c48e';
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(x - r * 0.6, y + r * 0.2);
        g.lineTo(x - r * 1.7, y + r * 0.9);
        g.stroke();
      }
      this.calls++;
    }
    // Stumps (flash when broken)
    for (const [key, z] of [
      ['striker', PITCH_HALF],
      ['nonStriker', -PITCH_HALF],
    ] as const) {
      const hit = script.stumps[key];
      const broken = hit && t >= hit.t;
      g.fillStyle = broken && t - hit!.t < 1600 && Math.floor((t - hit!.t) / 120) % 2 === 0 ? '#ffb347' : '#f7f5ef';
      g.fillRect(this.sx(v, 0.14), this.sy(v, z) - 2.5, 0.28 * v.scale, 5);
    }
    // Ball trail and ball (bigger and offset from its shadow when high).
    const trail: Array<[number, number]> = [];
    for (let i = 0; i < 18; i++) {
      const s = sampleBall(script, t - i * 16);
      if (!s.visible || !s.inFlight) break;
      trail.push([this.sx(v, s.pos.x), this.sy(v, s.pos.z) - s.pos.y * v.scale * 0.35]);
    }
    if (trail.length > 1) {
      g.strokeStyle = 'rgba(82,226,255,0.65)';
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(trail[0][0], trail[0][1]);
      for (const [x, y] of trail.slice(1)) g.lineTo(x, y);
      g.stroke();
    }
    const ball = sampleBall(script, t);
    if (ball.visible) {
      const x = this.sx(v, ball.pos.x);
      const y = this.sy(v, ball.pos.z);
      const lift = ball.pos.y * v.scale * 0.35;
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
      const glow = g.createRadialGradient(x, y - lift, 0, x, y - lift, 12);
      glow.addColorStop(0, 'rgba(160,240,255,0.9)');
      glow.addColorStop(1, 'rgba(160,240,255,0)');
      g.fillStyle = glow;
      g.beginPath();
      g.arc(x, y - lift, 12, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(x, y - lift, clamp(3 + ball.pos.y * 0.25, 3, 7), 0, Math.PI * 2);
      g.fill();
    }
    // Event rings.
    for (const e of script.events) {
      const dt = t - e.t;
      if (dt < 0 || dt > 900 || !e.at) continue;
      if (e.kind !== 'bounce' && e.kind !== 'boundary' && e.kind !== 'six' && e.kind !== 'stumps' && e.kind !== 'catch') continue;
      const u = dt / 900;
      g.strokeStyle = e.kind === 'six' ? `rgba(255,179,71,${1 - u})` : e.kind === 'stumps' || e.kind === 'catch' ? `rgba(255,77,106,${1 - u})` : `rgba(82,226,255,${1 - u})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.sx(v, e.at.x), this.sy(v, e.at.z), 4 + u * (e.kind === 'bounce' ? 14 : 40), 0, Math.PI * 2);
      g.stroke();
    }
    this.sideInset(script, t);
    // Crowd excitement glow along the top edge.
    const crowd = crowdAt(script, t);
    const grd = g.createLinearGradient(0, 0, 0, 60);
    grd.addColorStop(0, `rgba(255,170,51,${0.08 + crowd * 0.22})`);
    grd.addColorStop(1, 'rgba(255,170,51,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, this.w, 60);
  }

  /** Side-on strip at the bottom: release, bounce and arrival height of the current delivery (its physics path). */
  sideInset(script: BallScript, t: number) {
    const path = script.ball.find((s) => s.k === 'path');
    if (!path || script.kind === 'ambient') return;
    const g = this.ctx;
    const h = Math.min(86, this.h * 0.12);
    const y0 = this.h - h - 12;
    const x0 = 16;
    const w = this.w - 32;
    g.fillStyle = 'rgba(6,5,31,0.72)';
    g.beginPath();
    g.roundRect(x0, y0, w, h, 12);
    g.fill();
    const zx = (z: number) => x0 + 12 + ((z + PITCH_HALF) / (PITCH_HALF * 2 + 2)) * (w - 24);
    const hy = (y: number) => y0 + h - 14 - (y / 2.6) * (h - 26);
    g.strokeStyle = 'rgba(210,170,114,0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(zx(-PITCH_HALF), hy(0));
    g.lineTo(zx(PITCH_HALF + 1), hy(0));
    g.stroke();
    g.fillStyle = '#f7f5ef';
    g.fillRect(zx(PITCH_HALF) - 1, hy(0.71), 2, hy(0) - hy(0.71));
    g.strokeStyle = 'rgba(82,226,255,0.85)';
    g.lineWidth = 2;
    g.beginPath();
    // The ball's height along the pitch, up to the batter.
    const until = Math.min(t, script.times.contact + 60);
    let started = false;
    for (let ms = path.t0; ms <= until; ms += 12) {
      const p = sampleBall(script, ms).pos;
      if (p.z > PITCH_HALF + 1.2) break;
      if (!started) g.moveTo(zx(p.z), hy(p.y));
      else g.lineTo(zx(p.z), hy(p.y));
      started = true;
    }
    if (started) g.stroke();
    // The pitch, when it pitches before the bat.
    if (t >= script.times.bounce && script.times.bounce < script.times.contact) {
      const b = sampleBall(script, script.times.bounce).pos;
      g.fillStyle = '#52e2ff';
      g.beginPath();
      g.arc(zx(b.z), hy(0), 3.5, 0, Math.PI * 2);
      g.fill();
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The field inset (picture-in-picture). The first-person camera cannot show every fielder, so a small corner view
// shows the whole field from straight above: all eleven fielders with the keeper and the bowler, both batters, the
// umpires, the rope, the ring, the pitch, and after a stroke the ball and its path. Every position is the physics'
// own (an actor's evaluated track position, never the drawn rig's presentation offset; the ball's physics samples),
// in the batter's orientation: the bowler at the top, the batter at the bottom, the off side of a right-hander on the
// right (+x), exactly as the first-person view has it. One painter for every tier; the stage hands it a frame.
//
// The Practice screen owns the inset's place (a `[data-pip]` element holding a `canvas[data-pip-canvas]`, inside the
// same `[data-play-root]` as the stage canvas): a DOM seam, so no renderer code enters the interface bundle. The
// painter reports what it shows on that element (`data-pip-moment`), and the screen's CSS dims or hides it.
// ---------------------------------------------------------------------------------------------------------------

/**
 * What the inset shows at a moment of the ball (constitution §3–4, and the measured protected regions):
 * - calm: between balls, the field as set;
 * - quiet: the run-up (Delivery Quiet Mode): the field as set at the release, frozen, and dimmed by the screen;
 * - hidden: from the release until the camera leaves the batter's eye after a stroke (the ball outranks the
 *   interface, and near contact the pitch, the bat and the ball reach every corner of the frame);
 * - chase: after a stroke, once the fielding camera has taken over: where the ball went and who is chasing it;
 * - full: the dead ball: the complete picture (final positions, the ball, its whole path from the bat).
 */
export type InsetMoment = 'calm' | 'quiet' | 'hidden' | 'chase' | 'full';

/** World metres from the pitch's centre to the edge of the inset's picture: the rope plus a margin. */
export const INSET_FIELD_R = BOUNDARY_R + 3;

type InsetKind = 'striker' | 'batter' | 'bowler' | 'keeper' | 'fielder' | 'umpire';

interface InsetPlayer {
  id: string;
  kind: InsetKind;
  /** Physics ground position (world metres). */
  x: number;
  z: number;
  /** Ground velocity (m/s), measured over the last 150 ms of the track (zero unless the ball is being chased). */
  vx: number;
  vz: number;
  /** The fielder the physics says caught or fielded the ball, from that moment on. */
  fielded: boolean;
}

export interface InsetModel {
  moment: InsetMoment;
  players: InsetPlayer[];
  /** The ball on the ground plan (world metres; y is its height), when the moment shows it. */
  ball: { x: number; z: number; y: number } | null;
  /** The ball's ground track from the bat to now, as x, z pairs (world metres). */
  path: number[];
}

/** The moment of a Practice script at scene time t. */
export function insetMoment(script: BallScript, t: number): InsetMoment {
  const p = script.practice;
  if (!p) return 'hidden';
  if (!p.flight) return 'calm';
  if (t < p.releaseScene) return 'quiet';
  if (p.deadScene !== null && t >= p.deadScene) return 'full';
  if (p.contactScene !== null && t >= p.contactScene && t >= p.firstPersonUntil) return 'chase';
  return 'hidden';
}

const kindOf = (a: ActorTrack): InsetKind =>
  a.id === 'striker' ? 'striker' : a.role === 'batter' ? 'batter' : a.role === 'bowler' ? 'bowler' : a.role === 'keeper' ? 'keeper' : a.role === 'umpire' ? 'umpire' : 'fielder';

/** The physics fielder id an actor stands for ('fielder:<id>', or the keeper and bowler under their own ids). */
const fielderIdOf = (a: ActorTrack): string | null => (a.id.startsWith('fielder:') ? a.id.slice(8) : a.role === 'keeper' || a.role === 'bowler' ? a.id : null);

/** The ball's ground track after the bat, sampled once per script (scene ms, x, z triples). */
const pathCache = new WeakMap<BallScript, number[]>();
function afterBat(script: BallScript): number[] {
  let out = pathCache.get(script);
  if (out) return out;
  out = [];
  const p = script.practice;
  if (p && p.contactScene !== null) {
    const end = p.deadScene ?? script.duration;
    for (let t = p.contactScene; t <= end + 1e-6; t += 25) {
      const b = sampleBall(script, t);
      if (!b.visible || b.heldBy) break;
      out.push(t, b.pos.x, b.pos.z);
    }
  }
  pathCache.set(script, out);
  return out;
}

/** The inset's content at scene time t (null when the moment hides it). Pure. */
export function insetModel(script: BallScript, t: number, moment: InsetMoment = insetMoment(script, t)): InsetModel | null {
  const p = script.practice;
  if (!p || moment === 'hidden') return null;
  // During the run-up the field is drawn as it is set at the release (the physics positions), and never moves.
  const at = moment === 'quiet' ? p.releaseScene : t;
  let fielded: string | null = null;
  if (p.result && (moment === 'chase' || moment === 'full')) {
    for (const e of p.result.events) {
      if ((e.kind === 'catch' || e.kind === 'field') && p.releaseScene + e.t * 1000 <= t) {
        fielded = e.fielderId;
        break;
      }
    }
  }
  const players: InsetPlayer[] = [];
  for (const a of script.actors) {
    const s = evaluateActor(a, at).pos;
    let vx = 0;
    let vz = 0;
    if (moment === 'chase') {
      const b = evaluateActor(a, at - 150).pos;
      vx = (s.x - b.x) / 0.15;
      vz = (s.z - b.z) / 0.15;
    }
    players.push({ id: a.id, kind: kindOf(a), x: s.x, z: s.z, vx, vz, fielded: fielded !== null && fielderIdOf(a) === fielded });
  }
  let ball: InsetModel['ball'] = null;
  const path: number[] = [];
  if (moment === 'chase' || moment === 'full') {
    const b = sampleBall(script, t);
    if (b.visible) ball = { x: b.pos.x, z: b.pos.z, y: Math.max(0, b.pos.y) };
    const track = afterBat(script);
    for (let i = 0; i < track.length && track[i] <= t; i += 3) path.push(track[i + 1], track[i + 2]);
    if (ball && path.length && !b.heldBy) path.push(ball.x, ball.z);
  }
  return { moment, players, ball, path };
}

/** The inset's colours: the interface's restrained palette (practice/ui/design), over a plain floodlit field. */
export const INSET_LOOK = {
  backing: 'rgba(8, 9, 13, 0.72)',
  grassIn: '#21703f',
  grassOut: '#17552f',
  stripe: 'rgba(255, 255, 255, 0.05)',
  rope: 'rgba(243, 239, 231, 0.78)',
  ring: 'rgba(243, 239, 231, 0.34)',
  pitch: '#c9a26b',
  crease: 'rgba(247, 245, 239, 0.9)',
  outline: 'rgba(8, 9, 13, 0.92)',
  /** The fielding side in warm white; the keeper in amber (the catcher behind the bat); the bowler in grey. */
  fielder: '#f3efe7',
  keeper: '#f2ad41',
  bowler: '#aaa69e',
  /** The batting side in the VANDE accent; the striker (the player) ringed in white. */
  batter: '#52d3f2',
  umpire: '#11131a',
  umpireLine: '#aaa69e',
  ball: '#ffffff',
  path: 'rgba(255, 255, 255, 0.9)',
  tail: 'rgba(243, 239, 231, 0.6)',
} as const;

/** Above this ground speed (m/s) a player is shown as running (a short tail behind the marker). */
const RUNNING_MPS = 2.5;

/** Marker centres (CSS px) for a model in a square inset `size` px wide, with overlapping markers eased apart. */
export function insetLayout(model: InsetModel, size: number): { k: number; c: number; r: number; at: Float32Array } {
  const c = size / 2;
  const k = (c - 2) / INSET_FIELD_R;
  const r = clamp(size * 0.024, 2.2, 3.6);
  const n = model.players.length;
  const at = new Float32Array(n * 2);
  const home = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = model.players[i];
    at[i * 2] = home[i * 2] = c + p.x * k;
    at[i * 2 + 1] = home[i * 2 + 1] = c + p.z * k;
  }
  // A slip cordon, or the umpire beside the bowler, is a metre or two apart: about a pixel at this scale. Markers that
  // overlap are eased apart symmetrically, by at most one and a half marker radii (a few metres at this scale, far less
  // than any gap a batter could aim for), so each one stays countable.
  const min = r * 1.75 + 0.5;
  const cap = r * 1.5;
  for (let pass = 0; pass < 10; pass++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = at[j * 2] - at[i * 2];
        let dy = at[j * 2 + 1] - at[i * 2 + 1];
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 1e-3) {
          dx = 1;
          dy = (j - i) % 2 ? 0.5 : -0.5;
          d = Math.hypot(dx, dy);
        }
        const push = (min - d) / 2 / d;
        at[i * 2] -= dx * push;
        at[i * 2 + 1] -= dy * push;
        at[j * 2] += dx * push;
        at[j * 2 + 1] += dy * push;
      }
    }
    for (let i = 0; i < n; i++) {
      const ox = at[i * 2] - home[i * 2];
      const oy = at[i * 2 + 1] - home[i * 2 + 1];
      const o = Math.hypot(ox, oy);
      if (o > cap) {
        at[i * 2] = home[i * 2] + (ox / o) * cap;
        at[i * 2 + 1] = home[i * 2 + 1] + (oy / o) * cap;
      }
    }
  }
  return { k, c, r, at };
}

/** Paints field insets: one per inset canvas, kept between frames. */
class FieldInsetPainter {
  private readonly ctx: CanvasRenderingContext2D | null;
  private size = 0;
  private dpr = 1;
  private bg: HTMLCanvasElement | null = null;
  private bgKey = '';
  private lastKey = '';
  calls = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
  }

  /**
   * One frame. `ground` is the 3D tiers' overhead camera picture of the real ground (three/pip.ts), drawn under the
   * markers; without it the painter draws a plain field. Returns true when it drew (an unchanged picture is kept).
   */
  paint(model: InsetModel | null, ground: { image: CanvasImageSource; key: string } | null = null): boolean {
    const g = this.ctx;
    this.calls = 0;
    if (!g) return false;
    const size = Math.round(this.canvas.clientWidth);
    const dpr = Math.min(2, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
    if (size !== this.size || dpr !== this.dpr) {
      this.size = size;
      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(size * dpr));
      this.canvas.height = Math.max(1, Math.round(size * dpr));
      this.lastKey = '';
      this.bg = null;
    }
    if (!model || size < 24) {
      if (this.lastKey !== 'clear') {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.lastKey = 'clear';
      }
      return false;
    }
    const L = insetLayout(model, size);
    // Nothing moved by a tenth of a pixel: keep the picture (the calm and the frozen run-up views cost nothing).
    let key = `${model.moment}|${ground?.key ?? ''}`;
    for (let i = 0; i < L.at.length; i++) key += `|${Math.round(L.at[i] * 10)}`;
    if (model.ball) key += `|b${Math.round(model.ball.x * 10)},${Math.round(model.ball.z * 10)},${Math.round(model.ball.y * 4)}`;
    key += `|p${model.path.length}`;
    if (key === this.lastKey) return false;
    this.lastKey = key;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    g.drawImage(this.background(L, ground), 0, 0, size, size);
    this.calls++;
    const sx = (x: number) => L.c + x * L.k;
    const sy = (z: number) => L.c + z * L.k;
    // The ball's path from the bat, under the players.
    if (model.path.length >= 4) {
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = INSET_LOOK.outline;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(sx(model.path[0]), sy(model.path[1]));
      for (let i = 2; i < model.path.length; i += 2) g.lineTo(sx(model.path[i]), sy(model.path[i + 1]));
      g.stroke();
      g.strokeStyle = INSET_LOOK.path;
      g.lineWidth = 1.5;
      g.stroke();
      this.calls++;
    }
    // Players: umpires first, then the fielding side, then the batters on top.
    const order = (k: InsetKind) => (k === 'umpire' ? 0 : k === 'striker' ? 3 : k === 'batter' ? 2 : 1);
    const idx = model.players.map((_, i) => i).sort((a, b) => order(model.players[a].kind) - order(model.players[b].kind));
    for (const i of idx) {
      const p = model.players[i];
      const x = L.at[i * 2];
      const y = L.at[i * 2 + 1];
      const speed = Math.hypot(p.vx, p.vz);
      if (speed > RUNNING_MPS) {
        const len = clamp(speed * 0.45 * L.k, 3, L.r * 3.2);
        g.strokeStyle = INSET_LOOK.tail;
        g.lineWidth = 1.4;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - (p.vx / speed) * len, y - (p.vz / speed) * len);
        g.stroke();
      }
      this.marker(p.kind, x, y, L.r);
      if (p.fielded) {
        g.strokeStyle = INSET_LOOK.ball;
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(x, y, L.r + 2.2, 0, Math.PI * 2);
        g.stroke();
      }
      this.calls++;
    }
    // The ball last: on top of everything, a little larger when it is in the air.
    if (model.ball) {
      const x = sx(model.ball.x);
      const y = sy(model.ball.z);
      const rb = L.r * (0.9 + clamp(model.ball.y / 10, 0, 1) * 0.5);
      g.fillStyle = 'rgba(255, 255, 255, 0.22)';
      g.beginPath();
      g.arc(x, y, rb + 2.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = INSET_LOOK.ball;
      g.strokeStyle = INSET_LOOK.outline;
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x, y, rb, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      this.calls++;
    }
    return true;
  }

  private marker(kind: InsetKind, x: number, y: number, r: number) {
    const g = this.ctx!;
    g.lineWidth = 1;
    g.strokeStyle = INSET_LOOK.outline;
    if (kind === 'umpire') {
      g.fillStyle = INSET_LOOK.umpire;
      g.strokeStyle = INSET_LOOK.umpireLine;
      g.beginPath();
      g.arc(x, y, r * 0.72, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      return;
    }
    if (kind === 'keeper') {
      // The keeper is a square (shape as well as colour): the one fielder behind the stumps.
      const s = r * 0.95;
      g.fillStyle = INSET_LOOK.keeper;
      g.beginPath();
      g.roundRect(x - s, y - s, s * 2, s * 2, s * 0.35);
      g.fill();
      g.stroke();
      return;
    }
    g.fillStyle = kind === 'striker' || kind === 'batter' ? INSET_LOOK.batter : kind === 'bowler' ? INSET_LOOK.bowler : INSET_LOOK.fielder;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (kind === 'striker') {
      g.strokeStyle = INSET_LOOK.fielder;
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x, y, r + 1.6, 0, Math.PI * 2);
      g.stroke();
    }
  }

  /** The field under the players (cached): the backing, the ground (camera picture or plain), the rope, the ring, the pitch. */
  private background(L: { k: number; c: number }, ground: { image: CanvasImageSource; key: string } | null): HTMLCanvasElement {
    const key = `${this.size}x${this.dpr}|${ground?.key ?? 'plain'}`;
    if (this.bg && key === this.bgKey) return this.bg;
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const b = c.getContext('2d')!;
    b.scale(this.dpr, this.dpr);
    const size = this.size;
    const R = INSET_FIELD_R * L.k;
    // One backing, the rail's own material, so the inset reads on a bright sky or a dark stand alike.
    b.fillStyle = INSET_LOOK.backing;
    b.beginPath();
    b.roundRect(0, 0, size, size, Math.min(12, size * 0.1));
    b.fill();
    b.save();
    b.beginPath();
    b.arc(L.c, L.c, R, 0, Math.PI * 2);
    b.clip();
    if (ground) b.drawImage(ground.image, L.c - R, L.c - R, 2 * R, 2 * R);
    else {
      const grass = b.createRadialGradient(L.c, L.c, 2, L.c, L.c, R);
      grass.addColorStop(0, INSET_LOOK.grassIn);
      grass.addColorStop(1, INSET_LOOK.grassOut);
      b.fillStyle = grass;
      b.fillRect(L.c - R, L.c - R, 2 * R, 2 * R);
      b.fillStyle = INSET_LOOK.stripe;
      const stripe = 7 * L.k;
      for (let x = L.c - R; x < L.c + R; x += stripe * 2) b.fillRect(x, L.c - R, stripe, 2 * R);
    }
    b.restore();
    b.strokeStyle = INSET_LOOK.rope;
    b.lineWidth = 1.5;
    b.beginPath();
    b.arc(L.c, L.c, BOUNDARY_R * L.k, 0, Math.PI * 2);
    b.stroke();
    b.strokeStyle = INSET_LOOK.ring;
    b.lineWidth = 1;
    b.setLineDash([3, 3]);
    b.beginPath();
    b.arc(L.c, L.c, RING_R * L.k, 0, Math.PI * 2);
    b.stroke();
    b.setLineDash([]);
    if (!ground) {
      // The pitch is drawn at least 2 px wide so it reads at any size; the creases mark the two ends.
      const w = Math.max(2, PITCH_WIDTH * L.k);
      b.fillStyle = INSET_LOOK.pitch;
      b.fillRect(L.c - w / 2, L.c - PITCH_HALF * L.k, w, 2 * PITCH_HALF * L.k);
      b.fillStyle = INSET_LOOK.crease;
      for (const z of [PITCH_HALF - POPPING, -(PITCH_HALF - POPPING)]) b.fillRect(L.c - w / 2 - 1, L.c + z * L.k - 0.5, w + 2, 1);
    }
    this.bg = c;
    this.bgKey = key;
    return c;
  }
}

/** The inset the Practice screen provides beside a stage canvas, if any (looked up again only when it goes away). */
export interface InsetTarget {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
}
const targets = new WeakMap<HTMLCanvasElement, { target: InsetTarget | null }>();
const painters = new WeakMap<HTMLCanvasElement, FieldInsetPainter>();

export function insetTarget(stageCanvas: HTMLCanvasElement): InsetTarget | null {
  const hit = targets.get(stageCanvas);
  if (hit?.target && hit.target.root.isConnected && hit.target.canvas.isConnected) return hit.target;
  // Not there (yet): looked up again on the next frame (a few microseconds), so a new inset is painted at once.
  const root = stageCanvas.closest<HTMLElement>('[data-play-root]')?.querySelector<HTMLElement>('[data-pip]') ?? null;
  const canvas = root?.querySelector<HTMLCanvasElement>('canvas[data-pip-canvas]') ?? null;
  const target = root && canvas ? { root, canvas } : null;
  targets.set(stageCanvas, { target });
  return target;
}

export interface InsetFrameOptions {
  /** The stage's frame mode: only the live ball and the idle field are shown (replays and teaching views are not). */
  mode?: string;
  /** The main view already shows the whole field from above (Classic after a stroke): the inset steps aside. */
  fieldInView?: boolean;
  /** The 3D tiers' overhead picture of the real ground (three/pip.ts). */
  ground?: { image: CanvasImageSource; key: string } | null;
  /** Something the stage protects reaches the inset's rectangle this frame (three/pip.ts insetBlocked): it steps aside. */
  blocked?: boolean;
  /**
   * Whether this stage shows the dead ball's picture (default true). Classic does not: its dead-ball card takes the
   * right half and the screen removes the inset there, so it must not flash for the frame before the card arrives.
   */
  deadBall?: boolean;
}

/**
 * One stage frame into the inset beside `stageCanvas`: the moment, the model, the paint, and the moment reported on
 * the inset's element (`data-pip-moment`) for the screen's styling. Returns the moment shown, or null without an inset.
 */
export function paintFieldInset(stageCanvas: HTMLCanvasElement, script: BallScript, t: number, o: InsetFrameOptions = {}): InsetMoment | null {
  const target = insetTarget(stageCanvas);
  if (!target) return null;
  let painter = painters.get(target.canvas);
  if (!painter) {
    painter = new FieldInsetPainter(target.canvas);
    painters.set(target.canvas, painter);
  }
  const moment = o.fieldInView || o.blocked || (o.mode !== undefined && o.mode !== 'live' && o.mode !== 'idle') ? 'hidden' : insetMoment(script, t);
  const shown = moment === 'full' && o.deadBall === false ? 'hidden' : moment;
  painter.paint(shown === 'hidden' ? null : insetModel(script, t, shown), o.ground ?? null);
  if (target.root.dataset.pipMoment !== shown) target.root.dataset.pipMoment = shown;
  if (target.root.dataset.pipDrawn !== '1') target.root.dataset.pipDrawn = '1';
  return shown;
}
