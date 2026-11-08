#!/usr/bin/env node
/**
 * Cover-drive P1 scenario (docs/prompts/VANDE-COVER-DRIVE-PROMPT.md §6 P1, §8, Appendix B).
 *
 * TypeScript stays authoritative: every case is flown and resolved by the production Practice engine, exactly as
 * scripts/practice-unity-goldens.mjs does, and the canonical Unity wire packets are produced by the production
 * contract code. Nothing here decides an outcome.
 *
 * The fixed scenario: ref-1 (reference over, seed derived as in play), Real mode, right-handed, a new white ball, the
 * default (auto) field, the balanced pitch, batter on middle guard at the crease. One physical gesture (a grounded
 * attack at +55°, inside the 35–75° cover-drive band, footwork auto) is shifted in time so that the normalized swing
 * reaches the contact zone `offsetMs` from ideal. The input offset is the only variable of the main scenario. The
 * secondary scenarios (prompt §8: wrong ball, speeds) change only the named delivery field and keep the same gesture
 * and offset rule.
 *
 *   node scripts/cover-drive/scenario.mjs --out <dir>            write scenario.json, physics-telemetry.jsonl, summary.json
 *   node scripts/cover-drive/scenario.mjs --out <dir> --cases ideal,early-60   only the named cases
 *
 * Every output is deterministic for a given source tree: no wall-clock time, host name or random value is written
 * into the content files. The build id and the UTC time go into run-meta.json, which is never part of a digest.
 */
import '../simulate-loader.mjs';

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

const contracts = await import('../../src/contracts/practice.ts');
const unityContracts = await import('../../src/contracts/unityPractice.ts');
const physics = await import('../../src/physics/index.ts');
const input = await import('../../src/input/normalize.ts');
const practice = await import('../../src/practice/game/index.ts');
const { batAt } = await import('../../src/render3d/practice/frame.ts');

const { PRACTICE_SIM_VERSION } = contracts;
const { makeUnityPracticeMessage, packUnityPracticeMessage, unityPracticeReplayDigest, UNITY_PRACTICE_CONTRACT_VERSION } = unityContracts;
const { autoField, batTravelMs, fieldIntention, flight, replayDelivery, resolveDelivery, sampleAt } = physics;
const { normalizeGesture } = input;
const { REFERENCE_BALL, REFERENCE_BALLS, REFERENCE_CONDITIONS, REFERENCE_OVER, ballSeed } = practice;

export const SCENARIO_ID = 'cover-drive-p1-ref1-real-rh-v1';
const FRAME_HZ = 60;
const RELEASE_PERF_MS = 10_000;
const SURFACE = Object.freeze({ width: 915, height: 190 });
const START = Object.freeze({ x: 457.5, y: 170 });
/** The one physical gesture: grounded, +55° (off side), 120 px in 95 ms, footwork auto. */
export const GESTURE = Object.freeze({ bearingDeg: 55, lengthPx: 120, durationMs: 95, footwork: 'auto' });
const BAT_CONTACT_KINDS = new Set(['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge', 'toe', 'shoulder']);

/** Files whose content decides the scenario's outcome; their hashes travel with every run (determinism scope). */
const SOURCE_DIRS = ['src/physics', 'src/input', 'src/practice/game', 'src/contracts'];
const SOURCE_FILES = ['src/render3d/practice/frame.ts', 'scripts/cover-drive/scenario.mjs', 'scripts/simulate-loader.mjs'];

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`non-finite number: ${String(value)}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) if (value[key] !== undefined) out[key] = canonicalValue(value[key]);
    return out;
  }
  throw new TypeError(`unsupported value: ${typeof value}`);
}
export const canonicalJson = (value) => JSON.stringify(canonicalValue(value));
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const digest = (value) => sha256(canonicalJson(value));

function listFiles(relative) {
  const abs = path.join(repoRoot, relative);
  const out = [];
  for (const name of readdirSync(abs).sort()) {
    const child = path.join(relative, name);
    const st = statSync(path.join(repoRoot, child));
    if (st.isDirectory()) out.push(...listFiles(child));
    else if (/\.(ts|mjs|js)$/.test(name)) out.push(child);
  }
  return out;
}

export function sourceHashes() {
  const files = [...SOURCE_DIRS.flatMap(listFiles), ...SOURCE_FILES].sort();
  const hashes = Object.fromEntries(files.map((file) => [file, sha256(readFileSync(path.join(repoRoot, file)))]));
  return { files: hashes, combined: digest(hashes) };
}

function gestureSamples(t0) {
  const r = (GESTURE.bearingDeg * Math.PI) / 180;
  const dx = Math.sin(r) * GESTURE.lengthPx;
  const dy = -Math.cos(r) * GESTURE.lengthPx;
  const d = GESTURE.durationMs;
  return {
    pointer: 'touch',
    surface: SURFACE,
    footwork: GESTURE.footwork,
    samples: [
      { t: t0, ...START },
      { t: t0 + 5, ...START },
      { t: t0 + 15, x: START.x + dx * 0.08, y: START.y + dy * 0.08 },
      { t: t0 + d * 0.55, x: START.x + dx * 0.68, y: START.y + dy * 0.68 },
      { t: t0 + d, x: START.x + dx, y: START.y + dy },
    ],
  };
}

/** Shift the one gesture so the swing reaches contact `offsetMs` from ideal (− early, + late). Timing only. */
function timedGesture(flightValue, offsetMs) {
  const seed = gestureSamples(10_000);
  const first = normalizeGesture(seed, { releasePerfMs: 0, calibrationMs: 0, handedness: 'right' });
  if (!first) throw new Error('scenario gesture did not normalize');
  const targetStartT = flightValue.idealContactT - batTravelMs(first.kind, first.power) / 1000 + offsetMs / 1000;
  const shiftMs = RELEASE_PERF_MS + targetStartT * 1000 - first.startT * 1000;
  const gesture = { ...seed, samples: seed.samples.map((s) => ({ ...s, t: s.t + shiftMs })) };
  const normalize = { releasePerfMs: RELEASE_PERF_MS, calibrationMs: 0, handedness: 'right' };
  const swing = normalizeGesture(gesture, normalize);
  if (!swing) throw new Error('shifted scenario gesture did not normalize');
  return { gesture, normalize, swing, inputTimestampMs: gesture.samples[0].t };
}

/** The case list. `ref` is the reference ball id; `speedKph` overrides only the plan's release speed. */
export function caseSpecs() {
  const specs = [
    { id: 'ideal', ref: 'ref-1', offsetMs: 0, scenario: 5 },
    { id: 'early-60', ref: 'ref-1', offsetMs: -60, scenario: 4 },
    { id: 'early-30', ref: 'ref-1', offsetMs: -30, scenario: 4 },
    { id: 'late-30', ref: 'ref-1', offsetMs: 30, scenario: 6 },
    { id: 'late-60', ref: 'ref-1', offsetMs: 60, scenario: 6 },
    { id: 'leave', ref: 'ref-1', offsetMs: null, scenario: 1 },
    { id: 'wrong-ref-3', ref: 'ref-3', offsetMs: 0, scenario: 7 },
    { id: 'wrong-ref-5', ref: 'ref-5', offsetMs: 0, scenario: 7 },
    { id: 'wrong-ref-6', ref: 'ref-6', offsetMs: 0, scenario: 7 },
    { id: 'speed-120', ref: 'ref-1', offsetMs: 0, speedKph: 120, scenario: 8 },
    { id: 'speed-135', ref: 'ref-1', offsetMs: 0, speedKph: 135, scenario: 8 },
    { id: 'speed-150', ref: 'ref-1', offsetMs: 0, speedKph: 150, scenario: 8 },
  ];
  for (let offset = -120; offset <= 120; offset += 5) {
    specs.push({ id: `sweep${offset < 0 ? 'm' : 'p'}${String(Math.abs(offset)).padStart(3, '0')}`, ref: 'ref-1', offsetMs: offset, scenario: 'D1' });
  }
  return specs;
}

function delivery(spec) {
  const index = REFERENCE_BALLS.findIndex((b) => b.id === spec.ref);
  if (index < 0) throw new Error(`unknown reference ball ${spec.ref}`);
  const bowler = REFERENCE_OVER.bowler;
  const plan = spec.speedKph === undefined ? REFERENCE_OVER.balls[index] : { ...REFERENCE_OVER.balls[index], speedKph: spec.speedKph };
  const seed = ballSeed(REFERENCE_OVER, index);
  const handedness = 'right';
  const flightValue = flight({ plan, bowler, conditions: REFERENCE_CONDITIONS, seed, handedness, ball: REFERENCE_BALL });
  return { index, bowler, plan, seed, handedness, flight: flightValue, field: autoField(bowler, REFERENCE_CONDITIONS, handedness, REFERENCE_BALL) };
}

function batContactT(result) {
  const contacts = result.events.filter((e) => e.kind === 'contact' && BAT_CONTACT_KINDS.has(e.contact));
  return contacts[0]?.t ?? null;
}

/** Per-frame physics truth at 60 Hz from release to dead ball (prompt §8 telemetry, the TypeScript half). */
function physicsFrames(spec, d, result, swing, inputValue) {
  const frames = [];
  const impulseT = batContactT(result);
  const motionContactT = result.batterMotion?.contactT ?? null;
  const last = Math.ceil(result.deadT * FRAME_HZ);
  for (let frame = 0; frame <= last; frame++) {
    const t = Math.min(frame / FRAME_HZ, result.deadT);
    const ball = sampleAt(result.ball, t);
    const bat = result.bat.length ? batAt(result.bat, t, impulseT, motionContactT) : null;
    frames.push({
      scenarioId: SCENARIO_ID,
      caseId: spec.id,
      frame,
      traceT: t,
      inputTimestampMs: inputValue?.inputTimestampMs ?? null,
      swing: swing ?? null,
      ball: { p: ball.p, v: ball.v },
      bat: bat ? { grip: bat.grip, toe: bat.toe, face: bat.face } : null,
      contact: result.contact.kind === 'miss' && impulseT === null
        ? { kind: result.contact.kind, t: null, point: null }
        : { kind: result.contact.kind, t: result.contact.t ?? impulseT, point: result.contact.point ?? null },
      batterRootOffset: result.batterRootOffset,
      batterMotion: result.batterMotion,
    });
  }
  return frames;
}

async function makeCase(spec) {
  const d = delivery(spec);
  const inputValue = spec.offsetMs === null ? null : timedGesture(d.flight, spec.offsetMs);
  const swing = inputValue?.swing ?? null;
  const result = resolveDelivery({
    flight: d.flight, swing, field: d.field, bowler: d.bowler, conditions: REFERENCE_CONDITIONS,
    handedness: d.handedness, assist: 'real', tierToleranceMs: 0,
  });
  const record = {
    version: PRACTICE_SIM_VERSION, overIndex: 0, ballIndex: d.index, bowler: d.bowler, plan: d.plan, seed: d.seed,
    conditions: REFERENCE_CONDITIONS, ball: REFERENCE_BALL, field: d.field, handedness: d.handedness, assist: 'real',
    tierToleranceMs: 0, swing, runs: result.outcome.runs, dismissal: result.outcome.dismissal,
  };
  const replay = replayDelivery(record);
  const replayMatches = canonicalJson(replay) === canonicalJson(result);
  const replayDigest = await unityPracticeReplayDigest(record, result);
  const deliveryId = `cover-drive-p1-${spec.id}`;
  const sessionId = 'cover-drive-p1-session';
  const envelope = (sequence, type, payload, scoped = true) => makeUnityPracticeMessage({
    buildId: 'cover-drive-p1', sessionId, deliveryId: scoped ? deliveryId : null,
    messageId: `${deliveryId}-${sequence}-${type}`, sequence, sender: 'host',
  }, type, payload);
  const resolution = {
    record, result,
    score: { runs: result.outcome.runs, wickets: result.outcome.dismissal === null ? 0 : 1, balls: d.index + 1, maxOvers: 10 },
    replayDigest,
  };
  const packets = {
    scene: await packUnityPracticeMessage(envelope(0, 'host.scene', {
      conditions: REFERENCE_CONDITIONS, field: d.field,
      fieldIntent: fieldIntention(d.field, d.bowler, REFERENCE_CONDITIONS), trainingObjective: 'reference',
      bowler: d.bowler, ball: REFERENCE_BALL, handedness: d.handedness,
      batterPosition: { lateralM: 0, creaseOffsetM: 0, guard: 'middle' },
    }, false)),
    delivery: await packUnityPracticeMessage(envelope(1, 'host.delivery', {
      overIndex: 0, ballIndex: d.index, plan: d.plan, seed: d.seed, flight: d.flight,
      presentation: { learnCue: false, coach: null },
    })),
    ...(swing ? { provisionalSwing: await packUnityPracticeMessage(envelope(2, 'host.provisional_swing', {
      atPerfMs: RELEASE_PERF_MS + swing.startT * 1000, calibrationMs: 0, swing,
    })) } : {}),
    result: await packUnityPracticeMessage(envelope(3, 'host.result', resolution)),
  };
  // When the live host can send provisional_swing and result (src/practice/unity/stage.ts 'gesture' → play): the end
  // of the gesture read on the trace clock, with zero bridge latency. A leave is known when the ball reaches the bat.
  const hostSendT = inputValue
    ? (inputValue.gesture.samples.at(-1).t - RELEASE_PERF_MS) / 1000
    : d.flight.idealContactT;
  const c = result.contact;
  const summary = {
    caseId: spec.id, scenario: spec.scenario, referenceBall: spec.ref, offsetMs: spec.offsetMs,
    plan: d.plan, idealContactT: d.flight.idealContactT, swing,
    footwork: result.footwork,
    contact: {
      kind: c.kind, timing: c.timing, t: c.t ?? null, timingErrorMs: c.timingErrorMs ?? null,
      bladeU: c.bladeU ?? null, faceBearingDeg: c.faceBearingDeg ?? null, batSpeedKph: c.batSpeedKph ?? null,
      exitSpeedKph: c.exitSpeedKph ?? null, exitBearingDeg: c.exitBearingDeg ?? null,
      exitElevationDeg: c.exitElevationDeg ?? null, intendedBearingDeg: c.intendedBearingDeg ?? null, point: c.point ?? null,
    },
    outcome: result.outcome,
    events: result.events.map((e) => (e.contact ? `${e.kind}:${e.contact}` : e.kind)),
    batterMotion: result.batterMotion, batterRootOffset: result.batterRootOffset, deadT: result.deadT, hostSendT,
    replayMatchesResult: replayMatches,
    digests: { flight: digest(d.flight), result: digest(result), record: digest(record), replayDigest },
  };
  return {
    summary,
    frames: physicsFrames(spec, d, result, swing, inputValue),
    unity: { caseId: spec.id, deliveryId, gestureInputTimestampMs: inputValue?.inputTimestampMs ?? null, hostSendT, packets },
  };
}

function parseArgs(argv) {
  const out = { out: null, cases: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out.out = path.resolve(argv[++i]);
    else if (argv[i] === '--cases') out.cases = new Set(argv[++i].split(','));
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!out.out) throw new Error('usage: scenario.mjs --out <dir> [--cases a,b]');
  return out;
}

export async function writeScenario(outDir, only = null) {
  mkdirSync(outDir, { recursive: true });
  if (PRACTICE_SIM_VERSION !== 3) throw new Error(`pinned to Practice sim v3; found v${PRACTICE_SIM_VERSION}`);
  const specs = caseSpecs().filter((s) => !only || only.has(s.id));
  const cases = [];
  for (const spec of specs) cases.push(await makeCase(spec));
  const sources = sourceHashes();
  const header = {
    schema: 'vande.cover-drive.p1.scenario.v1', scenarioId: SCENARIO_ID, simulationVersion: PRACTICE_SIM_VERSION,
    unityContractVersion: UNITY_PRACTICE_CONTRACT_VERSION ?? null, frameHz: FRAME_HZ,
    fixed: { referenceOverSeed: REFERENCE_OVER.seed, conditions: REFERENCE_CONDITIONS, ball: REFERENCE_BALL,
      handedness: 'right', assist: 'real', field: 'autoField (default)', batterPosition: { lateralM: 0, creaseOffsetM: 0, guard: 'middle' },
      gesture: GESTURE, releasePerfMs: RELEASE_PERF_MS, calibrationMs: 0 },
    sourceCombinedSha256: sources.combined,
  };
  const files = {
    'scenario.json': `${JSON.stringify(canonicalValue({ ...header, cases: cases.map((c) => c.unity) }))}\n`,
    'summary.json': `${JSON.stringify(canonicalValue({ ...header, cases: cases.map((c) => c.summary) }), null, 1)}\n`,
    'physics-telemetry.jsonl': cases.flatMap((c) => c.frames.map((f) => canonicalJson(f))).join('\n') + '\n',
    'sources.json': `${JSON.stringify(canonicalValue(sources), null, 1)}\n`,
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(outDir, name), text);
  const digests = Object.fromEntries(Object.entries(files).map(([name, text]) => [name, sha256(text)]));
  writeFileSync(path.join(outDir, 'ts-digests.json'), `${JSON.stringify(digests, null, 1)}\n`);
  let buildId = 'NOT_AVAILABLE';
  try {
    buildId = execFileSync('bash', [path.join(repoRoot, 'scripts/build-id.sh')], { encoding: 'utf8' }).trim();
  } catch { /* recorded as NOT_AVAILABLE */ }
  writeFileSync(path.join(outDir, 'run-meta.json'), `${JSON.stringify({ buildId, generatedUtc: new Date().toISOString(),
    node: process.version, cases: specs.length }, null, 1)}\n`);
  return { digests, buildId, cases: cases.map((c) => c.summary), sourcesCombined: sources.combined };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const result = await writeScenario(args.out, args.cases);
  process.stdout.write(`${JSON.stringify({ buildId: result.buildId, sources: result.sourcesCombined, digests: result.digests })}\n`);
}
