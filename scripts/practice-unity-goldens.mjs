#!/usr/bin/env node
/**
 * Practice-v3 oracle fixtures for the React/Unity boundary.
 *
 * TypeScript remains authoritative: every case is flown, resolved and replayed
 * through the production Practice engine. The committed file contains raw input,
 * normalized input, reviewable physical/classification summaries, object digests,
 * and the complete canonical wire packets consumed by the Unity adapter. Keeping
 * the packet body and its SHA-256 together makes this one shared cross-runtime
 * artifact rather than two hand-maintained approximations.
 *
 *   node scripts/practice-unity-goldens.mjs --write
 *   node scripts/practice-unity-goldens.mjs --check
 */
import './simulate-loader.mjs';

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const fixtureFile = path.join(repoRoot, 'tests/fixtures/unity-practice/practice-v3.json');
const reachEvidenceFile = path.join(repoRoot, 'tests/fixtures/unity-practice/reach-proxies-v3.json');

const REACH_SOURCE_FILES = Object.freeze({
  admissibility: 'src/physics/admissibility.ts',
  bat: 'src/physics/bat.ts',
  collision: 'src/physics/collision.ts',
  contact: 'src/physics/contact.ts',
  frame: 'src/render3d/practice/frame.ts',
});
const REACH_FAILURE_ARRAYS = Object.freeze([
  'analyticFailures',
  'exactContactKnotFailures',
  'hiddenWhiffGeometricHits',
  'hitPrefixFailures',
  'invariantFailures',
  'motionAnchorFailures',
  'nonBatCanonicalFailures',
]);

const contracts = await import('../src/contracts/practice.ts');
const unityContracts = await import('../src/contracts/unityPractice.ts');
const physics = await import('../src/physics/index.ts');
const input = await import('../src/input/normalize.ts');
const practice = await import('../src/practice/game/index.ts');

const {
  PRACTICE_SIM_VERSION,
} = contracts;
const {
  UNITY_PRACTICE_TRACE_VERSION,
  makeUnityPracticeMessage,
  packUnityPracticeMessage,
  unityPracticeReplayDigest,
} = unityContracts;
const { batAt } = await import('../src/render3d/practice/frame.ts');
const {
  autoField,
  batTravelMs,
  fieldIntention,
  flight,
  replayDelivery,
  resolveDelivery,
  sampleAt,
} = physics;
const { normalizeGesture } = input;
const {
  REFERENCE_BALL,
  REFERENCE_BALLS,
  REFERENCE_CONDITIONS,
  REFERENCE_OVER,
  ballSeed,
} = practice;

if (PRACTICE_SIM_VERSION !== 3) {
  throw new Error(`Practice Unity golden v3 is pinned to Practice simulation v3; found v${PRACTICE_SIM_VERSION}`);
}

/** JSON-compatible canonical form: sorted object keys, finite numbers, and no negative zero. */
function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`non-finite number in golden payload: ${String(value)}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = canonicalValue(value[key]);
    }
    return out;
  }
  throw new TypeError(`unsupported value in golden payload: ${typeof value}`);
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function digestText(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isDigest(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function requireReachEvidence() {
  if (!existsSync(reachEvidenceFile)) {
    throw new Error(
      `missing ${path.relative(repoRoot, reachEvidenceFile)}; freeze two independent 7,560-case corpus passes before generating practice-v3`,
    );
  }
  const evidence = JSON.parse(readFileSync(reachEvidenceFile, 'utf8'));
  if (evidence?.schema !== 'vande.practice.reach-proxies.v3' || evidence.simulationVersion !== PRACTICE_SIM_VERSION) {
    throw new Error('reach-proxies-v3 has the wrong schema or simulation version');
  }
  if (evidence.passCount !== 2 || evidence.corpus?.expected !== 7_560 ||
      evidence.corpus.completed !== 7_560 || !Array.isArray(evidence.corpus.crashes) || evidence.corpus.crashes.length !== 0) {
    throw new Error('reach-proxies-v3 must come from two complete crash-free 7,560-case passes');
  }
  if (!isDigest(evidence.normalizedSummarySha256) || typeof evidence.gameplayHash !== 'string' ||
      typeof evidence.outcomeHash !== 'string') {
    throw new Error('reach-proxies-v3 is missing deterministic corpus digests');
  }
  for (const [name, relative] of Object.entries(REACH_SOURCE_FILES)) {
    const expected = evidence.sourceSha256?.[name];
    const observed = digestText(readFileSync(path.join(repoRoot, relative), 'utf8'));
    if (!isDigest(expected) || expected !== observed) {
      throw new Error(`reach-proxies-v3 source hash mismatch for ${relative}: expected ${String(expected)}, observed ${observed}`);
    }
  }
  const proxies = evidence.reachProxies;
  const selectedIds = evidence.proxySelection?.ids;
  if (!Array.isArray(proxies) || proxies.length === 0 || !Array.isArray(selectedIds) ||
      selectedIds.length !== proxies.length || new Set(selectedIds).size !== selectedIds.length ||
      selectedIds.some((id, index) => id !== proxies[index]?.id)) {
    throw new Error('reach-proxies-v3 proxySelection ids must uniquely match reachProxies in order');
  }
  for (const proxy of proxies) {
    const motion = proxy?.batterMotion;
    const bodyFrame = proxy?.batterBodyFrame;
    if (typeof proxy?.id !== 'string' || proxy.id.length === 0 || typeof proxy.family !== 'string' ||
        typeof proxy.footwork !== 'string' || !finiteNumber(proxy.contactU) ||
        !finiteNumber(proxy.batterRootOffset?.x) || !finiteNumber(proxy.batterRootOffset?.z) ||
        !finiteNumber(bodyFrame?.stance?.x) || !finiteNumber(bodyFrame?.stance?.z) ||
        !finiteNumber(bodyFrame?.torsoTop?.x) || !finiteNumber(bodyFrame?.torsoTop?.y) ||
        !finiteNumber(bodyFrame?.torsoTop?.z) || !finiteNumber(bodyFrame?.headCentre?.x) ||
        !finiteNumber(bodyFrame?.headCentre?.y) || !finiteNumber(bodyFrame?.headCentre?.z) ||
        !finiteNumber(proxy.batterPosture?.crouchM) || !finiteNumber(motion?.startT) ||
        !finiteNumber(motion?.contactT) || !finiteNumber(motion?.endT) ||
        !(motion.startT < motion.contactT && motion.contactT < motion.endT) ||
        !Array.isArray(proxy.batProbes) || proxy.batProbes.length === 0) {
      throw new Error(`reach-proxies-v3 contains an invalid proxy: ${String(proxy?.id)}`);
    }
  }
  const { reachProxies, ...metadata } = evidence;
  return { metadata, reachProxies };
}

/** jq filter: a corpus summary without its provenance (run time, optional sim-v2 baseline comparison). */
const REACH_NORMALIZE_FILTER = 'del(.generatedAtUtc, .transitionsFromV2, .changedKinds, .changedGameplay, .oldBatContactCases, .oldBatContactKindsChanged, .oldBatContactGameplayChanged)';

function freezeReachEvidence(firstPath, secondPath) {
  const summaries = [firstPath, secondPath].map((file) => JSON.parse(readFileSync(file, 'utf8')));
  // The default 1 MB child-output buffer cannot hold a complete corpus summary (2.8 MB with failure records), and jq
  // then failed with ENOBUFS before any gate ran. No gate or tolerance changes with the buffer.
  // The normalized summary digest covers only what the committed tree reproduces (PHYS2 5f, evaluator eval-phys-5e):
  // the run time and the optional sim-v2 baseline comparison (present only when a temporary baseline file existed:
  // transitionsFromV2, changedKinds, changedGameplay, oldBatContact*) are provenance, not corpus content, so they are
  // removed before hashing. Before, the digest could not be regenerated once that temporary file was gone.
  const normalized = [firstPath, secondPath].map((file) => execFileSync(
    'jq', ['-S', REACH_NORMALIZE_FILTER, file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  ));
  if (normalized[0] !== normalized[1]) {
    throw new Error('the two reach-proxy corpus summaries are not deterministic after removing their provenance fields');
  }
  for (const [index, summary] of summaries.entries()) {
    if (summary.corpus?.expected !== 7_560 || summary.corpus.completed !== 7_560 ||
        !Array.isArray(summary.corpus.crashes) || summary.corpus.crashes.length !== 0) {
      throw new Error(`reach corpus pass ${index + 1} is incomplete or crashed`);
    }
    for (const key of REACH_FAILURE_ARRAYS) {
      if (!Array.isArray(summary[key]) || summary[key].length !== 0) {
        throw new Error(`reach corpus pass ${index + 1} has ${key}`);
      }
    }
    if (summary.preStartBatContacts !== 0 || summary.batContactOnWhiffTrack !== 0 ||
        !Array.isArray(summary.reachProxies) || summary.reachProxies.length === 0 ||
        !Array.isArray(summary.proxySelection?.uncovered) || summary.proxySelection.uncovered.length !== 0) {
      throw new Error(`reach corpus pass ${index + 1} failed a causal or proxy-coverage gate`);
    }
  }
  const first = summaries[0];
  const evidence = {
    schema: 'vande.practice.reach-proxies.v3',
    simulationVersion: PRACTICE_SIM_VERSION,
    passCount: 2,
    corpus: first.corpus,
    normalizedSummarySha256: digestText(normalized[0]),
    fullSummarySha256: [
      digestText(readFileSync(firstPath, 'utf8')),
      digestText(readFileSync(secondPath, 'utf8')),
    ],
    gameplayHash: first.gameplayHash,
    outcomeHash: first.outcomeHash,
    sourceSha256: first.sourceSha256,
    gates: Object.fromEntries([
      ...REACH_FAILURE_ARRAYS.map((key) => [key, first[key].length]),
      ['preStartBatContacts', first.preStartBatContacts],
      ['batContactOnWhiffTrack', first.batContactOnWhiffTrack],
    ]),
    proxySelection: first.proxySelection,
    reachProxies: first.reachProxies,
  };
  mkdirSync(path.dirname(reachEvidenceFile), { recursive: true });
  writeFileSync(reachEvidenceFile, fixtureText(evidence));
  requireReachEvidence();
  process.stdout.write(
    `wrote ${path.relative(repoRoot, reachEvidenceFile)} (${evidence.reachProxies.length} proxies, normalized summary sha256 ${evidence.normalizedSummarySha256})\n`,
  );
}

/** Exact TypeScript implementation of Unity's vande-canonical-trace-v2 format. */
function canonicalTraceDigest(deliveryId, result) {
  const doubleBits = (raw) => {
    const value = Object.is(raw, -0) ? 0 : raw;
    if (!Number.isFinite(value)) throw new TypeError(`non-finite number in canonical trace: ${String(value)}`);
    const bytes = new ArrayBuffer(8);
    const view = new DataView(bytes);
    view.setFloat64(0, value, false);
    return view.getBigUint64(0, false).toString(16).padStart(16, '0');
  };
  const escape = (value) => {
    let out = '';
    for (const byte of new TextEncoder().encode(value)) {
      const unreserved =
        (byte >= 0x61 && byte <= 0x7a) ||
        (byte >= 0x41 && byte <= 0x5a) ||
        (byte >= 0x30 && byte <= 0x39) ||
        byte === 0x2d || byte === 0x5f || byte === 0x2e || byte === 0x7e;
      out += unreserved ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
    return out;
  };
  const join = (...values) => values.join('|');
  const vector = (value) => join(doubleBits(value.x), doubleBits(value.y), doubleBits(value.z));
  const lines = [];
  const append = (key, value) => lines.push(`${key}=${value}\n`);

  append('format', 'vande-canonical-trace-v2');
  append('traceVersion', String(UNITY_PRACTICE_TRACE_VERSION));
  append('deliveryId', escape(deliveryId));
  append('simulationVersion', String(PRACTICE_SIM_VERSION));
  append('duration', doubleBits(result.deadT));
  append('batterRootOffset', join(doubleBits(result.batterRootOffset.x), doubleBits(result.batterRootOffset.z)));
  append('batterPosture', doubleBits(result.batterPosture.crouchM));
  append('batterMotion', result.batterMotion === null
    ? 'null'
    : join(doubleBits(result.batterMotion.startT), doubleBits(result.batterMotion.contactT), doubleBits(result.batterMotion.endT)));
  append('ball.count', String(result.ball.length));
  result.ball.forEach((sample, index) => {
    append(`ball.${index}`, join(doubleBits(sample.t), vector(sample.p), vector(sample.v)));
  });
  append('bat.count', String(result.bat.length));
  result.bat.forEach((sample, index) => {
    append(`bat.${index}`, join(doubleBits(sample.t), vector(sample.grip), vector(sample.toe), vector(sample.face)));
  });
  append('fielder.count', String(result.fielders.length));
  result.fielders.forEach((path, pathIndex) => {
    append(`fielder.${pathIndex}.id`, escape(path.fielderId));
    append(`fielder.${pathIndex}.count`, String(path.samples.length));
    path.samples.forEach((sample, sampleIndex) => {
      append(
        `fielder.${pathIndex}.${sampleIndex}`,
        join(doubleBits(sample.t), doubleBits(sample.x), doubleBits(sample.z), escape(sample.action)),
      );
    });
  });
  append('event.count', String(result.events.length));
  result.events.forEach((event, index) => {
    append(
      `event.${index}`,
      join(
        doubleBits(event.t),
        escape(event.kind),
        escape(event.fielderId ?? ''),
        escape(event.contact ?? ''),
        String(event.runs ?? 0),
        String(event.completed ?? 0),
        event.p ? `vector:${vector(event.p)}` : 'null',
      ),
    );
  });
  return digestText(lines.join(''));
}

/** Nine decimals retain sub-millimetre/sub-millisecond evidence while keeping the review surface small. */
function compact(value) {
  if (typeof value === 'number') return Object.is(value, -0) ? 0 : Math.round(value * 1e9) / 1e9;
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) out[key] = compact(child);
    }
    return out;
  }
  return value;
}

const RELEASE_PERF_MS = 10_000;
const SURFACE = Object.freeze({ width: 915, height: 190 });
const START = Object.freeze({ x: 457.5, y: 170 });

function gestureShape(kind) {
  const t = 10_000;
  if (kind === 'tap') {
    return {
      pointer: 'touch',
      surface: SURFACE,
      footwork: 'auto',
      samples: [
        { t, ...START },
        { t: t + 40, x: START.x + 0.4, y: START.y - 0.3 },
        { t: t + 80, x: START.x + 0.7, y: START.y - 0.5 },
      ],
    };
  }
  const loft = kind === 'loft';
  const bearingDeg = kind === 'edge' || kind === 'loft' ? 25 : 0;
  const length = loft ? 315 : 120;
  const duration = loft ? 115 : 95;
  const radians = (bearingDeg * Math.PI) / 180;
  const dx = Math.sin(radians) * length;
  const dy = -Math.cos(radians) * length;
  return {
    pointer: 'touch',
    surface: SURFACE,
    footwork: 'auto',
    samples: [
      { t, ...START },
      { t: t + 5, ...START },
      { t: t + 15, x: START.x + dx * 0.08, y: START.y + dy * 0.08 },
      { t: t + duration * 0.55, x: START.x + dx * 0.68, y: START.y + dy * 0.68 },
      { t: t + duration, x: START.x + dx, y: START.y + dy },
    ],
  };
}

/**
 * Shift one fixed physical gesture so its normalized swing reaches the contact
 * zone at the requested offset. This changes timing only; the trace shape,
 * direction, power and elevation remain identical between timing cases.
 */
function timedGesture(flightValue, shape, offsetMs) {
  const seedGesture = gestureShape(shape);
  const first = normalizeGesture(seedGesture, {
    releasePerfMs: 0,
    calibrationMs: 0,
    handedness: 'right',
  });
  if (!first) throw new Error(`fixture gesture ${shape} did not normalize`);
  const targetStartT = flightValue.idealContactT - batTravelMs(first.kind, first.power) / 1000 + offsetMs / 1000;
  const shiftMs = RELEASE_PERF_MS + targetStartT * 1000 - first.startT * 1000;
  const gesture = {
    ...seedGesture,
    samples: seedGesture.samples.map((sample) => ({ ...sample, t: sample.t + shiftMs })),
  };
  const swing = normalizeGesture(gesture, {
    releasePerfMs: RELEASE_PERF_MS,
    calibrationMs: 0,
    handedness: 'right',
  });
  if (!swing) throw new Error(`shifted fixture gesture ${shape} did not normalize`);
  return { gesture: compact(gesture), normalize: { releasePerfMs: RELEASE_PERF_MS, calibrationMs: 0, handedness: 'right' }, swing };
}

function referenceDelivery(index) {
  const bowler = REFERENCE_OVER.bowler;
  const plan = REFERENCE_OVER.balls[index];
  const seed = ballSeed(REFERENCE_OVER, index);
  const handedness = 'right';
  const flightValue = flight({
    plan,
    bowler,
    conditions: REFERENCE_CONDITIONS,
    seed,
    handedness,
    ball: REFERENCE_BALL,
  });
  return {
    bowler,
    plan,
    seed,
    handedness,
    flight: flightValue,
    field: autoField(bowler, REFERENCE_CONDITIONS, handedness, REFERENCE_BALL),
  };
}

function recordFor(delivery, swing, result) {
  return {
    version: PRACTICE_SIM_VERSION,
    overIndex: 0,
    ballIndex: delivery.index,
    bowler: delivery.bowler,
    plan: delivery.plan,
    seed: delivery.seed,
    conditions: REFERENCE_CONDITIONS,
    ball: REFERENCE_BALL,
    field: delivery.field,
    handedness: delivery.handedness,
    assist: 'real',
    tierToleranceMs: 0,
    swing,
    runs: result.outcome.runs,
    dismissal: result.outcome.dismissal,
  };
}

function summarizeFlight(value) {
  return compact({
    plan: value.plan,
    seed: value.seed,
    release: value.release,
    bounce: value.bounce,
    spin: value.spin,
    seam: value.seam,
    idealContactT: value.idealContactT,
    stumpsT: value.stumpsT,
    wouldHitStumps: value.wouldHitStumps,
    sampleCount: value.samples.length,
    checkpoints: {
      first: value.samples[0],
      bounce: value.bounce ? sampleAt(value.samples, value.bounce.t) : null,
      idealContact: sampleAt(value.samples, value.idealContactT),
      stumps: sampleAt(value.samples, value.stumpsT),
      last: value.samples.at(-1),
    },
  });
}

function eventClass(event) {
  return {
    kind: event.kind,
    ...(event.contact ? { contact: event.contact } : {}),
    ...(event.runs ? { runs: event.runs } : {}),
    ...(event.completed ? { completed: event.completed } : {}),
    ...(event.fielderId ? { fielderId: event.fielderId } : {}),
  };
}

function summarizeResult(value) {
  return compact({
    batterRootOffset: value.batterRootOffset,
    batterBodyFrame: value.batterBodyFrame,
    batterPosture: value.batterPosture,
    batterMotion: value.batterMotion,
    footwork: value.footwork,
    contact: value.contact,
    lbw: value.lbw,
    outcome: value.outcome,
    coaching: value.coaching,
    eventClasses: value.events.map(eventClass),
    eventTimes: value.events.map((event) => event.t),
    batSampleCount: value.bat.length,
    ballSampleCount: value.ball.length,
    fielderPathCount: value.fielders.length,
    deadT: value.deadT,
    finalBall: value.ball.at(-1),
  });
}

function batContactTime(result) {
  const contacts = result.events.filter((event) =>
    event.kind === 'contact' && ['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge'].includes(event.contact));
  if (contacts.length > 1) throw new Error('canonical fixture has more than one bat-contact event');
  return contacts[0]?.t ?? null;
}

/**
 * Off-knot probes shared with C# lock rigid C1 interpolation, including the pre-domain no-bat rule. Fractions are
 * deliberately asymmetric and every time is deduplicated before evaluation so the fixture cannot accidentally
 * pass by sampling only authored knots.
 */
function tracePlayback(result) {
  const samples = result.bat;
  const impulseT = batContactTime(result);
  const motionContactT = result.batterMotion?.contactT ?? null;
  const candidates = [];
  if (samples.length) candidates.push(Math.max(0, samples[0].t - 0.001));
  if (samples.length >= 2) {
    const between = (a, b, u) => a.t + (b.t - a.t) * u;
    candidates.push(between(samples[0], samples[1], 0.37));
    if (motionContactT !== null) {
      const contactIndex = samples.findIndex((sample) => Math.abs(sample.t - motionContactT) <= 1e-12);
      if (contactIndex < 0) throw new Error('canonical fixture is missing its exact batter-motion contact knot');
      if (contactIndex > 0) candidates.push(between(samples[contactIndex - 1], samples[contactIndex], 0.61));
      if (contactIndex + 1 < samples.length) candidates.push(between(samples[contactIndex], samples[contactIndex + 1], 0.43));
    }
    const motionEndT = result.batterMotion?.endT ?? null;
    if (motionEndT !== null) {
      const endIndex = samples.findIndex((sample) => Math.abs(sample.t - motionEndT) <= 1e-12);
      if (endIndex < 0) throw new Error('canonical fixture is missing its exact batter-motion end knot');
      if (endIndex > 0) candidates.push(between(samples[endIndex - 1], samples[endIndex], 0.79));
      if (endIndex + 1 < samples.length) candidates.push(between(samples[endIndex], samples[endIndex + 1], 0.37));
    }
    candidates.push(between(samples[samples.length - 2], samples[samples.length - 1], 0.73));
  }
  // Playback cannot seek beyond the canonical delivery duration. A bat trace may retain authored terminal-hold
  // knots after dead ball, but those knots are not playable probe times. Keep the intentional pre-bat probe while
  // bounding every authority/off-knot probe to the same [0, deadT] domain consumed by Unity playback.
  const times = [...new Set(candidates.filter((time) =>
    Number.isFinite(time) && time >= 0 && time <= result.deadT))].sort((a, b) => a - b);
  return {
    batterRootOffset: { ...result.batterRootOffset },
    batterBodyFrame: {
      stance: { ...result.batterBodyFrame.stance },
      torsoTop: { ...result.batterBodyFrame.torsoTop },
      headCentre: { ...result.batterBodyFrame.headCentre },
    },
    batterPosture: { ...result.batterPosture },
    batterMotion: result.batterMotion ? { ...result.batterMotion } : null,
    batProbes: times.map((t) => {
      const pose = batAt(samples, t, impulseT, motionContactT);
      return { t, bat: pose ? { grip: pose.grip, toe: pose.toe, face: pose.face } : null };
    }),
  };
}

const CASE_SPECS = [
  { id: 'defensive-tap', intent: 'defensive_tap', ball: 2, shape: 'tap', offsetMs: 0 },
  { id: 'grounded-attack', intent: 'grounded_attack', ball: 2, shape: 'ground', offsetMs: 0 },
  { id: 'deliberate-loft', intent: 'deliberate_loft', ball: 2, shape: 'loft', offsetMs: 0 },
  { id: 'early-attack', intent: 'early', ball: 0, shape: 'ground', offsetMs: -90 },
  { id: 'late-attack', intent: 'late', ball: 0, shape: 'ground', offsetMs: 90 },
  // The 25 deg drive at the outswinger, 8 ms late (inside the perfect band): the ball meets the outside edge level with the
  // sweet spot (0.08 m across) and flies fine towards the slips. On the frozen phase-5c physics the same drive on time
  // is a middle; the outside edge holds from +7 to +9 ms (+6: middle, +10: beaten), so +8 is the centre of that run and
  // well inside the 14 ms perfect band (PHYS2, 2026-11-03).
  { id: 'thin-edge', intent: 'edge', ball: 0, shape: 'edge', offsetMs: 8 },
  { id: 'complete-miss', intent: 'miss', ball: 2, shape: 'ground', offsetMs: 260 },
];

async function makeCase(spec) {
  const base = referenceDelivery(spec.ball);
  const delivery = { ...base, index: spec.ball };
  const inputValue = timedGesture(base.flight, spec.shape, spec.offsetMs);
  const result = resolveDelivery({
    flight: base.flight,
    swing: inputValue.swing,
    field: base.field,
    bowler: base.bowler,
    conditions: REFERENCE_CONDITIONS,
    handedness: base.handedness,
    assist: 'real',
    tierToleranceMs: 0,
  });
  const record = recordFor(delivery, inputValue.swing, result);
  const replay = replayDelivery(record);
  const resultDigest = digest(result);
  const replayDigest = digest(replay);
  const contractReplayDigest = await unityPracticeReplayDigest(record, result);
  const deliveryId = `golden-${spec.id}`;
  const envelope = (sequence, type, payload, deliveryScoped = true) => makeUnityPracticeMessage({
    buildId: 'unity-golden-v3',
    sessionId: `golden-session-${spec.id}`,
    deliveryId: deliveryScoped ? deliveryId : null,
    messageId: `golden-${spec.id}-${sequence}-${type}`,
    sequence,
    sender: 'host',
  }, type, payload);
  const resolution = {
    record,
    result,
    score: {
      runs: result.outcome.runs,
      wickets: result.outcome.dismissal === null ? 0 : 1,
      balls: spec.ball + 1,
      maxOvers: 10,
    },
    replayDigest: contractReplayDigest,
  };
  const wire = {
    buildId: 'unity-golden-v3',
    sessionId: `golden-session-${spec.id}`,
    deliveryId,
    replayDigest: contractReplayDigest,
    packets: {
      scene: await packUnityPracticeMessage(envelope(0, 'host.scene', {
        conditions: REFERENCE_CONDITIONS,
        field: base.field,
        fieldIntent: fieldIntention(base.field, base.bowler, REFERENCE_CONDITIONS),
        trainingObjective: 'reference',
        bowler: base.bowler,
        ball: REFERENCE_BALL,
        handedness: base.handedness,
        batterPosition: { lateralM: 0, creaseOffsetM: 0, guard: 'middle' },
      }, false)),
      delivery: await packUnityPracticeMessage(envelope(1, 'host.delivery', {
        overIndex: 0,
        ballIndex: spec.ball,
        plan: base.plan,
        seed: base.seed,
        flight: base.flight,
        presentation: { learnCue: false, coach: null },
      })),
      result: await packUnityPracticeMessage(envelope(2, 'host.result', resolution)),
      replay: await packUnityPracticeMessage(envelope(3, 'host.replay', {
        resolution,
        speed: 0.3,
        diagnostics: true,
      })),
    },
  };
  return {
    id: spec.id,
    intent: spec.intent,
    referenceBall: REFERENCE_BALLS[spec.ball].id,
    timingOffsetMs: spec.offsetMs,
    input: inputValue,
    request: compact({
      plan: base.plan,
      seed: base.seed,
      bowler: base.bowler,
      conditions: REFERENCE_CONDITIONS,
      ball: REFERENCE_BALL,
      field: base.field,
      handedness: base.handedness,
      assist: 'real',
      tierToleranceMs: 0,
    }),
    flight: summarizeFlight(base.flight),
    result: summarizeResult(result),
    tracePlayback: tracePlayback(result),
    digests: {
      canonicalTraceSha256: canonicalTraceDigest(deliveryId, result),
      flightSha256: digest(base.flight),
      resultSha256: resultDigest,
      recordSha256: digest(record),
      replaySha256: replayDigest,
    },
    wire,
    replayMatchesResult: replayDigest === resultDigest && canonicalJson(replay) === canonicalJson(result),
  };
}

async function buildFixture() {
  const cases = await Promise.all(CASE_SPECS.map(makeCase));
  const reachEvidence = requireReachEvidence();
  const contacts = [...new Set(cases.map((item) => item.result.contact.kind))].sort();
  const timings = [...new Set(cases.map((item) => item.result.contact.timing))].sort();
  const payload = {
    schema: 'vande.practice.unity-golden',
    fixtureVersion: 3,
    simulationVersion: PRACTICE_SIM_VERSION,
    canonicalization: 'recursive-key-sort-json-sha256-v1',
    generator: 'scripts/practice-unity-goldens.mjs',
    oracle: 'TypeScript Practice v3',
    note: 'Classification fields are exact. Numeric summaries are rounded to 1e-9 for review; digests and canonical wire packets cover complete unrounded production objects.',
    reference: {
      overSeed: REFERENCE_OVER.seed,
      conditions: REFERENCE_CONDITIONS,
      bowler: REFERENCE_OVER.bowler,
      ball: REFERENCE_BALL,
    },
    coverage: {
      intents: cases.map((item) => item.intent),
      contacts,
      timings,
      allReplaysMatch: cases.every((item) => item.replayMatchesResult),
    },
    reachProxyEvidence: reachEvidence.metadata,
    reachProxies: reachEvidence.reachProxies,
    cases,
  };
  return { ...payload, payloadSha256: digest(payload) };
}

function fixtureText(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function usageError(message) {
  process.stderr.write(
    `${message}\nusage: node scripts/practice-unity-goldens.mjs --write | --check | ` +
    `--freeze-reach-evidence <pass1.json> <pass2.json>\n`,
  );
  process.exitCode = 2;
}

const args = process.argv.slice(2);
if (args.length === 3 && args[0] === '--freeze-reach-evidence') {
  freezeReachEvidence(path.resolve(args[1]), path.resolve(args[2]));
} else if (args.length !== 1 || !['--write', '--check'].includes(args[0])) {
  usageError('choose exactly one mode');
} else {
  const fixture = await buildFixture();
  const next = fixtureText(fixture);
  if (args[0] === '--write') {
    mkdirSync(path.dirname(fixtureFile), { recursive: true });
    writeFileSync(fixtureFile, next);
    process.stdout.write(`wrote ${path.relative(repoRoot, fixtureFile)} (${fixture.cases.length} cases, payload sha256 ${fixture.payloadSha256})\n`);
  } else if (!existsSync(fixtureFile)) {
    process.stderr.write(`missing ${path.relative(repoRoot, fixtureFile)}; run with --write\n`);
    process.exitCode = 1;
  } else {
    const current = readFileSync(fixtureFile, 'utf8');
    if (current !== next) {
      const committed = (() => {
        try {
          return JSON.parse(current).payloadSha256 ?? 'unreadable payload digest';
        } catch {
          return 'invalid JSON';
        }
      })();
      process.stderr.write(`Practice Unity golden fixture differs (committed ${committed}, generated ${fixture.payloadSha256}); inspect the physics change, then regenerate deliberately with --write\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`Practice Unity golden fixture matches (${fixture.cases.length} cases, payload sha256 ${fixture.payloadSha256})\n`);
    }
  }
}
