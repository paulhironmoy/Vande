#!/usr/bin/env node
/**
 * Deterministic original cricket-equipment candidate baker for VANDE Stage 1.
 *
 * All geometry in this file is generated from VANDE-authored dimensions and
 * parametric surfaces. No third-party mesh, trademark, real-player likeness,
 * sponsor art or equipment branding is used. The output is a technical art
 * candidate only: visual acceptance, clipping, physical-device performance,
 * Android installed size and India-weighted reach remain UNPROVEN.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  V3_BONE_NAMES,
  computeTangents,
  encodeVpm3,
  parseVpm3Header,
  parseVsk1,
} from './export-unity-production-character-v3.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = dirname(SCRIPT_PATH);
export const DEFAULT_GEAR_SKELETON = resolve(
  SCRIPT_DIRECTORY,
  '../unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/' +
    'hero-skeleton.bytes',
);
export const DEFAULT_GEAR_OUTPUT = '/private/tmp/vande-production-cricket-gear-output';

export const GEAR_REGIONS = Object.freeze({
  pad: 4,
  glove: 5,
  helmet: 6,
  metal: 7,
  strap: 13,
  padding: 14,
});
export const GEAR_FAMILIES = Object.freeze({
  externallyRendered: Object.freeze(['helmet', 'pads', 'gloves']),
  omittedUnderClothing: Object.freeze(['thigh-guard', 'lower-arm-guard']),
});

// Keep explicit headroom below the arithmetic maximum shares of the locked complete-batter targets.
// The body, eyes, bat and future fitted-clothing shell all consume the same aggregate budgets; using
// every residual triangle here would make a technically valid gear mesh block the coherent player.
export const GEAR_TRIANGLE_BUDGETS = Object.freeze({ high: 6_200, live: 2_200 });
export const BAT_TRIANGLE_BUDGETS = Object.freeze({ high: 2_000, live: 700 });
export const BAT_DIMENSIONS = Object.freeze({
  bladeLength: 0.56,
  bladeWidth: 0.108,
  bladeThickness: 0.05,
  handleLength: 0.30,
  totalLength: 0.86,
  gripRadius: 0.0182,
});
export const GEAR_DIMENSIONS = Object.freeze({
  helmet: Object.freeze({
    shellCenterOffset: Object.freeze([0, 0.078, 0.004]),
    shellRadii: Object.freeze([0.103, 0.125, 0.110]),
    // A cricket helmet follows a head-like asymmetric profile rather than a scaled ball. Keep
    // the audited maximum radii above as the envelope, then shape the crown and occiput inside it.
    crownFlattenExponent: 1.45,
    crownSideTaper: 0.10,
    frontDepthCompression: 0.085,
    occipitalDepthExpansion: 0.115,
    occipitalDrop: 0.009,
    occipitalLatitudeRadians: -0.04 * Math.PI,
    occipitalBandWidthRadians: 0.22 * Math.PI,
    // Keep the face readable from the locked rear-shoulder three-quarter view without
    // turning the shell into an unsafe open-face cap.
    faceOpeningHalfAngleRadians: 0.45 * Math.PI,
    faceOpeningFullToLatitudeRadians: 0.14 * Math.PI,
    faceOpeningClosedAtLatitudeRadians: 0.31 * Math.PI,
    faceLowerLatitudeRadians: -0.18 * Math.PI,
    napeLowerLatitudeRadians: -0.29 * Math.PI,
    grilleFrontZ: 0.158,
    grilleHalfWidth: 0.092,
    upperBarRadius: 0.0038,
    lowerBarRadius: 0.0034,
    uprightRadius: 0.0030,
    sideGuardRadius: 0.0042,
    apertureRimRadius: 0.0026,
    peakRearHalfWidth: 0.094,
    peakFrontHalfWidth: 0.076,
    peakRearZ: 0.0115,
    peakFrontZ: 0.166,
    peakCenterY: 0.061,
    peakThickness: 0.010,
    earGuardCenterX: 0.099,
    earGuardCenterY: -0.027,
    earGuardCenterZ: -0.002,
    earGuardRadii: Object.freeze([0.008, 0.028, 0.022]),
  }),
  pad: Object.freeze({
    centerOffset: Object.freeze([0, -0.150, 0.046]),
    panelWidth: 0.170,
    panelHeight: 0.460,
    panelDepth: 0.042,
    rearWidthScale: 0.60,
    rearHeightScale: 0.94,
    bottomWidthScale: 0.72,
    topWidthScale: 0.88,
    sideWrapDepth: 0.010,
    longitudinalRollOffsets: Object.freeze([-0.056, -0.028, 0, 0.028, 0.056]),
    longitudinalRollRadius: 0.0082,
    longitudinalSeamOffsets: Object.freeze([-0.042, -0.014, 0.014, 0.042]),
    longitudinalSeamRadius: 0.0013,
    longitudinalRollHalfHeight: 0.190,
    kneeRollY: 0.174,
    kneeRollHalfSpan: 0.066,
    kneeRollRadius: 0.0160,
    strapHalfSpan: 0.068,
    strapIntermediateX: 0.058,
    strapSideZ: -0.014,
    strapRearZ: -0.026,
    strapRadius: 0.0024,
    strapY: Object.freeze([-0.145, 0.010, 0.160]),
  }),
  glove: Object.freeze({
    palmCenterOffset: Object.freeze([0, -0.010, 0.016]),
    palmRadii: Object.freeze([0.041, 0.054, 0.026]),
    backPanelCenterOffset: Object.freeze([0, -0.007, 0.039]),
    backPanelWidth: 0.066,
    backPanelHeight: 0.050,
    backPanelDepth: 0.008,
    backRollOffsets: Object.freeze([-0.021, -0.007, 0.007, 0.021]),
    backRollRadius: 0.0035,
    seamOffsets: Object.freeze([-0.014, 0.014]),
    seamRadius: 0.0012,
    fingerBankCenterOffset: Object.freeze([0, -0.052, 0.071]),
    fingerBankRadii: Object.freeze([0.038, 0.046, 0.028]),
    fingerReliefOffsets: Object.freeze([-0.023, -0.008, 0.008, 0.023]),
    fingerReliefRadius: 0.0016,
    thumbCenterOffset: Object.freeze([0.034, -0.022, 0.055]),
    thumbRadii: Object.freeze([0.014, 0.025, 0.018]),
    strapHalfSpan: 0.033,
    strapRadius: 0.0024,
  }),
});

export const VBT_MAGIC = 'VBT1';
export const VBT_VERSION = 1;
export const VBT_HEADER_BYTES = 32;
export const VBT_VERTEX_BYTES = 56;
export const VBT_INDEX_BYTES = 2;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, scalar) => [a[0] * scalar, a[1] * scalar, a[2] * scalar];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a) => Math.hypot(...a);
const normalize = (a, fallback = [0, 1, 0]) => {
  const value = length(a);
  return Number.isFinite(value) && value > 1e-10 ? mul(a, 1 / value) : [...fallback];
};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function quatMultiply(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function quatRotate(rotation, point) {
  const inverse = [-rotation[0], -rotation[1], -rotation[2], rotation[3]];
  return quatMultiply(quatMultiply(rotation, [...point, 0]), inverse).slice(0, 3);
}

function transform(frame, local) {
  return add(frame.position, quatRotate(frame.rotation, local));
}

function boneIndex(name) {
  const value = V3_BONE_NAMES.indexOf(name);
  if (value < 0) throw new Error(`The production skeleton has no ${name} bone`);
  return value;
}

export function decodeGearSkeleton(bytes) {
  const header = parseVsk1(bytes);
  const local = [];
  const world = [];
  for (let index = 0; index < header.boneCount; index++) {
    const offset = 32 + index * 32;
    const parent = bytes.readInt16LE(offset);
    const position = [
      bytes.readFloatLE(offset + 4),
      bytes.readFloatLE(offset + 8),
      bytes.readFloatLE(offset + 12),
    ];
    const rotation = [
      bytes.readFloatLE(offset + 16),
      bytes.readFloatLE(offset + 20),
      bytes.readFloatLE(offset + 24),
      bytes.readFloatLE(offset + 28),
    ];
    local.push({ parent, position, rotation });
    world.push(parent < 0
      ? { position, rotation }
      : {
          position: add(world[parent].position, quatRotate(world[parent].rotation, position)),
          rotation: quatMultiply(world[parent].rotation, rotation),
        });
  }
  return Object.freeze({
    ...header,
    skeletonIdBytes: bytes.subarray(16, 24),
    local: Object.freeze(local),
    world: Object.freeze(world),
  });
}

function rigidBinding(index) {
  return { bones: [index, 0, 0, 0], weights: [255, 0, 0, 0] };
}

function createSkinnedMesh() {
  return { vertices: [], indices: [] };
}

function addVertex(mesh, position, uv, region, binding, component = null) {
  const index = mesh.vertices.length;
  mesh.vertices.push({
    position,
    bindPos: [...position],
    uv,
    region,
    bones: [...binding.bones],
    weights: [...binding.weights],
    normal: [0, 1, 0],
    tangent: [1, 0, 0, 1],
    component,
  });
  return index;
}

function addTriangle(mesh, a, b, c) {
  if (a === b || b === c || c === a) return;
  mesh.indices.push(a, b, c);
}

function addParametricGrid(mesh, columns, rows, sample, { reverse = false } = {}) {
  const base = mesh.vertices.length;
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const value = sample(column / columns, row / rows);
      addVertex(mesh, value.position, value.uv ?? [column / columns, row / rows],
        value.region, value.binding, value.component);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = base + row * (columns + 1) + column;
      const b = a + 1;
      const d = a + columns + 1;
      const c = d + 1;
      if (reverse) {
        addTriangle(mesh, a, c, d);
        addTriangle(mesh, a, b, c);
      } else {
        addTriangle(mesh, a, d, c);
        addTriangle(mesh, a, c, b);
      }
    }
  }
}

function addTube(mesh, points, radius, sides, region, binding, component = null) {
  if (points.length < 2) throw new Error('A tube needs at least two path points');
  const base = mesh.vertices.length;
  for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
    const before = points[Math.max(0, pointIndex - 1)];
    const after = points[Math.min(points.length - 1, pointIndex + 1)];
    const tangent = normalize(sub(after, before));
    const reference = Math.abs(dot(tangent, [0, 1, 0])) > 0.88 ? [1, 0, 0] : [0, 1, 0];
    const side = normalize(cross(tangent, reference));
    const up = normalize(cross(side, tangent));
    for (let ring = 0; ring <= sides; ring++) {
      const angle = Math.PI * 2 * ring / sides;
      const offset = add(mul(side, Math.cos(angle) * radius), mul(up, Math.sin(angle) * radius));
      addVertex(mesh, add(points[pointIndex], offset),
        [ring / sides, pointIndex / (points.length - 1)], region, binding, component);
    }
  }
  for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex++) {
    for (let ring = 0; ring < sides; ring++) {
      const a = base + pointIndex * (sides + 1) + ring;
      const b = a + 1;
      const d = a + sides + 1;
      const c = d + 1;
      addTriangle(mesh, a, d, c);
      addTriangle(mesh, a, c, b);
    }
  }
}

function addEllipsoid(mesh, frame, radii, longitudeCount, latitudeCount, region, binding,
  latitudeMinimum = -Math.PI * 0.5, latitudeMaximum = Math.PI * 0.5,
  longitudeOffset = 0, longitudeSpan = Math.PI * 2, component = null) {
  addParametricGrid(mesh, longitudeCount, latitudeCount, (u, v) => {
    const longitude = longitudeSpan * u + longitudeOffset;
    const latitude = latitudeMinimum + (latitudeMaximum - latitudeMinimum) * v;
    const cosLatitude = Math.cos(latitude);
    return {
      position: transform(frame, [
        Math.sin(longitude) * cosLatitude * radii[0],
        Math.sin(latitude) * radii[1],
        Math.cos(longitude) * cosLatitude * radii[2],
      ]),
      uv: [u, v], region, binding, component,
    };
  }, { reverse: true });
}

export function helmetShellLocalPoint(dimensions, longitude, latitude) {
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const crown = clamp(sinLatitude, 0, 1);
  const crownHeight = sinLatitude < 0
    ? sinLatitude
    : 1 - (1 - crown) ** dimensions.crownFlattenExponent;
  const crownTaperProgress = clamp(
    (latitude - dimensions.faceOpeningFullToLatitudeRadians) /
      (Math.PI * 0.5 - dimensions.faceOpeningFullToLatitudeRadians),
    0,
    1,
  );
  const crownTaper = 1 - dimensions.crownSideTaper * crownTaperProgress ** 1.2;
  const longitudeCosine = Math.cos(longitude);
  const front = Math.max(longitudeCosine, 0) ** 2;
  const rear = Math.max(-longitudeCosine, 0) ** 2;
  // The occipital volume is strongest below the crown. The front is deliberately shallower so
  // the brow, peak and grille read as one fitted assembly rather than a cage on a sphere.
  const depthScale = 1 - dimensions.frontDepthCompression * front * (0.55 + 0.45 * crown) +
    dimensions.occipitalDepthExpansion * rear * (1 - 0.55 * crown);
  const occipitalBand = Math.exp(-0.5 * (
    (latitude - dimensions.occipitalLatitudeRadians) /
    dimensions.occipitalBandWidthRadians
  ) ** 2);
  return [
    Math.sin(longitude) * cosLatitude * dimensions.shellRadii[0] * crownTaper,
    crownHeight * dimensions.shellRadii[1] -
      dimensions.occipitalDrop * rear * occipitalBand * (1 - crown),
    longitudeCosine * cosLatitude * dimensions.shellRadii[2] * depthScale,
  ];
}

function addHelmetShell(mesh, frame, dimensions, longitudeCount, latitudeCount, binding) {
  const frontLatitudeMinimum = dimensions.faceLowerLatitudeRadians;
  const rearLatitudeMinimum = dimensions.napeLowerLatitudeRadians;
  const latitudeMaximum = 0.5 * Math.PI;
  const openingMaximum = dimensions.faceOpeningHalfAngleRadians;
  const openingFullTo = dimensions.faceOpeningFullToLatitudeRadians;
  const openingClosedAt = dimensions.faceOpeningClosedAtLatitudeRadians;
  addParametricGrid(mesh, longitudeCount, latitudeCount, (u, v) => {
    // Lift only the occipital lower edge to expose a cricket-helmet nape line.  The
    // temples retain the deeper protective shell and the blend is continuous, so
    // this changes silhouette rather than cutting another facial aperture.
    const lowerOpening = openingMaximum;
    const lowerLongitude = lowerOpening + (Math.PI * 2 - lowerOpening * 2) * u;
    const rearWeight = Math.max(-Math.cos(lowerLongitude), 0) ** 2;
    const latitudeMinimum = frontLatitudeMinimum +
      (rearLatitudeMinimum - frontLatitudeMinimum) * rearWeight;
    const latitude = latitudeMinimum + (latitudeMaximum - latitudeMinimum) * v;
    const transition = clamp((latitude - openingFullTo) /
      (openingClosedAt - openingFullTo), 0, 1);
    const easedTransition = transition * transition * (3 - 2 * transition);
    const opening = openingMaximum * (1 - easedTransition);
    const longitude = opening + (Math.PI * 2 - opening * 2) * u;
    return {
      position: transform(frame, helmetShellLocalPoint(dimensions, longitude, latitude)),
      uv: [u, v],
      region: GEAR_REGIONS.helmet,
      binding,
      component: 'helmet-shell',
    };
  }, { reverse: true });
}

function addRoundedPanel(mesh, frame, width, height, depth, columns, rows, region, binding,
  component, {
    rearWidthScale = 1,
    rearHeightScale = 1,
    bottomWidthScale = 1,
    topWidthScale = 1,
    sideWrapDepth = 0,
  } = {}) {
  const start = mesh.vertices.length;
  const sample = (u, v, rear) => {
    const x = (u * 2 - 1);
    const y = (v * 2 - 1);
    const widthScale = y <= -0.2
      ? bottomWidthScale + (1 - bottomWidthScale) * (y + 1) / 0.8
      : 1 + (topWidthScale - 1) * (y + 0.2) / 1.2;
    const roundedWidth = width * 0.5 * x * widthScale *
      (0.93 + 0.07 * Math.cos(y * Math.PI * 0.5));
    const crown = depth * (1 - 0.68 * x * x) * (0.94 + 0.06 * Math.cos(y * Math.PI)) -
      sideWrapDepth * Math.abs(x) ** 1.6;
    return transform(frame, [
      roundedWidth * (rear ? rearWidthScale : 1),
      y * height * 0.5 * (rear ? rearHeightScale : 1),
      rear ? -depth * 0.36 : crown,
    ]);
  };
  addParametricGrid(mesh, columns, rows, (u, v) => ({
    position: sample(u, v, false), uv: [u, v], region, binding, component,
  }), { reverse: true });
  addParametricGrid(mesh, columns, rows, (u, v) => ({
    position: sample(u, v, true), uv: [u, v], region, binding, component,
  }));

  const front = start;
  const rear = start + (columns + 1) * (rows + 1);
  const boundary = [];
  for (let column = 0; column <= columns; column++) boundary.push([column, 0]);
  for (let row = 1; row <= rows; row++) boundary.push([columns, row]);
  for (let column = columns - 1; column >= 0; column--) boundary.push([column, rows]);
  for (let row = rows - 1; row > 0; row--) boundary.push([0, row]);
  for (let index = 0; index < boundary.length; index++) {
    const [column, row] = boundary[index];
    const [nextColumn, nextRow] = boundary[(index + 1) % boundary.length];
    const a = front + row * (columns + 1) + column;
    const b = front + nextRow * (columns + 1) + nextColumn;
    const c = rear + nextRow * (columns + 1) + nextColumn;
    const d = rear + row * (columns + 1) + column;
    addTriangle(mesh, a, c, b);
    addTriangle(mesh, a, d, c);
  }
}

function addHelmetPeak(mesh, frame, dimensions, binding) {
  const rearWidth = dimensions.peakRearHalfWidth;
  const frontWidth = dimensions.peakFrontHalfWidth;
  const rearZ = dimensions.peakRearZ;
  const frontZ = dimensions.peakFrontZ;
  const bottomY = dimensions.peakCenterY - dimensions.peakThickness * 0.5;
  const topY = dimensions.peakCenterY + dimensions.peakThickness * 0.5;
  const component = 'helmet-peak';
  const local = [
    [-rearWidth, bottomY, rearZ], [rearWidth, bottomY, rearZ],
    [frontWidth, bottomY, frontZ], [-frontWidth, bottomY, frontZ],
    [-rearWidth, topY, rearZ], [rearWidth, topY, rearZ],
    [frontWidth, topY, frontZ], [-frontWidth, topY, frontZ],
  ];
  // Duplicate the six planes at their shared corners. This deliberately preserves the peak's
  // crisp manufactured edges while the shell and round grille use welded smooth-normal groups.
  const faces = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 3, 7, 4],
    [1, 5, 6, 2],
    [0, 4, 5, 1],
    [3, 2, 6, 7],
  ];
  for (const face of faces) {
    const vertices = face.map((localIndex, faceIndex) => addVertex(
      mesh,
      transform(frame, local[localIndex]),
      [faceIndex === 0 || faceIndex === 3 ? 0 : 1, faceIndex >= 2 ? 1 : 0],
      GEAR_REGIONS.helmet,
      binding,
      component,
    ));
    addTriangle(mesh, vertices[0], vertices[1], vertices[2]);
    addTriangle(mesh, vertices[0], vertices[2], vertices[3]);
  }
}

const HARD_NORMAL_COMPONENTS = new Set(['helmet-peak']);

function normalWeldKey(vertex, index) {
  if (typeof vertex.component !== 'string' || HARD_NORMAL_COMPONENTS.has(vertex.component))
    return `vertex:${index}`;
  const position = vertex.position.map((value) => Math.round(value * 1e8)).join(',');
  const bones = vertex.bones?.join(',') ?? '';
  const weights = vertex.weights?.join(',') ?? '';
  return `${vertex.component}|${vertex.region}|${bones}|${weights}|${position}`;
}

function computeNormals(mesh) {
  const keys = mesh.vertices.map(normalWeldKey);
  const sums = new Map(keys.map((key) => [key, [0, 0, 0]]));
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const a = mesh.indices[offset];
    const b = mesh.indices[offset + 1];
    const c = mesh.indices[offset + 2];
    const face = cross(
      sub(mesh.vertices[b].position, mesh.vertices[a].position),
      sub(mesh.vertices[c].position, mesh.vertices[a].position),
    );
    if (length(face) < 1e-12) continue;
    for (const index of [a, b, c]) sums.set(keys[index], add(sums.get(keys[index]), face));
  }
  for (let index = 0; index < mesh.vertices.length; index++)
    mesh.vertices[index].normal = normalize(sums.get(keys[index]), [0, 1, 0]);
}

function finalizeSkinnedMesh(mesh) {
  computeNormals(mesh);
  const tangents = computeTangents(mesh.vertices, mesh.indices);
  for (let index = 0; index < mesh.vertices.length; index++)
    mesh.vertices[index].tangent = tangents[index];
  return mesh;
}

function frameFor(skeleton, name, localOffset = [0, 0, 0]) {
  const index = boneIndex(name);
  const value = skeleton.world[index];
  return {
    index,
    position: add(value.position, quatRotate(value.rotation, localOffset)),
    rotation: value.rotation,
  };
}

function addHelmet(mesh, skeleton, detail) {
  const dimensions = GEAR_DIMENSIONS.helmet;
  const head = frameFor(skeleton, 'head', dimensions.shellCenterOffset);
  const binding = rigidBinding(head.index);
  const longitudes = detail === 'high' ? 30 : 18;
  // Nine live latitude bands keep the widened face-opening transition monotone. Seven bands
  // made two coarse temple quads fold inward even though the high mesh remained valid.
  const latitudes = 12;
  // The facial aperture belongs around the eyes, nose and mouth, not through the crown. Taper the open longitude
  // sector to zero above the brow so the same bounded grid produces a continuous crown, temples and rear shell.
  // The previous all-latitude crop exposed the scalp and made the helmet read as a floating crescent in gameplay.
  addHelmetShell(mesh, head, dimensions, longitudes, latitudes, binding);
  addHelmetPeak(mesh, head, dimensions, binding);

  const earLongitudes = detail === 'high' ? 12 : 5;
  const earLatitudes = detail === 'high' ? 7 : 4;
  for (const sign of [-1, 1]) {
    const earFrame = {
      index: head.index,
      position: transform(head, [
        sign * dimensions.earGuardCenterX,
        dimensions.earGuardCenterY,
        dimensions.earGuardCenterZ,
      ]),
      rotation: head.rotation,
    };
    addEllipsoid(mesh, earFrame, dimensions.earGuardRadii, earLongitudes, earLatitudes,
      GEAR_REGIONS.padding, binding, -Math.PI * 0.5, Math.PI * 0.5, 0, Math.PI * 2,
      `helmet-ear-guard-${sign < 0 ? 'left' : 'right'}`);
  }

  const sides = detail === 'high' ? 8 : 4;
  const frontZ = dimensions.grilleFrontZ;
  for (const sign of [-1, 1]) {
    const points = [];
    const steps = detail === 'high' ? 9 : 5;
    for (let step = 0; step <= steps; step++) {
      const latitude = -0.18 * Math.PI + 0.46 * Math.PI * step / steps;
      const transition = clamp((latitude - dimensions.faceOpeningFullToLatitudeRadians) /
        (dimensions.faceOpeningClosedAtLatitudeRadians -
          dimensions.faceOpeningFullToLatitudeRadians), 0, 1);
      const easedTransition = transition * transition * (3 - 2 * transition);
      const opening = dimensions.faceOpeningHalfAngleRadians * (1 - easedTransition);
      const longitude = sign * opening;
      points.push(transform(head, helmetShellLocalPoint(dimensions, longitude, latitude)));
    }
    addTube(mesh, points, dimensions.apertureRimRadius, sides, GEAR_REGIONS.metal, binding,
      `helmet-aperture-rim-${sign < 0 ? 'left' : 'right'}`);
  }
  const grilleBarY = (x, centreY) =>
    centreY - 0.015 * Math.cos(x / dimensions.grilleHalfWidth * Math.PI * 0.5);
  for (const localY of [0.055, -0.005]) {
    const points = [];
    const steps = detail === 'high' ? 8 : 4;
    for (let index = 0; index <= steps; index++) {
      const x = -dimensions.grilleHalfWidth + dimensions.grilleHalfWidth * 2 * index / steps;
      points.push(transform(head, [x, grilleBarY(x, localY), frontZ]));
    }
    addTube(mesh, points,
      localY > 0.02 ? dimensions.upperBarRadius : dimensions.lowerBarRadius,
      sides, GEAR_REGIONS.metal, binding,
      localY > 0.02 ? 'helmet-grille-upper-bar' : 'helmet-grille-lower-bar');
  }
  for (const [uprightIndex, x] of [-0.082, -0.041, 0, 0.041, 0.082].entries()) {
    const lowerX = x * 0.86;
    addTube(mesh, [
      transform(head, [x * 0.98,
        dimensions.peakCenterY - dimensions.peakThickness * 0.5 +
          dimensions.uprightRadius * 0.35,
        dimensions.peakFrontZ - dimensions.uprightRadius * 0.45]),
      transform(head, [x, grilleBarY(x, 0.055), frontZ]),
      transform(head, [lowerX, grilleBarY(lowerX, -0.005), frontZ - 0.002]),
    ], dimensions.uprightRadius, sides, GEAR_REGIONS.metal, binding,
    `helmet-grille-upright-${uprightIndex}`);
  }
  for (const sign of [-1, 1]) {
    const shellAnchor = helmetShellLocalPoint(
      dimensions,
      sign * dimensions.faceOpeningHalfAngleRadians,
      0.06 * Math.PI,
    );
    addTube(mesh, [
      transform(head, shellAnchor),
      transform(head, [sign * dimensions.grilleHalfWidth,
        grilleBarY(sign * dimensions.grilleHalfWidth, 0.055), frontZ]),
      transform(head, [sign * dimensions.grilleHalfWidth,
        grilleBarY(sign * dimensions.grilleHalfWidth, -0.005), frontZ]),
    ], dimensions.sideGuardRadius, sides, GEAR_REGIONS.metal, binding,
    `helmet-grille-side-${sign < 0 ? 'left' : 'right'}`);
  }
}

function addPad(mesh, skeleton, side, detail) {
  const shinName = `lowerleg01.${side}`;
  const dimensions = GEAR_DIMENSIONS.pad;
  const frame = frameFor(skeleton, shinName, dimensions.centerOffset);
  const binding = rigidBinding(frame.index);
  // The live rear-shoulder view needs the pad silhouette and five cane rolls, not a dense hidden backing grid.
  // Four by six retains the authored outline while protecting the locked complete-batter triangle target.
  const columns = detail === 'high' ? 8 : 4;
  const rows = detail === 'high' ? 10 : 5;
  addRoundedPanel(mesh, frame, dimensions.panelWidth, dimensions.panelHeight,
    dimensions.panelDepth, columns, rows, GEAR_REGIONS.pad, binding, `pad-panel-${side}`, {
      rearWidthScale: dimensions.rearWidthScale,
      rearHeightScale: dimensions.rearHeightScale,
      bottomWidthScale: dimensions.bottomWidthScale,
      topWidthScale: dimensions.topWidthScale,
      sideWrapDepth: dimensions.sideWrapDepth,
    });

  const rollSides = detail === 'high' ? 5 : 4;
  for (const localX of dimensions.longitudinalRollOffsets) {
    const points = [];
    const steps = detail === 'high' ? 4 : 2;
    for (let step = 0; step <= steps; step++) {
      const localY = -dimensions.longitudinalRollHalfHeight +
        dimensions.longitudinalRollHalfHeight * 2 * step / steps;
      points.push(transform(frame, [localX, localY,
        dimensions.panelDepth + 0.014 + 0.006 * Math.cos(localY * Math.PI)]));
    }
    addTube(mesh, points, dimensions.longitudinalRollRadius, rollSides, GEAR_REGIONS.pad, binding,
      `pad-cane-roll-${side}`);
  }
  if (detail === 'high') {
    for (const localX of dimensions.longitudinalSeamOffsets) {
      addTube(mesh, [
        transform(frame, [localX, -dimensions.longitudinalRollHalfHeight + 0.004,
          dimensions.panelDepth + 0.016]),
        transform(frame, [localX, dimensions.kneeRollY - 0.018,
          dimensions.panelDepth + 0.020]),
      ], dimensions.longitudinalSeamRadius, rollSides, GEAR_REGIONS.strap, binding,
      `pad-cane-seam-${side}`);
    }
  }
  // A broad knee roll follows the curved front rather than reading as a rectangular armour plate.
  addTube(mesh, [
    transform(frame, [-dimensions.kneeRollHalfSpan, dimensions.kneeRollY,
      dimensions.panelDepth + 0.012]),
    transform(frame, [0, dimensions.kneeRollY + 0.016,
      dimensions.panelDepth + 0.026]),
    transform(frame, [dimensions.kneeRollHalfSpan, dimensions.kneeRollY,
      dimensions.panelDepth + 0.012]),
  ], dimensions.kneeRollRadius, rollSides, GEAR_REGIONS.pad, binding,
  `pad-knee-roll-${side}`);
  for (let strapIndex = 0; strapIndex < dimensions.strapY.length; strapIndex++) {
    const y = dimensions.strapY[strapIndex];
    if (detail === 'live' && strapIndex === 1) {
      const channelPoints = [];
      for (let pointIndex = 0; pointIndex < 5; pointIndex++) {
        const channelY = -dimensions.longitudinalRollHalfHeight +
          dimensions.longitudinalRollHalfHeight * 2 * pointIndex / 4;
        channelPoints.push(transform(frame, [0.014, channelY,
          dimensions.panelDepth + 0.018 + 0.004 * Math.cos(channelY * Math.PI)]));
      }
      addTube(mesh, channelPoints, dimensions.longitudinalSeamRadius, rollSides,
        GEAR_REGIONS.strap, binding, `pad-live-front-channel-${side}`);
      continue;
    }
    addTube(mesh, [
      transform(frame, [-dimensions.strapHalfSpan, y, dimensions.strapSideZ]),
      transform(frame, [-dimensions.strapIntermediateX, y, dimensions.strapRearZ]),
      transform(frame, [0, y, dimensions.strapRearZ]),
      transform(frame, [dimensions.strapIntermediateX, y, dimensions.strapRearZ]),
      transform(frame, [dimensions.strapHalfSpan, y, dimensions.strapSideZ]),
    ], dimensions.strapRadius, rollSides, GEAR_REGIONS.pad, binding,
    `pad-rear-strap-${side}`);
  }
}

function addGlove(mesh, skeleton, side, detail) {
  const dimensions = GEAR_DIMENSIONS.glove;
  const wrist = frameFor(skeleton, `wrist.${side}`, dimensions.palmCenterOffset);
  const wristBinding = rigidBinding(wrist.index);
  const palmLongitudes = detail === 'high' ? 18 : 8;
  const palmLatitudes = detail === 'high' ? 9 : 5;
  // Both bounded LODs use odd latitude counts, so neither samples the equator directly. Compensate the
  // horizontal radii for that fixed tessellation gap so high and live retain the same authored silhouette.
  const equatorCorrection = 1 / Math.cos(Math.PI / (2 * palmLatitudes));
  const sampledPalmRadii = [
    dimensions.palmRadii[0] * equatorCorrection,
    dimensions.palmRadii[1],
    dimensions.palmRadii[2] * equatorCorrection,
  ];
  addEllipsoid(mesh, wrist, sampledPalmRadii, palmLongitudes, palmLatitudes,
    GEAR_REGIONS.glove, wristBinding, -Math.PI * 0.5, Math.PI * 0.5, Math.PI * 0.5,
    Math.PI * 2, `glove-palm-${side}`);
  const backFrame = frameFor(skeleton, `wrist.${side}`, dimensions.backPanelCenterOffset);
  addRoundedPanel(mesh, backFrame,
    dimensions.backPanelWidth, dimensions.backPanelHeight, dimensions.backPanelDepth,
    detail === 'high' ? 6 : 3, detail === 'high' ? 7 : 3, GEAR_REGIONS.pad, wristBinding,
    `glove-back-panel-${side}`);

  const sides = detail === 'high' ? 7 : 5;
  // High retains the close-up back-of-hand rolls.  The live LOD spends those
  // same four tubes on the finger bank, where the rear-shoulder camera can
  // actually read them; this adds no triangles to the already full live budget.
  if (detail === 'high') {
    for (const localX of dimensions.backRollOffsets) {
      addTube(mesh, [
        transform(backFrame, [localX, -0.026, 0.012]),
        transform(backFrame, [localX, 0.024, 0.013]),
      ], dimensions.backRollRadius, sides, GEAR_REGIONS.pad, wristBinding,
      `glove-back-roll-${side}`);
    }
  }
  for (const localX of dimensions.seamOffsets) {
    addTube(mesh, [
      transform(backFrame, [localX, -0.025, 0.018]),
      transform(backFrame, [localX, 0.022, 0.018]),
    ], dimensions.seamRadius, sides, GEAR_REGIONS.strap, wristBinding,
    `glove-back-seam-${side}`);
  }

  // A batting glove is read as one compact gripping silhouette at gameplay distance. The old
  // independently bone-bound finger tubes remained in the MakeHuman open-hand rest pose and
  // became fifteen bright spikes around each bat handle. Keep the authored hand skeleton, but
  // render a closed wrist-bound finger bank and thumb volume: it cannot splay or detach while the
  // canonical grip rig moves the wrist around the bat.
  const fingerFrame = frameFor(skeleton, `wrist.${side}`, dimensions.fingerBankCenterOffset);
  const fingerLatitudes = detail === 'high' ? 9 : 5;
  const fingerEquatorCorrection = 1 / Math.cos(Math.PI / (2 * fingerLatitudes));
  addEllipsoid(mesh, fingerFrame, [
    dimensions.fingerBankRadii[0] * fingerEquatorCorrection,
    dimensions.fingerBankRadii[1],
    dimensions.fingerBankRadii[2] * fingerEquatorCorrection,
  ], detail === 'high' ? 16 : 8, fingerLatitudes, GEAR_REGIONS.glove, wristBinding,
  -Math.PI * 0.5, Math.PI * 0.5, Math.PI * 0.5, Math.PI * 2,
  `glove-finger-bank-${side}`);
  const fingerReliefOffsets = dimensions.fingerReliefOffsets;
  for (const localX of fingerReliefOffsets) {
    const reliefY = 0.018;
    const reliefZ = (localY) => dimensions.fingerBankRadii[2] * Math.sqrt(Math.max(0,
      1 - (localX / dimensions.fingerBankRadii[0]) ** 2 -
        (localY / dimensions.fingerBankRadii[1]) ** 2)) + dimensions.fingerReliefRadius * 0.55;
    addTube(mesh, [
      transform(fingerFrame, [localX, -reliefY, reliefZ(-reliefY)]),
      transform(fingerFrame, [localX, reliefY, reliefZ(reliefY)]),
    ], dimensions.fingerReliefRadius, sides, GEAR_REGIONS.strap, wristBinding,
    `glove-finger-relief-${side}`);
  }
  const sideSign = side === 'L' ? -1 : 1;
  const thumbOffset = dimensions.thumbCenterOffset.map((value, axis) =>
    axis === 0 ? value * sideSign : value);
  const thumbFrame = frameFor(skeleton, `wrist.${side}`, thumbOffset);
  addEllipsoid(mesh, thumbFrame, dimensions.thumbRadii,
    detail === 'high' ? 12 : 6, detail === 'high' ? 7 : 5,
    GEAR_REGIONS.glove, wristBinding, -Math.PI * 0.5, Math.PI * 0.5,
    Math.PI * 0.5, Math.PI * 2, `glove-thumb-${side}`);
  const cuff = [];
  const cuffSteps = detail === 'high' ? 12 : 6;
  for (let step = 0; step <= cuffSteps; step++) {
    const angle = Math.PI * 2 * step / cuffSteps;
    cuff.push(transform(frameFor(skeleton, `wrist.${side}`), [
      Math.cos(angle) * dimensions.strapHalfSpan,
      Math.sin(angle) * dimensions.strapHalfSpan * 0.62,
      -0.010,
    ]));
  }
  addTube(mesh, cuff, dimensions.strapRadius, sides, GEAR_REGIONS.strap, wristBinding,
    `glove-cuff-${side}`);
}

export function buildCricketGear(skeleton, detail = 'high') {
  if (detail !== 'high' && detail !== 'live') throw new Error(`Unsupported gear detail ${detail}`);
  const mesh = createSkinnedMesh();
  addHelmet(mesh, skeleton, detail);
  addPad(mesh, skeleton, 'L', detail);
  addPad(mesh, skeleton, 'R', detail);
  addGlove(mesh, skeleton, 'L', detail);
  addGlove(mesh, skeleton, 'R', detail);
  return finalizeSkinnedMesh(mesh);
}

function createStaticMesh() {
  return { vertices: [], indices: [] };
}

function addStaticVertex(mesh, position, uv, region) {
  const index = mesh.vertices.length;
  mesh.vertices.push({ position, uv, region, normal: [0, 1, 0], tangent: [1, 0, 0, 1] });
  return index;
}

function addStaticCap(mesh, ring, y, region, outwardUp) {
  const centre = addStaticVertex(mesh, [0, y, 0], [0.5, 0.5], region);
  for (let index = 0; index < ring.length - 1; index++) {
    if (outwardUp) addTriangle(mesh, centre, ring[index], ring[index + 1]);
    else addTriangle(mesh, centre, ring[index + 1], ring[index]);
  }
}

function addBatBlade(mesh, stationCount, sectionCount) {
  const base = mesh.vertices.length;
  for (let station = 0; station < stationCount; station++) {
    const u = station / (stationCount - 1);
    const y = -BAT_DIMENSIONS.totalLength + BAT_DIMENSIONS.bladeLength * u;
    const toe = clamp(u / 0.055, 0, 1);
    const shoulder = u < 0.86 ? 1 : 1 - 0.58 * ((u - 0.86) / 0.14) ** 1.35;
    const halfWidth = BAT_DIMENSIONS.bladeWidth * 0.5 * (0.84 + 0.16 * toe) * shoulder;
    const spine = 0.5 + 0.5 * Math.sin(Math.PI * clamp(u / 0.88, 0, 1));
    for (let section = 0; section <= sectionCount; section++) {
      const angle = Math.PI * 2 * section / sectionCount;
      const lateral = Math.sin(angle);
      const frontBack = Math.cos(angle);
      const edgeRound = Math.sign(lateral) * Math.abs(lateral) ** 0.78;
      const depth = BAT_DIMENSIONS.bladeThickness * (0.5 + 0.22 * spine);
      const z = frontBack >= 0
        ? frontBack * BAT_DIMENSIONS.bladeThickness * 0.5
        : frontBack * depth;
      addStaticVertex(mesh, [edgeRound * halfWidth, y, z], [section / sectionCount, u],
        Math.abs(frontBack) > 0.72 ? 0 : 1);
    }
  }
  for (let station = 0; station < stationCount - 1; station++) {
    for (let section = 0; section < sectionCount; section++) {
      const a = base + station * (sectionCount + 1) + section;
      const b = a + 1;
      const d = a + sectionCount + 1;
      const c = d + 1;
      addTriangle(mesh, a, c, d);
      addTriangle(mesh, a, b, c);
    }
  }
  addStaticCap(mesh,
    Array.from({ length: sectionCount + 1 }, (_, section) => base + section),
    -BAT_DIMENSIONS.totalLength, 0, false);
  const shoulder = base + (stationCount - 1) * (sectionCount + 1);
  addStaticCap(mesh,
    Array.from({ length: sectionCount + 1 }, (_, section) => shoulder + section),
    -BAT_DIMENSIONS.handleLength, 0, true);
}

function addBatHandle(mesh, axialCount, sides) {
  const base = mesh.vertices.length;
  for (let axial = 0; axial <= axialCount; axial++) {
    const v = axial / axialCount;
    const y = -BAT_DIMENSIONS.handleLength + BAT_DIMENSIONS.handleLength * v;
    const rib = 1 + 0.09 * Math.sin(v * Math.PI * axialCount * 2);
    for (let side = 0; side <= sides; side++) {
      const angle = Math.PI * 2 * side / sides;
      addStaticVertex(mesh, [
        Math.sin(angle) * BAT_DIMENSIONS.gripRadius * rib,
        y,
        Math.cos(angle) * BAT_DIMENSIONS.gripRadius * rib,
      ], [side / sides, v], 2);
    }
  }
  for (let axial = 0; axial < axialCount; axial++) {
    for (let side = 0; side < sides; side++) {
      const a = base + axial * (sides + 1) + side;
      const b = a + 1;
      const d = a + sides + 1;
      const c = d + 1;
      addTriangle(mesh, a, c, d);
      addTriangle(mesh, a, b, c);
    }
  }
  addStaticCap(mesh,
    Array.from({ length: sides + 1 }, (_, side) => base + side),
    -BAT_DIMENSIONS.handleLength, 2, false);
  const handleTop = base + axialCount * (sides + 1);
  addStaticCap(mesh,
    Array.from({ length: sides + 1 }, (_, side) => handleTop + side),
    0, 2, true);
}

export function buildCricketBat(detail = 'high') {
  if (detail !== 'high' && detail !== 'live') throw new Error(`Unsupported bat detail ${detail}`);
  const mesh = createStaticMesh();
  addBatBlade(mesh, detail === 'high' ? 25 : 11, detail === 'high' ? 14 : 8);
  addBatHandle(mesh, detail === 'high' ? 12 : 5, detail === 'high' ? 14 : 8);
  computeNormals(mesh);
  const tangents = computeTangents(mesh.vertices, mesh.indices);
  for (let index = 0; index < mesh.vertices.length; index++) mesh.vertices[index].tangent = tangents[index];
  return mesh;
}

function writeVector(bytes, offset, values) {
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error('VBT1 contains a non-finite vector');
    bytes.writeFloatLE(value, offset);
    offset += 4;
  }
  return offset;
}

export function encodeVbt1(mesh) {
  const vertexCount = mesh.vertices.length;
  const indexCount = mesh.indices.length;
  if (vertexCount < 3 || vertexCount > 65_535 || indexCount < 3 || indexCount % 3 !== 0)
    throw new Error('VBT1 mesh counts are outside the bounded contract');
  const bytes = Buffer.alloc(VBT_HEADER_BYTES + vertexCount * VBT_VERTEX_BYTES + indexCount * 2);
  bytes.write(VBT_MAGIC, 0, 4, 'ascii');
  bytes.writeUInt16LE(VBT_VERSION, 4);
  bytes.writeUInt16LE(VBT_VERTEX_BYTES, 6);
  bytes.writeUInt32LE(vertexCount, 8);
  bytes.writeUInt32LE(indexCount, 12);
  bytes.writeUInt8(VBT_INDEX_BYTES, 16);
  bytes.fill(0, 17, VBT_HEADER_BYTES);
  let offset = VBT_HEADER_BYTES;
  for (const vertex of mesh.vertices) {
    offset = writeVector(bytes, offset, vertex.position);
    offset = writeVector(bytes, offset, vertex.normal);
    offset = writeVector(bytes, offset, vertex.tangent);
    offset = writeVector(bytes, offset, vertex.uv);
    if (!Number.isInteger(vertex.region) || vertex.region < 0 || vertex.region > 2)
      throw new Error('VBT1 bat material region is invalid');
    bytes.writeUInt8(vertex.region, offset++);
    bytes.fill(0, offset, offset + 7);
    offset += 7;
  }
  for (const index of mesh.indices) {
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount)
      throw new Error('VBT1 index is invalid');
    bytes.writeUInt16LE(index, offset);
    offset += 2;
  }
  if (offset !== bytes.length) throw new Error('VBT1 writer length mismatch');
  return bytes;
}

export function parseVbt1Header(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < VBT_HEADER_BYTES || bytes.toString('ascii', 0, 4) !== VBT_MAGIC ||
      bytes.readUInt16LE(4) !== VBT_VERSION || bytes.readUInt16LE(6) !== VBT_VERTEX_BYTES ||
      bytes.readUInt8(16) !== VBT_INDEX_BYTES)
    throw new Error('VBT1 header is invalid');
  for (let offset = 17; offset < VBT_HEADER_BYTES; offset++)
    if (bytes[offset] !== 0) throw new Error('VBT1 reserved header bytes must be zero');
  const vertexCount = bytes.readUInt32LE(8);
  const indexCount = bytes.readUInt32LE(12);
  const expectedBytes = VBT_HEADER_BYTES + vertexCount * VBT_VERTEX_BYTES + indexCount * 2;
  if (vertexCount < 3 || vertexCount > 65_535 || indexCount < 3 || indexCount % 3 !== 0 ||
      bytes.length !== expectedBytes)
    throw new Error('VBT1 header or byte length is invalid');
  return { vertexCount, indexCount, triangleCount: indexCount / 3, expectedBytes };
}

async function writeIfChanged(path, bytes) {
  let current = null;
  try { current = await readFile(path); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (current == null || !current.equals(bytes)) await writeFile(path, bytes);
}

export async function exportProductionCricketGear({
  skeletonPath = DEFAULT_GEAR_SKELETON,
  outputDir = DEFAULT_GEAR_OUTPUT,
} = {}) {
  const skeletonBytes = await readFile(skeletonPath);
  const skeleton = decodeGearSkeleton(skeletonBytes);
  await mkdir(outputDir, { recursive: true });
  const outputs = [];
  for (const detail of ['high', 'live']) {
    const gear = buildCricketGear(skeleton, detail);
    const gearBytes = encodeVpm3(gear, skeleton.skeletonIdBytes);
    const gearHeader = parseVpm3Header(gearBytes);
    const gearBudget = GEAR_TRIANGLE_BUDGETS[detail];
    if (gearHeader.indexCount / 3 > gearBudget)
      throw new Error(`${detail} gear exceeds its ${gearBudget}-triangle budget`);
    const gearPath = join(outputDir, `cricket-gear-${detail}.bytes`);
    await writeIfChanged(gearPath, gearBytes);

    const bat = buildCricketBat(detail);
    const batBytes = encodeVbt1(bat);
    const batHeader = parseVbt1Header(batBytes);
    const batBudget = BAT_TRIANGLE_BUDGETS[detail];
    if (batHeader.triangleCount > batBudget)
      throw new Error(`${detail} bat exceeds its ${batBudget}-triangle budget`);
    const batPath = join(outputDir, `cricket-bat-${detail}.bytes`);
    await writeIfChanged(batPath, batBytes);

    outputs.push({
      detail,
      gear: {
        path: gearPath,
        bytes: gearBytes.length,
        sha256: sha256(gearBytes),
        vertices: gearHeader.vertexCount,
        triangles: gearHeader.indexCount / 3,
        skeletonId: gearHeader.skeletonId,
      },
      bat: {
        path: batPath,
        bytes: batBytes.length,
        sha256: sha256(batBytes),
        vertices: batHeader.vertexCount,
        triangles: batHeader.triangleCount,
      },
    });
  }

  const manifest = {
    status: 'ORIGINAL TECHNICAL ART CANDIDATE / INDEPENDENT VISUAL ACCEPTANCE UNPROVEN',
    generatedAtUtc: new Date(0).toISOString(),
    generator: 'scripts/export-unity-production-cricket-gear.mjs',
    source: 'Original VANDE-authored parametric surfaces; no third-party mesh, brand, sponsor or likeness',
    skeleton: {
      path: skeletonPath,
      sha256: sha256(skeletonBytes),
      id: skeleton.skeletonId,
      bones: skeleton.boneCount,
    },
    dimensions: {
      bat: BAT_DIMENSIONS,
      gear: GEAR_DIMENSIONS,
    },
    foregroundReadabilityPolicy: {
      helmet: 'Distinct padded ear guards and nape shell; the complete aperture rim, horizontal bars, uprights and side rails use the non-emissive metal region.',
      pads: 'Tapered ankle and knee edges, shallow side wrap, overlapping rear depth and a live front channel keep each pad integrated with its shin.',
      gloves: 'Compact wrist-bound palm and finger-bank volumes retain a thumb and four contrast finger channels without independent finger-bone gaps.',
    },
    shaderRegions: GEAR_REGIONS,
    renderedFamilies: GEAR_FAMILIES.externallyRendered,
    omittedUnderClothing: GEAR_FAMILIES.omittedUnderClothing,
    outputs,
    limitations: [
      'Runtime integration is technical only; independent normal-speed and slow-motion gameplay-distance review remains required.',
      'Body/equipment clipping, grip, left-handed mirroring and animation deformation remain UNPROVEN.',
      'Android fresh-installed size and India-weighted working reach remain UNPROVEN.',
      'Builders cannot certify visual realism or player acceptance.',
    ],
  };
  const manifestPath = join(outputDir, 'original-cricket-gear-provenance.json');
  await writeIfChanged(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  return { ...manifest, manifestPath };
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  exportProductionCricketGear({
    skeletonPath: process.argv[2] ?? DEFAULT_GEAR_SKELETON,
    outputDir: process.argv[3] ?? DEFAULT_GEAR_OUTPUT,
  }).then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`), (error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
