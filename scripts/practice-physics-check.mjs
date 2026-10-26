#!/usr/bin/env node
/**
 * Practice physics check: proves the timing windows emerge from the bat–ball physics.
 *
 * For each assistance level it sweeps a swing across timing errors (1 ms steps) against fixed deliveries, runs the
 * real strike() (bat kinematics, swept collision, contact classification) and measures, around zero error, the
 * contiguous window where the ball meets the sweet spot (perfect), the middle of the bat (solid) and any part of the
 * bat (edge). It prints them next to the TIMING_BANDS the levels advertise.
 *
 *   node scripts/practice-physics-check.mjs            # default deliveries and strokes
 *   node scripts/practice-physics-check.mjs --json     # machine-readable
 */
import './simulate-loader.mjs';

const { flight } = await import('../src/physics/delivery.ts');
const { strike } = await import('../src/physics/contact.ts');
const { batTravelMs } = await import('../src/physics/bat.ts');
const { TIMING_BANDS } = await import('../src/physics/constants.ts');

const json = process.argv.includes('--json');
const levels = ['learn', 'play', 'real'];
const pace = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'check-pace' };
const spin = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'check-spin' };
const cases = [
  { name: 'pace 136 km/h good length, straight drive', bowler: pace, plan: { variation: 'stock', lengthM: 6.5, lineM: 0.05, speedKph: 136 }, swing: { kind: 'attack', directionDeg: 0, power: 0.6, elevation: 0.1 } },
  { name: 'pace 136 km/h good length, cover drive', bowler: pace, plan: { variation: 'stock', lengthM: 6.5, lineM: 0.12, speedKph: 136 }, swing: { kind: 'attack', directionDeg: 55, power: 0.6, elevation: 0.1 } },
  { name: 'pace 136 km/h good length, forward defence', bowler: pace, plan: { variation: 'stock', lengthM: 6.5, lineM: 0.05, speedKph: 136 }, swing: { kind: 'defend', directionDeg: 0, power: 0, elevation: 0 } },
  { name: 'spin 85 km/h, straight drive', bowler: spin, plan: { variation: 'stock', lengthM: 5.5, lineM: 0.05, speedKph: 85 }, swing: { kind: 'attack', directionDeg: 0, power: 0.6, elevation: 0.1 } },
];

function category(r) {
  const k = r.contact.kind;
  if (k === 'middle') return r.quality?.sweet ? 'sweet' : 'middle';
  if (k === 'inside_edge' || k === 'outside_edge' || k === 'top_edge' || k === 'leading_edge') return 'edge';
  return 'none';
}

/** Contiguous window around 0 (ms) where pred holds: [lo, hi]. */
function window(samples, pred) {
  const zero = samples.findIndex((s) => s.e === 0);
  if (zero < 0 || !pred(samples[zero].c)) return null;
  let lo = zero;
  let hi = zero;
  while (lo > 0 && pred(samples[lo - 1].c)) lo--;
  while (hi < samples.length - 1 && pred(samples[hi + 1].c)) hi++;
  return [samples[lo].e, samples[hi].e];
}

const out = [];
for (const c of cases) {
  const f = flight({ plan: c.plan, bowler: c.bowler, conditions: 'balanced', seed: 'physics-check' });
  for (const assist of levels) {
    const travel = batTravelMs(c.swing.kind, c.swing.power) / 1000;
    const samples = [];
    for (let e = -260; e <= 260; e++) {
      const swing = { ...c.swing, footwork: 'auto', startT: f.idealContactT - travel + e / 1000 };
      const r = strike(f, swing, { assist });
      samples.push({ e, c: category(r) });
    }
    const perfect = window(samples, (x) => x === 'sweet');
    const solid = window(samples, (x) => x === 'sweet' || x === 'middle');
    const edge = window(samples, (x) => x !== 'none');
    out.push({ case: c.name, assist, bands: TIMING_BANDS[assist], perfect, solid, edge });
  }
}

if (json) {
  console.log(JSON.stringify(out, null, 2));
} else {
  const fmt = (w) => (w ? `${String(w[0]).padStart(5)} … ${String(w[1]).padStart(4)}` : '   none    ');
  console.log('Measured timing windows (ms; − early, + late) from strike() physics, against TIMING_BANDS (±).');
  let last = '';
  for (const r of out) {
    if (r.case !== last) {
      console.log(`\n${r.case}`);
      console.log('  level   perfect (sweet spot)   solid (middle)        edge (any bat)        bands ±p/±s/±e');
      last = r.case;
    }
    const b = r.bands;
    console.log(`  ${r.assist.padEnd(6)}  ${fmt(r.perfect)}          ${fmt(r.solid)}          ${fmt(r.edge)}          ${b.perfectMs}/${b.solidMs}/${b.edgeMs}`);
  }
}
