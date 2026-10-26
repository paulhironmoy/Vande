#!/usr/bin/env node
/**
 * Practice scoring check: runs many scripted swings through the real Practice pipeline (flight → bat → swept
 * collision → contact → struck-ball flight and roll → fielding → running or the rope → outcome) and prints the outcome
 * distribution per kind of shot, with evidence that runs, catches and boundaries come from the physics:
 *
 *   - every six crossed the rope without touching the ground, every four touched the ground first;
 *   - every catch was taken before the ball bounced, by a fielder whose path reaches the ball;
 *   - every run was completed before the ball came back (no run-outs) and runs equal the run events;
 *   - moving the nearest fielder onto the line of a boundary turns the same shot into a fielded ball or a catch;
 *   - replaying a record reproduces the result exactly;
 *   - intent: the share of well-timed attacking strokes that leave the bat within 10° of the intended bearing.
 *
 *   node scripts/practice-scoring-check.mjs                  # 4,000 deliveries × 6 scripted strokes
 *   node scripts/practice-scoring-check.mjs --n=1000         # faster
 *   node scripts/practice-scoring-check.mjs --json=out.json  # also write the raw tallies
 *
 * Exits with status 1 when an evidence check fails. Loads the TypeScript sources natively (Node ≥ 23.6) through
 * scripts/simulate-loader.mjs.
 */
import { writeFileSync } from 'node:fs';
import './simulate-loader.mjs';

const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const N = Number(arg('n', 4000));
const KEY = arg('key', 'vande-practice-scoring-check');
const JSON_OUT = arg('json', null);

const P = await import('../src/physics/index.ts');
const Gm = await import('../src/practice/game/index.ts');
const { rngFromKey } = await import('../src/engine/prng.ts');

const CONDITIONS = ['balanced', 'green', 'hard', 'turning'];
const ASSISTS = ['learn', 'play', 'real'];
const travelS = (kind, power) => (kind === 'defend' ? P.BAT_TRAVEL_MS.defend : P.BAT_TRAVEL_MS.attackMin + P.BAT_TRAVEL_MS.attackRange * power) / 1000;
const swingAt = (flight, o) => ({
  kind: o.kind ?? 'attack',
  startT: flight.idealContactT - travelS(o.kind ?? 'attack', o.power) + (o.errorMs ?? 0) / 1000,
  directionDeg: o.directionDeg,
  power: o.power,
  elevation: o.elevation,
  footwork: 'auto',
});

/** Fielders in front of square inside 40 m (the bowler included), by bearing; the widest gap between two of them. */
function gapsOf(field) {
  const ring = field.fielders
    .filter((f) => f.role !== 'keeper')
    .map((f) => ({ f, b: P.bearingFromStriker(f.x, f.z), d: P.distanceFromStriker(f.x, f.z) }))
    .filter((x) => Math.abs(x.b) <= 110 && x.d < 40)
    .sort((a, b) => a.b - b.b);
  let best = { mid: 45, width: 0 };
  for (let i = 1; i < ring.length; i++) {
    const w = ring[i].b - ring[i - 1].b;
    if (w > best.width) best = { mid: (ring[i].b + ring[i - 1].b) / 2, width: w };
  }
  const target = ring.find((x) => x.f.role === 'cover') ?? ring.find((x) => x.f.role === 'mid_off') ?? ring[0];
  return { gap: best.mid, fielder: target.b, fielderId: target.f.id };
}

const STROKES = {
  drive_gap: (fl, g, r) => swingAt(fl, { directionDeg: g.gap + (r.float() - 0.5) * 6, power: 0.75 + 0.2 * r.float(), elevation: 0.08, errorMs: (r.float() - 0.5) * 20 }),
  at_fielder: (fl, g, r) => swingAt(fl, { directionDeg: g.fielder, power: 0.55 + 0.25 * r.float(), elevation: 0.05, errorMs: (r.float() - 0.5) * 20 }),
  lofted: (fl, g, r) => swingAt(fl, { directionDeg: (r.float() < 0.5 ? 0 : g.gap) + (r.float() - 0.5) * 10, power: 0.85 + 0.15 * r.float(), elevation: 0.85 + 0.15 * r.float(), errorMs: (r.float() - 0.5) * 20 }),
  mistimed: (fl, g, r) => swingAt(fl, { directionDeg: g.gap, power: 0.7 + 0.2 * r.float(), elevation: 0.1 + 0.6 * r.float(), errorMs: (r.float() < 0.5 ? -1 : 1) * (70 + 50 * r.float()) }),
  defend: (fl, g, r) => swingAt(fl, { kind: 'defend', directionDeg: (r.float() - 0.5) * 20, power: 0.15, elevation: 0, errorMs: (r.float() - 0.5) * 30 }),
  leave: () => null,
};

const tally = {};
const bump = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);
const failures = [];
const fail = (msg) => {
  if (failures.length < 25) failures.push(msg);
};
let intentWell = 0;
let intentWithin = 0;
let counterTried = 0;
let counterChanged = 0;
let replayed = 0;

const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const conditions = CONDITIONS[i % 4];
  const assist = ASSISTS[Math.floor(i / 4) % 3];
  const over = Gm.randomOver({ seed: `${KEY}|over|${i}`, conditions, assist, beginner: false });
  const k = i % 6;
  const plan = over.balls[k];
  const seed = Gm.ballSeed(over, k);
  const field = P.autoField(over.bowler, conditions);
  const flight = P.flight({ plan, bowler: over.bowler, conditions, seed, handedness: 'right' });
  const g = gapsOf(field);
  const rng = rngFromKey(`${KEY}|strokes|${i}`);
  for (const [name, make] of Object.entries(STROKES)) {
    const swing = make(flight, g, rng);
    const args = { flight, swing, field, bowler: over.bowler, conditions, handedness: 'right', assist, tierToleranceMs: 0 };
    const res = P.resolveDelivery(args);
    const t = (tally[name] ??= { n: 0, runs: {}, dismissal: {}, contact: {}, timing: {}, reason: {}, totalRuns: 0 });
    t.n++;
    const o = res.outcome;
    bump(t.runs, o.dismissal ? 'out' : String(o.runs));
    if (o.dismissal) bump(t.dismissal, o.dismissal);
    bump(t.contact, res.contact.kind);
    bump(t.timing, res.contact.timing);
    bump(t.reason, res.coaching.reason);
    t.totalRuns += o.runs;

    // Evidence: boundaries.
    const bEv = res.events.find((e) => e.kind === 'boundary');
    const bounceBefore = (tt) => res.events.some((e) => e.kind === 'ball_bounce' && e.t < tt - 1e-9);
    if (o.boundary) {
      if (!bEv || bEv.runs !== o.boundary) fail(`${name} #${i}: boundary ${o.boundary} without a matching event`);
      const last = res.ball[res.ball.length - 1];
      if (Math.sqrt(last.p.x * last.p.x + last.p.z * last.p.z) < P.BOUNDARY_R - 0.5) fail(`${name} #${i}: boundary but the ball ends inside the rope`);
      if (o.boundary === 6 && bounceBefore(bEv.t)) fail(`${name} #${i}: six after a bounce`);
      if (o.boundary === 4 && !bounceBefore(bEv.t)) fail(`${name} #${i}: four without a bounce`);
    }
    // Evidence: catches.
    if (o.dismissal === 'caught' || o.dismissal === 'caught_behind') {
      const c = res.events.find((e) => e.kind === 'catch');
      if (!c) fail(`${name} #${i}: caught without a catch event`);
      else {
        if (bounceBefore(c.t)) fail(`${name} #${i}: caught after a bounce`);
        const path = res.fielders.find((f) => f.fielderId === c.fielderId);
        const at = path?.samples.find((s) => Math.abs(s.t - c.t) < 1e-6);
        const reach = at ? Math.sqrt((at.x - c.p.x) ** 2 + (at.z - c.p.z) ** 2) : Infinity;
        if (reach > 2.7) fail(`${name} #${i}: catch ${reach.toFixed(2)} m from the catcher`);
      }
    }
    // Evidence: running.
    const runEv = res.events.filter((e) => e.kind === 'run');
    if (!o.boundary && !o.dismissal && runEv.length !== o.runs) fail(`${name} #${i}: ${o.runs} runs but ${runEv.length} run events`);
    if (runEv.length) {
      const dead = res.events.find((e) => e.kind === 'dead');
      for (const r of runEv) if (dead.t - r.t < P.RUNNING.SAFETY_MARGIN_S - 1e-9) fail(`${name} #${i}: run ${r.completed} completed too close to the return`);
    }
    // Intent: well-timed attacking strokes.
    if (swing && swing.kind === 'attack' && (res.contact.timing === 'perfect' || res.contact.timing === 'solid') && res.contact.kind === 'middle' && res.contact.exitBearingDeg !== null) {
      intentWell++;
      if (Math.abs(P.bearingDelta(res.contact.exitBearingDeg, swing.directionDeg)) <= 10) intentWithin++;
    }
    // Counterfactual: a fielder placed on the line of a four or six changes the result of the very same shot.
    if (name === 'drive_gap' && o.boundary && counterTried < 300) {
      counterTried++;
      const b = res.contact.exitBearingDeg ?? o.endBearingDeg;
      const ring = field.fielders.filter((f) => f.role !== 'keeper' && f.role !== 'bowler');
      const nearest = ring.reduce((a, f) => (Math.abs(P.bearingDelta(P.bearingFromStriker(f.x, f.z), b)) < Math.abs(P.bearingDelta(P.bearingFromStriker(a.x, a.z), b)) ? f : a));
      const spot = P.pointFromStriker(b, Math.min(30, P.distanceFromStriker(nearest.x, nearest.z)));
      const moved = { ...field, id: `${field.id}/moved`, fielders: field.fielders.map((f) => (f.id === nearest.id ? { ...f, x: spot.x, z: spot.z } : f)) };
      const again = P.resolveDelivery({ ...args, field: moved });
      if (!again.outcome.boundary) counterChanged++;
    }
    // Determinism: replay reproduces the result exactly.
    if (i % 97 === 0) {
      replayed++;
      const record = { version: 1, overIndex: 0, ballIndex: k, bowler: over.bowler, plan, seed, conditions, field, handedness: 'right', assist, tierToleranceMs: 0, swing, runs: o.runs, dismissal: o.dismissal };
      if (JSON.stringify(P.replayDelivery(record)) !== JSON.stringify(res)) fail(`${name} #${i}: replay differs`);
    }
  }
}
const secs = (Date.now() - t0) / 1000;

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1).padStart(5) + '%' : '   -  ');
const order = ['0', '1', '2', '3', '4', '6', 'out'];
console.log(`\nPractice scoring check: ${N} deliveries × ${Object.keys(STROKES).length} scripted strokes in ${secs.toFixed(1)} s\n`);
console.log('stroke        n      ' + order.map((k) => k.padStart(7)).join('') + '   runs/ball');
for (const [name, t] of Object.entries(tally)) {
  console.log(name.padEnd(12) + String(t.n).padStart(6) + '  ' + order.map((k) => pct(t.runs[k] ?? 0, t.n).padStart(7)).join('') + '   ' + (t.totalRuns / t.n).toFixed(2));
}
console.log('\nDismissals:');
for (const [name, t] of Object.entries(tally)) console.log('  ' + name.padEnd(12) + Object.entries(t.dismissal).map(([k, v]) => `${k} ${pct(v, t.n).trim()}`).join(', '));
console.log('\nContact:');
for (const [name, t] of Object.entries(tally)) console.log('  ' + name.padEnd(12) + Object.entries(t.contact).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, t.n).trim()}`).join(', '));
console.log('\nTop coaching reasons:');
for (const [name, t] of Object.entries(tally)) console.log('  ' + name.padEnd(12) + Object.entries(t.reason).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${pct(v, t.n).trim()}`).join(', '));
console.log(`\nIntent: ${intentWithin} of ${intentWell} well-timed attacking strokes left the bat within 10° of the intended bearing (${pct(intentWithin, intentWell).trim()}).`);
console.log(`Counterfactual: moving the nearest fielder onto the line changed ${counterChanged} of ${counterTried} boundary drives (${pct(counterChanged, counterTried).trim()}).`);
console.log(`Replay: ${replayed} records re-simulated.`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ N, tally, intent: { within: intentWithin, of: intentWell }, counterfactual: { changed: counterChanged, of: counterTried }, failures }, null, 1));
if (failures.length) {
  console.log(`\nEVIDENCE FAILURES (${failures.length}${failures.length >= 25 ? '+' : ''}):`);
  for (const f of failures) console.log('  ' + f);
  process.exit(1);
}
console.log('\nAll evidence checks passed.');
