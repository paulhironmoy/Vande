/**
 * Placeholder synthesis: physically motivated impact and modal synthesis, original code, no samples.
 *
 * An impact is a contact force (a half-sine pulse whose length is the contact time: about 1 ms for a hard leather
 * ball on willow, 5–9 ms on a pad or a body) driving a bank of damped modes (each a two-pole resonator: a frequency,
 * a decay time and a gain), plus band-limited noise for what modes don't model (the leather slap, grit, grass, air).
 * The force pulse filters the modes the way a real contact does: a longer contact excites fewer high modes.
 *
 * Each recipe is a base description of the object; a take is that description perturbed by a seeded PRNG (mode
 * frequencies ±4 %, decays ±20 %, gains ±25 %, contact time ±15 %, noise), so the same id and take number always
 * render the same samples. Mode values are physically motivated, not measured from any recording:
 *   - the bat: free-free bending of a ~1.2 kg blade (about 130, 420, 1050 Hz) and higher plate and torsion modes;
 *     the sweet spot sits near the nodes of the first two, so a middled hit rings them least;
 *   - a stump: a cantilever (one end in the ground), modes in the beam ratios 1 : 6.27 : 17.5 : 34.4 : 56.8;
 *   - a bail: a short free-free beam, ratios 1 : 2.76 : 5.40;
 *   - a boundary board: a hollow panel with a low air-and-plate resonance;
 *   - the ball on the pitch: a low ground thump and the ball's own heavily damped high modes;
 *   - the bat through the air: noise through a moving band whose centre and level follow the bat's speed.
 */
import { fnv1a32, rng } from './dsp.mjs';

const TAU = 2 * Math.PI;

function pulse(sr, tc) {
  const n = Math.max(2, Math.round(tc * sr));
  const p = new Float64Array(n);
  for (let i = 0; i < n; i++) p[i] = Math.sin((Math.PI * (i + 0.5)) / n);
  return p;
}

/** Adds a damped mode driven by the force `f` (starting at sample `at`) into `out`. */
function mode(out, f, at, sr, freq, decayS, gain) {
  if (freq >= sr * 0.45) return;
  const r = Math.exp(-1 / (decayS * sr));
  const th = (TAU * freq) / sr;
  const c1 = 2 * r * Math.cos(th);
  const c2 = -r * r;
  // The impulse response is r^n sin((n + 1)θ) (unit amplitude) for a unit-area force: `gain` is the mode's level for
  // an instant contact, and a longer contact rolls the high modes off as the force's own spectrum does.
  const norm = (gain * Math.sin(th)) / Math.max(1e-12, sumOf(f));
  let y1 = 0;
  let y2 = 0;
  for (let i = at; i < out.length; i++) {
    const x = i - at < f.length ? f[i - at] : 0;
    const y = c1 * y1 + c2 * y2 + x;
    y2 = y1;
    y1 = y;
    out[i] += y * norm;
    if (i - at > f.length && Math.abs(y) < 1e-9 && Math.abs(y2) < 1e-9) break;
  }
}

function sumOf(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s;
}

/** RBJ biquad coefficients. */
function rbj(type, sr, f, q) {
  const w = (TAU * Math.min(f, sr * 0.45)) / sr;
  const al = Math.sin(w) / (2 * q);
  const cw = Math.cos(w);
  let b;
  if (type === 'bp') b = [al, 0, -al];
  else if (type === 'lp') b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2];
  else b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
  const a0 = 1 + al;
  return { b: b.map((v) => v / a0), a: [1, (-2 * cw) / a0, (1 - al) / a0] };
}

function filt(x, { b, a }) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    x[i] = v;
  }
  return x;
}

/** A noise burst: white noise, band-limited, with an attack and an exponential decay. */
function noise(out, rand, sr, at, { f, q = 1, type = 'bp', attack = 0.0005, decay, gain }) {
  const n = Math.min(out.length - at, Math.ceil(decay * sr * 9));
  if (n <= 0) return;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = rand() * 2 - 1;
  filt(x, rbj(type, sr, f, q));
  if (type === 'bp') filt(x, rbj(type, sr, f, q));
  const atk = Math.max(1, attack * sr);
  for (let i = 0; i < n; i++) {
    const e = (i < atk ? i / atk : 1) * Math.exp(-i / (decay * sr));
    out[at + i] += x[i] * e * gain;
  }
}

/** Sparse grit: random micro-impacts (Poisson in time), each a tiny click, band-passed. */
function grit(out, rand, sr, at, { count, spread, f, gain }) {
  const g = new Float64Array(out.length - at);
  for (let k = 0; k < count; k++) {
    const t = Math.floor(-Math.log(1 - rand()) * spread * sr * 0.4 + rand() * spread * sr * 0.3);
    if (t >= g.length) continue;
    g[t] += (rand() < 0.5 ? -1 : 1) * (0.3 + 0.7 * rand()) * Math.exp(-t / (spread * sr));
  }
  filt(g, rbj('bp', sr, f, 1.2));
  for (let i = 0; i < g.length; i++) out[at + i] += g[i] * gain * 6;
}

/** The ball's own click: the force's rate of change radiates a short, broadband tick. */
function click(out, f, at, gain) {
  const k = (gain * f.length) / Math.PI;
  for (let i = 1; i < f.length && at + i < out.length; i++) out[at + i] += (f[i] - f[i - 1]) * k;
}

/** One impact: the contact force into a set of modes, plus the click. */
function impact(out, sr, at, v, { tc, modes, click: ck = 0 }) {
  const f = pulse(sr, tc * v.u(0.15));
  for (const [freq, decay, gain] of modes) mode(out, f, at, sr, freq * v.u(0.04), decay * v.u(0.2), gain * v.u(0.25));
  if (ck) click(out, f, at, ck * v.u(0.25));
}

const BAT = { f1: 130, f2: 420, f3: 1050, f4: 1680, f5: 2350, f6: 3100 };
const STUMP = [1, 6.267, 17.547, 34.386, 56.843];
const BAIL = [1, 2.756, 5.404];

/** Each placeholder id's recipe: (out, sr, at, v) where v.u(spread) is a seeded factor 1 ± spread, v.r() a uniform. */
export const RECIPES = {
  sweet: { len: 0.45, render(o, sr, at, v) {
    impact(o, sr, at, v, { tc: 0.0009, click: 0.1, modes: [[BAT.f1, 0.03, 0.04], [BAT.f2, 0.02, 0.08], [BAT.f3, 0.026, 0.3], [BAT.f4, 0.036, 0.55], [BAT.f5, 0.012, 0.3], [BAT.f6, 0.006, 0.16]] });
    noise(o, v.rand, sr, at, { f: 2600, q: 0.9, decay: 0.003, gain: 0.16 * v.u(0.2) });
  } },
  middle: { len: 0.4, render(o, sr, at, v) {
    impact(o, sr, at, v, { tc: 0.001, click: 0.2, modes: [[BAT.f1, 0.035, 0.12], [BAT.f2, 0.022, 0.2], [BAT.f3, 0.016, 0.36], [BAT.f4, 0.014, 0.5], [BAT.f5, 0.007, 0.3], [BAT.f6, 0.005, 0.16]] });
    noise(o, v.rand, sr, at, { f: 2300, q: 0.9, decay: 0.003, gain: 0.14 * v.u(0.2) });
  } },
  mistimed: { len: 0.4, render(o, sr, at, v) {
    impact(o, sr, at, v, { tc: 0.0016, click: 0.08, modes: [[BAT.f1, 0.05, 0.55], [BAT.f2, 0.03, 0.42], [BAT.f3, 0.014, 0.16], [BAT.f4, 0.008, 0.1]] });
    noise(o, v.rand, sr, at, { f: 900, q: 0.8, decay: 0.006, gain: 0.12 * v.u(0.2) });
  } },
  edge_thick: { len: 0.25, render(o, sr, at, v) {
    impact(o, sr, at, v, { tc: 0.0007, click: 0.3, modes: [[640, 0.012, 0.3], [1900, 0.006, 0.5], [3400, 0.004, 0.4], [5200, 0.0025, 0.25]] });
    noise(o, v.rand, sr, at, { f: 3000, q: 0.7, decay: 0.006, gain: 0.2 * v.u(0.2) });
  } },
  edge_thin: { len: 0.2, render(o, sr, at, v) {
    impact(o, sr, at, v, { tc: 0.0005, click: 0.35, modes: [[2600, 0.003, 0.4], [4300, 0.002, 0.42], [6800, 0.0015, 0.3]] });
    noise(o, v.rand, sr, at, { f: 5200, q: 0.8, decay: 0.0015, gain: 0.18 * v.u(0.2) });
  } },
  top_edge: { len: 0.3, render(o, sr, at, v) {
    const m = [[300, 0.03, 0.4], [760, 0.014, 0.4], [1500, 0.008, 0.3]];
    impact(o, sr, at, v, { tc: 0.0008, click: 0.2, modes: m });
    // The handle's laminations knock a moment later.
    impact(o, sr, at + Math.round((0.006 + 0.003 * v.r()) * sr), v, { tc: 0.0006, modes: m.map(([f, d, g]) => [f * 1.6, d * 0.5, g * 0.3]) });
  } },
  block: { len: 0.25, render(o, sr, at, v) {
    impact(o, sr, at, v, { tc: 0.0022, click: 0.05, modes: [[BAT.f1, 0.015, 0.2], [BAT.f2, 0.01, 0.3], [BAT.f3, 0.007, 0.25], [BAT.f4, 0.005, 0.14]] });
    noise(o, v.rand, sr, at, { f: 1400, q: 0.8, decay: 0.004, gain: 0.08 * v.u(0.2) });
  } },
  pad: { len: 0.3, render(o, sr, at, v) {
    impact(o, sr, at, v, { tc: 0.006, modes: [[180, 0.018, 0.6], [420, 0.01, 0.3], [900, 0.006, 0.15]] });
    noise(o, v.rand, sr, at, { f: 1800, q: 0.8, attack: 0.001, decay: 0.008, gain: 0.35 * v.u(0.2) });
  } },
  body: { len: 0.3, render(o, sr, at, v) {
    impact(o, sr, at, v, { tc: 0.009, modes: [[120, 0.02, 0.6], [260, 0.012, 0.3]] });
    noise(o, v.rand, sr, at, { f: 1200, q: 0.7, type: 'lp', attack: 0.002, decay: 0.015, gain: 0.2 * v.u(0.2) });
  } },
  swish: { len: 0.3, render(o, sr, at, v) {
    // The bat's speed rises and falls over the swing; the band's centre follows the speed and the level about its
    // cube (aeroacoustic power rises steeply with speed). Two state-variable band-passes in series.
    const dur = 0.2 * v.u(0.15);
    const n = Math.round(dur * sr);
    const st = [0, 0, 0, 0];
    const f0 = 300 * v.u(0.1);
    const f1 = 1200 * v.u(0.1);
    for (let i = 0; i < n && at + i < o.length; i++) {
      const t = i / n;
      const s = Math.sin(Math.PI * t) ** 1.5 * (0.6 + 0.4 * Math.sin(Math.PI * t * 0.5 + 0.2));
      const fq = 2 * Math.sin((Math.PI * (f0 + (f1 - f0) * s)) / sr);
      let x = v.rand() * 2 - 1;
      for (let k = 0; k < 4; k += 2) {
        const hp = x - st[k] - 0.8 * st[k + 1];
        st[k + 1] += fq * hp;
        st[k] += fq * st[k + 1];
        x = st[k + 1];
      }
      o[at + i] += x * s ** 3 * 0.5;
    }
  } },
  gloves: { len: 0.25, render(o, sr, at, v) {
    impact(o, sr, at, v, { tc: 0.005, modes: [[330, 0.009, 0.5], [720, 0.006, 0.3]] });
    noise(o, v.rand, sr, at, { f: 2200, q: 0.9, attack: 0.0008, decay: 0.005, gain: 0.45 * v.u(0.2) });
    // The fingers close on the ball.
    const late = at + Math.round((0.025 + 0.015 * v.r()) * sr);
    noise(o, v.rand, sr, late, { f: 1600, q: 0.8, attack: 0.001, decay: 0.004, gain: 0.1 * v.u(0.3) });
  } },
  bounce_hard: { len: 0.25, render(o, sr, at, v) {
    impact(o, sr, at, v, { tc: 0.0008, click: 0.3, modes: [[95, 0.012, 0.5], [3200, 0.003, 0.4], [5000, 0.002, 0.3]] });
    noise(o, v.rand, sr, at, { f: 2800, q: 0.9, decay: 0.003, gain: 0.35 * v.u(0.2) });
  } },
  bounce: { len: 0.25, render(o, sr, at, v) {
    impact(o, sr, at, v, { tc: 0.0013, click: 0.15, modes: [[85, 0.015, 0.6], [240, 0.009, 0.3], [2800, 0.003, 0.22]] });
    noise(o, v.rand, sr, at, { f: 1600, q: 0.8, decay: 0.004, gain: 0.25 * v.u(0.2) });
  } },
  bounce_green: { len: 0.3, render(o, sr, at, v) {
    impact(o, sr, at, v, { tc: 0.003, modes: [[75, 0.02, 0.6], [200, 0.01, 0.3]] });
    noise(o, v.rand, sr, at, { f: 2500, q: 0.7, type: 'hp', attack: 0.002, decay: 0.012, gain: 0.02 * v.u(0.2) });
    noise(o, v.rand, sr, at, { f: 700, q: 0.7, type: 'lp', attack: 0.001, decay: 0.012, gain: 0.15 * v.u(0.2) });
  } },
  bounce_turning: { len: 0.3, render(o, sr, at, v) {
    impact(o, sr, at, v, { tc: 0.0012, click: 0.12, modes: [[90, 0.013, 0.5], [260, 0.008, 0.3], [2900, 0.0025, 0.15]] });
    grit(o, v.rand, sr, at, { count: 30, spread: 0.04, f: 4000, gain: 0.12 * v.u(0.25) });
    noise(o, v.rand, sr, at, { f: 1000, q: 0.7, type: 'lp', attack: 0.003, decay: 0.03, gain: 0.12 * v.u(0.2) });
  } },
  stumps: { len: 0.5, render(o, sr, at, v) {
    const f1 = 42 * v.u(0.06);
    const g = [0.35, 0.5, 0.4, 0.25, 0.12];
    const d = [0.06, 0.03, 0.018, 0.01, 0.006];
    impact(o, sr, at, v, { tc: 0.0009, click: 0.2, modes: STUMP.slice(1).map((r, i) => [f1 * r, d[i], g[i]]) });
    noise(o, v.rand, sr, at, { f: 1800, q: 0.8, decay: 0.004, gain: 0.15 * v.u(0.2) });
  } },
  bails: { len: 0.6, render(o, sr, at, v) {
    // Off the grooves, then a few bounces on the ground, each shorter and softer.
    let t = 0;
    let amp = 1;
    const hits = 3 + Math.floor(v.r() * 3);
    for (let k = 0; k < hits; k++) {
      const f1 = (1700 + 600 * v.r()) * (k % 2 ? 1.08 : 1);
      impact(o, sr, at + Math.round(t * sr), v, { tc: 0.0003, click: 0.15 * amp, modes: BAIL.map((r, i) => [f1 * r, [0.012, 0.008, 0.005][i], [0.6, 0.35, 0.2][i] * amp]) });
      t += (k === 0 ? 0.08 + 0.06 * v.r() : 0.05 + 0.04 * v.r()) * (1 - k * 0.15);
      amp *= 0.45 + 0.15 * v.r();
    }
  } },
  board: { len: 0.4, render(o, sr, at, v) {
    impact(o, sr, at, v, { tc: 0.002, click: 0.05, modes: [[95, 0.04, 0.5], [170, 0.03, 0.4], [310, 0.02, 0.3], [560, 0.012, 0.2]] });
    noise(o, v.rand, sr, at, { f: 1200, q: 0.8, attack: 0.0008, decay: 0.006, gain: 0.3 * v.u(0.2) });
  } },
};

/** The seeded variation for one take: deterministic in (id, take). */
export function variation(id, take) {
  const rand = rng(fnv1a32(`vande-placeholder|${id}|${take}`));
  return { rand, r: rand, u: (spread) => 1 + spread * (rand() * 2 - 1) };
}

/** Renders one take's raw samples (10 ms of silence first; the pipeline trims to the onset). */
export function renderTake(id, take, sr) {
  const recipe = RECIPES[id];
  if (!recipe) throw new Error(`no placeholder recipe for ${id}`);
  const out = new Float64Array(Math.round((recipe.len + 0.01) * sr));
  recipe.render(out, sr, Math.round(0.01 * sr), variation(id, take));
  return out;
}
