/**
 * The top-down Canvas 2D painter behind every 2D presentation: a floodlit field seen from above that zooms on the
 * pitch for the delivery and follows the ball after the shot, plus a side-on inset of the ball's height. The match's
 * 2D fallback (Fallback2DRenderer) and Classic Practice (Fallback2DPracticeStage) both paint through it.
 * Deterministic and cheap; no external assets.
 */
import type { KitSpec } from '@/contracts';
import { evaluateActor } from '../core/actors';
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
