#!/usr/bin/env node
/**
 * Practice release-gate properties, rerunnable by one command (release/player-experience rubric):
 *
 *   FAIR6  exploit search: every fixed input of the grid (stroke families by direction, elevation, power and
 *          footwork; always defend; always leave) over random Club overs on every pitch, at perfect timing (σ 0) and
 *          expert timing (σ 20 ms). Reports the best fixed inputs by boundaries and runs per over, and their
 *          dismissal rates.
 *          FAIR6's second clause: coach-recommended play (src/practice/coach) against the best fixed input.
 *   EX5    skill gradient: an expert policy (the coach's recommended shot, timing σ 20 ms) against a rookie (σ 60 ms,
 *          intent ignoring the ball) and random input, at Club and Expert.
 *   EX6    gaps matter: the same stroke aimed into a gap of fieldIntent against one aimed at a protected fielder.
 *   EX7    for each reference-over ball, the best fixed input; no input may be best on 4 or more of the six.
 *   EX9    the delivery-parameter distributions per difficulty (lengths, lines, bad balls).
 *
 *   --only=fair6,ex5,ex6,ex7,ex9 runs a subset (all by default).
 *
 *   node scripts/practice-properties.mjs                     # screen on 30 overs, confirm the top 12 on 100
 *   nice -n 15 node scripts/practice-properties.mjs --overs=100 --innings=100 --screen=40 --top=20 --workers=2 --assist=play
 *   node scripts/practice-properties.mjs --json=out.json
 *
 * Deterministic in its arguments. Loads the TypeScript sources natively through scripts/simulate-loader.mjs.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fair6CoachComparison } from './practice-properties-method.mjs';
import './simulate-loader.mjs';

const E = await import('../src/practice/game/evaluate.ts');

async function work({ intents, overs, innings, difficulty, sigma, assist, key }) {
  if (innings) {
    const sequences = E.evalInnings({ difficulty, innings, key, assist });
    return intents.map((intent) => ({ intent, innings: E.playInnings(sequences, E.fixedPolicy(intent, sigma, key), assist) }));
  }
  const balls = E.evalOvers({ difficulty, overs, key, assist });
  return intents.map((intent) => ({ intent, stats: E.playPolicy(balls, E.fixedPolicy(intent, sigma, key), assist) }));
}

/** The coach's recommended response to every ball of `overs` overs (intent only; timing is the policy's). */
async function coachWork({ overs, innings, sigmas = [0], difficulty, assist, key, part, parts }) {
  const C = await import('../src/practice/coach/index.ts');
  const { PRACTICE_SIM_VERSION } = await import('../src/contracts/practice.ts');
  const recommend = (b) => {
    const record = { version: PRACTICE_SIM_VERSION, overIndex: b.overIndex, ballIndex: b.ballIndex, bowler: b.over.bowler, plan: b.flight.plan, seed: b.seed, conditions: b.conditions, ball: b.over.ball, field: b.field, handedness: 'right', assist, tierToleranceMs: 0, swing: null, runs: 0, dismissal: null };
    const an = C.analyzeBall(record);
    const rec = an.options.find((x) => x.kind === 'recommended') ?? an.options[0];
    const sw = rec?.swing;
    return sw ? { kind: sw.kind, directionDeg: sw.directionDeg, elevation: sw.elevation, power: sw.power, footwork: sw.footwork } : null;
  };
  if (innings) {
    const sequences = E.evalInnings({ difficulty, innings, key, assist });
    // Lazy recommendations stop at dismissal: no future delivery can influence this innings' choices.
    const choices = new Map();
    return Object.fromEntries(sigmas.map((sigma) => [sigma, E.playInnings(sequences, (b) => {
      if (!choices.has(b.seed)) choices.set(b.seed, recommend(b));
      return { intent: choices.get(b.seed), errorMs: sigma * E.gaussian(`${key}|${b.over.seed}|${b.ballIndex}`) };
    }, assist)]));
  }
  const balls = E.evalOvers({ difficulty, overs, key, assist });
  const out = [];
  balls.forEach((o, oi) => {
    if (oi % parts !== part) return;
    for (const b of o) {
      out.push({ key: `${oi}|${b.ballIndex}`, intent: recommend(b) });
    }
  });
  return out;
}

if (!isMainThread) {
  parentPort.postMessage(workerData.coach ? await coachWork(workerData) : await work(workerData));
} else {
  const arg = (name, def) => {
    const a = process.argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : def;
  };
  const OVERS = Number(arg('overs', 100));
  const INNINGS = Number(arg('innings', 100));
  const SCREEN = Number(arg('screen', 30));
  const TOP = Number(arg('top', 12));
  const WORKERS = Number(arg('workers', Math.max(1, Math.min(2, availableParallelism() - 1))));
  const ASSIST = arg('assist', 'play');
  const KEY = arg('key', 'vande-properties');
  const JSON_OUT = arg('json', null);
  const DIFFS = arg('difficulty', 'club,expert').split(',');
  const SIGMAS = arg('sigma', '0,20').split(',').map(Number);
  const ONLY = new Set(arg('only', 'fair6,ex5,ex6,ex7,ex9').split(','));
  for (const [name, value] of Object.entries({ OVERS, INNINGS, SCREEN, TOP, WORKERS })) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  }
  if (WORKERS > 2) throw new Error('Shared-machine limit: --workers must be at most 2');
  if (!['learn', 'play', 'real'].includes(ASSIST)) throw new Error('Unknown assistance level');
  if (DIFFS.some((x) => !['beginner', 'club', 'expert'].includes(x))) throw new Error('Unknown difficulty');
  if (SIGMAS.some((x) => !Number.isFinite(x) || x < 0)) throw new Error('Timing sigma must be finite and nonnegative');
  if ([...ONLY].some((x) => !['fair6', 'ex5', 'ex6', 'ex7', 'ex9'].includes(x))) throw new Error('Unknown property');
  const SCREEN_KEY = `${KEY}|screen`;
  const CONFIRM_KEY = `${KEY}|confirm`;
  const INNINGS_KEY = `${KEY}|held-out-innings`;
  const commandOutput = (command, args = []) => { try { return execFileSync(command, args, { encoding: 'utf8' }).trim(); } catch { return 'unavailable'; } };
  const buildId = () => commandOutput('bash', ['scripts/build-id.sh']);

  const pool = (intents, opts) => {
    const n = Math.min(WORKERS, intents.length);
    const chunks = Array.from({ length: n }, (_, i) => intents.filter((_, k) => k % n === i));
    return Promise.all(chunks.map((c) => new Promise((res, rej) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { ...opts, intents: c } });
      w.once('message', res);
      w.once('error', rej);
    }))).then((r) => r.flat());
  };
  /** Screening heuristic only. Final expected-runs comparisons use actual held-out stopped innings below. */
  const screeningInningsEstimate = (x) => {
    const r = x.runs / Math.max(1, x.balls);
    const q = Math.max(1e-9, x.dismissalsPerBall);
    return (r * (1 - Math.pow(1 - q, 60))) / q;
  };
  const fmt = (s) => `${s.runsPerOver.toFixed(2).padStart(6)} r/o ${s.boundariesPerOver.toFixed(2).padStart(5)} b/o (${(s.sixes / s.overs).toFixed(2)} 6s) out/ball ${(100 * s.dismissalsPerBall).toFixed(1).padStart(5)}% out/over ${(100 * s.dismissalRatePerOver).toFixed(0).padStart(3)}%`;
  const report = { evidence: { startedAtUtc: new Date().toISOString(), buildIdStart: buildId(), uptimeStart: commandOutput('uptime'), runtime: `${process.platform} ${process.arch} Node ${process.version}`, command: process.argv, method: 'Deterministic physics policy simulation; AI engineering evidence, no human participants', independentCertification: false }, args: { OVERS, INNINGS, SCREEN, TOP, WORKERS, ASSIST, KEY, DIFFS, SIGMAS, ONLY: [...ONLY] }, sampling: { screenKey: SCREEN_KEY, confirmationKey: CONFIRM_KEY, inningsKey: INNINGS_KEY, inningsCapBalls: 60, inningsPitch: 'fixed within each innings; balanced, green, hard, turning cycled between innings' }, fair6: {}, ex5: {}, ex6: {}, ex7: null, ex9: {} };
  const t0 = Date.now();
  const grid = E.fixedInputGrid();
  let fail = false;
  const aerialFielding = ONLY.has('ex6') ? E.evaluateAerialFielding() : null;
  if (aerialFielding) console.log(`EX6 aerial mechanism · ${aerialFielding.eligible}/${aerialFielding.total} geometrically eligible flights: catches in gap ${aerialFielding.gapCatches}, protected ${aerialFielding.protectedCatches} → ${aerialFielding.pass ? 'PASS' : 'FAIL'}`);
  for (const difficulty of ONLY.has('fair6') ? DIFFS : []) {
    for (const sigma of SIGMAS) {
      const screened = await pool(grid, { overs: SCREEN, difficulty, sigma, assist: ASSIST, key: SCREEN_KEY });
      const ranked = [...screened].sort((a, b) => b.stats.boundariesPerOver - a.stats.boundariesPerOver || b.stats.runsPerOver - a.stats.runsPerOver);
      const byRuns = [...screened].sort((a, b) => b.stats.runsPerOver - a.stats.runsPerOver);
      const byInnings = [...screened].sort((a, b) => screeningInningsEstimate(b.stats) - screeningInningsEstimate(a.stats));
      const bySafety = [...screened].filter((x) => x.stats.runsPerOver >= 1).sort((a, b) => a.stats.dismissalsPerBall - b.stats.dismissalsPerBall);
      const keep = new Map();
      for (const x of [...ranked.slice(0, TOP), ...byRuns.slice(0, TOP), ...byInnings.slice(0, TOP), ...bySafety.slice(0, TOP)]) keep.set(E.intentLabel(x.intent), x.intent);
      for (const x of bySafety) if (x.stats.dismissalsPerBall < 0.1) keep.set(E.intentLabel(x.intent), x.intent);
      for (const x of screened) if (!x.intent || x.intent.kind === 'defend') keep.set(E.intentLabel(x.intent), x.intent);
      const confirmed = await pool([...keep.values()], { overs: OVERS, difficulty, sigma, assist: ASSIST, key: CONFIRM_KEY });
      confirmed.sort((a, b) => b.stats.boundariesPerOver - a.stats.boundariesPerOver || b.stats.runsPerOver - a.stats.runsPerOver);
      const attack = confirmed.filter((x) => x.intent && x.intent.kind === 'attack');
      const best = attack[0];
      const bestRuns = [...attack].sort((a, b) => b.stats.runsPerOver - a.stats.runsPerOver)[0];
      const sampledInnings = await pool([...keep.values()], { innings: INNINGS, difficulty, sigma, assist: ASSIST, key: INNINGS_KEY });
      const bestInn = [...sampledInnings].sort((a, b) => b.innings.meanRuns - a.innings.meanRuns)[0];
      const defend = confirmed.filter((x) => x.intent && x.intent.kind === 'defend').sort((a, b) => a.stats.dismissalsPerBall - b.stats.dismissalsPerBall);
      const leave = confirmed.find((x) => !x.intent);
      console.log(`\nFAIR6 · ${difficulty} overs × ${OVERS} (screened ${grid.length} inputs on ${SCREEN}) · timing σ ${sigma} ms · ${ASSIST}`);
      for (const x of confirmed.slice(0, 8)) console.log(`  ${E.intentLabel(x.intent).padEnd(34)} ${fmt(x.stats)}`);
      console.log(`  best by runs:  ${E.intentLabel(bestRuns.intent).padEnd(34)} ${fmt(bestRuns.stats)}`);
      console.log(`  best innings:  ${E.intentLabel(bestInn.intent).padEnd(34)} ${bestInn.innings.meanRuns.toFixed(2)} runs across ${INNINGS} held-out one-wicket capped innings; ${bestInn.innings.dismissals} dismissals`);
      for (const d of defend) console.log(`  ${E.intentLabel(d.intent).padEnd(34)} ${fmt(d.stats)}`);
      console.log(`  ${'leave'.padEnd(34)} ${fmt(leave.stats)}`);
      const clauses = E.fixedInputClauses(confirmed.map((x) => x.stats));
      const violations = confirmed.filter((x) => x.stats.runsPerOver >= 1 && x.stats.dismissalsPerBall < 0.1);
      if (!clauses.boundaryPass || !clauses.productiveDismissalPass) fail = true;
      console.log(`  → boundaries < 2/over: ${clauses.boundaryPass ? 'PASS' : 'FAIL'}; productive fixed-input dismissal ≥ 10%/ball: ${clauses.productiveDismissalPass ? 'PASS' : 'FAIL'} (${violations.length} violating inputs)`);
      for (const x of violations.slice(0, 3)) console.log(`    safe productive input: ${E.intentLabel(x.intent)} ${fmt(x.stats)}`);
      report.fair6[`${difficulty}/σ${sigma}`] = { clauses, sampleAdequacyPass: OVERS >= 100 && INNINGS >= 100, screenedInputs: screened.length, confirmedInputs: confirmed.length, best: { intent: best.intent, stats: best.stats }, bestRuns: { intent: bestRuns.intent, stats: bestRuns.stats }, bestInnings: bestInn, productiveDismissalViolations: violations, defend, leave: leave.stats, top: confirmed.slice(0, 20) };
    }
  }
  // EX5 and FAIR6's coach clause: policies over the same overs.
  if (ONLY.has('fair6') || ONLY.has('ex5') || ONLY.has('ex6')) {
    for (const difficulty of DIFFS) {
      const overs = E.evalOvers({ difficulty, overs: OVERS, key: CONFIRM_KEY, assist: ASSIST });
      const parts = Math.max(1, WORKERS);
      const chunks = await Promise.all(Array.from({ length: parts }, (_, part) => new Promise((res, rej) => {
        const w = new Worker(new URL(import.meta.url), { workerData: { coach: true, overs: OVERS, difficulty, assist: ASSIST, key: CONFIRM_KEY, part, parts } });
        w.once('message', res);
        w.once('error', rej);
      })));
      const rec = new Map(chunks.flat().map((x) => [x.key, x.intent]));
      const coachIntent = (b) => rec.get(`${b.overIndex}|${b.ballIndex}`) ?? null;
      const gauss = (k) => E.gaussian(`${KEY}|${k}`);
      const policies = {
        'coach σ0': (b) => ({ intent: coachIntent(b), errorMs: 0 }),
        'expert σ20': (b) => ({ intent: coachIntent(b), errorMs: 20 * gauss(`ex|${b.over.seed}|${b.ballIndex}`) }),
        'rookie σ60': (b) => {
          const r = (n) => (E.gaussian(`${KEY}|rk${n}|${b.over.seed}|${b.ballIndex}`) + 3) / 6;
          return { intent: { kind: 'attack', directionDeg: -60 + 120 * Math.min(1, Math.max(0, r(1))), elevation: 0.6 * Math.min(1, Math.max(0, r(2))), power: 0.5 + 0.5 * Math.min(1, Math.max(0, r(3))), footwork: 'auto' }, errorMs: 60 * gauss(`rk|${b.over.seed}|${b.ballIndex}`) };
        },
        random: (b) => {
          const u = (n) => Math.min(1, Math.max(0, (E.gaussian(`${KEY}|rn${n}|${b.over.seed}|${b.ballIndex}`) + 3) / 6));
          const k = u(0);
          const kind = k < 0.15 ? null : k < 0.3 ? 'defend' : 'attack';
          const fw = ['auto', 'forward', 'back', 'across'][Math.min(3, Math.floor(u(5) * 4))];
          return { intent: kind ? { kind, directionDeg: -180 + 360 * u(1), elevation: u(2), power: u(3), footwork: fw } : null, errorMs: -150 + 300 * u(4) };
        },
      };
      if (ONLY.has('ex5')) {
        console.log(`\nEX5 · ${difficulty} overs × ${OVERS} · ${ASSIST}`);
        const st = {};
        for (const [name, pol] of Object.entries(policies)) {
          st[name] = E.playPolicy(overs, pol, ASSIST);
          console.log(`  ${name.padEnd(12)} ${fmt(st[name])}  boundary share ${((100 * (st[name].fours + st[name].sixes)) / st[name].balls).toFixed(1)}% of balls, a wicket every ${(st[name].balls / Math.max(1, st[name].dismissals)).toFixed(0)} balls`);
        }
        const ex = st['expert σ20'];
        const okR = ex.runsPerOver >= 2 * st['rookie σ60'].runsPerOver && ex.dismissalsPerBall <= 0.5 * st['rookie σ60'].dismissalsPerBall;
        const okN = ex.runsPerOver >= 2 * st.random.runsPerOver && ex.dismissalsPerBall <= 0.5 * st.random.dismissalsPerBall;
        console.log(`  → expert vs rookie ${(ex.runsPerOver / Math.max(0.01, st['rookie σ60'].runsPerOver)).toFixed(2)}× runs, ${(ex.dismissalsPerBall / Math.max(1e-9, st['rookie σ60'].dismissalsPerBall)).toFixed(2)}× outs; vs random ${(ex.runsPerOver / Math.max(0.01, st.random.runsPerOver)).toFixed(2)}× runs, ${(ex.dismissalsPerBall / Math.max(1e-9, st.random.dismissalsPerBall)).toFixed(2)}× outs: ${okR && okN ? 'PASS' : 'FAIL'}`);
        if (!(okR && okN)) fail = true;
        report.ex5[difficulty] = { policies: st, clauses: { expertVsRookiePass: okR, expertVsRandomPass: okN }, pass: okR && okN };
      }
      if (ONLY.has('fair6')) {
        console.log(`\nFAIR6 coach · ${difficulty}: evaluating ${INNINGS} held-out capped innings at σ ${SIGMAS.join(', ')} ms`);
        const coachBySigma = await new Promise((res, rej) => {
          const worker = new Worker(new URL(import.meta.url), { workerData: { coach: true, innings: INNINGS, sigmas: SIGMAS, difficulty, assist: ASSIST, key: INNINGS_KEY } });
          worker.once('message', res);
          worker.once('error', rej);
        });
        for (const sigma of SIGMAS) {
          const result = report.fair6[`${difficulty}/σ${sigma}`];
          const coachPerBall = E.playPolicy(overs, (b) => ({ intent: coachIntent(b), errorMs: sigma * E.gaussian(`${CONFIRM_KEY}|${b.over.seed}|${b.ballIndex}`) }), ASSIST);
          const coachInnings = coachBySigma[sigma];
          const fixed = result.bestInnings.innings;
          const comparison = fair6CoachComparison(coachInnings, fixed);
          const { coachComparisonEvidencePass, expectedRunsPass, noMoreDismissalsPass } = comparison;
          result.coach = { perBall: coachPerBall, innings: coachInnings, inningsRunsRatio: coachInnings.meanRuns / Math.max(1e-9, fixed.meanRuns), rawRunsPerOverRatioDiagnostic: coachPerBall.runsPerOver / Math.max(1e-9, result.bestRuns.stats.runsPerOver), dismissalComparison: comparison };
          Object.assign(result.clauses, { coachComparisonEvidencePass, expectedRunsPass, noMoreDismissalsPass });
          result.pass = Object.entries(result.clauses).filter(([key]) => key.endsWith('Pass')).every(([, value]) => value) && result.sampleAdequacyPass;
          if (!result.pass) fail = true;
          const coachRate = comparison.coach.dismissalsPerBall === null ? 'invalid' : `${(100 * comparison.coach.dismissalsPerBall).toFixed(3)}%/ball`;
          const fixedRate = comparison.fixed.dismissalsPerBall === null ? 'invalid' : `${(100 * comparison.fixed.dismissalsPerBall).toFixed(3)}%/ball`;
          console.log(`\nFAIR6 coach · ${difficulty} σ${sigma}: actual capped innings ${coachInnings.meanRuns.toFixed(2)} vs best fixed ${fixed.meanRuns.toFixed(2)} runs (${result.coach.inningsRunsRatio.toFixed(2)}×): ${expectedRunsPass ? 'PASS' : 'FAIL'}; dismissal evidence ${coachInnings.dismissals}/${coachInnings.balls} (${coachRate}) vs ${fixed.dismissals}/${fixed.balls} (${fixedRate}): ${coachComparisonEvidencePass && noMoreDismissalsPass ? 'PASS' : 'FAIL'}; complete FAIR6: ${result.pass ? 'PASS' : 'FAIL'}`);
        }
      }
      // EX6: the coach's stroke aimed into the nearest gap against the same stroke aimed at the nearest protected fielder.
      if (ONLY.has('ex6')) {
        const P = await import('../src/physics/index.ts');
        const simpleBucket = () => ({ n: 0, runs: 0, scoring: 0, catches: 0, byRuns: {} });
        const bucket = () => ({ ...simpleBucket(), byDepth: {}, contacts: {}, byStroke: { ground: simpleBucket(), lofted: simpleBucket() }, loftedSamples: [] });
        const g = bucket();
        const p = bucket();
        for (const o of overs)
          for (const b of o) {
            const it = coachIntent(b);
            if (!it || it.kind !== 'attack') continue;
            const fi = P.fieldIntent(b.field, b.over.bowler, b.conditions);
            const lofted = it.elevation > 0.3;
            const mid = (a) => (a.fromDeg + a.toDeg) / 2;
            const gaps = fi.gaps.filter((x) => (lofted ? x.depth === 'deep' : true) && x.toDeg - x.fromDeg >= 6);
            const prot = fi.protected.filter((x) => x.depth === (lofted ? 'deep' : 'ring'));
            const near = (arcs) => arcs.map((a) => ({ a, d: Math.abs(P.bearingDelta(mid(a), it.directionDeg)) })).filter((x) => x.d <= 35).sort((x, y) => x.d - y.d)[0]?.a;
            // Only aims inside the same stroke (shot family) as the coach's: only the direction differs, not the reach.
            const S = await import('../src/physics/shot.ts');
            const fw = it.footwork === 'auto' ? P.resolveFootwork(b.flight, 'auto') : it.footwork;
            const fam = S.shotFamily(it.kind, it.directionDeg, fw);
            const same = (arcs) => arcs.filter((a) => S.shotFamily(it.kind, mid(a), fw) === fam);
            const ga = near(same(gaps));
            const pa = near(same(prot));
            if (!ga || !pa) continue;
            for (const [arc, acc] of [[ga, g], [pa, p]]) {
              const r = E.playBall(b, { ...it, directionDeg: mid(arc) }, 0, ASSIST);
              acc.n++;
              acc.runs += r.outcome.runs;
              if (r.outcome.runs > 0) acc.scoring++;
              if (r.outcome.dismissal === 'caught' || r.outcome.dismissal === 'caught_behind') acc.catches++;
              acc.byRuns[r.outcome.runs] = (acc.byRuns[r.outcome.runs] ?? 0) + 1;
              acc.byDepth[arc.depth] = (acc.byDepth[arc.depth] ?? 0) + 1;
              acc.contacts[r.contact.kind] = (acc.contacts[r.contact.kind] ?? 0) + 1;
              const byStroke = acc.byStroke[lofted ? 'lofted' : 'ground'];
              byStroke.n++;
              byStroke.runs += r.outcome.runs;
              if (r.outcome.runs > 0) byStroke.scoring++;
              if (r.outcome.dismissal === 'caught' || r.outcome.dismissal === 'caught_behind') byStroke.catches++;
              byStroke.byRuns[r.outcome.runs] = (byStroke.byRuns[r.outcome.runs] ?? 0) + 1;
              if (lofted) acc.loftedSamples.push({ ball: b.flight.plan, originalDirectionDeg: it.directionDeg, aimDeg: mid(arc), arc, exitBearingDeg: r.contact.exitBearingDeg, exitElevationDeg: r.contact.exitElevationDeg, exitSpeedKph: r.contact.exitSpeedKph, contact: r.contact.kind, runs: r.outcome.runs, dismissal: r.outcome.dismissal, fielderId: r.outcome.fielderId });
            }
          }
        const rps = (x) => x.runs / Math.max(1, x.scoring);
        const rpb = (x) => x.runs / Math.max(1, x.n);
        const cr = (x) => x.catches / Math.max(1, x.n);
        const groundGap = g.byStroke.ground;
        const groundProtected = p.byStroke.ground;
        const groundedSamplePass = groundGap.n > 0 && groundProtected.n > 0 && groundProtected.scoring > 0;
        const groundedRunsPass = groundedSamplePass && rps(groundGap) >= 1.5 * rps(groundProtected);
        const groundedCatchPass = groundedSamplePass && cr(groundGap) <= 0.5 * cr(groundProtected);
        const pass = groundedRunsPass && groundedCatchPass && aerialFielding.pass;
        // These arcs are defined for a ground stroke. Preserve aerial observations without relabelling them as
        // verified aerial protection. The independent paired-placement mechanism test supplies that comparison.
        const lofted = { mechanism: aerialFielding, groundArcDiagnostic: { gaps: g.byStroke.lofted, protected: p.byStroke.lofted, comparisonRatio: cr(g.byStroke.lofted) / Math.max(1e-9, cr(p.byStroke.lofted)), status: 'DIAGNOSTIC_ONLY', reason: 'fieldIntent protected arcs describe ground interception, not aerial catch opportunity' } };
        console.log(`\nEX6 · ${difficulty} grounded: ${groundGap.n} paired shots, gap ${rps(groundGap).toFixed(2)} vs protected ${rps(groundProtected).toFixed(2)} runs/scoring shot (${(rps(groundGap) / Math.max(1e-9, rps(groundProtected))).toFixed(2)}×); catches ${groundGap.catches} vs ${groundProtected.catches}: ${pass ? 'PASS' : 'FAIL'}`);
        console.log(`  Lofted mechanism ${aerialFielding.pass ? 'PASS' : 'FAIL'}: catch-risk ratio ${(aerialFielding.gapCatches / Math.max(1, aerialFielding.protectedCatches)).toFixed(2)}; ground-arc aerial observations remain diagnostic only`);
        if (!pass) fail = true;
        report.ex6[difficulty] = { pass, clauses: { groundedSamplePass, groundedRunsPass, groundedCatchPass, aerialCatchRiskPass: aerialFielding.pass }, grounded: { gaps: groundGap, protected: groundProtected, runsPerScoringShotRatio: rps(groundGap) / Math.max(1e-9, rps(groundProtected)), runsPerAttemptRatio: rpb(groundGap) / Math.max(1e-9, rpb(groundProtected)) }, lofted, aggregateDiagnostic: { gaps: g, protected: p } };
      }
    }
  }
  // EX7: the best fixed input per reference ball (perfect timing).
  if (ONLY.has('ex7')) {
    const G = await import('../src/practice/game/index.ts');
    const P = await import('../src/physics/index.ts');
    const balls = E.overBalls(G.REFERENCE_OVER, G.REFERENCE_CONDITIONS);
    const value = (r) => (r.outcome.dismissal ? -10 : r.outcome.runs + (r.contact.kind === 'middle' ? 0.25 : 0));
    const score = grid.map((intent) => ({ intent, v: balls.map((b) => value(E.playBall(b, intent, 0, ASSIST))) }));
    const bestPer = balls.map((_, i) => Math.max(...score.map((s) => s.v[i])));
    let worst = { intent: null, n: 0 };
    for (const s of score) {
      const n = s.v.filter((v, i) => v >= bestPer[i] - 1e-9).length;
      if (n > worst.n) worst = { intent: s.intent, n };
    }
    console.log(`\nEX7 · reference over: the most balls one fixed input is (joint) best on: ${worst.n} (${E.intentLabel(worst.intent)}) → ${worst.n >= 4 ? 'FAIL' : 'PASS'}`);
    if (worst.n >= 4) fail = true;
    report.ex7 = { bestPerBall: bestPer, worst, pass: worst.n < 4 };
    void P;
  }
  // EX9: the delivery-parameter distributions by difficulty.
  if (ONLY.has('ex9')) {
    const G = await import('../src/practice/game/index.ts');
    console.log('\nEX9 · random-over deliveries by difficulty (400 overs each): share of balls');
    for (const difficulty of ['beginner', 'club', 'expert']) {
      const c = { n: 0, yorker: 0, full: 0, good: 0, short: 0, bouncer: 0, wideOff: 0, pads: 0, channel: 0, change: 0 };
      for (let i = 0; i < 400; i++) {
        const over = G.randomOver({ seed: `${KEY}|ex9|${i}`, conditions: E.PITCH_LIST[i % 4], assist: ASSIST, difficulty });
        for (const b of over.balls) {
          c.n++;
          c[G.lengthBand(b.lengthM, over.bowler.family)]++;
          if (b.lineM > 0.35) c.wideOff++;
          if (b.lineM < -0.12) c.pads++;
          if (b.lineM >= 0.04 && b.lineM <= 0.25) c.channel++;
          if (G.variationSpec(over.bowler.family, b.variation)?.kind === 'change') c.change++;
        }
      }
      const pct = (k) => `${k} ${((100 * c[k]) / c.n).toFixed(0)}%`;
      console.log(`  ${difficulty.padEnd(9)} ${['yorker', 'full', 'good', 'short', 'bouncer', 'channel', 'wideOff', 'pads', 'change'].map(pct).join('  ')}`);
      report.ex9[difficulty] = c;
    }
  }
  report.evidence.finishedAtUtc = new Date().toISOString();
  report.evidence.buildIdEnd = buildId();
  report.evidence.treeChangedDuringRun = report.evidence.buildIdStart !== report.evidence.buildIdEnd;
  report.evidence.uptimeEnd = commandOutput('uptime');
  report.evidence.elapsedSeconds = (Date.now() - t0) / 1000;
  report.pass = !fail;
  report.limitations = ['Bounded fixed-input grid search, not a proof over all possible gestures', 'EX6 aerial experiment isolates catch opportunity with one test fielder plus keeper/bowler; it is not an eleven-player-field population claim', 'Automated evidence does not certify a human experience score'];
  console.log(`\n${report.evidence.elapsedSeconds.toFixed(0)} s · ${fail ? 'FAIL' : 'PASS'} · uptime ${report.evidence.uptimeEnd}`);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
  if (fail) process.exitCode = 1;
}
