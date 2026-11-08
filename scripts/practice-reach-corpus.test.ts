/**
 * Practice sim-v3 reach corpus: the producer of tests/fixtures/unity-practice/reach-proxies-v3.json.
 *
 * Provenance: written by Codex on 2026-11-01 as /private/tmp/vande-v3-audit/corpus.test.ts (sha256
 * 615706e9c1d5398ae11e6a3ae7b3e8e32c119ec6649a17c966cbbd4cd55e67f1) and never committed. Brought into the repo by
 * PHYS2 on 2026-11-03 with only these changes:
 *   - paths derive from the repository root instead of a hard-coded checkout;
 *   - the output file must be named (VANDE_AUDIT_OUTPUT);
 *   - the sim-v2 baseline comparison (transitionsFromV2, changedKinds, changedGameplay, oldBatContact*) is optional: it
 *     runs when VANDE_AUDIT_V2_BASELINE (default: Codex's baseline-4f9643b.jsonl) exists and those fields are null
 *     otherwise. scripts/practice-unity-goldens.mjs freezeReachEvidence() never reads them.
 * The corpus, gates, hashes, proxy selection and output keys are Codex's, unchanged.
 *
 * 3 bowlers x 8 lengths x 5 lines x 7 directions x 9 timing errors = 7,560 attacking swings (power 0.7, elevation 0.2,
 * automatic footwork, Real, seed 'post-contact-audit', balanced pitch): the same grid as
 * tests/unit/physics/simV3Census.test.ts, whose outcomeHash is the same FNV-1a over contact kinds (unpadded there).
 *
 *   VANDE_AUDIT_OUTPUT=/path/pass1.json npx vitest run --config scripts/practice-reach-corpus.vitest.config.mjs
 *   VANDE_AUDIT_OUTPUT=/path/pass2.json npx vitest run --config scripts/practice-reach-corpus.vitest.config.mjs
 *   node scripts/practice-unity-goldens.mjs --freeze-reach-evidence /path/pass1.json /path/pass2.json
 *
 * Optional filters (diagnostics only; a filtered run is incomplete and cannot be frozen): VANDE_AUDIT_CASES (comma-
 * separated case ids) and VANDE_AUDIT_PRIOR_FAILURES (a summary whose invariantFailures ids are re-run).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import type { BallFlight, BatSample, BowlerProfile, NormalizedSwing, PracticeDeliveryPlan, Vec3 } from '@/contracts/practice';
import {
  BAT_HAND_REACH_M,
  BAT_HAND_REACH_SOLVE_M,
  BAT_BODY_RETARGET_M,
  BAT_POSTURE_CROUCH_MAX_M,
  batPoseAdmissibility,
} from '@/physics/admissibility';
import {
  BAT_ANGULAR_ACCEL_LIMIT_RADPS2,
  BAT_ANGULAR_SPEED_LIMIT_RADPS,
  BAT_GRIP_ACCEL_LIMIT_MPS2,
  BAT_GRIP_SPEED_LIMIT_MPS,
  BAT_POINT_ACCEL_LIMIT_MPS2,
  BAT_POINT_SPEED_LIMIT_MPS,
  batPose,
  batSamples,
  batTrackAnalyticEnvelope,
  batTravelMs,
  idealTimeFor,
  trackEndT,
  type BatPose,
  type BatTrack,
} from '@/physics/bat';
import { strike, type StrikeResult } from '@/physics/contact';
import { sweepRawBat } from '@/physics/collision';
import { flight } from '@/physics/delivery';
import { batAt } from '@/render3d/practice/frame';

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const BASELINE = process.env.VANDE_AUDIT_V2_BASELINE ?? '/private/tmp/vande-presentation-audit.L6pDMe/baseline-4f9643b.jsonl';
const OUTPUT = process.env.VANDE_AUDIT_OUTPUT ?? '';
const PRIOR_FAILURE_FILTER = process.env.VANDE_AUDIT_PRIOR_FAILURES
  ? (JSON.parse(readFileSync(process.env.VANDE_AUDIT_PRIOR_FAILURES, 'utf8')).invariantFailures as Array<{ id: string }>).map((failure) => failure.id)
  : [];
const CASE_FILTER = new Set([
  ...(process.env.VANDE_AUDIT_CASES ?? '').split(',').filter(Boolean),
  ...PRIOR_FAILURE_FILTER,
]);
const SEED = 'post-contact-audit';
const CONDITIONS = 'balanced' as const;
const BAT_KINDS = new Set(['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge']);
const PACE: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'test-pace' };
const OFFSPIN: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'test-spin' };
const LEGSPIN: BowlerProfile = { family: 'spin', spinType: 'wrist', arm: 'right', lookSeed: 'test-spin' };
const BOWLERS = [
  { id: 'pace', bowler: PACE, speedKph: 136 },
  { id: 'finger_spin', bowler: OFFSPIN, speedKph: 84 },
  { id: 'wrist_spin', bowler: LEGSPIN, speedKph: 84 },
] as const;
const LENGTHS = [1.2, 2.5, 4, 5.5, 6.5, 7.5, 9, 10.5];
const LINES = [-0.3, -0.12, 0.05, 0.25, 0.45];
const DIRECTIONS = [-70, -45, -20, 0, 20, 45, 70];
const ERRORS = [-200, -140, -80, -40, 0, 40, 80, 140, 200];

type CorpusInput = {
  id: string;
  bowlerId: string;
  bowler: BowlerProfile;
  plan: PracticeDeliveryPlan;
  conditions: typeof CONDITIONS;
  seed: string;
  handedness: 'right';
  swing: NormalizedSwing;
  options: { assist: 'real'; expect: { bowler: BowlerProfile; conditions: typeof CONDITIONS; handedness: 'right' } };
};

type CompactCase = {
  input: CorpusInput;
  family: string;
  footwork: string;
  kind: string;
  rootNorm: number;
  crouchM: number;
  contactU: number;
  geometryAdmitted: boolean;
  worstRuntimeReach: number;
};

function timedSwing(f: BallFlight, errorMs: number, directionDeg: number): NormalizedSwing {
  const kind = 'attack' as const;
  const power = 0.7;
  return {
    kind,
    power,
    directionDeg,
    elevation: 0.2,
    footwork: 'auto',
    startT: idealTimeFor(f, 'auto') - batTravelMs(kind, power) / 1000 + errorMs / 1000,
  };
}

function makeInput(bowlerId: string, bowler: BowlerProfile, speedKph: number, lengthM: number, lineM: number, directionDeg: number, errorMs: number, existingFlight?: BallFlight): { input: CorpusInput; flight: BallFlight } {
  const plan: PracticeDeliveryPlan = { variation: 'stock', lengthM, lineM, speedKph };
  const handedness = 'right' as const;
  const f = existingFlight ?? flight({ plan, bowler, conditions: CONDITIONS, seed: SEED, handedness });
  const swing = timedSwing(f, errorMs, directionDeg);
  const options = { assist: 'real' as const, expect: { bowler, conditions: CONDITIONS, handedness } };
  const id = `${bowlerId}:L${lengthM}:x${lineM}:d${directionDeg}:e${errorMs}`;
  return { input: { id, bowlerId, bowler, plan, conditions: CONDITIONS, seed: SEED, handedness, swing, options }, flight: f };
}

function replay(input: CorpusInput): { flight: BallFlight; result: StrikeResult } {
  const f = flight({
    plan: input.plan,
    bowler: input.bowler,
    conditions: input.conditions,
    seed: input.seed,
    handedness: input.handedness,
  });
  return { flight: f, result: strike(f, input.swing, input.options) };
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a: Vec3, amount: number): Vec3 {
  return { x: a.x * amount, y: a.y * amount, z: a.z * amount };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function axis(pose: BatPose): Vec3 {
  const span = sub(pose.grip, pose.toe);
  return scale(span, 1 / Math.hypot(span.x, span.y, span.z));
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/** World-space logarithm of frame(b) * frame(a)^T, divided by dt. Dense samples stay far from the pi branch. */
function angularVelocity(a: BatPose, b: BatPose, dt: number): Vec3 {
  const aa = axis(a);
  const an = a.n;
  const aw = cross(aa, an);
  const ba = axis(b);
  const bn = b.n;
  const bw = cross(ba, bn);
  const r00 = ba.x * aa.x + bn.x * an.x + bw.x * aw.x;
  const r01 = ba.x * aa.y + bn.x * an.y + bw.x * aw.y;
  const r02 = ba.x * aa.z + bn.x * an.z + bw.x * aw.z;
  const r10 = ba.y * aa.x + bn.y * an.x + bw.y * aw.x;
  const r11 = ba.y * aa.y + bn.y * an.y + bw.y * aw.y;
  const r12 = ba.y * aa.z + bn.y * an.z + bw.y * aw.z;
  const r20 = ba.z * aa.x + bn.z * an.x + bw.z * aw.x;
  const r21 = ba.z * aa.y + bn.z * an.y + bw.z * aw.y;
  const r22 = ba.z * aa.z + bn.z * an.z + bw.z * aw.z;
  const theta = Math.acos(Math.max(-1, Math.min(1, (r00 + r11 + r22 - 1) / 2)));
  const vee = { x: r21 - r12, y: r02 - r20, z: r10 - r01 };
  if (theta < 1e-8) return scale(vee, 0.5 / dt);
  const sine = Math.sin(theta);
  if (Math.abs(sine) < 1e-8) throw new Error(`Unexpected near-pi frame step ${theta}`);
  return scale(vee, theta / (2 * sine * dt));
}

function exactPoseEqual(sample: BatSample, pose: BatPose): boolean {
  return sample.grip.x === pose.grip.x && sample.grip.y === pose.grip.y && sample.grip.z === pose.grip.z &&
    sample.toe.x === pose.toe.x && sample.toe.y === pose.toe.y && sample.toe.z === pose.toe.z &&
    sample.face.x === pose.n.x && sample.face.y === pose.n.y && sample.face.z === pose.n.z;
}

function fnv(value: string, prior = 0x811c9dc5): number {
  let hash = prior;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function distribution(values: number[]) {
  return {
    count: values.length,
    min: values.length ? Math.min(...values) : null,
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: values.length ? Math.max(...values) : null,
  };
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function coverageFeatures(entry: CompactCase): string[] {
  return [`family:${entry.family}`, `footwork:${entry.footwork}`, `bowler:${entry.input.bowlerId}`, `kind:${entry.kind}`];
}

function rigidMetrics(pose: BatPose) {
  const batAxis = axis(pose);
  return {
    lengthError: Math.abs(dist(pose.grip, pose.toe) - 0.86),
    faceUnitError: Math.abs(Math.hypot(pose.n.x, pose.n.y, pose.n.z) - 1),
    orthogonalityError: Math.abs(dot(batAxis, pose.n)),
  };
}

function sampleTimes(start: number, end: number, step: number, anchors: number[] = []): number[] {
  const out: Array<{ t: number; authority: boolean }> = [];
  const count = Math.ceil((end - start) / step);
  for (let i = 0; i <= count; i++) {
    const value = start + i * step;
    if (value < end) out.push({ t: value, authority: false });
  }
  out.push({ t: end, authority: true });
  out.push(...anchors.filter((value) => value >= start && value <= end).map((t) => ({ t, authority: true })));
  out.sort((a, b) => a.t - b.t || Number(b.authority) - Number(a.authority));
  const merged: Array<{ t: number; authority: boolean }> = [];
  for (const value of out) {
    const prior = merged.at(-1);
    if (prior && Math.abs(value.t - prior.t) <= 1e-10) {
      if (value.authority && !prior.authority) merged[merged.length - 1] = value;
    } else {
      merged.push(value);
    }
  }
  return merged.map((value) => value.t);
}

type MotionAudit = {
  minimumGap: number;
  maximumReach: number;
  maximumLengthError: number;
  maximumFaceUnitError: number;
  maximumOrthogonalityError: number;
  maximumGripSpeed: number;
  maximumToeSpeed: number;
  maximumAngularSpeed: number;
  maximumGripAcceleration: number;
  maximumToeAcceleration: number;
  maximumAngularAcceleration: number;
  terminalSpeed: number;
  worstReachT: number;
  maximumGripAccelerationAt: unknown;
  maximumToeAccelerationAt: unknown;
  maximumAngularAccelerationAt: unknown;
};

function auditReturnedTrace(result: StrikeResult, step = 0.001): MotionAudit {
  const track = result.track!;
  const trace = result.bat;
  const motion = result.batterMotion!;
  const contactT = BAT_KINDS.has(result.contact.kind) ? result.contact.t : null;
  const times = sampleTimes(trace[0].t, trace.at(-1)!.t, step, [motion.contactT, motion.endT, ...(contactT == null ? [] : [contactT])]);
  const poses = times.map((t) => {
    const value = batAt(trace, t, contactT, motion.contactT);
    if (!value) throw new Error(`batAt unexpectedly null for ${t}`);
    return { t, pose: { grip: value.grip, toe: value.toe, n: value.face } };
  });
  let minimumGap = Infinity;
  let maximumReach = -Infinity;
  let maximumLengthError = 0;
  let maximumFaceUnitError = 0;
  let maximumOrthogonalityError = 0;
  let worstReachT = poses[0].t;
  for (const item of poses) {
    const anatomy = batPoseAdmissibility(item.pose, track.body);
    const rigid = rigidMetrics(item.pose);
    minimumGap = Math.min(minimumGap, anatomy.gap);
    if (anatomy.reach > maximumReach) {
      maximumReach = anatomy.reach;
      worstReachT = item.t;
    }
    maximumLengthError = Math.max(maximumLengthError, rigid.lengthError);
    maximumFaceUnitError = Math.max(maximumFaceUnitError, rigid.faceUnitError);
    maximumOrthogonalityError = Math.max(maximumOrthogonalityError, rigid.orthogonalityError);
  }
  const intervals: Array<{ t0: number; t1: number; grip: Vec3; toe: Vec3; angular: Vec3 }> = [];
  let maximumGripSpeed = 0;
  let maximumToeSpeed = 0;
  let maximumAngularSpeed = 0;
  for (let i = 1; i < poses.length; i++) {
    const dt = poses[i].t - poses[i - 1].t;
    const grip = scale(sub(poses[i].pose.grip, poses[i - 1].pose.grip), 1 / dt);
    const toe = scale(sub(poses[i].pose.toe, poses[i - 1].pose.toe), 1 / dt);
    const angular = angularVelocity(poses[i - 1].pose, poses[i].pose, dt);
    intervals.push({ t0: poses[i - 1].t, t1: poses[i].t, grip, toe, angular });
    maximumGripSpeed = Math.max(maximumGripSpeed, Math.hypot(grip.x, grip.y, grip.z));
    maximumToeSpeed = Math.max(maximumToeSpeed, Math.hypot(toe.x, toe.y, toe.z));
    maximumAngularSpeed = Math.max(maximumAngularSpeed, Math.hypot(angular.x, angular.y, angular.z));
  }
  let maximumGripAcceleration = 0;
  let maximumToeAcceleration = 0;
  let maximumAngularAcceleration = 0;
  let maximumGripAccelerationAt: unknown = null;
  let maximumToeAccelerationAt: unknown = null;
  let maximumAngularAccelerationAt: unknown = null;
  for (let i = 1; i < intervals.length; i++) {
    const before = intervals[i - 1];
    const after = intervals[i];
    if (contactT !== null && before.t1 <= contactT && after.t0 >= contactT) continue;
    const dt = ((before.t1 - before.t0) + (after.t1 - after.t0)) / 2;
    const gripAcceleration = dist(before.grip, after.grip) / dt;
    const toeAcceleration = dist(before.toe, after.toe) / dt;
    const angularAcceleration = dist(after.angular, before.angular) / dt;
    const at = { t: before.t1, dt, before, after };
    if (gripAcceleration > maximumGripAcceleration) {
      maximumGripAcceleration = gripAcceleration;
      maximumGripAccelerationAt = at;
    }
    if (toeAcceleration > maximumToeAcceleration) {
      maximumToeAcceleration = toeAcceleration;
      maximumToeAccelerationAt = at;
    }
    if (angularAcceleration > maximumAngularAcceleration) {
      maximumAngularAcceleration = angularAcceleration;
      maximumAngularAccelerationAt = at;
    }
  }
  const last = intervals.at(-1)!;
  const terminalSpeed = Math.max(Math.hypot(last.grip.x, last.grip.y, last.grip.z), Math.hypot(last.toe.x, last.toe.y, last.toe.z));
  return {
    minimumGap,
    maximumReach,
    maximumLengthError,
    maximumFaceUnitError,
    maximumOrthogonalityError,
    maximumGripSpeed,
    maximumToeSpeed,
    maximumAngularSpeed,
    maximumGripAcceleration,
    maximumToeAcceleration,
    maximumAngularAcceleration,
    terminalSpeed,
    worstReachT,
    maximumGripAccelerationAt,
    maximumToeAccelerationAt,
    maximumAngularAccelerationAt,
  };
}

function auditCanonicalTrack(track: BatTrack, step = 0.0005) {
  let minimumGap = Infinity;
  let maximumReach = -Infinity;
  let maximumReachSolveExcess = -Infinity;
  let maximumLengthError = 0;
  let maximumFaceUnitError = 0;
  let maximumOrthogonalityError = 0;
  for (const t of sampleTimes(track.startT, trackEndT(track), step, [track.plannedContactT, track.zoneOut])) {
    const pose = batPose(track, t);
    const anatomy = batPoseAdmissibility(pose, track.body);
    const rigid = rigidMetrics(pose);
    minimumGap = Math.min(minimumGap, anatomy.gap);
    maximumReach = Math.max(maximumReach, anatomy.reach);
    maximumReachSolveExcess = Math.max(maximumReachSolveExcess, anatomy.reach - BAT_HAND_REACH_SOLVE_M);
    maximumLengthError = Math.max(maximumLengthError, rigid.lengthError);
    maximumFaceUnitError = Math.max(maximumFaceUnitError, rigid.faceUnitError);
    maximumOrthogonalityError = Math.max(maximumOrthogonalityError, rigid.orthogonalityError);
  }
  return { minimumGap, maximumReach, maximumReachSolveExcess, maximumLengthError, maximumFaceUnitError, maximumOrthogonalityError };
}

function gameplay(result: StrikeResult) {
  return {
    contact: result.contact,
    exit: result.exit,
    impact: result.impact,
    miss: result.miss,
    footwork: result.footwork,
    idealT: result.idealT,
    quality: result.quality,
  };
}

/** A failure record of the audit: free-form (case id, gate, detail), written as it is into the summary JSON. */
type Finding = Record<string, unknown>;

function baselineKey(key: Record<string, unknown>): string {
  const bowlerId = key.family === 'pace' ? 'pace' : key.spinType === 'finger' ? 'finger_spin' : 'wrist_spin';
  return `${bowlerId}:L${key.lengthM}:x${key.lineM}:d${key.directionDeg}:e${key.errorMs}`;
}

function updateMaximum<T>(current: { value: number; item: T } | null, value: number, item: T): { value: number; item: T } {
  return !current || value > current.value ? { value, item } : current;
}

function updateMinimum<T>(current: { value: number; item: T } | null, value: number, item: T): { value: number; item: T } {
  return !current || value < current.value ? { value, item } : current;
}

function sourceDigest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('independent frozen sim-v3 corpus audit', () => {
  it('writes the complete deterministic census and proxy candidates', () => {
    if (!OUTPUT) throw new Error('set VANDE_AUDIT_OUTPUT to the summary file this pass writes');
    const baseline = existsSync(BASELINE)
      ? new Map(readFileSync(BASELINE, 'utf8').trim().split('\n').map((line) => JSON.parse(line)).map((row) => [baselineKey(row.key), row]))
      : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the report document is assembled field by field and written as JSON; no tsconfig covers this generator
    const summary: any = {
      generatedAtUtc: new Date().toISOString(),
      sourceSha256: {
        bat: sourceDigest(`${REPO}/src/physics/bat.ts`),
        admissibility: sourceDigest(`${REPO}/src/physics/admissibility.ts`),
        collision: sourceDigest(`${REPO}/src/physics/collision.ts`),
        contact: sourceDigest(`${REPO}/src/physics/contact.ts`),
        frame: sourceDigest(`${REPO}/src/render3d/practice/frame.ts`),
      },
      corpus: { expected: 7560, completed: 0, crashes: [] as Finding[] },
      counts: {},
      transitionsFromV2: baseline ? {} : null,
      changedKinds: baseline ? 0 : null,
      changedGameplay: baseline ? 0 : null,
      oldBatContactCases: baseline ? 0 : null,
      oldBatContactKindsChanged: baseline ? 0 : null,
      oldBatContactGameplayChanged: baseline ? 0 : null,
      admittedTracks: 0,
      whiffTracks: 0,
      zeroGripVelocityTracks: 0,
      zeroGripVelocityTrackExamples: [] as string[],
      batContacts: 0,
      preStartBatContacts: 0,
      batContactOnWhiffTrack: 0,
      hiddenWhiffGeometricHits: [] as Finding[],
      exactContactKnotFailures: [] as Finding[],
      nonBatCanonicalFailures: [] as Finding[],
      hitPrefixFailures: [] as Finding[],
      motionAnchorFailures: [] as Finding[],
      invariantFailures: [] as Finding[],
      analyticFailures: [] as Finding[],
      extrema: {},
    };
    const roots: number[] = [];
    const crouches: number[] = [];
    const contactUs: number[] = [];
    const hitOffsets: number[] = [];
    const canonicalReach: number[] = [];
    const runtimeReach: number[] = [];
    const familyCounts: Record<string, number> = {};
    const footworkCounts: Record<string, number> = {};
    const familyKindCounts: Record<string, number> = {};
    const candidates: CompactCase[] = [];
    let maxRoot: { value: number; item: CompactCase } | null = null;
    let maxCrouch: { value: number; item: CompactCase } | null = null;
    let minContactU: { value: number; item: CompactCase } | null = null;
    let maxContactU: { value: number; item: CompactCase } | null = null;
    let maxRuntimeReach: { value: number; item: CompactCase } | null = null;
    const runtimeMaxima: Record<string, { value: number; id: string; at?: unknown }> = {};
    let outcomeHash = 0x811c9dc5;
    let gameplayHash = 0x811c9dc5;
    for (const bowlerSpec of BOWLERS) {
      for (const lengthM of LENGTHS) {
        for (const lineM of LINES) {
          const flightByCase = flight({
            plan: { variation: 'stock', lengthM, lineM, speedKph: bowlerSpec.speedKph },
            bowler: bowlerSpec.bowler,
            conditions: CONDITIONS,
            seed: SEED,
            handedness: 'right',
          });
          for (const directionDeg of DIRECTIONS) {
            for (const errorMs of ERRORS) {
              const { input } = makeInput(bowlerSpec.id, bowlerSpec.bowler, bowlerSpec.speedKph, lengthM, lineM, directionDeg, errorMs, flightByCase);
              if (CASE_FILTER.size && !CASE_FILTER.has(input.id)) continue;
              let result: StrikeResult;
              try {
                result = strike(flightByCase, input.swing, input.options);
              } catch (error) {
                summary.corpus.crashes.push({ id: input.id, error: error instanceof Error ? error.stack : String(error) });
                continue;
              }
              summary.corpus.completed++;
              increment(summary.counts, result.contact.kind);
              outcomeHash = fnv(`${result.contact.kind}\n`, outcomeHash);
              gameplayHash = fnv(`${JSON.stringify(gameplay(result))}\n`, gameplayHash);
              const old = baseline ? baseline.get(input.id) : null;
              if (baseline && !old) throw new Error(`Missing baseline row ${input.id}`);
              if (old && old.gameplay.contact.kind !== result.contact.kind) {
                summary.changedKinds++;
                increment(summary.transitionsFromV2, `${old.gameplay.contact.kind}->${result.contact.kind}`);
              }
              if (old && JSON.stringify(old.gameplay) !== JSON.stringify(gameplay(result))) summary.changedGameplay++;
              if (old && old.exactPose !== null) {
                summary.oldBatContactCases++;
                if (old.gameplay.contact.kind !== result.contact.kind) summary.oldBatContactKindsChanged++;
                if (JSON.stringify(old.gameplay) !== JSON.stringify(gameplay(result))) summary.oldBatContactGameplayChanged++;
              }
              const track = result.track;
              if (!track) throw new Error(`Swing unexpectedly returned null track ${input.id}`);
              if (track.geometryAdmitted) summary.admittedTracks++;
              else {
                summary.whiffTracks++;
                const geometric = sweepRawBat(
                  flightByCase.samples,
                  { ...track, geometryAdmitted: true },
                  0,
                  flightByCase.samples.at(-1)!.t,
                ).hit;
                if (geometric) summary.hiddenWhiffGeometricHits.push({ id: input.id, part: geometric.part, t: geometric.t });
              }
              if (Math.hypot(track.collisionTwist.gripVelocity.x, track.collisionTwist.gripVelocity.y, track.collisionTwist.gripVelocity.z) <= 1e-15) {
                summary.zeroGripVelocityTracks++;
                if (summary.zeroGripVelocityTrackExamples.length < 32) summary.zeroGripVelocityTrackExamples.push(input.id);
              }
              const isBat = BAT_KINDS.has(result.contact.kind);
              if (isBat) {
                summary.batContacts++;
                if (result.contact.t! < track.startT - 1e-12) summary.preStartBatContacts++;
                if (!track.geometryAdmitted) summary.batContactOnWhiffTrack++;
                hitOffsets.push(result.contact.t! - track.plannedContactT);
              }
              const rootNorm = Math.hypot(result.batterRootOffset.x, result.batterRootOffset.z);
              roots.push(rootNorm);
              crouches.push(result.batterPosture.crouchM);
              contactUs.push(track.contactU);
              increment(familyCounts, track.shot.family);
              increment(footworkCounts, result.footwork);
              increment(familyKindCounts, `${track.shot.family}/${result.contact.kind}`);
              if (rootNorm > BAT_BODY_RETARGET_M + 1e-12 || result.batterPosture.crouchM > BAT_POSTURE_CROUCH_MAX_M + 1e-12) {
                summary.invariantFailures.push({ id: input.id, gate: 'root/posture', rootNorm, crouchM: result.batterPosture.crouchM });
              }
              const canonical = auditCanonicalTrack(track);
              canonicalReach.push(canonical.maximumReach);
              if (canonical.minimumGap < -1e-9 || canonical.maximumReach > BAT_HAND_REACH_M + 1e-9 || canonical.maximumLengthError > 1e-10 || canonical.maximumFaceUnitError > 1e-10 || canonical.maximumOrthogonalityError > 1e-10) {
                summary.invariantFailures.push({ id: input.id, gate: 'canonical', ...canonical });
              }
              const analytic = batTrackAnalyticEnvelope(track);
              if (analytic.gripSpeed > BAT_GRIP_SPEED_LIMIT_MPS + 1e-9 || analytic.pointSpeed > BAT_POINT_SPEED_LIMIT_MPS + 1e-9 || analytic.gripAcceleration > BAT_GRIP_ACCEL_LIMIT_MPS2 + 1e-9 || analytic.pointAcceleration > BAT_POINT_ACCEL_LIMIT_MPS2 + 1e-9 || analytic.angularSpeed > BAT_ANGULAR_SPEED_LIMIT_RADPS + 1e-9 || analytic.angularAcceleration > BAT_ANGULAR_ACCEL_LIMIT_RADPS2 + 1e-9) {
                summary.analyticFailures.push({ id: input.id, analytic });
              }
              const expectedCanonical = batSamples(track);
              if (!isBat && JSON.stringify(result.bat) !== JSON.stringify(expectedCanonical)) {
                summary.nonBatCanonicalFailures.push({ id: input.id, kind: result.contact.kind });
              }
              if (isBat) {
                const contactMatches = result.bat.filter((sample) => Math.abs(sample.t - result.contact.t!) <= 1e-12);
                if (contactMatches.length !== 1 || !exactPoseEqual(contactMatches[0], batPose(track, result.contact.t!))) {
                  summary.exactContactKnotFailures.push({ id: input.id, matches: contactMatches.length });
                }
                for (const sample of result.bat) {
                  if (sample.t <= result.contact.t! + 1e-12 && !exactPoseEqual(sample, batPose(track, sample.t))) {
                    summary.hitPrefixFailures.push({ id: input.id, t: sample.t, contactT: result.contact.t });
                    break;
                  }
                }
              }
              const motion = result.batterMotion;
              if (!motion || motion.startT !== result.bat[0]?.t || motion.endT > result.bat.at(-1)!.t || !(motion.startT < motion.contactT && motion.contactT < motion.endT) || result.bat.filter((sample) => Math.abs(sample.t - motion.contactT) <= 1e-12).length !== 1 || result.bat.filter((sample) => Math.abs(sample.t - motion.endT) <= 1e-12).length !== 1) {
                summary.motionAnchorFailures.push({ id: input.id, motion, first: result.bat[0]?.t, last: result.bat.at(-1)?.t });
              }
              const runtime = auditReturnedTrace(result);
              const updateRuntimeMaximum = (key: string, value: number, at?: unknown) => {
                if (!runtimeMaxima[key] || value > runtimeMaxima[key].value) runtimeMaxima[key] = { value, id: input.id, ...(at === undefined ? {} : { at }) };
              };
              updateRuntimeMaximum('minimumGapNegated', -runtime.minimumGap, { t: runtime.worstReachT });
              updateRuntimeMaximum('reach', runtime.maximumReach, { t: runtime.worstReachT });
              updateRuntimeMaximum('lengthError', runtime.maximumLengthError);
              updateRuntimeMaximum('faceUnitError', runtime.maximumFaceUnitError);
              updateRuntimeMaximum('orthogonalityError', runtime.maximumOrthogonalityError);
              updateRuntimeMaximum('gripSpeed', runtime.maximumGripSpeed);
              updateRuntimeMaximum('toeSpeed', runtime.maximumToeSpeed);
              updateRuntimeMaximum('angularSpeed', runtime.maximumAngularSpeed);
              updateRuntimeMaximum('gripAcceleration', runtime.maximumGripAcceleration, runtime.maximumGripAccelerationAt);
              updateRuntimeMaximum('toeAcceleration', runtime.maximumToeAcceleration, runtime.maximumToeAccelerationAt);
              updateRuntimeMaximum('angularAcceleration', runtime.maximumAngularAcceleration, runtime.maximumAngularAccelerationAt);
              updateRuntimeMaximum('terminalSpeed', runtime.terminalSpeed);
              runtimeReach.push(runtime.maximumReach);
              if (runtime.minimumGap < -1e-8 || runtime.maximumReach > BAT_HAND_REACH_M + 1e-8 || runtime.maximumLengthError > 1e-9 || runtime.maximumFaceUnitError > 1e-9 || runtime.maximumOrthogonalityError > 1e-9 || runtime.maximumGripSpeed > BAT_GRIP_SPEED_LIMIT_MPS + 0.05 || runtime.maximumToeSpeed > BAT_POINT_SPEED_LIMIT_MPS + 0.05 || runtime.maximumAngularSpeed > BAT_ANGULAR_SPEED_LIMIT_RADPS + 0.05 || runtime.maximumGripAcceleration > BAT_GRIP_ACCEL_LIMIT_MPS2 + 2 || runtime.maximumToeAcceleration > BAT_POINT_ACCEL_LIMIT_MPS2 + 2 || runtime.maximumAngularAcceleration > BAT_ANGULAR_ACCEL_LIMIT_RADPS2 + 2 || runtime.terminalSpeed > 0.1) {
                summary.invariantFailures.push({ id: input.id, gate: 'runtime', runtime });
              }
              const compact: CompactCase = {
                input,
                family: track.shot.family,
                footwork: result.footwork,
                kind: result.contact.kind,
                rootNorm,
                crouchM: result.batterPosture.crouchM,
                contactU: track.contactU,
                geometryAdmitted: track.geometryAdmitted,
                worstRuntimeReach: runtime.maximumReach,
              };
              candidates.push(compact);
              maxRoot = updateMaximum(maxRoot, rootNorm, compact);
              maxCrouch = updateMaximum(maxCrouch, compact.crouchM, compact);
              minContactU = updateMinimum(minContactU, compact.contactU, compact);
              maxContactU = updateMaximum(maxContactU, compact.contactU, compact);
              maxRuntimeReach = updateMaximum(maxRuntimeReach, compact.worstRuntimeReach, compact);
            }
          }
        }
      }
    }
    summary.outcomeHash = outcomeHash.toString(16).padStart(8, '0');
    summary.gameplayHash = gameplayHash.toString(16).padStart(8, '0');
    summary.runtimeMaxima = runtimeMaxima;
    summary.distributions = {
      rootNorm: distribution(roots),
      crouchM: distribution(crouches),
      contactU: distribution(contactUs),
      hitMinusPlannedContactSeconds: distribution(hitOffsets),
      canonicalMaximumReach: distribution(canonicalReach),
      runtimeMaximumReach: distribution(runtimeReach),
    };
    summary.familyCounts = familyCounts;
    summary.footworkCounts = footworkCounts;
    summary.familyKindCounts = familyKindCounts;
    const selected = new Map<string, CompactCase>();
    const select = (entry: CompactCase | undefined | null) => { if (entry) selected.set(entry.input.id, entry); };
    select(maxRoot?.item);
    select(maxCrouch?.item);
    select(minContactU?.item);
    select(maxContactU?.item);
    select(maxRuntimeReach?.item);
    const universe = new Set(candidates.flatMap(coverageFeatures));
    const covered = new Set([...selected.values()].flatMap(coverageFeatures));
    while ([...universe].some((feature) => !covered.has(feature))) {
      let best: CompactCase | null = null;
      let bestScore = -1;
      for (const candidate of candidates) {
        if (selected.has(candidate.input.id)) continue;
        const score = coverageFeatures(candidate).filter((feature) => universe.has(feature) && !covered.has(feature)).length;
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
      if (!best || bestScore <= 0) break;
      select(best);
      for (const feature of coverageFeatures(best)) covered.add(feature);
    }
    summary.proxySelection = {
      algorithm: 'mandatory exact extrema, then corpus-order deterministic greedy maximum uncovered family/footwork/bowler/contact-kind coverage',
      universe: [...universe].sort(),
      covered: [...covered].sort(),
      uncovered: [...universe].filter((feature) => !covered.has(feature)).sort(),
      ids: [...selected.keys()],
    };
    summary.extrema = {
      maxRoot: maxRoot && { value: maxRoot.value, id: maxRoot.item.input.id },
      maxCrouch: maxCrouch && { value: maxCrouch.value, id: maxCrouch.item.input.id },
      minContactU: minContactU && { value: minContactU.value, id: minContactU.item.input.id },
      maxContactU: maxContactU && { value: maxContactU.value, id: maxContactU.item.input.id },
      maxRuntimeReach: maxRuntimeReach && { value: maxRuntimeReach.value, id: maxRuntimeReach.item.input.id },
    };
    summary.reachProxies = [...selected.values()].map((entry) => {
      const { result } = replay(entry.input);
      const motion = result.batterMotion!;
      const contactT = BAT_KINDS.has(result.contact.kind) ? result.contact.t : null;
      const audit = auditReturnedTrace(result);
      const times = [...new Set([
        motion.startT,
        motion.contactT,
        motion.endT,
        result.bat.at(-1)!.t,
        audit.worstReachT,
      ])].sort((a, b) => a - b);
      const batProbes = times.map((t) => {
        const value = batAt(result.bat, t, contactT, result.batterMotion!.contactT)!;
        return { t, bat: { grip: value.grip, toe: value.toe, face: value.face } };
      });
      const accelerationTimes = [...new Set([
        (audit.maximumGripAccelerationAt as { t?: unknown } | null)?.t,
        (audit.maximumToeAccelerationAt as { t?: unknown } | null)?.t,
        (audit.maximumAngularAccelerationAt as { t?: unknown } | null)?.t,
      ].filter((value): value is number => typeof value === 'number'))];
      const sourceNeighborhoods = accelerationTimes.map((t) => {
        let upper = result.bat.findIndex((sample) => sample.t >= t);
        if (upper < 0) upper = result.bat.length - 1;
        const from = Math.max(0, upper - 3);
        const to = Math.min(result.bat.length, upper + 4);
        return { t, from, knots: result.bat.slice(from, to).map((sample, localIndex) => ({ index: from + localIndex, ...sample })) };
      });
      return {
        id: entry.input.id,
        family: entry.family,
        footwork: entry.footwork,
        contactU: entry.contactU,
        batterRootOffset: result.batterRootOffset,
        batterPosture: result.batterPosture,
        batterBodyFrame: result.batterBodyFrame,
        batterMotion: result.batterMotion,
        batProbes,
        provenance: entry.input,
        observed: {
          contactKind: result.contact.kind,
          geometryAdmitted: result.track!.geometryAdmitted,
          rootNorm: entry.rootNorm,
          worstRuntimeReach: audit.maximumReach,
          worstRuntimeReachT: audit.worstReachT,
        },
        diagnostics: {
          track: {
            startT: result.track!.startT,
            plannedContactT: result.track!.plannedContactT,
            zoneOut: result.track!.zoneOut,
            endT: trackEndT(result.track!),
          },
          contact: result.contact,
          acceleration: {
            grip: { value: audit.maximumGripAcceleration, at: audit.maximumGripAccelerationAt },
            toe: { value: audit.maximumToeAcceleration, at: audit.maximumToeAccelerationAt },
            angular: { value: audit.maximumAngularAcceleration, at: audit.maximumAngularAccelerationAt },
          },
          sourceNeighborhoods,
        },
      };
    });
    writeFileSync(OUTPUT, `${JSON.stringify(summary, null, 2)}\n`);
    if (summary.corpus.crashes.length) throw new Error(`${summary.corpus.crashes.length} corpus cases crashed; see ${OUTPUT}`);
  });
});
