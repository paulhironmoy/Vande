import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { V3_BONE_NAMES, parseVpm3Header } from './export-unity-production-character-v3.mjs';
import {
  BAT_DIMENSIONS,
  BAT_TRIANGLE_BUDGETS,
  DEFAULT_GEAR_SKELETON,
  GEAR_DIMENSIONS,
  GEAR_FAMILIES,
  GEAR_REGIONS,
  GEAR_TRIANGLE_BUDGETS,
  VBT_VERTEX_BYTES,
  buildCricketBat,
  buildCricketGear,
  decodeGearSkeleton,
  encodeVbt1,
  exportProductionCricketGear,
  helmetShellLocalPoint,
  parseVbt1Header,
} from './export-unity-production-cricket-gear.mjs';

const EPSILON = 1e-6;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (value) => {
  const magnitude = Math.hypot(...value);
  assert.ok(magnitude > 1e-9, 'expected a non-zero direction');
  return value.map((component) => component / magnitude);
};

function quatMultiply(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function inverseRotate(rotation, point) {
  const inverse = [-rotation[0], -rotation[1], -rotation[2], rotation[3]];
  const normSquared = rotation.reduce((sum, value) => sum + value * value, 0);
  return quatMultiply(quatMultiply(inverse, [...point, 0]), rotation).slice(0, 3)
    .map((value) => value / (normSquared * normSquared));
}

function rigidBoneBounds(mesh, skeleton, boneName) {
  const bone = V3_BONE_NAMES.indexOf(boneName);
  assert.notEqual(bone, -1, `missing ${boneName}`);
  const frame = skeleton.world[bone];
  const positions = mesh.vertices
    .filter((vertex) => vertex.bones[0] === bone && vertex.weights[0] === 255)
    .map((vertex) => inverseRotate(frame.rotation, vertex.position.map(
      (value, axis) => value - frame.position[axis])));
  assert.ok(positions.length > 0, `no vertices rigid-bound to ${boneName}`);
  const minimum = [0, 1, 2].map((axis) => Math.min(...positions.map((value) => value[axis])));
  const maximum = [0, 1, 2].map((axis) => Math.max(...positions.map((value) => value[axis])));
  return { minimum, maximum, size: maximum.map((value, axis) => value - minimum[axis]) };
}

function assertWithin(value, minimum, maximum, label) {
  assert.ok(value >= minimum - EPSILON && value <= maximum + EPSILON,
    `${label} ${value} must stay in [${minimum}, ${maximum}]`);
}

function rigidEllipsoidNormalDots(mesh, skeleton, boneName, region, centreOffset, radii,
  component = null) {
  const bone = V3_BONE_NAMES.indexOf(boneName);
  assert.notEqual(bone, -1, `missing ${boneName}`);
  const frame = skeleton.world[bone];
  return mesh.vertices
    .filter((vertex) => vertex.region === region &&
      (component == null || vertex.component === component) &&
      vertex.bones[0] === bone && vertex.weights[0] === 255)
    .map((vertex) => ({
      vertex,
      localPosition: inverseRotate(frame.rotation, vertex.position.map(
        (value, axis) => value - frame.position[axis]))
        .map((value, axis) => value - centreOffset[axis]),
    }))
    // A latitude/longitude grid duplicates the exact pole for every longitude. Those singular vertices have no
    // unique surface tangent; triangle winding below is the authority at the cap. Keep the vertex-normal check on
    // the non-singular rendered surface where interpolation affects exterior lighting.
    .filter(({ localPosition }) => Math.hypot(
      localPosition[0] / radii[0], localPosition[2] / radii[2]) > 0.05)
    .map(({ vertex, localPosition }) => {
      const expected = normalize(localPosition.map((value, axis) => value / (radii[axis] ** 2)));
      const actual = normalize(inverseRotate(frame.rotation, vertex.normal));
      return dot(actual, expected);
    });
}

function rigidEllipsoidTriangleDots(mesh, skeleton, boneName, region, centreOffset, radii,
  component = null) {
  const bone = V3_BONE_NAMES.indexOf(boneName);
  assert.notEqual(bone, -1, `missing ${boneName}`);
  const frame = skeleton.world[bone];
  const localPosition = (vertex) => inverseRotate(frame.rotation, vertex.position.map(
    (value, axis) => value - frame.position[axis]))
    .map((value, axis) => value - centreOffset[axis]);
  const dots = [];
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const triangle = [0, 1, 2].map((corner) => mesh.vertices[mesh.indices[offset + corner]]);
    if (!triangle.every((vertex) => vertex.region === region &&
      (component == null || vertex.component === component) &&
      vertex.bones[0] === bone && vertex.weights[0] === 255)) continue;
    const positions = triangle.map(localPosition);
    const unnormalizedFace = cross(
      subtract(positions[1], positions[0]),
      subtract(positions[2], positions[0]),
    );
    if (Math.hypot(...unnormalizedFace) < 1e-10) continue;
    const centre = [0, 1, 2].map((axis) =>
      (positions[0][axis] + positions[1][axis] + positions[2][axis]) / 3);
    const expected = normalize(centre.map((value, axis) => value / (radii[axis] ** 2)));
    dots.push(dot(normalize(unnormalizedFace), expected));
  }
  return dots;
}

function trianglesForComponent(mesh, component) {
  const triangles = [];
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const indices = [mesh.indices[offset], mesh.indices[offset + 1], mesh.indices[offset + 2]];
    if (indices.every((index) => mesh.vertices[index].component === component))
      triangles.push({ indices, positions: indices.map((index) => mesh.vertices[index].position) });
  }
  return triangles;
}

function localizeTriangles(triangles, frame, centreOffset) {
  return triangles.map(({ indices, positions }) => ({
    indices,
    positions: positions.map((position) => {
      const boneLocal = inverseRotate(frame.rotation, position.map(
        (value, axis) => value - frame.position[axis]));
      return boneLocal.map((value, axis) => value - centreOffset[axis]);
    }),
  }));
}

function localizeComponentVertices(mesh, component, frame, centreOffset) {
  return mesh.vertices
    .filter((vertex) => vertex.component === component)
    .map((vertex) => {
      const boneLocal = inverseRotate(frame.rotation, vertex.position.map(
        (value, axis) => value - frame.position[axis]));
      return boneLocal.map((value, axis) => value - centreOffset[axis]);
    });
}

function triangleFace(positions) {
  return normalize(cross(
    subtract(positions[1], positions[0]),
    subtract(positions[2], positions[0]),
  ));
}

function triangleCentre(positions) {
  return [0, 1, 2].map((axis) =>
    (positions[0][axis] + positions[1][axis] + positions[2][axis]) / 3);
}

function geometricPointKey(point) {
  return point.map((value) => Math.round(value * 1e8)).join(',');
}

function coincidentComponentGroups(mesh, component) {
  const groups = new Map();
  for (const vertex of mesh.vertices.filter((value) => value.component === component)) {
    const key = geometricPointKey(vertex.position);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(vertex);
  }
  return [...groups.values()].filter((vertices) => vertices.length > 1);
}

function assertGeometricallyClosed(triangles, label) {
  const edges = new Map();
  for (const { positions } of triangles) {
    for (const [left, right] of [[0, 1], [1, 2], [2, 0]]) {
      const keys = [geometricPointKey(positions[left]), geometricPointKey(positions[right])].sort();
      const key = keys.join('|');
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  const open = [...edges.values()].filter((count) => count !== 2);
  assert.deepEqual(open, [], `${label} must have exactly two triangles on every geometric edge`);
}

function assertPanelFacesOutward(triangles, width, height, label) {
  assert.ok(triangles.length > 0, `${label} has no panel triangles`);
  for (const { positions } of triangles) {
    const face = triangleFace(positions);
    const centre = triangleCentre(positions);
    let expected;
    if (positions.every((position) => position[2] > 0)) expected = [0, 0, 1];
    else if (positions.every((position) => position[2] < 0)) expected = [0, 0, -1];
    else expected = normalize([
      centre[0] / ((width * 0.5) ** 2),
      centre[1] / ((height * 0.5) ** 2),
      0,
    ]);
    const orientation = dot(face, expected);
    assert.ok(orientation > 0.05,
      `${label} contains an inward-facing front, rear or edge triangle: ` +
      `${orientation} at ${JSON.stringify(centre)} toward ${JSON.stringify(expected)}`);
  }
}

function batComponentTriangles(mesh, handle) {
  const triangles = [];
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const indices = [mesh.indices[offset], mesh.indices[offset + 1], mesh.indices[offset + 2]];
    const selected = indices.every((index) => handle
      ? mesh.vertices[index].region === 2
      : mesh.vertices[index].region !== 2);
    if (selected) triangles.push({
      indices,
      positions: indices.map((index) => mesh.vertices[index].position),
    });
  }
  return triangles;
}

function assertBatFacesOutward(triangles, minimumY, maximumY, label) {
  assert.ok(triangles.length > 0, `${label} has no triangles`);
  for (const { positions } of triangles) {
    const face = triangleFace(positions);
    const centre = triangleCentre(positions);
    const yRange = Math.max(...positions.map((position) => position[1])) -
      Math.min(...positions.map((position) => position[1]));
    let expected;
    if (yRange < 1e-9 && Math.abs(centre[1] - minimumY) < 1e-9) expected = [0, -1, 0];
    else if (yRange < 1e-9 && Math.abs(centre[1] - maximumY) < 1e-9) expected = [0, 1, 0];
    else expected = normalize([centre[0], 0, centre[2]]);
    assert.ok(dot(face, expected) > 0.05, `${label} contains an inward-facing side or cap triangle`);
  }
}

async function withScratch(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'vande-cricket-gear-'));
  try { return await callback(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function regionCounts(bytes) {
  const header = parseVpm3Header(bytes);
  const counts = new Map();
  for (let index = 0; index < header.vertexCount; index++) {
    const region = bytes.readUInt8(32 + index * 72 + 60);
    counts.set(region, (counts.get(region) ?? 0) + 1);
  }
  return counts;
}

test('original gear uses the locked production-character material regions', () => {
  assert.deepEqual(GEAR_REGIONS,
    { pad: 4, glove: 5, helmet: 6, metal: 7, strap: 13, padding: 14 });
  assert.deepEqual(GEAR_FAMILIES.externallyRendered,
    ['helmet', 'pads', 'gloves']);
  assert.deepEqual(GEAR_FAMILIES.omittedUnderClothing, ['thigh-guard', 'lower-arm-guard']);
  assert.deepEqual(GEAR_TRIANGLE_BUDGETS, { high: 6_200, live: 2_200 });
});

test('full 75-bone skeleton drives finite high and live equipment meshes', async () => {
  const skeleton = decodeGearSkeleton(await readFile(DEFAULT_GEAR_SKELETON));
  for (const detail of ['high', 'live']) {
    const mesh = buildCricketGear(skeleton, detail);
    assert.ok(mesh.vertices.length > 1_000);
    assert.ok(mesh.indices.length / 3 <= GEAR_TRIANGLE_BUDGETS[detail]);
    assert.ok(mesh.vertices.every((vertex) =>
      [...vertex.position, ...vertex.normal, ...vertex.tangent].every(Number.isFinite)));
    assert.ok(mesh.vertices.every((vertex) =>
      vertex.weights.reduce((sum, value) => sum + value, 0) === 255));
    const hiddenGuardBones = new Set([
      V3_BONE_NAMES.indexOf('upperleg01.L'),
      V3_BONE_NAMES.indexOf('lowerarm01.L'),
    ]);
    assert.ok(mesh.vertices.every((vertex) => vertex.bones.every((bone, index) =>
      vertex.weights[index] === 0 || !hiddenGuardBones.has(bone))),
    'no externally rendered vertex may remain bound as a thigh or lower-arm guard');
    const normalDirections = new Set(mesh.vertices.map((vertex) =>
      vertex.normal.map((value) => Math.round(value * 20)).join(',')));
    assert.ok(normalDirections.size > 80,
      'rounded authored surfaces must expose substantially more than primitive face normals');
  }
});

test('helmet cage, ear padding and shell retain distinct gameplay-readable material zones', async () => {
  const skeleton = decodeGearSkeleton(await readFile(DEFAULT_GEAR_SKELETON));
  const cageComponents = [
    'helmet-aperture-rim-left',
    'helmet-aperture-rim-right',
    'helmet-grille-upper-bar',
    'helmet-grille-lower-bar',
    'helmet-grille-side-left',
    'helmet-grille-side-right',
    ...Array.from({ length: 5 }, (_, index) => `helmet-grille-upright-${index}`),
  ];
  for (const detail of ['high', 'live']) {
    const mesh = buildCricketGear(skeleton, detail);
    const shell = mesh.vertices.filter(({ component }) => component === 'helmet-shell');
    assert.ok(shell.length > 0 && shell.every(({ region }) => region === GEAR_REGIONS.helmet),
      `${detail} helmet shell must retain the original navy region`);
    for (const side of ['left', 'right']) {
      const ear = mesh.vertices.filter(({ component }) =>
        component === `helmet-ear-guard-${side}`);
      assert.ok(ear.length > 0 && ear.every(({ region }) => region === GEAR_REGIONS.padding),
        `${detail} ${side} ear insert must contrast with the smooth shell`);
    }
    for (const component of cageComponents) {
      const cage = mesh.vertices.filter((vertex) => vertex.component === component);
      assert.ok(cage.length > 0 && cage.every(({ region }) => region === GEAR_REGIONS.metal),
        `${detail} ${component} must remain one continuous metal cage`);
    }
  }
});

test('helmet, pads and glove palms stay inside the audited human-scale envelopes', async () => {
  assertWithin(GEAR_DIMENSIONS.helmet.shellRadii[0] * 2, 0.202, 0.210,
    'helmet shell width');
  assertWithin(GEAR_DIMENSIONS.helmet.faceOpeningHalfAngleRadians * 180 / Math.PI,
    80, 83, 'helmet face-opening half-angle in degrees');
  assert.ok(GEAR_DIMENSIONS.helmet.faceOpeningHalfAngleRadians >= 0.445 * Math.PI,
    'helmet face aperture must retain the widened rear-shoulder-view profile');
  assertWithin(GEAR_DIMENSIONS.helmet.faceOpeningFullToLatitudeRadians * 180 / Math.PI,
    24, 27, 'helmet full face-opening upper latitude in degrees');
  assertWithin(GEAR_DIMENSIONS.helmet.faceOpeningClosedAtLatitudeRadians * 180 / Math.PI,
    50, 58, 'helmet closed-crown latitude in degrees');
  assertWithin(GEAR_DIMENSIONS.helmet.faceLowerLatitudeRadians * 180 / Math.PI,
    -34, -31, 'helmet facial lower edge in degrees');
  assertWithin(GEAR_DIMENSIONS.helmet.napeLowerLatitudeRadians * 180 / Math.PI,
    -54, -50, 'helmet occipital lower edge in degrees');
  assert.ok(GEAR_DIMENSIONS.helmet.napeLowerLatitudeRadians <
    GEAR_DIMENSIONS.helmet.faceLowerLatitudeRadians,
  'helmet nape must extend below the facial/temple edge');
  assert.ok(GEAR_DIMENSIONS.helmet.faceOpeningClosedAtLatitudeRadians >
    GEAR_DIMENSIONS.helmet.faceOpeningFullToLatitudeRadians,
  'helmet face aperture must close progressively above the brow');
  assertWithin(GEAR_DIMENSIONS.helmet.grilleFrontZ, 0.156, 0.160,
    'helmet grille projection');
  assert.ok(GEAR_DIMENSIONS.helmet.upperBarRadius * 2 <= 0.008,
    'upper grille diameter must not mask the face');
  assert.ok(GEAR_DIMENSIONS.helmet.lowerBarRadius * 2 <= 0.007,
    'lower grille diameter must not mask the face');
  assert.ok(GEAR_DIMENSIONS.helmet.uprightRadius * 2 <= 0.006,
    'upright grille diameter must not mask the face');
  assertWithin(GEAR_DIMENSIONS.pad.panelWidth, 0.168, 0.172, 'pad panel width');
  assertWithin(GEAR_DIMENSIONS.pad.panelHeight, 0.455, 0.465, 'pad panel height');
  assertWithin(GEAR_DIMENSIONS.pad.rearWidthScale, 0.58, 0.62, 'pad tapered rear width');
  assertWithin(GEAR_DIMENSIONS.pad.bottomWidthScale, 0.70, 0.74, 'pad ankle taper');
  assertWithin(GEAR_DIMENSIONS.pad.topWidthScale, 0.86, 0.90, 'pad upper taper');
  assert.ok(GEAR_DIMENSIONS.pad.centerOffset[2] - GEAR_DIMENSIONS.pad.panelDepth * 0.36 <= 0.032,
    'pad rear must overlap the audited live-shin envelope instead of floating ahead of it');
  assert.ok(GEAR_DIMENSIONS.pad.strapHalfSpan < GEAR_DIMENSIONS.pad.panelWidth * 0.42,
    'rear straps must finish inside the pad silhouette');
  assertWithin(GEAR_DIMENSIONS.glove.palmRadii[0] * 2, 0.080, 0.084,
    'glove palm width');
  assertWithin(GEAR_DIMENSIONS.glove.palmRadii[1] * 2, 0.106, 0.110,
    'glove palm height');
  assertWithin(GEAR_DIMENSIONS.glove.fingerBankRadii[0] * 2, 0.074, 0.078,
    'closed glove finger-bank width');
  assertWithin(GEAR_DIMENSIONS.glove.thumbRadii[0] * 2, 0.026, 0.030,
    'closed glove thumb width');

  const skeleton = decodeGearSkeleton(await readFile(DEFAULT_GEAR_SKELETON));
  for (const detail of ['high', 'live']) {
    const mesh = buildCricketGear(skeleton, detail);
    const helmet = rigidBoneBounds(mesh, skeleton, 'head');
    assertWithin(helmet.size[0], 0.212, 0.215, `${detail} generated helmet width`);
    const headBone = V3_BONE_NAMES.indexOf('head');
    const headFrame = skeleton.world[headBone];
    const shellSamples = mesh.vertices
      .filter((vertex) => vertex.region === GEAR_REGIONS.helmet &&
        vertex.component === 'helmet-shell' &&
        vertex.bones[0] === headBone && vertex.weights[0] === 255)
      .map((vertex) => inverseRotate(headFrame.rotation, vertex.position.map(
        (value, axis) => value - headFrame.position[axis])))
      .map((position) => position.map((value, axis) =>
        value - GEAR_DIMENSIONS.helmet.shellCenterOffset[axis]))
      .filter(([x, , z]) => Math.hypot(x, z) > 0.01)
      .map(([x, y, z]) => {
        const normalizedX = x / GEAR_DIMENSIONS.helmet.shellRadii[0];
        const normalizedY = y / GEAR_DIMENSIONS.helmet.shellRadii[1];
        const normalizedZ = z / GEAR_DIMENSIONS.helmet.shellRadii[2];
        return {
          latitude: Math.atan2(normalizedY, Math.hypot(normalizedX, normalizedZ)),
          longitude: Math.abs(Math.atan2(normalizedX, normalizedZ)),
        };
      });
    assert.ok(shellSamples.length > 0, `${detail} helmet shell has no measurable surface`);

    const faceOpening = shellSamples.filter(({ latitude }) =>
      latitude >= -0.15 * Math.PI &&
      latitude <= GEAR_DIMENSIONS.helmet.faceOpeningFullToLatitudeRadians + 1e-6);
    assert.ok(faceOpening.length > 0, `${detail} helmet shell has no face-aperture samples`);
    assert.ok(Math.min(...faceOpening.map(({ longitude }) => longitude)) >=
      GEAR_DIMENSIONS.helmet.faceOpeningHalfAngleRadians - 1e-6,
    `${detail} helmet shell must leave the eyes, nose and mouth sector open`);

    const crown = shellSamples.filter(({ latitude }) =>
      latitude >= GEAR_DIMENSIONS.helmet.faceOpeningClosedAtLatitudeRadians - 1e-6);
    assert.ok(crown.length > 0, `${detail} helmet shell has no crown samples`);
    assert.ok(Math.min(...crown.map(({ longitude }) => longitude)) <= 1e-6,
    `${detail} helmet crown must cover the front scalp instead of retaining the face wedge`);
    assert.ok(crown.some(({ longitude }) => longitude >= Math.PI - 0.01),
    `${detail} helmet crown must retain occipital coverage`);

    const temples = shellSamples.filter(({ latitude }) =>
      latitude > GEAR_DIMENSIONS.helmet.faceOpeningFullToLatitudeRadians &&
      latitude < GEAR_DIMENSIONS.helmet.faceOpeningClosedAtLatitudeRadians);
    assert.ok(temples.length > 0, `${detail} helmet shell has no aperture-transition samples`);
    const minimumTempleLongitude = Math.min(...temples.map(({ longitude }) => longitude));
    assert.ok(minimumTempleLongitude > 0 &&
      minimumTempleLongitude < GEAR_DIMENSIONS.helmet.faceOpeningHalfAngleRadians,
    `${detail} helmet aperture must close through the temples before the crown`);

    const lowerShellEdge = mesh.vertices
      .filter((vertex) => vertex.component === 'helmet-shell' && Math.abs(vertex.uv[1]) <= EPSILON)
      .map((vertex) => inverseRotate(headFrame.rotation, vertex.position.map(
        (value, axis) => value - headFrame.position[axis])))
      .map((position) => position.map((value, axis) =>
        value - GEAR_DIMENSIONS.helmet.shellCenterOffset[axis]));
    const rearNape = lowerShellEdge.filter(([, , z]) => z < -0.06);
    const templeEdge = lowerShellEdge.filter(([, , z]) => z > -0.01);
    assert.ok(rearNape.length > 0 && templeEdge.length > 0,
      `${detail} helmet must expose both rear-nape and temple lower edges`);
    assert.ok(Math.min(...templeEdge.map(([, y]) => y)) -
      Math.max(...rearNape.map(([, y]) => y)) >= 0.020,
    `${detail} helmet nape edge must extend at least 20 mm below the temple edge`);
    for (const side of ['L', 'R']) {
      const pad = rigidBoneBounds(mesh, skeleton, `lowerleg01.${side}`);
      assertWithin(pad.size[0], 0.168, 0.172, `${detail} ${side} generated pad width`);
      assertWithin(pad.size[1], 0.455, 0.465, `${detail} ${side} generated pad height`);
      const lowerLegFrame = skeleton.world[V3_BONE_NAMES.indexOf(`lowerleg01.${side}`)];
      const footPosition = skeleton.world[V3_BONE_NAMES.indexOf(`foot.${side}`)].position;
      const footLocalY = inverseRotate(lowerLegFrame.rotation, footPosition.map(
        (value, axis) => value - lowerLegFrame.position[axis]))[1];
      const padToFootClearance = pad.minimum[1] - footLocalY;
      assert.ok(padToFootClearance >= 0.015 && padToFootClearance <= 0.025,
        `${detail} ${side} pad must retain 15-25 mm animated ankle clearance; ` +
        `observed ${padToFootClearance}`);

      // Every visible glove volume is wrist-bound so the compact batting grip cannot splay into
      // the open-hand MakeHuman rest pose around the bat.
      const glove = rigidBoneBounds(mesh, skeleton, `wrist.${side}`);
      assertWithin(glove.size[0], 0.087, 0.090,
        `${detail} ${side} generated compact glove width`);
      assertWithin(glove.size[1], 0.140, 0.144,
        `${detail} ${side} generated compact glove height`);
      assert.ok(glove.size[1] / helmet.size[1] < 0.66,
        `${detail} ${side} glove must not approach the helmet's visual footprint`);
    }
  }
});

test('fitted helmet shell and ellipsoid glove palms expose outward-facing surfaces', async () => {
  const skeleton = decodeGearSkeleton(await readFile(DEFAULT_GEAR_SKELETON));
  for (const detail of ['high', 'live']) {
    const mesh = buildCricketGear(skeleton, detail);
    const helmetDots = rigidEllipsoidNormalDots(
      mesh,
      skeleton,
      'head',
      GEAR_REGIONS.helmet,
      GEAR_DIMENSIONS.helmet.shellCenterOffset,
      GEAR_DIMENSIONS.helmet.shellRadii,
      'helmet-shell',
    );
    assert.ok(helmetDots.length > 0, `${detail} helmet has no shell normals`);
    assert.ok(Math.min(...helmetDots) > 0.4,
      `${detail} helmet contains inward or tangential exterior normals`);
    assert.ok(helmetDots.reduce((sum, value) => sum + value, 0) / helmetDots.length > 0.9,
      `${detail} helmet exterior normals do not consistently face away from the scalp`);
    const helmetTriangleDots = rigidEllipsoidTriangleDots(
      mesh,
      skeleton,
      'head',
      GEAR_REGIONS.helmet,
      GEAR_DIMENSIONS.helmet.shellCenterOffset,
      GEAR_DIMENSIONS.helmet.shellRadii,
      'helmet-shell',
    );
    assert.ok(helmetTriangleDots.length > 0, `${detail} helmet has no shell triangles`);
    // The fitted crown deliberately departs from an ellipsoid and the aperture closes between
    // bounded rows, so those boundary faces can be oblique to an ellipsoid gradient. A strictly
    // positive margin still rejects an inverted exterior triangle without re-imposing a ball shape.
    assert.ok(Math.min(...helmetTriangleDots) > 0.05,
      `${detail} helmet contains inward-facing exterior triangles`);

    const palmLatitudes = detail === 'high' ? 9 : 5;
    const equatorCorrection = 1 / Math.cos(Math.PI / (2 * palmLatitudes));
    const palmRadii = [
      GEAR_DIMENSIONS.glove.palmRadii[0] * equatorCorrection,
      GEAR_DIMENSIONS.glove.palmRadii[1],
      GEAR_DIMENSIONS.glove.palmRadii[2] * equatorCorrection,
    ];
    for (const side of ['L', 'R']) {
      const palmDots = rigidEllipsoidNormalDots(
        mesh,
        skeleton,
        `wrist.${side}`,
        GEAR_REGIONS.glove,
        GEAR_DIMENSIONS.glove.palmCenterOffset,
        palmRadii,
        `glove-palm-${side}`,
      );
      assert.ok(palmDots.length > 0, `${detail} ${side} glove has no palm normals`);
      const minimumPalmDot = Math.min(...palmDots);
      const meanPalmDot = palmDots.reduce((sum, value) => sum + value, 0) / palmDots.length;
      assert.ok(minimumPalmDot > 0.4,
        `${detail} ${side} glove contains inward or tangential palm normals: ${minimumPalmDot}`);
      assert.ok(meanPalmDot > 0.9,
        `${detail} ${side} glove palm normals do not consistently face outward: ${meanPalmDot}`);
      const palmTriangleDots = rigidEllipsoidTriangleDots(
        mesh,
        skeleton,
        `wrist.${side}`,
        GEAR_REGIONS.glove,
        GEAR_DIMENSIONS.glove.palmCenterOffset,
        palmRadii,
        `glove-palm-${side}`,
      );
      assert.ok(palmTriangleDots.length > 0, `${detail} ${side} glove has no palm triangles`);
      assert.ok(Math.min(...palmTriangleDots) > 0.4,
        `${detail} ${side} glove contains inward-facing palm triangles`);

      const fingerLatitudes = detail === 'high' ? 9 : 5;
      const fingerCorrection = 1 / Math.cos(Math.PI / (2 * fingerLatitudes));
      const fingerRadii = [
        GEAR_DIMENSIONS.glove.fingerBankRadii[0] * fingerCorrection,
        GEAR_DIMENSIONS.glove.fingerBankRadii[1],
        GEAR_DIMENSIONS.glove.fingerBankRadii[2] * fingerCorrection,
      ];
      const fingerTriangleDots = rigidEllipsoidTriangleDots(
        mesh,
        skeleton,
        `wrist.${side}`,
        GEAR_REGIONS.glove,
        GEAR_DIMENSIONS.glove.fingerBankCenterOffset,
        fingerRadii,
        `glove-finger-bank-${side}`,
      );
      assert.ok(fingerTriangleDots.length > 0,
        `${detail} ${side} glove has no closed finger-bank triangles`);
      assert.ok(Math.min(...fingerTriangleDots) > 0.4,
        `${detail} ${side} glove contains inward-facing finger-bank triangles`);

      const sideSign = side === 'L' ? -1 : 1;
      const thumbOffset = GEAR_DIMENSIONS.glove.thumbCenterOffset.map((value, axis) =>
        axis === 0 ? value * sideSign : value);
      const thumbTriangleDots = rigidEllipsoidTriangleDots(
        mesh,
        skeleton,
        `wrist.${side}`,
        GEAR_REGIONS.glove,
        thumbOffset,
        GEAR_DIMENSIONS.glove.thumbRadii,
        `glove-thumb-${side}`,
      );
      assert.ok(thumbTriangleDots.length > 0,
        `${detail} ${side} glove has no closed thumb triangles`);
      assert.ok(Math.min(...thumbTriangleDots) > 0.35,
        `${detail} ${side} glove contains inward-facing thumb triangles`);
    }
  }
});

test('helmet uses a flattened tapered crown and an asymmetric fitted occipital profile', async () => {
  const dimensions = GEAR_DIMENSIONS.helmet;
  assertWithin(dimensions.crownFlattenExponent, 1.42, 1.48,
    'helmet crown flatten exponent');
  assertWithin(dimensions.crownSideTaper, 0.07, 0.11, 'helmet crown side taper');
  assert.ok(dimensions.occipitalDepthExpansion > dimensions.frontDepthCompression,
    'occipital shell must be fuller than the compressed forehead profile');

  // At the same closed-crown latitude the rear must retain more depth than the forehead,
  // and the authored mid-crown must sit closer to the top plane than an ellipsoid would.
  const latitude = 0.36 * Math.PI;
  const front = helmetShellLocalPoint(dimensions, 0, latitude);
  const rear = helmetShellLocalPoint(dimensions, Math.PI, latitude);
  assert.ok(Math.abs(rear[2]) > front[2] * 1.08,
    'helmet must expose a readable occipital back profile');
  const ellipsoidY = Math.sin(latitude) * dimensions.shellRadii[1];
  assert.ok(front[1] >= ellipsoidY + 0.004,
    'helmet crown must flatten above the equivalent ball-like ellipsoid');

  const skeleton = decodeGearSkeleton(await readFile(DEFAULT_GEAR_SKELETON));
  const headFrame = skeleton.world[V3_BONE_NAMES.indexOf('head')];
  for (const detail of ['high', 'live']) {
    const mesh = buildCricketGear(skeleton, detail);
    const shell = localizeComponentVertices(
      mesh,
      'helmet-shell',
      headFrame,
      dimensions.shellCenterOffset,
    );
    const nearTop = shell.filter((point) => point[1] >= dimensions.shellRadii[1] - 0.005);
    assert.ok(nearTop.length > 0, `${detail} helmet has no flattened crown samples`);
    assert.ok(Math.max(...nearTop.map((point) => Math.abs(point[0]))) >= 0.032,
      `${detail} helmet crown still collapses to a ball-like point`);
    const upperFront = shell.filter((point) => point[1] >= 0.10 && Math.abs(point[0]) < 0.025);
    assert.ok(upperFront.length > 0, `${detail} helmet has no closed upper-front samples`);
    assert.ok(Math.abs(Math.min(...upperFront.map((point) => point[2]))) >
      Math.max(...upperFront.map((point) => point[2])) * 1.03,
    `${detail} helmet shell must remain deeper over the occiput than the forehead`);
  }
});

test('helmet parametric seams are normal-welded by component while peak panel edges stay hard', async () => {
  const skeleton = decodeGearSkeleton(await readFile(DEFAULT_GEAR_SKELETON));
  for (const detail of ['high', 'live']) {
    const mesh = buildCricketGear(skeleton, detail);
    for (const component of [
      'helmet-shell',
      'helmet-ear-guard-left',
      'helmet-grille-upper-bar',
      'helmet-grille-upright-2',
      'helmet-grille-side-right',
    ]) {
      const groups = coincidentComponentGroups(mesh, component);
      assert.ok(groups.length > 0, `${detail} ${component} exposes no parametric seam`);
      for (const vertices of groups) {
        const reference = normalize(vertices[0].normal);
        for (const vertex of vertices.slice(1))
          assert.ok(dot(reference, normalize(vertex.normal)) > 0.999999,
            `${detail} ${component} has a split normal at a coincident seam`);
      }
    }

    const peakGroups = coincidentComponentGroups(mesh, 'helmet-peak');
    assert.ok(peakGroups.length >= 8, `${detail} helmet peak must split all manufactured corners`);
    for (const vertices of peakGroups) {
      const directions = new Set(vertices.map((vertex) =>
        vertex.normal.map((value) => Math.round(value * 1000)).join(',')));
      assert.ok(directions.size >= 3,
        `${detail} helmet peak corner must retain three intentional hard panel normals`);
    }
    for (const triangle of trianglesForComponent(mesh, 'helmet-peak')) {
      const face = triangleFace(triangle.positions);
      for (const index of triangle.indices)
        assert.ok(dot(face, normalize(mesh.vertices[index].normal)) > 0.999999,
          `${detail} helmet peak face must remain flat shaded`);
    }
  }
});

test('pad and glove-back rounded panels are closed and outward-facing', async () => {
  const skeleton = decodeGearSkeleton(await readFile(DEFAULT_GEAR_SKELETON));
  for (const detail of ['high', 'live']) {
    const mesh = buildCricketGear(skeleton, detail);
    for (const side of ['L', 'R']) {
      const padFrame = skeleton.world[V3_BONE_NAMES.indexOf(`lowerleg01.${side}`)];
      const padTriangles = localizeTriangles(
        trianglesForComponent(mesh, `pad-panel-${side}`),
        padFrame,
        GEAR_DIMENSIONS.pad.centerOffset,
      );
      assertGeometricallyClosed(padTriangles, `${detail} ${side} pad panel`);
      assertPanelFacesOutward(
        padTriangles,
        GEAR_DIMENSIONS.pad.panelWidth,
        GEAR_DIMENSIONS.pad.panelHeight,
        `${detail} ${side} pad panel`,
      );
      const padPanel = localizeComponentVertices(
        mesh,
        `pad-panel-${side}`,
        padFrame,
        GEAR_DIMENSIONS.pad.centerOffset,
      );
      const halfHeight = GEAR_DIMENSIONS.pad.panelHeight * 0.5;
      const widthAt = (targetY) => Math.max(...padPanel
        .filter((position) => Math.abs(position[1] - targetY) < EPSILON)
        .map((position) => Math.abs(position[0])));
      const middleWidth = widthAt(-halfHeight * 0.2);
      assert.ok(widthAt(-halfHeight) < middleWidth * 0.78,
        `${detail} ${side} pad must taper into the ankle instead of reading as a slab`);
      assert.ok(widthAt(halfHeight) < middleWidth * 0.92,
        `${detail} ${side} pad must taper above the knee instead of reading as a slab`);
      assert.ok(GEAR_DIMENSIONS.pad.centerOffset[2] +
        Math.min(...padPanel.map((position) => position[2])) <= 0.032,
      `${detail} ${side} pad rear must overlap the audited shin envelope`);

      const wristFrame = skeleton.world[V3_BONE_NAMES.indexOf(`wrist.${side}`)];
      const backPanelTriangles = localizeTriangles(
        trianglesForComponent(mesh, `glove-back-panel-${side}`),
        wristFrame,
        GEAR_DIMENSIONS.glove.backPanelCenterOffset,
      );
      assertGeometricallyClosed(backPanelTriangles, `${detail} ${side} glove back panel`);
      assertPanelFacesOutward(
        backPanelTriangles,
        GEAR_DIMENSIONS.glove.backPanelWidth,
        GEAR_DIMENSIONS.glove.backPanelHeight,
        `${detail} ${side} glove back panel`,
      );

      const straps = localizeComponentVertices(
        mesh,
        `pad-rear-strap-${side}`,
        padFrame,
        GEAR_DIMENSIONS.pad.centerOffset,
      );
      assert.ok(straps.length > 0, `${detail} ${side} pad has no rear straps`);
      assert.ok(Math.max(...straps.map((value) => Math.abs(value[0]))) <=
        GEAR_DIMENSIONS.pad.strapHalfSpan + GEAR_DIMENSIONS.pad.strapRadius + EPSILON,
      `${detail} ${side} pad straps protrude beyond the bounded side silhouette`);
      assert.ok(Math.max(...straps.map((value) => value[2])) < 0,
        `${detail} ${side} pad straps must remain behind the front padding`);
      assert.ok(Math.min(...straps.map((value) => value[2])) >= -0.030,
        `${detail} ${side} pad straps must remain fitted within 15 mm of the rear panel`);
      const strapVertices = mesh.vertices.filter((vertex) =>
        vertex.component === `pad-rear-strap-${side}`);
      assert.ok(strapVertices.every(({ region }) => region === GEAR_REGIONS.pad),
        `${detail} ${side} rear straps must use the off-white pad-derived region`);

      const palm = localizeComponentVertices(
        mesh,
        `glove-palm-${side}`,
        wristFrame,
        GEAR_DIMENSIONS.glove.palmCenterOffset,
      );
      const fingerBank = localizeComponentVertices(
        mesh,
        `glove-finger-bank-${side}`,
        wristFrame,
        GEAR_DIMENSIONS.glove.fingerBankCenterOffset,
      );
      assert.ok(fingerBank.length > 0, `${detail} ${side} glove has no closed finger bank`);
      const fingerRelief = mesh.vertices.filter((vertex) =>
        vertex.component === `glove-finger-relief-${side}`);
      assert.ok(fingerRelief.length > 0,
        `${detail} ${side} glove must retain visible finger-channel relief`);
      assert.ok(fingerRelief.every(({ region }) => region === GEAR_REGIONS.strap),
        `${detail} ${side} finger channels must contrast with the off-white glove`);
      const reliefLocal = localizeComponentVertices(
        mesh,
        `glove-finger-relief-${side}`,
        wristFrame,
        GEAR_DIMENSIONS.glove.fingerBankCenterOffset,
      );
      assert.ok(Math.max(...reliefLocal.map((position) => position[2])) <=
        GEAR_DIMENSIONS.glove.fingerBankRadii[2] +
          GEAR_DIMENSIONS.glove.fingerReliefRadius * 2.1,
      `${detail} ${side} finger channels must follow the bank surface instead of becoming spikes`);
      for (const offset of GEAR_DIMENSIONS.glove.fingerReliefOffsets) {
        assert.ok(reliefLocal.some((position) =>
          Math.abs(position[0] - offset) <= GEAR_DIMENSIONS.glove.fingerReliefRadius * 1.1),
        `${detail} ${side} glove must retain all four separated finger sections`);
      }
      if (detail === 'live') {
        const frontChannel = mesh.vertices.filter((vertex) =>
          vertex.component === `pad-live-front-channel-${side}`);
        assert.ok(frontChannel.length > 0 &&
          frontChannel.every(({ region }) => region === GEAR_REGIONS.strap),
        `${detail} ${side} pad must spend the hidden middle-strap budget on a readable front channel`);
      }
      if (detail === 'live') {
        assert.equal(mesh.vertices.filter((vertex) =>
          vertex.component === `glove-back-roll-${side}`).length, 0,
        `${detail} ${side} must reallocate hidden back-roll tubes to visible finger channels`);
      }
      const fingerBones = new Set(V3_BONE_NAMES.map((name, index) => ({ name, index }))
        .filter(({ name }) => name.startsWith('finger'))
        .map(({ index }) => index));
      assert.equal(mesh.vertices.filter((vertex) => vertex.weights.some((weight, slot) =>
        weight > 0 && fingerBones.has(vertex.bones[slot]))).length, 0,
      `${detail} ${side} glove must not reopen through independent finger-bone binding`);
      const palmFront = Math.max(...palm.map((value) => value[2])) +
        GEAR_DIMENSIONS.glove.palmCenterOffset[2];
      const fingerRear = Math.min(...fingerBank.map((value) => value[2])) +
        GEAR_DIMENSIONS.glove.fingerBankCenterOffset[2];
      assert.ok(fingerRear <= palmFront + 0.010,
        `${detail} ${side} glove finger bank must overlap the palm instead of floating`);
    }
  }
});

test('helmet peak is a closed, bounded silhouette', async () => {
  const skeleton = decodeGearSkeleton(await readFile(DEFAULT_GEAR_SKELETON));
  const headFrame = skeleton.world[V3_BONE_NAMES.indexOf('head')];
  for (const detail of ['high', 'live']) {
    const mesh = buildCricketGear(skeleton, detail);
    const peak = localizeTriangles(
      trianglesForComponent(mesh, 'helmet-peak'),
      headFrame,
      GEAR_DIMENSIONS.helmet.shellCenterOffset,
    );
    assertGeometricallyClosed(peak, `${detail} helmet peak`);
    const peakPoints = peak.flatMap(({ positions }) => positions);
    assertWithin(Math.max(...peakPoints.map((value) => value[2])), 0.164, 0.168,
      `${detail} helmet peak projection`);
    assert.ok(Math.max(...peakPoints.map((value) => value[1])) < 0.085,
      `${detail} helmet peak must remain below the crown`);

  }
});

test('helmet peak and grille form one attached assembly inside the shell envelope', async () => {
  const skeleton = decodeGearSkeleton(await readFile(DEFAULT_GEAR_SKELETON));
  const headFrame = skeleton.world[V3_BONE_NAMES.indexOf('head')];
  const dimensions = GEAR_DIMENSIONS.helmet;
  const peakRearCorner = [
    dimensions.peakRearHalfWidth,
    dimensions.peakCenterY - dimensions.peakThickness * 0.5,
    dimensions.peakRearZ,
  ];
  const shellBrow = Array.from({ length: 257 }, (_, index) => {
    const latitude = -0.18 * Math.PI + 0.46 * Math.PI * index / 256;
    const transition = Math.max(0, Math.min(1,
      (latitude - dimensions.faceOpeningFullToLatitudeRadians) /
      (dimensions.faceOpeningClosedAtLatitudeRadians -
        dimensions.faceOpeningFullToLatitudeRadians)));
    const easedTransition = transition * transition * (3 - 2 * transition);
    const opening = dimensions.faceOpeningHalfAngleRadians * (1 - easedTransition);
    return helmetShellLocalPoint(dimensions, opening, latitude);
  });
  const peakShellDistance = Math.min(...shellBrow.map((point) => Math.hypot(
    ...point.map((value, axis) => value - peakRearCorner[axis]),
  )));
  assert.ok(peakShellDistance <= 0.005,
    'peak rear corners must meet the shell brow instead of floating forward');
  for (const detail of ['high', 'live']) {
    const mesh = buildCricketGear(skeleton, detail);
    const local = (component) => localizeComponentVertices(
      mesh,
      component,
      headFrame,
      dimensions.shellCenterOffset,
    );
    const peak = local('helmet-peak');
    const upperBar = local('helmet-grille-upper-bar');
    const lowerBar = local('helmet-grille-lower-bar');
    const uprights = [0, 1, 2, 3, 4].flatMap((index) =>
      local(`helmet-grille-upright-${index}`));
    const sideRails = [...local('helmet-grille-side-left'), ...local('helmet-grille-side-right')];
    assert.ok(peak.length > 0 && upperBar.length > 0 && lowerBar.length > 0 &&
      uprights.length > 0 && sideRails.length > 0,
    `${detail} helmet assembly is incomplete`);

    const nearestDistance = (left, right) => Math.min(...left.flatMap((a) => right.map((b) =>
      Math.hypot(...a.map((value, axis) => value - b[axis])))));
    assert.ok(nearestDistance(peak, uprights) <= 0.007,
      `${detail} grille uprights must physically meet the peak`);
    assert.ok(nearestDistance(upperBar, sideRails) <= 0.003,
      `${detail} upper grille bar must physically meet both side mounts`);
    assert.ok(nearestDistance(lowerBar, sideRails) <= 0.003,
      `${detail} lower grille bar must physically meet both side mounts`);
    assert.ok(Math.max(...[...upperBar, ...lowerBar, ...sideRails].map((point) =>
      Math.abs(point[0]))) <= dimensions.shellRadii[0] + dimensions.sideGuardRadius + EPSILON,
    `${detail} grille must stay within the helmet's lateral envelope`);
    assert.ok(Math.max(...[...upperBar, ...lowerBar, ...uprights].map((point) => point[2])) <=
      dimensions.peakFrontZ + dimensions.uprightRadius + EPSILON,
    `${detail} grille must not project beyond its bounded peak assembly`);
  }
});

test('VPM3 equipment output is deterministic, skeleton-bound and contains only external gear families', async () => {
  await withScratch(async (firstDirectory) => {
    await withScratch(async (secondDirectory) => {
      const first = await exportProductionCricketGear({ outputDir: firstDirectory });
      const second = await exportProductionCricketGear({ outputDir: secondDirectory });
      assert.equal(first.status,
        'ORIGINAL TECHNICAL ART CANDIDATE / INDEPENDENT VISUAL ACCEPTANCE UNPROVEN');
      assert.equal(first.outputs.length, 2);
      assert.deepEqual(first.renderedFamilies,
        ['helmet', 'pads', 'gloves']);
      assert.deepEqual(first.omittedUnderClothing, ['thigh-guard', 'lower-arm-guard']);
      assert.deepEqual(first.dimensions, {
        bat: BAT_DIMENSIONS,
        gear: GEAR_DIMENSIONS,
      }, 'provenance must bind both the bat dimensions and the foreground gear correction');
      assert.match(first.foregroundReadabilityPolicy.helmet, /ear guards.*nape.*metal region/i);
      assert.match(first.foregroundReadabilityPolicy.pads, /tapered.*side wrap.*front channel/i);
      assert.match(first.foregroundReadabilityPolicy.gloves, /compact.*four contrast finger channels/i);
      assert.deepEqual(first.outputs.map(({ detail, gear }) => ({
        detail,
        vertices: gear.vertices,
        triangles: gear.triangles,
      })), [
        { detail: 'high', vertices: 3_854, triangles: 5_996 },
        { detail: 'live', vertices: 1_588, triangles: 2_196 },
      ]);
      for (let index = 0; index < first.outputs.length; index++) {
        const left = await readFile(first.outputs[index].gear.path);
        const right = await readFile(second.outputs[index].gear.path);
        assert.deepEqual(left, right);
        const header = parseVpm3Header(left);
        assert.equal(header.skeletonId, first.skeleton.id);
        const regions = regionCounts(left);
        for (const region of Object.values(GEAR_REGIONS))
          assert.ok((regions.get(region) ?? 0) > 0, `missing shader region ${region}`);
      }
    });
  });
});

test('original bat preserves the law-scale contract and bounded rounded topology', () => {
  assert.ok(Math.abs(BAT_DIMENSIONS.totalLength -
    (BAT_DIMENSIONS.bladeLength + BAT_DIMENSIONS.handleLength)) < 1e-12);
  for (const detail of ['high', 'live']) {
    const mesh = buildCricketBat(detail);
    const ys = mesh.vertices.map((vertex) => vertex.position[1]);
    const xs = mesh.vertices.map((vertex) => vertex.position[0]);
    assert.ok(Math.abs(Math.min(...ys) + BAT_DIMENSIONS.totalLength) < 1e-9);
    assert.ok(Math.abs(Math.max(...ys)) < 1e-9);
    assert.ok(Math.max(...xs) - Math.min(...xs) <= BAT_DIMENSIONS.bladeWidth + 1e-9);
    const bytes = encodeVbt1(mesh);
    const header = parseVbt1Header(bytes);
    assert.deepEqual({ vertices: header.vertexCount, triangles: header.triangleCount },
      detail === 'high'
        ? { vertices: 574, triangles: 1_064 }
        : { vertices: 157, triangles: 272 });
    assert.equal(header.vertexCount, mesh.vertices.length);
    assert.ok(header.triangleCount <= BAT_TRIANGLE_BUDGETS[detail]);
    assert.equal(bytes.readUInt16LE(6), VBT_VERTEX_BYTES);
    const regions = new Set();
    for (let index = 0; index < header.vertexCount; index++)
      regions.add(bytes.readUInt8(32 + index * VBT_VERTEX_BYTES + 48));
    assert.deepEqual([...regions].sort(), [0, 1, 2]);
  }
});

test('bat blade and handle are geometrically closed with outward sides and end caps', () => {
  for (const detail of ['high', 'live']) {
    const mesh = buildCricketBat(detail);
    const blade = batComponentTriangles(mesh, false);
    const handle = batComponentTriangles(mesh, true);
    assertGeometricallyClosed(blade, `${detail} bat blade`);
    assertGeometricallyClosed(handle, `${detail} bat handle`);
    assertBatFacesOutward(
      blade,
      -BAT_DIMENSIONS.totalLength,
      -BAT_DIMENSIONS.handleLength,
      `${detail} bat blade`,
    );
    assertBatFacesOutward(
      handle,
      -BAT_DIMENSIONS.handleLength,
      0,
      `${detail} bat handle`,
    );
  }
});

test('VBT1 fails closed on truncation and reserved-byte mutation', () => {
  const exact = encodeVbt1(buildCricketBat('live'));
  assert.throws(() => parseVbt1Header(exact.subarray(0, -1)), /byte length/);
  const reserved = Buffer.from(exact);
  reserved[17] = 1;
  assert.throws(() => parseVbt1Header(reserved), /reserved/);
});

test('gear skeleton decoder rejects malformed VSK1 data', async () => {
  const exact = await readFile(DEFAULT_GEAR_SKELETON);
  assert.throws(() => decodeGearSkeleton(exact.subarray(0, -1)), /header or byte length/);
});
