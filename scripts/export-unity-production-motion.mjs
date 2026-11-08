#!/usr/bin/env node
/**
 * Deterministically converts selected CMU ASF/AMC motion references into VANDE's
 * compact, presentation-only VMA1 stream.
 *
 * VMA1 is deliberately not a gameplay authority. It stores root-locked,
 * semantically keyed reference poses which a future Unity presentation layer
 * may retarget and correct. Release/contact timing, the ball trace, contact and
 * scoring continue to come exclusively from the TypeScript Practice packet.
 *
 * The CMU trials are useful motion foundations, not cricket-authentic clips.
 * Baseball pitch/swing/bunt and running require authored cricket correction,
 * planted-foot constraints and hand/bat IK before they may be player-facing.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_SOURCE_DIR = '/private/tmp/vande-cmu-motion-audit';
export const DEFAULT_OUTPUT_DIR = '/private/tmp/vande-production-motion-output';

export const VMA_MAGIC = 'VMA1';
export const VMA_VERSION = 1;
export const VMA_HEADER_BYTES = 64;
export const VMA_BONE_RECORD_BYTES = 8;
export const VMA_QUATERNION_BYTES = 8;
export const VMA_ROOT_POSITION_BYTES = 6;
export const VMA_MARKER_BYTES = 8;
export const VMA_ROOT_POSITION_METRES_PER_UNIT = 0.001;

const CMU_TERMS_URL = 'https://mocap.cs.cmu.edu/';
const CMU_INDEX_URL = 'https://mocap.cs.cmu.edu/search.php';
const OUTPUT_SAMPLE_RATE = 60;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const CLIPS = Object.freeze([
  Object.freeze({
    id: 'cmu-124-baseball-pitch-reference',
    role: 'bowling_reference_only',
    skeleton: '124.asf',
    motion: '124_01.amc',
    sourceFps: 120,
    sourceDescription: 'Baseball Pitch',
    sourceSkeletonSha256: 'b0e6a62b7e151200497b8bbcf42d0e95800decabec9254f8653e57dcde45dd45',
    sourceMotionSha256: '7fd098ab1b535c38a3a6ae7c82f7c87299e177ce665dd65fa19db110e22f0857',
  }),
  Object.freeze({
    id: 'cmu-124-baseball-swing-reference',
    role: 'batting_reference_only',
    skeleton: '124.asf',
    motion: '124_07.amc',
    sourceFps: 120,
    sourceDescription: 'Baseball Swing',
    sourceSkeletonSha256: 'b0e6a62b7e151200497b8bbcf42d0e95800decabec9254f8653e57dcde45dd45',
    sourceMotionSha256: '4d9773480a816e24c272ba9414c6bd407d2768cedb72698287ba47b3709ff36f',
  }),
  Object.freeze({
    id: 'cmu-124-baseball-bunt-reference',
    role: 'defensive_batting_reference_only',
    skeleton: '124.asf',
    motion: '124_08.amc',
    sourceFps: 120,
    sourceDescription: 'Baseball Bunt',
    sourceSkeletonSha256: 'b0e6a62b7e151200497b8bbcf42d0e95800decabec9254f8653e57dcde45dd45',
    sourceMotionSha256: '6dd6f7de3e9f997f2786dc1d08447a7ca4c77847bf85f4f69eab71c71487b0a8',
  }),
  Object.freeze({
    id: 'cmu-35-run-jog-reference',
    role: 'runup_reference_only',
    skeleton: '35.asf',
    motion: '35_17.amc',
    sourceFps: 120,
    sourceDescription: 'run/jog',
    sourceSkeletonSha256: '2a8e2eda3c0d7d828566b2a9a8ab36b2b8b3864110574e8b73c8f069fded416c',
    sourceMotionSha256: '8096cd53878242dbc35e987288cef6ae81d4e1c0e207086639bbed5cc06c8fee',
  }),
]);

// Stable IDs are a serialized contract. Do not reorder or reuse an ID.
export const SEMANTIC_BONES = Object.freeze([
  ['root', null, 'root'],
  ['spine_lower', 'root', 'lowerback'],
  ['spine_upper', 'spine_lower', 'upperback'],
  ['chest', 'spine_upper', 'thorax'],
  ['neck_lower', 'chest', 'lowerneck'],
  ['neck_upper', 'neck_lower', 'upperneck'],
  ['head', 'neck_upper', 'head'],
  ['clavicle_left', 'chest', 'lclavicle'],
  ['upper_arm_left', 'clavicle_left', 'lhumerus'],
  ['forearm_left', 'upper_arm_left', 'lradius'],
  ['wrist_left', 'forearm_left', 'lwrist'],
  ['hand_left', 'wrist_left', 'lhand'],
  ['fingers_left', 'hand_left', 'lfingers'],
  ['thumb_left', 'wrist_left', 'lthumb'],
  ['clavicle_right', 'chest', 'rclavicle'],
  ['upper_arm_right', 'clavicle_right', 'rhumerus'],
  ['forearm_right', 'upper_arm_right', 'rradius'],
  ['wrist_right', 'forearm_right', 'rwrist'],
  ['hand_right', 'wrist_right', 'rhand'],
  ['fingers_right', 'hand_right', 'rfingers'],
  ['thumb_right', 'wrist_right', 'rthumb'],
  ['upper_leg_left', 'root', 'lfemur'],
  ['lower_leg_left', 'upper_leg_left', 'ltibia'],
  ['foot_left', 'lower_leg_left', 'lfoot'],
  ['toes_left', 'foot_left', 'ltoes'],
  ['upper_leg_right', 'root', 'rfemur'],
  ['lower_leg_right', 'upper_leg_right', 'rtibia'],
  ['foot_right', 'lower_leg_right', 'rfoot'],
  ['toes_right', 'foot_right', 'rtoes'],
].map(([name, parent, source], id) => Object.freeze({ id, name, parent, source })));

const finiteNumber = (token, context) => {
  const value = Number(token);
  if (!Number.isFinite(value)) throw new Error(`${context} contains a non-finite number`);
  return value;
};

const tokenize = (line) => line.trim().split(/\s+/).filter(Boolean);

export function parseAsf(text) {
  if (typeof text !== 'string' || !text.includes(':bonedata') || !text.includes(':hierarchy'))
    throw new Error('ASF source is missing bonedata or hierarchy');
  const lines = text.replace(/\r/g, '').split('\n');
  let section = '';
  let lengthUnit = null;
  let rootOrder = [];
  let rootAxisOrder = 'XYZ';
  const bones = new Map();
  const parents = new Map();
  let active = null;
  let inHierarchy = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith(':')) {
      section = line.toLowerCase();
      inHierarchy = section === ':hierarchy';
      continue;
    }
    const parts = tokenize(line);
    if (section === ':units' && parts[0].toLowerCase() === 'length') {
      lengthUnit = finiteNumber(parts[1], 'ASF length unit');
    } else if (section === ':root') {
      if (parts[0].toLowerCase() === 'order') rootOrder = parts.slice(1).map((value) => value.toLowerCase());
      if (parts[0].toLowerCase() === 'axis') rootAxisOrder = (parts[1] || 'XYZ').toUpperCase();
    } else if (section === ':bonedata') {
      if (parts[0].toLowerCase() === 'begin') {
        active = { id: null, name: null, direction: [0, 0, 0], length: 0, axis: [0, 0, 0], axisOrder: 'XYZ', dof: [] };
      } else if (parts[0].toLowerCase() === 'end') {
        if (!active || !active.name || !Number.isInteger(active.id)) throw new Error('ASF bone block is incomplete');
        if (bones.has(active.name)) throw new Error(`ASF repeats bone ${active.name}`);
        bones.set(active.name, Object.freeze(active));
        active = null;
      } else if (active) {
        const key = parts[0].toLowerCase();
        if (key === 'id') active.id = finiteNumber(parts[1], 'ASF bone id');
        else if (key === 'name') active.name = parts[1];
        else if (key === 'direction') active.direction = parts.slice(1, 4).map((v) => finiteNumber(v, 'ASF direction'));
        else if (key === 'length') active.length = finiteNumber(parts[1], 'ASF bone length');
        else if (key === 'axis') {
          active.axis = parts.slice(1, 4).map((v) => finiteNumber(v, 'ASF axis'));
          active.axisOrder = (parts[4] || 'XYZ').toUpperCase();
        } else if (key === 'dof') active.dof = parts.slice(1).map((value) => value.toLowerCase());
      }
    } else if (inHierarchy || section === ':hierarchy') {
      if (parts[0].toLowerCase() === 'begin' || parts[0].toLowerCase() === 'end') continue;
      const parent = parts[0];
      for (const child of parts.slice(1)) {
        if (parents.has(child)) throw new Error(`ASF hierarchy repeats parent for ${child}`);
        parents.set(child, parent);
      }
    }
  }
  if (!Number.isFinite(lengthUnit) || lengthUnit <= 0) throw new Error('ASF has no valid length unit');
  if (rootOrder.length !== 6) throw new Error('ASF root order is incomplete');
  if (bones.size === 0) throw new Error('ASF has no bones');
  for (const bone of bones.values()) {
    if (bone.id < 1 || bone.id > 0xffff) throw new Error(`ASF bone ${bone.name} has invalid id`);
    if (!parents.has(bone.name)) throw new Error(`ASF hierarchy omits ${bone.name}`);
  }
  return Object.freeze({
    lengthUnit,
    // CMU/VICON ASF lengths are expressed in units of 0.45 inches.
    metresPerUnit: lengthUnit * 0.0254,
    rootOrder: Object.freeze(rootOrder),
    rootAxisOrder,
    bones,
    parents,
  });
}

export function parseAmc(text, skeleton) {
  if (!skeleton || !(skeleton.bones instanceof Map)) throw new Error('A parsed ASF skeleton is required');
  if (typeof text !== 'string' || !text.includes(':DEGREES')) throw new Error('AMC source must declare degrees');
  const lines = text.replace(/\r/g, '').split('\n');
  const frames = [];
  let frame = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(':')) continue;
    if (/^\d+$/.test(line)) {
      const number = Number(line);
      if (frame) frames.push(Object.freeze(frame));
      if (frames.length && number !== frames[frames.length - 1].number + 1)
        throw new Error('AMC frame numbers are not contiguous');
      frame = { number, channels: new Map() };
      continue;
    }
    if (!frame) throw new Error('AMC channel appears before the first frame');
    const parts = tokenize(line);
    const name = parts[0];
    const order = name === 'root' ? skeleton.rootOrder : skeleton.bones.get(name)?.dof;
    if (!order) throw new Error(`AMC references unknown bone ${name}`);
    if (parts.length - 1 !== order.length)
      throw new Error(`AMC ${name} channel count does not match ASF`);
    frame.channels.set(name, Object.freeze(parts.slice(1).map((v) => finiteNumber(v, `AMC ${name}`))));
  }
  if (frame) frames.push(Object.freeze(frame));
  if (frames.length < 2) throw new Error('AMC has fewer than two frames');
  for (const frameValue of frames) {
    if (!frameValue.channels.has('root')) throw new Error(`AMC frame ${frameValue.number} has no root`);
  }
  return Object.freeze(frames);
}

const quatIdentity = () => [0, 0, 0, 1];
const quatNormalize = (q) => {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!Number.isFinite(length) || length < 1e-12) throw new Error('Cannot normalize quaternion');
  let result = q.map((value) => value / length);
  // q and -q encode the same orientation. Canonicalizing prevents platform/sign drift.
  if (result[3] < 0 || (result[3] === 0 && result.find((v) => v !== 0) < 0)) result = result.map((v) => -v);
  return result;
};
const quatMultiply = (a, b) => quatNormalize([
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]);
const quatInverse = (q) => [-q[0], -q[1], -q[2], q[3]];
const quatAxis = (axis, degrees) => {
  const radians = degrees * Math.PI / 180 * 0.5;
  const sine = Math.sin(radians);
  if (axis === 'X') return [sine, 0, 0, Math.cos(radians)];
  if (axis === 'Y') return [0, sine, 0, Math.cos(radians)];
  if (axis === 'Z') return [0, 0, sine, Math.cos(radians)];
  throw new Error(`Unsupported rotation axis ${axis}`);
};
const quatEuler = (angles, order) => {
  let value = quatIdentity();
  for (let i = 0; i < order.length; i += 1)
    value = quatMultiply(value, quatAxis(order[i], angles[i] || 0));
  return value;
};
const quatSlerp = (a, b, t) => {
  let second = b;
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (dot < 0) { dot = -dot; second = b.map((v) => -v); }
  if (dot > 0.9995) return quatNormalize(a.map((v, i) => v + (second[i] - v) * t));
  const theta0 = Math.acos(Math.max(-1, Math.min(1, dot)));
  const theta = theta0 * t;
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - dot * Math.sin(theta) / sinTheta0;
  const s1 = Math.sin(theta) / sinTheta0;
  return quatNormalize(a.map((v, i) => s0 * v + s1 * second[i]));
};

const channelMap = (values, order) => new Map(order.map((name, index) => [name, values[index]]));

function poseFrame(frame, skeleton, rootLock) {
  const rootValues = channelMap(frame.channels.get('root'), skeleton.rootOrder);
  const baseRoot = [rootValues.get('tx') || 0, rootValues.get('ty') || 0, rootValues.get('tz') || 0]
    .map((value) => value * skeleton.metresPerUnit);
  const rootAngles = ['rx', 'ry', 'rz'].map((name) => rootValues.get(name) || 0);
  const rotations = [];
  for (const semantic of SEMANTIC_BONES) {
    if (semantic.source === 'root') {
      rotations.push(quatEuler(rootAngles, 'XYZ'));
      continue;
    }
    const bone = skeleton.bones.get(semantic.source);
    if (!bone) throw new Error(`ASF lacks required semantic source ${semantic.source}`);
    const values = frame.channels.get(semantic.source) || [];
    const byChannel = channelMap(values, bone.dof);
    const motionAngles = ['rx', 'ry', 'rz'].map((name) => byChannel.get(name) || 0);
    const axis = quatEuler(bone.axis, bone.axisOrder);
    const motion = quatEuler(motionAngles, 'XYZ');
    rotations.push(quatMultiply(quatMultiply(quatInverse(axis), motion), axis));
  }
  return { root: rootLock ? [0, 0, 0] : baseRoot, rotations };
}

const angularDistanceDegrees = (a, b) => {
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return 2 * Math.acos(dot) * 180 / Math.PI;
};

export function selectMotionWindow(poses, sourceFps) {
  if (!Array.isArray(poses) || poses.length < 2) throw new Error('At least two poses are required');
  const energies = [];
  for (let i = 1; i < poses.length; i += 1) {
    let energy = 0;
    for (let bone = 1; bone < poses[i].rotations.length; bone += 1)
      energy += angularDistanceDegrees(poses[i - 1].rotations[bone], poses[i].rotations[bone]);
    energies.push(energy / Math.max(1, poses[i].rotations.length - 1));
  }
  const maximum = Math.max(...energies);
  const threshold = Math.max(0.08, maximum * 0.08);
  let first = energies.findIndex((value) => value >= threshold);
  let last = energies.length - 1;
  while (last >= 0 && energies[last] < threshold) last -= 1;
  if (first < 0 || last < first) return { start: 0, end: poses.length - 1, sourcePeak: 0 };
  const padding = Math.max(1, Math.round(sourceFps * 0.25));
  first = Math.max(0, first + 1 - padding);
  last = Math.min(poses.length - 1, last + 1 + padding);
  if (last - first + 1 < sourceFps) {
    const missing = sourceFps - (last - first + 1);
    first = Math.max(0, first - Math.ceil(missing / 2));
    last = Math.min(poses.length - 1, last + Math.floor(missing / 2));
  }
  let peak = 0;
  for (let i = 1; i < energies.length; i += 1) if (energies[i] > energies[peak]) peak = i;
  return { start: first, end: last, sourcePeak: peak + 1 };
}

function resample(poses, start, end, sourceFps, targetFps) {
  const duration = (end - start) / sourceFps;
  const count = Math.max(2, Math.round(duration * targetFps) + 1);
  const output = [];
  for (let frame = 0; frame < count; frame += 1) {
    const sourcePosition = start + (frame / (count - 1)) * (end - start);
    const lower = Math.floor(sourcePosition);
    const upper = Math.min(end, lower + 1);
    const t = sourcePosition - lower;
    output.push({
      root: poses[lower].root.map((value, index) => value + (poses[upper].root[index] - value) * t),
      rotations: poses[lower].rotations.map((value, index) => quatSlerp(value, poses[upper].rotations[index], t)),
    });
  }
  const origin = output[0].root;
  for (const pose of output) pose.root = pose.root.map((value, index) => value - origin[index]);
  return output;
}

const writeAscii = (buffer, offset, value) => buffer.write(value, offset, 'ascii');
const quantizeQuaternion = (value) => value.map((component) => Math.max(-32767, Math.min(32767, Math.round(component * 32767))));
const quantizeRoot = (value) => value.map((component) => {
  const quantized = Math.round(component / VMA_ROOT_POSITION_METRES_PER_UNIT);
  if (quantized < -32768 || quantized > 32767) throw new Error('Root translation exceeds VMA1 range');
  return quantized;
});

export function encodeVma({ clipId, frames, sampleRate, sourceMotionSha256, rootLocked, sourcePeak, sourceStart, sourceEnd }) {
  if (!clipId || !Array.isArray(frames) || frames.length < 2) throw new Error('VMA1 needs an id and at least two frames');
  const peakRatio = sourceEnd === sourceStart ? 0 : (sourcePeak - sourceStart) / (sourceEnd - sourceStart);
  const peakFrame = Math.max(0, Math.min(frames.length - 1, Math.round(peakRatio * (frames.length - 1))));
  const markers = [
    { kind: 1, frame: 0, confidence: 65535 },
    { kind: 2, frame: peakFrame, confidence: 32768 },
    { kind: 3, frame: frames.length - 1, confidence: 65535 },
  ];
  const boneCount = SEMANTIC_BONES.length;
  const frameBytes = VMA_ROOT_POSITION_BYTES + boneCount * VMA_QUATERNION_BYTES;
  const length = VMA_HEADER_BYTES + boneCount * VMA_BONE_RECORD_BYTES +
    frames.length * frameBytes + markers.length * VMA_MARKER_BYTES;
  const bytes = Buffer.alloc(length);
  writeAscii(bytes, 0, VMA_MAGIC);
  bytes.writeUInt16LE(VMA_VERSION, 4);
  bytes.writeUInt16LE(VMA_HEADER_BYTES, 6);
  bytes.writeUInt32LE(rootLocked ? 1 : 0, 8);
  bytes.writeUInt16LE(sampleRate, 12);
  bytes.writeUInt16LE(boneCount, 14);
  bytes.writeUInt32LE(frames.length, 16);
  bytes.writeUInt16LE(markers.length, 20);
  bytes.writeUInt16LE(VMA_BONE_RECORD_BYTES, 22);
  bytes.writeUInt16LE(VMA_QUATERNION_BYTES, 24);
  bytes.writeUInt16LE(VMA_MARKER_BYTES, 26);
  bytes.writeUInt32LE(Math.round((frames.length - 1) / sampleRate * 1000), 28);
  Buffer.from(sourceMotionSha256, 'hex').copy(bytes, 32, 0, 16);
  createHash('sha256').update(clipId).digest().copy(bytes, 48, 0, 8);
  bytes.writeFloatLE(VMA_ROOT_POSITION_METRES_PER_UNIT, 56);
  bytes.writeUInt32LE(frameBytes, 60);

  const semanticIndex = new Map(SEMANTIC_BONES.map((bone) => [bone.name, bone.id]));
  let offset = VMA_HEADER_BYTES;
  for (const bone of SEMANTIC_BONES) {
    bytes.writeUInt16LE(bone.id, offset);
    bytes.writeInt16LE(bone.parent == null ? -1 : semanticIndex.get(bone.parent), offset + 2);
    bytes.writeUInt16LE(bone.id, offset + 4); // stable semantic source index, not an ASF ordinal
    bytes.writeUInt16LE(bone.id === 0 ? 1 : 0, offset + 6);
    offset += VMA_BONE_RECORD_BYTES;
  }
  for (const frame of frames) {
    for (const value of quantizeRoot(frame.root)) { bytes.writeInt16LE(value, offset); offset += 2; }
    if (frame.rotations.length !== boneCount) throw new Error('VMA1 pose has the wrong bone count');
    for (const rotation of frame.rotations) {
      for (const value of quantizeQuaternion(rotation)) { bytes.writeInt16LE(value, offset); offset += 2; }
    }
  }
  for (const marker of markers) {
    bytes.writeUInt16LE(marker.kind, offset);
    bytes.writeUInt16LE(marker.frame, offset + 2);
    bytes.writeUInt16LE(marker.confidence, offset + 4);
    bytes.writeUInt16LE(0, offset + 6);
    offset += VMA_MARKER_BYTES;
  }
  if (offset !== bytes.length) throw new Error(`VMA1 writer stopped at ${offset}, expected ${bytes.length}`);
  return { bytes, markers, frameBytes };
}

export function decodeVmaHeader(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < VMA_HEADER_BYTES) throw new Error('VMA1 stream is truncated');
  if (bytes.toString('ascii', 0, 4) !== VMA_MAGIC) throw new Error('VMA1 magic is invalid');
  if (bytes.readUInt16LE(4) !== VMA_VERSION || bytes.readUInt16LE(6) !== VMA_HEADER_BYTES)
    throw new Error('VMA1 version/header is unsupported');
  const boneCount = bytes.readUInt16LE(14);
  const frameCount = bytes.readUInt32LE(16);
  const markerCount = bytes.readUInt16LE(20);
  const frameBytes = bytes.readUInt32LE(60);
  const expected = VMA_HEADER_BYTES + boneCount * VMA_BONE_RECORD_BYTES +
    frameCount * frameBytes + markerCount * VMA_MARKER_BYTES;
  if (bytes.length !== expected) throw new Error(`VMA1 length ${bytes.length} does not match ${expected}`);
  return Object.freeze({
    rootLocked: (bytes.readUInt32LE(8) & 1) !== 0,
    sampleRate: bytes.readUInt16LE(12), boneCount, frameCount, markerCount,
    durationMs: bytes.readUInt32LE(28), frameBytes,
  });
}

export async function convertClip(spec, { sourceDir = DEFAULT_SOURCE_DIR, outputDir = DEFAULT_OUTPUT_DIR, rootLock = true, sampleRate = OUTPUT_SAMPLE_RATE } = {}) {
  if (!Number.isInteger(sampleRate) || sampleRate < 15 || sampleRate > 120)
    throw new Error('Output sample rate must be an integer from 15 to 120');
  const [asfBytes, amcBytes] = await Promise.all([
    readFile(join(sourceDir, spec.skeleton)),
    readFile(join(sourceDir, spec.motion)),
  ]);
  if (sha256(asfBytes) !== spec.sourceSkeletonSha256) throw new Error(`${spec.id} skeleton hash mismatch`);
  if (sha256(amcBytes) !== spec.sourceMotionSha256) throw new Error(`${spec.id} motion hash mismatch`);
  const skeleton = parseAsf(asfBytes.toString('utf8'));
  const sourceFrames = parseAmc(amcBytes.toString('utf8'), skeleton);
  const sourcePoses = sourceFrames.map((frame) => poseFrame(frame, skeleton, rootLock));
  const window = selectMotionWindow(sourcePoses, spec.sourceFps);
  const frames = resample(sourcePoses, window.start, window.end, spec.sourceFps, sampleRate);
  const encoded = encodeVma({
    clipId: spec.id, frames, sampleRate, sourceMotionSha256: spec.sourceMotionSha256,
    rootLocked: rootLock, sourcePeak: window.sourcePeak, sourceStart: window.start, sourceEnd: window.end,
  });
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${spec.id}.vma.bytes`);
  await writeFile(outputPath, encoded.bytes);
  return Object.freeze({
    id: spec.id,
    role: spec.role,
    outputPath,
    outputBytes: encoded.bytes.length,
    outputSha256: sha256(encoded.bytes),
    sourceSkeleton: spec.skeleton,
    sourceSkeletonSha256: spec.sourceSkeletonSha256,
    sourceMotion: spec.motion,
    sourceMotionSha256: spec.sourceMotionSha256,
    sourceDescription: spec.sourceDescription,
    sourceFrames: sourceFrames.length,
    sourceFps: spec.sourceFps,
    selectedSourceWindow: Object.freeze({ startFrame: window.start + 1, endFrame: window.end + 1, technicalActionPeakFrame: window.sourcePeak + 1 }),
    outputFrames: frames.length,
    outputFps: sampleRate,
    outputDurationSeconds: (frames.length - 1) / sampleRate,
    rootLocked: rootLock,
    markers: encoded.markers.map((marker) => Object.freeze({
      kind: marker.kind === 1 ? 'clip_start' : marker.kind === 2 ? 'technical_action_peak' : 'clip_end',
      frame: marker.frame,
      confidence: marker.confidence / 65535,
    })),
  });
}

export async function exportProductionMotion(options = {}) {
  const sourceDir = resolve(options.sourceDir || DEFAULT_SOURCE_DIR);
  const outputDir = resolve(options.outputDir || DEFAULT_OUTPUT_DIR);
  const selected = options.clipIds?.length
    ? CLIPS.filter((clip) => options.clipIds.includes(clip.id))
    : CLIPS;
  if (selected.length === 0) throw new Error('No known CMU motion clip was selected');
  const results = [];
  for (const clip of selected) results.push(await convertClip(clip, {
    sourceDir, outputDir, rootLock: options.rootLock !== false, sampleRate: options.sampleRate || OUTPUT_SAMPLE_RATE,
  }));
  const manifest = {
    format: 'VMA1/version-1/semantic-quaternion-reference-motion',
    generatedAtUtc: new Date().toISOString(),
    generator: 'scripts/export-unity-production-motion.mjs',
    purpose: 'Stage 1 Unity presentation reference motion only',
    source: {
      name: 'Carnegie Mellon University Graphics Lab Motion Capture Database',
      indexUrl: CMU_INDEX_URL,
      termsUrl: CMU_TERMS_URL,
      termsSummary: 'CMU states the data may be included in commercially sold products but may not be resold directly, including in converted form; acknowledgment is requested.',
      acknowledgementRequested: 'The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.',
    },
    authorityBoundary: 'Motion is presentation-only. TypeScript canonical traces remain sole authority for release, contact, ball flight, score and replay.',
    acceptance: 'REFERENCE CANDIDATES ONLY / CRICKET AUTHENTICITY, PLAYER-FACING USE, AND INDEPENDENT VISUAL ACCEPTANCE UNPROVEN',
    limitations: [
      'No cricket-specific CMU trial was found.',
      'Baseball pitch, swing and bunt require authored cricket correction.',
      'CMU warns that hand/toe data are noisy and finger/thumb joints were not captured.',
      'technical_action_peak is an energy-derived alignment hint, not release or bat contact.',
      'Android fresh-installed size and India-weighted working reach remain UNPROVEN.',
    ],
    rootLock: options.rootLock !== false,
    outputSampleRate: options.sampleRate || OUTPUT_SAMPLE_RATE,
    clips: results,
  };
  const manifestPath = join(outputDir, 'production-motion-provenance.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return Object.freeze({ manifestPath, results: Object.freeze(results), manifest: Object.freeze(manifest) });
}

function parseArguments(argv) {
  const options = {};
  for (const argument of argv) {
    if (argument.startsWith('--source-dir=')) options.sourceDir = argument.slice(13);
    else if (argument.startsWith('--output-dir=')) options.outputDir = argument.slice(13);
    else if (argument.startsWith('--clip=')) (options.clipIds ||= []).push(argument.slice(7));
    else if (argument.startsWith('--sample-rate=')) options.sampleRate = Number(argument.slice(14));
    else if (argument === '--preserve-root') options.rootLock = false;
    else throw new Error(`Unknown argument ${argument}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportProductionMotion(parseArguments(process.argv.slice(2)))
    .then(({ manifestPath, results }) => {
      for (const result of results)
        process.stdout.write(`${result.id}: ${result.outputBytes} bytes ${result.outputSha256}\n`);
      process.stdout.write(`manifest: ${manifestPath}\n`);
    })
    .catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}

