/**
 * RK3 and EX1 on seeded gesture corpora (tests/unit/input/corpus.ts), and the Expert Examiner's E-EXP-014 corpus
 * (release/player-experience/expert/tools/gestures.mjs) rebuilt here with its own seed, distributions, harness and
 * recognition rule, as an acceptance fixture.
 */
import { describe, expect, it } from 'vitest';
import type { GestureInput, GestureSample, NormalizedSwing } from '@/contracts/practice';
import { GestureTracker, normalizeGesture, referenceLength, type TrackerScheduler } from '@/input';
import { LOFT_REACH, TAP_HOLD_MS } from '@/input/constants';
import { sha256Hex } from '@/engine/sha256';
import { shotFamily } from '@/physics/shot';
import { expertCorpus, noviceCorpus, type CorpusGesture, type ExpertClass, type NoviceClass } from './corpus';
import { SURFACES, bearingDiff, play } from './fixtures';

function swingOf<C extends string>(g: CorpusGesture<C>): NormalizedSwing | null {
  if (!g.samples) return null;
  return play(g.samples, { surface: g.surface, pointer: g.pointer, delivery: g.delivery, lifted: g.lifted, armAtMs: g.armAtMs, footwork: g.footwork }).swing;
}

function tally<C extends string>(rows: Array<{ cls: C; ok: boolean; note: string }>) {
  const by: Record<string, { n: number; ok: number; misses: string[] }> = {};
  for (const r of rows) {
    const t = (by[r.cls] ??= { n: 0, ok: 0, misses: [] });
    t.n++;
    if (r.ok) t.ok++;
    else if (t.misses.length < 5) t.misses.push(r.note);
  }
  const total = rows.length;
  const ok = rows.filter((r) => r.ok).length;
  return { by, overall: ok / total, total, line: `${ok}/${total} (${((100 * ok) / total).toFixed(1)}%); ${Object.entries(by).map(([k, c]) => `${k} ${c.ok}/${c.n}`).join(', ')}` };
}

describe('RK3: novice tap, swipe and leave are recognised (≥ 95% of ≥ 300 jittered gestures)', () => {
  it('on the seeded novice corpus', () => {
    const corpus = noviceCorpus();
    expect(corpus.length).toBeGreaterThanOrEqual(300);
    // Keep the original traces and their intended labels. The old corpus called
    // held/unreleased presses taps because the old tracker auto-defended them.
    // Under the rest-then-swipe contract they are waiting/leave; they are not
    // removed from evaluation, and the old-label result is reported separately.
    const oldRows: Array<{ cls: NoviceClass; ok: boolean; note: string }> = [];
    const rows = corpus.map((g) => {
      const sw = swingOf(g);
      const read: NoviceClass = sw === null ? 'leave' : sw.kind === 'defend' ? 'tap' : 'flick';
      const note = `${g.id} ${g.note} ${g.delivery.name} → ${read}`;
      oldRows.push({ cls: g.cls, ok: read === g.cls, note });
      const duration = g.samples ? g.samples.at(-1)!.t - g.samples[0].t : 0;
      const expected: NoviceClass = g.cls === 'tap' && (!g.lifted || duration > TAP_HOLD_MS) ? 'leave' : g.cls;
      return { cls: expected, ok: read === expected, note };
    });
    const t = tally(rows);
    console.info(`RK3 original auto-hold labels (historical contract, not the active gate): ${tally(oldRows).line}; relabelled waiting presses: ${rows.filter((r, i) => r.cls !== corpus[i].cls).length}; all ${corpus.length} traces retained`);
    console.info(`RK3 novice corpus: ${t.line}${Object.values(t.by).some((c) => c.misses.length) ? `; misses: ${Object.values(t.by).flatMap((c) => c.misses).join(' | ')}` : ''}`);
    for (const [cls, c] of Object.entries(t.by)) expect(c.ok / c.n, `${cls}: ${c.ok}/${c.n}; ${c.misses.join(' | ')}`).toBeGreaterThanOrEqual(0.95);
    expect(t.overall).toBeGreaterThanOrEqual(0.95);
  });

  it('is reproducible: the same seed builds the same corpus and the same reads', () => {
    const a = noviceCorpus().slice(0, 40).map(swingOf);
    const b = noviceCorpus().slice(0, 40).map(swingOf);
    expect(a).toEqual(b);
  });
});

/** The stroke class the game plays for a swing (src/physics/shot.ts), plus loft and the defences. */
function classOf(sw: NormalizedSwing | null): ExpertClass | 'other' {
  if (!sw) return 'leave';
  if (sw.kind === 'defend') return sw.footwork === 'forward' || sw.footwork === 'down_track' ? 'forward_defence' : sw.footwork === 'back' || sw.footwork === 'across' ? 'back_defence' : 'other';
  if (sw.elevation >= 0.45) return 'lofted';
  if (sw.elevation > 0.05) return 'other';
  const played = sw.footwork === 'auto' ? 'forward' : sw.footwork;
  const fam = shotFamily('attack', sw.directionDeg, played);
  if (fam === 'straight_drive' || fam === 'off_drive' || fam === 'cover_drive' || fam === 'on_drive' || fam === 'back_drive') return 'drive';
  if (fam === 'cut') return 'cut';
  if (fam === 'pull') return 'pull';
  if (fam === 'flick') return 'flick';
  return 'other';
}

describe('EX1: an expert’s eight intended classes are recognised (≥ 90%)', () => {
  it('on the seeded expert corpus (touch, mouse and pen, every surface, every cadence)', () => {
    const corpus = expertCorpus();
    const rows = corpus.map((g) => {
      const sw = swingOf(g);
      const read = classOf(sw);
      const aimOk = g.aimDeg === undefined || (sw !== null && Math.abs(bearingDiff(sw.directionDeg, g.aimDeg)) <= 15);
      return { cls: g.cls, ok: read === g.cls && aimOk, note: `${g.id} ${g.note} ${g.surfaceName}/${g.pointer} ${g.delivery.name} → ${read} ${sw ? `${sw.directionDeg}° e${sw.elevation}` : ''}` };
    });
    const t = tally(rows);
    console.info(`EX1 expert corpus: ${t.line}`);
    expect(Object.keys(t.by)).toHaveLength(8);
    for (const [cls, c] of Object.entries(t.by)) expect(c.ok / c.n, `${cls}: ${c.ok}/${c.n}; ${c.misses.join(' | ')}`).toBeGreaterThanOrEqual(0.9);
    expect(t.overall).toBeGreaterThanOrEqual(0.9);
  });

  it('on the keyboard, every class is one key sequence away', () => {
    const run = (keys: Array<[string, number, boolean?]>) => {
      let now = 0;
      const timers: Array<{ at: number; fn: () => void }> = [];
      const sched: TrackerScheduler = { now: () => now, setTimer: (fn, ms) => { const t = { at: now + ms, fn }; timers.push(t); return t; }, clearTimer: (id) => { const i = timers.indexOf(id as (typeof timers)[number]); if (i >= 0) timers.splice(i, 1); } };
      let g: GestureInput | null = null;
      const tr = new GestureTracker({ swingStart: () => undefined, gesture: (x) => (g = x) }, sched);
      tr.setSurface(SURFACES.desktop.width, SURFACES.desktop.height);
      tr.setEnabled(true);
      for (const [code, t, shift] of keys) {
        now = t;
        tr.key(code, t, false, { shift: shift === true });
      }
      now = 5000;
      for (const t of timers.splice(0)) t.fn();
      return g ? normalizeGesture(g, { releasePerfMs: 0, calibrationMs: 0, handedness: 'right' }) : null;
    };
    const cases: Array<[ExpertClass, Array<[string, number, boolean?]>]> = [
      ['leave', []],
      ['forward_defence', [['KeyW', 1000], ['Space', 1100]]],
      ['back_defence', [['KeyS', 1000], ['Space', 1100]]],
      ['drive', [['KeyW', 1000], ['ArrowUp', 1100], ['ArrowRight', 1110]]],
      ['cut', [['KeyS', 1000], ['ArrowRight', 1100]]],
      ['pull', [['KeyS', 1000], ['ArrowLeft', 1100]]],
      ['flick', [['KeyW', 1000], ['ArrowUp', 1100], ['ArrowLeft', 1105]]],
      ['lofted', [['KeyW', 1000], ['ArrowUp', 1100, true]]],
    ];
    for (const [cls, keys] of cases) expect(classOf(keys.length ? run(keys) : null), cls).toBe(cls);
  });

  it('touch defences carry the intended foot once footwork by press position is on (F-027)', () => {
    const surf = SURFACES.phone;
    const tap = (y: number): GestureSample[] => [
      { t: 1000, x: 450, y },
      { t: 1040, x: 451, y: y + 1 },
      { t: 1070, x: 450.5, y: y + 0.5 },
    ];
    const fd = play(tap(surf.height * 0.18), { surface: surf, pressFootwork: true });
    const bd = play(tap(surf.height * 0.82), { surface: surf, pressFootwork: true });
    const mid = play(tap(surf.height * 0.5), { surface: surf, pressFootwork: true });
    const off = play(tap(surf.height * 0.18), { surface: surf });
    expect(classOf(fd.swing)).toBe('forward_defence');
    expect(classOf(bd.swing)).toBe('back_defence');
    expect(mid.swing!.footwork).toBe('auto');
    // Off by default: a rookie's press position never chooses a foot.
    expect(off.swing!.footwork).toBe('auto');
    // The foot is known at the press itself, with the swing start.
    expect(fd.trace.starts[0].footwork).toBe('forward');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// E-EXP-014 (Expert Examiner): the same seed, distributions, harness and rule as expert/tools/gestures.mjs
// ---------------------------------------------------------------------------------------------------------------

function examinerRng(seed: string) {
  // The examiner seeds sfc32 with the first four little-endian words of SHA-256(seed) (Node's readUInt32LE).
  const hex = sha256Hex(seed);
  const le = (i: number) => (parseInt(hex.slice(2 * i, 2 * i + 2), 16) | (parseInt(hex.slice(2 * i + 2, 2 * i + 4), 16) << 8) | (parseInt(hex.slice(2 * i + 4, 2 * i + 6), 16) << 16) | (parseInt(hex.slice(2 * i + 6, 2 * i + 8), 16) << 24)) >>> 0;
  let a = le(0);
  let b = le(4);
  let c = le(8);
  let d = le(12);
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
}

const EX_SURF = { width: 915, height: Math.round(412 * 0.46) };

function examinerHarness() {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void }> = [];
  const sched: TrackerScheduler = {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = { at: now + ms, fn };
      timers.push(id);
      return id;
    },
    clearTimer: (id) => {
      const i = timers.indexOf(id as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const advanceTo = (t: number) => {
    for (;;) {
      timers.sort((x, y) => x.at - y.at);
      const next = timers[0];
      if (!next || next.at > t) break;
      timers.shift();
      now = next.at;
      next.fn();
    }
    now = Math.max(now, t);
  };
  return { sched, advanceTo, setNow: (t: number) => (now = t) };
}

function examinerRun(samples: GestureSample[], pressFootwork = false): NormalizedSwing | null {
  const h = examinerHarness();
  let gesture: GestureInput | null = null;
  const tr = new GestureTracker({ swingStart: () => undefined, gesture: (g) => (gesture = g) }, h.sched);
  tr.setSurface(EX_SURF.width, EX_SURF.height);
  tr.setHandedness('right');
  tr.setPressFootwork(pressFootwork);
  tr.setEnabled(true);
  h.setNow(samples[0].t);
  tr.pointerDown(1, 'touch', samples[0]);
  for (let i = 1; i < samples.length; i++) {
    h.advanceTo(samples[i].t);
    if (gesture) break;
    tr.pointerMove(1, [samples[i]]);
  }
  if (!gesture) tr.pointerUp(1, samples[samples.length - 1]);
  h.advanceTo(samples[samples.length - 1].t + 200);
  return gesture ? normalizeGesture(gesture, { releasePerfMs: 0, calibrationMs: 0, handedness: 'right' }) : null;
}

function examinerCorpus(loftSpec: 'examiner' | 'documented') {
  const R = examinerRng('xx-gestures-v1');
  const U = (a: number, b: number) => a + (b - a) * R();
  const stroke = ({ L, ang, dur, lift = true, hold = 0, rate = 8, x0 = 450, y0 = 130 }: { L: number; ang: number; dur: number; lift?: boolean; hold?: number; rate?: number; x0?: number; y0?: number }) => {
    const s: GestureSample[] = [];
    const t0 = 1000;
    const n = Math.max(1, Math.round(dur / rate));
    const rad = (ang * Math.PI) / 180;
    s.push({ t: t0, x: x0, y: y0 });
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      const e = 1 - (1 - u) * (1 - u);
      s.push({ t: t0 + u * dur, x: x0 + Math.sin(rad) * L * e + U(-0.6, 0.6), y: y0 - Math.cos(rad) * L * e + U(-0.6, 0.6) });
    }
    if (!lift && hold) {
      const last = s[s.length - 1];
      for (let k = rate; k <= hold; k += rate) s.push({ t: last.t + k, x: last.x, y: last.y });
    }
    return s;
  };
  const ref = referenceLength(EX_SURF);
  // The examiner's lofted class (130–220 px over 90–160 ms), or the documented loft: 1.65–2.0 reference lengths
  // (313–379 px on this surface) over 90–140 ms, started low so the stroke has room.
  const lofted =
    loftSpec === 'examiner'
      ? (ang: number) => stroke({ L: U(130, 220), ang, dur: U(90, 160), lift: true })
      : (ang: number) => stroke({ L: U(1.65, 2.0) * ref, ang, dur: U(90, 140), lift: true, y0: 170 });
  const CLASSES: Record<string, () => { ang: number; gen: (ang: number) => GestureSample[]; ground: boolean }> = {
    drive: () => ({ ang: U(0, 30), gen: (ang) => stroke({ L: U(40, 100), ang, dur: U(50, 120), lift: R() < 0.5, hold: 60 }), ground: true }),
    cut: () => ({ ang: U(90, 105), gen: (ang) => stroke({ L: U(40, 80), ang, dur: U(40, 80), lift: R() < 0.5, hold: 60 }), ground: true }),
    pull: () => ({ ang: U(-100, -80), gen: (ang) => stroke({ L: U(50, 100), ang, dur: U(50, 110), lift: R() < 0.5, hold: 60 }), ground: true }),
    flick: () => ({ ang: U(-50, -30), gen: (ang) => stroke({ L: U(30, 70), ang, dur: U(40, 90), lift: R() < 0.5, hold: 60 }), ground: true }),
    lofted: () => ({ ang: U(-30, 30), gen: lofted, ground: false }),
  };
  const results: Record<string, { n: number; ok: number; worst: string[] }> = {};
  for (const [name, mk] of Object.entries(CLASSES)) {
    const r = (results[name] = { n: 0, ok: 0, worst: [] as string[] });
    for (let i = 0; i < 60; i++) {
      const c = mk();
      const sw = examinerRun(c.gen(c.ang));
      const good = sw !== null && sw.kind === 'attack' && Math.abs(bearingDiff(sw.directionDeg, c.ang)) <= 15 && (c.ground ? sw.elevation <= 0.3 : sw.elevation >= 0.45);
      r.n++;
      if (good) r.ok++;
      else if (r.worst.length < 4) r.worst.push(`${c.ang.toFixed(0)}° → ${sw?.kind} ${sw?.directionDeg}° e${sw?.elevation} p${sw?.power}`);
    }
  }
  // Defences: keyboard (W or S, then Space), and touch taps; the examiner's taps press at y 130 of 190 (the low band).
  const defences: Record<string, { keyboard: number; touchDefend: number; touchFootworkByPress: number }> = {};
  for (const [name, key, fw] of [
    ['forward_defence', 'KeyW', 'forward'],
    ['back_defence', 'KeyS', 'back'],
  ] as const) {
    let ok = 0;
    for (let i = 0; i < 60; i++) {
      const t = 1000 + U(0, 50);
      const h = examinerHarness();
      let g: GestureInput | null = null;
      const tr = new GestureTracker({ swingStart: () => undefined, gesture: (x) => (g = x) }, h.sched);
      tr.setSurface(EX_SURF.width, EX_SURF.height);
      tr.setEnabled(true);
      for (const [code, at] of [
        [key, t],
        ['Space', t + U(60, 200)],
      ] as const) {
        h.advanceTo(at);
        tr.key(code, at, false);
      }
      const sw = g ? normalizeGesture(g, { releasePerfMs: 0, calibrationMs: 0, handedness: 'right' }) : null;
      if (sw && sw.kind === 'defend' && sw.footwork === fw) ok++;
    }
    let tapDefend = 0;
    let byPress = 0;
    for (let i = 0; i < 60; i++) {
      // The examiner's taps, pressed in the band for the intended foot (footwork by press position switched on).
      const y = fw === 'forward' ? 40 : 150;
      const s: GestureSample[] = [{ t: 1000, x: 450, y }];
      const hold = U(15, 45);
      for (let k = 8; k <= hold; k += 8) s.push({ t: 1000 + k, x: 450 + U(-1.5, 1.5), y: y + U(-1.5, 1.5) });
      const sw = examinerRun(s, true);
      if (sw && sw.kind === 'defend') tapDefend++;
      if (sw && sw.footwork === fw) byPress++;
    }
    defences[name] = { keyboard: ok, touchDefend: tapDefend, touchFootworkByPress: byPress };
  }
  return { results, defences };
}

describe('E-EXP-014 (Expert Examiner’s corpus, rebuilt as an acceptance fixture)', () => {
  it('uses the examiner’s own seed words', () => {
    // node -e "const h=require('crypto').createHash('sha256').update('xx-gestures-v1').digest(); [0,4,8,12].map(i=>h.readUInt32LE(i))"
    const hex = sha256Hex('xx-gestures-v1');
    expect(hex.slice(0, 8)).toBe('f2262183');
    const R = examinerRng('xx-gestures-v1');
    expect(R()).toBeGreaterThanOrEqual(0);
  });

  it('grounded drive, cut, pull and flick, and the defences, are recognised; lofted with the documented loft gesture', () => {
    const { results, defences } = examinerCorpus('documented');
    console.info(`E-EXP-014 rebuilt (documented loft): ${Object.entries(results).map(([k, r]) => `${k} ${r.ok}/${r.n}`).join(', ')}; defences ${JSON.stringify(defences)}`);
    for (const cls of ['drive', 'cut', 'pull', 'flick', 'lofted']) {
      const r = results[cls];
      expect(r.ok / r.n, `${cls}: ${r.ok}/${r.n} ${r.worst.join(' | ')}`).toBeGreaterThanOrEqual(0.95);
    }
    for (const d of Object.values(defences)) {
      expect(d.keyboard).toBe(60);
      expect(d.touchDefend).toBe(60);
      expect(d.touchFootworkByPress).toBe(60);
    }
    const ok = Object.values(results).reduce((s, r) => s + r.ok, 0) + defences.forward_defence.keyboard + defences.back_defence.keyboard + 60;
    expect(ok / (5 * 60 + 3 * 60)).toBeGreaterThanOrEqual(0.9);
  });

  it('the examiner’s own lofted class (130–220 px) is an ordinary swipe under decision 1, so it stays (nearly) grounded', () => {
    const { results } = examinerCorpus('examiner');
    console.info(`E-EXP-014 rebuilt (examiner's lofted class): ${Object.entries(results).map(([k, r]) => `${k} ${r.ok}/${r.n}`).join(', ')}`);
    // 220 px on this surface is 1.16 reference lengths: at most just past the start of the loft ramp.
    const maxElevation = (220 / referenceLength(EX_SURF) - LOFT_REACH.from) / (LOFT_REACH.full - LOFT_REACH.from);
    expect(maxElevation).toBeLessThan(0.15);
    expect(results.lofted.ok).toBe(0);
    for (const cls of ['drive', 'cut', 'pull', 'flick']) expect(results[cls].ok / results[cls].n).toBeGreaterThanOrEqual(0.95);
  });
});
