/**
 * Lightweight canvas confetti (no dependency).
 *
 * One fixed, full-screen, pointer-transparent canvas is created on demand and removed when the last particle settles.
 * Particles are small rounded rectangles, dots and thin ribbons with a 3D-ish flutter, gravity, air drag, spin and a
 * fade-out. Capped at 400 live particles, driven by requestAnimationFrame. Every entry point is a no-op under reduced
 * motion and when there is no document or no 2D canvas context.
 */
import { prefersReducedMotion } from './motion';

export interface ConfettiOptions {
  /** 0..1 viewport fractions (default { x: 0.5, y: 0.35 }). */
  origin?: { x: number; y: number };
  count?: number;
  /** Cone width in degrees (default 70). */
  spread?: number;
  /** Launch power multiplier (default 1). */
  power?: number;
  palette?: string[];
  /** Approximate life of a particle in ms (default 2600). */
  durationMs?: number;
}

type Shape = 'rect' | 'dot' | 'ribbon';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  shape: Shape;
  wobble: number;
  wobbleSpeed: number;
  gravity: number;
  drag: number;
  age: number;
  ttl: number;
}

const MAX_PARTICLES = 400;
const GRAVITY = 620; // px/s²
const DRAG = 2.6; // 1/s

/** Cool, on-brand colours; saffron is added separately as a minority accent (≤ 15 %). */
const COOL_VARS: [string, string][] = [
  ['--c-cyan', '#62D6FF'],
  ['--c-electric', '#38A0FF'],
  ['--o-trust', '#7B8CFF'],
  ['--o-safety', '#2ED3C4'],
  ['--o-economy', '#2ECC8A'],
  ['--o-legitimacy', '#A9E4FF'],
];
const ACCENT_VAR: [string, string] = ['--a-saffron', '#F0A24A'];
const ACCENT_SHARE = 0.12;

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let raf = 0;
let lastTs = 0;
let dpr = 1;
let width = 0;
let height = 0;
let rainUntil = 0;
let rainPalette: { cool: string[]; accent: string } | null = null;
let rainCarry = 0;

function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

function readPalette(custom?: string[]): { cool: string[]; accent: string; custom?: string[] } {
  if (custom && custom.length) return { cool: custom, accent: '', custom };
  return { cool: COOL_VARS.map(([n, f]) => cssVar(n, f)), accent: cssVar(ACCENT_VAR[0], ACCENT_VAR[1]) };
}

function pickColor(p: { cool: string[]; accent: string; custom?: string[] }): string {
  if (!p.custom && p.accent && Math.random() < ACCENT_SHARE) return p.accent;
  return p.cool[Math.floor(Math.random() * p.cool.length)];
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function resize(): void {
  if (!canvas || typeof window === 'undefined') return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

function ensureCanvas(): boolean {
  if (canvas && ctx) return true;
  if (typeof document === 'undefined' || !document.body) return false;
  const el = document.createElement('canvas');
  el.setAttribute('aria-hidden', 'true');
  el.dataset.vandeConfetti = 'true';
  Object.assign(el.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2000' } as Partial<CSSStyleDeclaration>);
  let c: CanvasRenderingContext2D | null = null;
  try {
    c = el.getContext('2d');
  } catch {
    c = null;
  }
  if (!c) return false;
  document.body.appendChild(el);
  canvas = el;
  ctx = c;
  resize();
  window.addEventListener('resize', resize, { passive: true });
  return true;
}

function teardown(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  lastTs = 0;
  particles = [];
  rainUntil = 0;
  rainPalette = null;
  rainCarry = 0;
  if (typeof window !== 'undefined') window.removeEventListener('resize', resize);
  canvas?.remove();
  canvas = null;
  ctx = null;
}

function makeParticle(x: number, y: number, vx: number, vy: number, color: string, ttl: number, gravityScale = 1): Particle {
  const r = Math.random();
  const shape: Shape = r < 0.5 ? 'rect' : r < 0.75 ? 'dot' : 'ribbon';
  const w = shape === 'rect' ? rand(6, 10) : shape === 'dot' ? rand(2.5, 4) : rand(1.6, 2.4);
  const h = shape === 'rect' ? rand(3, 6) : shape === 'dot' ? w : rand(11, 16);
  return {
    x,
    y,
    vx,
    vy,
    rot: rand(0, Math.PI * 2),
    vr: rand(-7, 7),
    w,
    h,
    color,
    shape,
    wobble: rand(0, Math.PI * 2),
    wobbleSpeed: rand(5, 11),
    gravity: GRAVITY * gravityScale,
    drag: DRAG,
    age: 0,
    ttl,
  };
}

function add(p: Particle): void {
  if (particles.length >= MAX_PARTICLES) particles.shift();
  particles.push(p);
}

function spawnRain(dt: number, now: number): void {
  if (!rainPalette || now >= rainUntil) return;
  // ~ 70 particles per second across a phone-width screen; scale gently with width.
  rainCarry += dt * 70 * Math.max(0.6, Math.min(2, width / 420));
  while (rainCarry >= 1) {
    rainCarry -= 1;
    add(makeParticle(rand(0, width), rand(-30, -8), rand(-25, 25), rand(60, 140), pickColor(rainPalette), rand(2.6, 4.2), 0.35));
  }
}

function frame(ts: number): void {
  if (!ctx || !canvas) return;
  const now = performance.now();
  const dt = lastTs ? Math.min(0.05, Math.max(0, (ts - lastTs) / 1000)) : 1 / 60;
  lastTs = ts;
  spawnRain(dt, now);

  const next: Particle[] = [];
  for (const p of particles) {
    p.age += dt;
    const k = Math.exp(-p.drag * dt);
    p.vx *= k;
    p.vy = p.vy * k + p.gravity * dt;
    p.wobble += p.wobbleSpeed * dt;
    p.x += (p.vx + Math.sin(p.wobble) * 22) * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.age < p.ttl && p.y < height + 40 && p.x > -60 && p.x < width + 60) next.push(p);
  }
  particles = next;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  for (const p of particles) {
    const fadeStart = p.ttl * 0.7;
    const alpha = p.age > fadeStart ? Math.max(0, 1 - (p.age - fadeStart) / (p.ttl - fadeStart)) : 1;
    const flutter = Math.cos(p.wobble * 1.3);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(1, p.shape === 'dot' ? 1 : Math.max(0.12, Math.abs(flutter)));
    ctx.fillStyle = p.color;
    if (p.shape === 'dot') {
      ctx.beginPath();
      ctx.arc(0, 0, p.w, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const r = Math.min(p.w, p.h) * 0.35;
      ctx.beginPath();
      const x = -p.w / 2;
      const y = -p.h / 2;
      if (typeof (ctx as CanvasRenderingContext2D & { roundRect?: unknown }).roundRect === 'function') ctx.roundRect(x, y, p.w, p.h, r);
      else ctx.rect(x, y, p.w, p.h);
      ctx.fill();
    }
    ctx.restore();
  }

  if (particles.length === 0 && now >= rainUntil) {
    teardown();
    return;
  }
  raf = requestAnimationFrame(frame);
}

function run(): void {
  if (!raf) raf = requestAnimationFrame(frame);
}

function canRun(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (typeof requestAnimationFrame !== 'function') return false;
  if (prefersReducedMotion()) return false;
  return ensureCanvas();
}

/** One celebratory burst. */
export function fireConfetti(opts: ConfettiOptions = {}): void {
  try {
    if (!canRun()) return;
    const palette = readPalette(opts.palette);
    const origin = opts.origin ?? { x: 0.5, y: 0.35 };
    const ox = origin.x * width;
    const oy = origin.y * height;
    const count = Math.max(1, Math.min(MAX_PARTICLES, Math.round(opts.count ?? 120)));
    const spread = ((opts.spread ?? 70) * Math.PI) / 180;
    const power = opts.power ?? 1;
    const ttlBase = (opts.durationMs ?? 2600) / 1000;
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + rand(-spread / 2, spread / 2);
      const speed = rand(520, 1050) * power;
      add(makeParticle(ox + rand(-6, 6), oy + rand(-6, 6), Math.cos(angle) * speed, Math.sin(angle) * speed, pickColor(palette), ttlBase * rand(0.7, 1.1)));
    }
    run();
  } catch {
    /* decoration only */
  }
}

/** Gentle rain from the top edge for `durationMs` (default 2200 ms). */
export function confettiRain(durationMs = 2200): void {
  try {
    if (!canRun()) return;
    rainPalette = readPalette();
    rainUntil = Math.max(rainUntil, performance.now() + Math.max(0, durationMs));
    run();
  } catch {
    /* decoration only */
  }
}

/** Burst from the centre of an element (falls back to the default origin). */
export function confettiFromElement(el: Element | null, opts: Omit<ConfettiOptions, 'origin'> = {}): void {
  try {
    if (!el || typeof window === 'undefined') {
      fireConfetti(opts);
      return;
    }
    const r = el.getBoundingClientRect();
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    fireConfetti({ ...opts, origin: { x: (r.left + r.width / 2) / w, y: (r.top + r.height / 2) / h } });
  } catch {
    /* decoration only */
  }
}

/** Test helper: stop everything and remove the canvas. */
export function __resetConfettiForTests(): void {
  teardown();
}

/** Test helper: number of live particles. */
export function __confettiParticleCount(): number {
  return particles.length;
}
