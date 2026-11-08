import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const pointerPath = resolve(here, 'active-target.v2.json');
const addendumPath = resolve(here, 'ACTIVE-TARGET-V2-ADDENDUM.md');
const pointer = JSON.parse(readFileSync(pointerPath, 'utf8'));
const addendum = readFileSync(addendumPath, 'utf8');

const expectedStatus =
  'STATIC_DIRECTION_CANDIDATE_PENDING_CURRENT_CAPTURE_ASSET_FEASIBILITY_AND_OWNER_APPROVAL';
const shaPattern = /^[0-9a-f]{64}$/u;

function exactKeys(value, expected, label) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} keys`);
}

function bytes(path) {
  const absolute = resolve(repository, path);
  assert.equal(statSync(absolute).isFile(), true, `${path} must be a file`);
  return readFileSync(absolute);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function verifyIdentity(identity, label) {
  assert.match(identity.sha256, shaPattern, `${label} SHA-256 grammar`);
  const content = bytes(identity.path);
  assert.equal(sha256(content), identity.sha256, `${label} SHA-256`);
  return content;
}

function pngIdentity(identity, label, expectedWidth, expectedHeight) {
  const content = verifyIdentity(identity, label);
  assert.equal(content.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${label} PNG signature`);
  assert.equal(content.subarray(12, 16).toString('ascii'), 'IHDR', `${label} PNG IHDR`);
  assert.equal(content.readUInt32BE(16), expectedWidth, `${label} width`);
  assert.equal(content.readUInt32BE(20), expectedHeight, `${label} height`);
  assert.equal(content.length, identity.bytes, `${label} byte count`);
}

exactKeys(pointer, [
  'schemaVersion',
  'selectionId',
  'recordedUtc',
  'status',
  'claimBoundary',
  'selectionReason',
  'target',
  'frozenStaticPackage',
  'independentStaticRetest',
  'assetFeasibility',
  'comparison',
  'historicalV1Records',
  'pending',
], 'active target');
assert.equal(pointer.schemaVersion, 1);
assert.equal(pointer.selectionId, 'gate-a-static-direction-v2');
assert.equal(pointer.status, expectedStatus);
assert.equal(pointer.claimBoundary, 'STATIC_DIRECTION_ONLY_NOT_RUNTIME_NOT_GATE_A_NOT_OWNER_APPROVED');
assert.match(pointer.recordedUtc, /^2026-10-29T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/u);
assert.match(pointer.selectionReason, /v1 is historical and superseded/u);
assert.match(pointer.selectionReason, /PIP/u);
assert.match(pointer.selectionReason, /crop anchors differed/u);

const { target } = pointer;
exactKeys(target, [
  'handedness',
  'viewport',
  'horizontalFovDegrees',
  'clean',
  'overlay',
  'machineContract',
  'readme',
  'captureContract',
], 'target');
assert.equal(target.handedness, 'right');
assert.deepEqual(target.viewport, { width: 844, height: 390, deviceScaleFactor: 1 });
assert.equal(target.horizontalFovDegrees, 58);
assert.equal(target.clean.path,
  'docs/evaluation/gate-a/visual-direction/v1/golden-screen-v2-844x390.png');
assert.equal(target.clean.sha256,
  'f7e70b281a7127ae0f2eead9f4f5e1fb4e60c220eec9ae0a94ec7c58b59a97e9');
assert.equal(target.overlay.path,
  'docs/evaluation/gate-a/visual-direction/v1/golden-screen-v2-evidence-844x390.png');
assert.equal(target.overlay.sha256,
  '9c8611e6a44b90b1eda2bc576de1138bd48858e6469c2690a49ec5055cedf099');
pngIdentity(target.clean, 'clean target', 844, 390);
pngIdentity(target.overlay, 'overlay target', 844, 390);
verifyIdentity(target.machineContract, 'machine contract');
verifyIdentity(target.readme, 'target README');
verifyIdentity(target.captureContract, 'capture contract');
assert.equal(target.captureContract.method, 'local-headless-chromium-playwright-static-html');
assert.equal(target.captureContract.outputPolicy, 'exclusive-hard-link-no-overwrite');
assert.deepEqual(target.captureContract.referenceCrop, {
  mode: 'cover',
  anchorCoordinateSystem: 'top-left-normalized',
  anchor: { x: 0.5, y: 1 },
});

assert.equal(pointer.frozenStaticPackage.length, 13, 'frozen package path count');
assert.equal(
  new Set(pointer.frozenStaticPackage.map(({ path }) => path)).size,
  13,
  'frozen package paths unique',
);
for (const identity of pointer.frozenStaticPackage) {
  verifyIdentity(identity, `frozen package ${identity.path}`);
  assert.match(addendum, new RegExp(identity.sha256, 'u'), `${identity.path} hash in addendum`);
}

verifyIdentity(pointer.independentStaticRetest, 'independent static retest');
assert.equal(
  pointer.independentStaticRetest.verdict,
  'PASS_FROZEN_V2_STATIC_DIRECTION_PACKAGE_ONLY_GATE_A_NOT_PASSED',
);

exactKeys(pointer.assetFeasibility, ['path', 'sha256', 'status'], 'asset feasibility');
const assetFeasibility = verifyIdentity(pointer.assetFeasibility, 'asset feasibility').toString('utf8');
assert.equal(
  pointer.assetFeasibility.status,
  'PRODUCTION_ASSET_FEASIBILITY_UNRESOLVED_GATE_A_NOT_PASSED',
);
assert.match(assetFeasibility, /V2_STATIC_DIRECTION_CANDIDATE/u);
assert.match(assetFeasibility, /GATE_A NOT PASSED/u);
assert.match(assetFeasibility, /ten `REQUIRED_MISSING` rows/u);
assert.match(assetFeasibility, /six `REFERENCE_ONLY` rows/u);
assert.match(assetFeasibility, /SIZE-50 and India REACH-90 remain\s+\*\*UNPROVEN\*\*/u);

exactKeys(pointer.comparison, [
  'templatePath',
  'templateSha256',
  'strictComparator',
], 'comparison');
const templateBytes = verifyIdentity(
  { path: pointer.comparison.templatePath, sha256: pointer.comparison.templateSha256 },
  'comparison template',
);
const comparator = pointer.comparison.strictComparator;
exactKeys(comparator, [
  'sourcePath',
  'sourceSha256',
  'testPath',
  'testSha256',
  'dependencySet',
], 'strict comparator');
verifyIdentity(
  { path: comparator.sourcePath, sha256: comparator.sourceSha256 },
  'strict comparator source',
);
verifyIdentity(
  { path: comparator.testPath, sha256: comparator.testSha256 },
  'strict comparator tests',
);
assert.equal(comparator.dependencySet.length, 5, 'strict comparator dependency count');
assert.equal(
  new Set(comparator.dependencySet.map(({ path }) => path)).size,
  comparator.dependencySet.length,
  'strict comparator dependency paths unique',
);
for (const identity of comparator.dependencySet) {
  exactKeys(identity, ['path', 'sha256'], `strict comparator dependency ${identity.path}`);
  verifyIdentity(identity, `strict comparator dependency ${identity.path}`);
  assert.match(addendum, new RegExp(identity.sha256, 'u'), `${identity.path} hash in addendum`);
}

assert.equal(
  pointer.historicalV1Records.policy,
  'PRESERVE_BYTE_FOR_BYTE_AS_HISTORICAL_NOT_ACTIVE_TARGET',
);
verifyIdentity(pointer.historicalV1Records.cleanTarget, 'historical v1 clean target');
verifyIdentity(pointer.historicalV1Records.overlayTarget, 'historical v1 overlay target');
assert.equal(pointer.historicalV1Records.reports.length, 5, 'historical report count');
for (const identity of pointer.historicalV1Records.reports) {
  verifyIdentity(identity, `historical record ${identity.path}`);
}

assert.deepEqual(pointer.pending, [
  'EXACT_CURRENT_ACCEPTED_ANDROID_CAPTURE',
  'MATCHED_CURRENT_V2_COMPARISON',
  'PRODUCTION_ASSET_SOURCE_LICENCE_IMPORT_AND_MOBILE_FEASIBILITY',
  'OWNER_APPROVAL',
]);

const targetContract = JSON.parse(bytes(target.machineContract.path).toString('utf8'));
assert.equal(targetContract.status, 'STATIC_TARGET_ONLY_NOT_GATE_A_EVIDENCE');
assert.equal(targetContract.composition.viewport.width, target.viewport.width);
assert.equal(targetContract.composition.viewport.height, target.viewport.height);
assert.equal(targetContract.composition.viewport.deviceScaleFactor, target.viewport.deviceScaleFactor);
assert.equal(targetContract.composition.camera.horizontalFovDegrees, target.horizontalFovDegrees);
assert.deepEqual(
  targetContract.composition.referenceCrop,
  target.captureContract.referenceCrop,
  'selected crop contract',
);
const artifactStatuses = new Map(
  targetContract.artifacts.map(({ path, status }) => [path, status]),
);
assert.equal(
  artifactStatuses.get('golden-screen-v2-844x390.png'),
  'CURRENT_STATIC_TARGET_NOT_RUNTIME_EVIDENCE',
);
assert.equal(
  artifactStatuses.get('golden-screen-v2-evidence-844x390.png'),
  'CURRENT_STATIC_EVALUATOR_OVERLAY_NOT_RUNTIME_EVIDENCE',
);
assert.equal(
  artifactStatuses.get('golden-screen-844x390.png'),
  'SUPERSEDED_PIP_COUNT_AND_CROP_ANCHOR_DEFECT',
);
assert.equal(
  artifactStatuses.get('golden-screen-evidence-844x390.png'),
  'SUPERSEDED_PIP_COUNT_AND_CROP_ANCHOR_DEFECT',
);

assert.match(addendum, new RegExp(expectedStatus, 'u'));
assert.match(addendum, /not owner approval/u);
assert.match(addendum, /Gate A is\s+not passed/u);
assert.match(addendum, /historical provisional rubric/u);
assert.match(addendum, /right/u);
assert.match(addendum, /844 × 390/u);
assert.match(addendum, /58°/u);
assert.match(addendum, new RegExp(pointer.independentStaticRetest.sha256, 'u'));
assert.match(addendum, new RegExp(pointer.assetFeasibility.sha256, 'u'));
assert.match(addendum, new RegExp(pointer.comparison.templateSha256, 'u'));
assert.match(addendum, new RegExp(comparator.sourceSha256, 'u'));
assert.match(addendum, new RegExp(comparator.testSha256, 'u'));

const template = templateBytes.toString('utf8');
assert.match(template, new RegExp(expectedStatus, 'u'));
assert.match(template, /Gate-A verdict until every required field is bound: \*\*NOT PASSED\*\*/u);
assert.match(template, /golden-screen-v2-844x390\.png/u);
assert.match(template, new RegExp(target.clean.sha256, 'u'));
assert.match(template, /\| Handedness \| \*\*MISSING\*\* \| `right` \|/u);
assert.match(template, /\| Horizontal FOV \| \*\*MISSING\*\* \| `58°` \|/u);
assert.match(template, /844x390 \/ 844x390/u);
assert.match(template, /active-target\.v2\.json/u);
assert.match(template, /CURRENT-TARGET-V2-ADDENDUM|ACTIVE-TARGET-V2-ADDENDUM/u);
assert.match(template, /STATIC_GOLDEN_DIRECTION_NOT_RUNTIME/u);
assert.match(template, /DIRECTIONAL_COMPARISON_READY_NOT_GATE_PASS/u);
assert.match(template, /DIRECTIONAL_COMPARISON_NOT_COMPARABLE_NOT_GATE_PASS/u);
assert.match(template, /logical CSS viewport/u);
assert.match(template, /device pixel\s+ratio is exactly `1`/u);
assert.match(template, /422x195 logical viewport at DPR 2/u);
assert.doesNotMatch(template, /golden-screen-844x390\.png/u);
assert.doesNotMatch(template, /d75e208a0363a5905937ef795076b4ccabda90d6ab3eb6e43ae1c5d687caaa57/u);

process.stdout.write(
  'GATE_A_ACTIVE_TARGET_V2_OK status=pending-owner target=f7e70b281a71 overlay=9c8611e6a44b package=13 historical=preserved comparator=frozen-full-h7-logical-dpr\n',
);
