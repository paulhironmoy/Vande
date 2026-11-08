import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../../..');
const target = JSON.parse(readFileSync(resolve(here, 'target.v1.json'), 'utf8'));
const composition = target.composition;

function exactKeys(value, keys, label) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function pngIdentity(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${path} PNG signature`);
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR', `${path} IHDR`);
  return {
    bytes: bytes.length,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    sha256: sha256(bytes),
  };
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

function assertClose(actual, expected, label, epsilon = 1e-6) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon,
    `${label}: expected ${expected}, observed ${actual}`,
  );
}

function csharpNumber(source, name) {
  const match = source.match(new RegExp(`public const (?:int|float|double) ${name} = ([0-9.]+)f?;`, 'u'));
  assert.ok(match, `Unity target constant ${name}`);
  return Number(match[1]);
}

exactKeys(target, ['schemaVersion', 'status', 'composition', 'artifacts'], 'target');
assert.equal(target.schemaVersion, 1);
assert.equal(target.status, 'STATIC_TARGET_ONLY_NOT_GATE_A_EVIDENCE');
exactKeys(composition, [
  'viewport', 'camera', 'referenceCrop', 'hud', 'touch', 'deliveryCorridor', 'pip',
], 'composition');
assert.deepEqual(composition.viewport, { width: 844, height: 390, deviceScaleFactor: 1 });
assert.equal(composition.camera.horizontalFovDegrees, 58);
assert.deepEqual(composition.referenceCrop, {
  mode: 'cover',
  anchorCoordinateSystem: 'top-left-normalized',
  anchor: { x: 0.5, y: 1 },
});

const hudNames = ['score', 'conditions', 'fieldPip', 'pause'];
const hudArea = hudNames.reduce((sum, name) => {
  const rect = composition.hud[name];
  exactKeys(rect, ['x', 'y', 'width', 'height'], `HUD ${name}`);
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0, `HUD ${name} bounds`);
  assert.ok(rect.x + rect.width <= composition.viewport.width, `HUD ${name} x containment`);
  assert.ok(rect.y + rect.height <= composition.viewport.height, `HUD ${name} y containment`);
  return sum + rect.width * rect.height;
}, 0);
const hudOccupancy = hudArea / (composition.viewport.width * composition.viewport.height);
assert.ok(hudOccupancy <= composition.hud.maximumOccupancy, 'HUD occupancy ceiling');
assert.deepEqual(composition.hud.score, { x: 10, y: 10, width: 126, height: 46 });
assert.deepEqual(composition.hud.conditions, { x: 10, y: 62, width: 146, height: 28 });
assert.deepEqual(composition.hud.fieldPip, { x: 750, y: 10, width: 84, height: 84 });
assert.deepEqual(composition.hud.pause, { x: 786, y: 100, width: 48, height: 48 });

assert.equal(composition.touch.fraction, 0.46);
assertClose(composition.touch.rect.x, 0, 'touch x');
assertClose(
  composition.touch.rect.y,
  composition.viewport.height * (1 - composition.touch.fraction),
  'touch y',
);
assertClose(composition.touch.rect.width, composition.viewport.width, 'touch width');
assertClose(
  composition.touch.rect.height,
  composition.viewport.height * composition.touch.fraction,
  'touch height',
);
assert.equal(composition.deliveryCorridor.length, 4);
const corridorBounds = {
  x: Math.min(...composition.deliveryCorridor.map(({ x }) => x)),
  y: Math.min(...composition.deliveryCorridor.map(({ y }) => y)),
  width: Math.max(...composition.deliveryCorridor.map(({ x }) => x))
    - Math.min(...composition.deliveryCorridor.map(({ x }) => x)),
  height: Math.max(...composition.deliveryCorridor.map(({ y }) => y))
    - Math.min(...composition.deliveryCorridor.map(({ y }) => y)),
};
for (const name of hudNames) {
  assert.equal(overlaps(composition.hud[name], corridorBounds), false, `${name} outside corridor`);
}

assert.equal(composition.pip.orientation, 'bowler-end-top-striker-end-bottom');
assert.equal(composition.pip.batter.id, 'batter');
assert.equal(composition.pip.batter.role, 'batter');
assert.equal(composition.pip.defenders.length, 11);
const allMarkers = [composition.pip.batter, ...composition.pip.defenders];
assert.equal(new Set(allMarkers.map(({ id }) => id)).size, 12, 'PIP marker IDs are unique');
assert.equal(composition.pip.defenders.filter(({ role }) => role === 'keeper').length, 1);
assert.equal(composition.pip.defenders.filter(({ role }) => role === 'bowler').length, 1);
assert.equal(composition.pip.defenders.filter(({ role }) => role === 'fielder').length, 9);
assert.equal(composition.pip.defenders.some(({ id }) => id === 'batter'), false, 'batter excluded from defence');
assert.equal(
  composition.pip.defenders.find(({ id }) => id === composition.pip.activeBowlerId)?.role,
  'bowler',
  'active highlight belongs to the bowler',
);
for (const marker of allMarkers) {
  assert.ok(marker.x >= 0 && marker.x <= 1 && marker.y >= 0 && marker.y <= 1, `${marker.id} normalized`);
}

const html = readFileSync(resolve(here, 'index.html'), 'utf8');
const embeddedMatch = html.match(/<script id="golden-target" type="application\/json">([\s\S]*?)<\/script>/u);
assert.ok(embeddedMatch, 'HTML embedded target');
assert.deepEqual(JSON.parse(embeddedMatch[1]), composition, 'HTML composition equals frozen target');
assert.match(html, /world\.style\.objectFit = target\.referenceCrop\.mode/u);
assert.match(html, /world\.style\.objectPosition = `\$\{target\.referenceCrop\.anchor\.x \* 100\}% \$\{target\.referenceCrop\.anchor\.y \* 100\}%`/u);
assert.match(html, /addMarker\(target\.pip\.batter, 'batting'\)/u);
assert.match(html, /target\.pip\.defenders\.forEach\(\(marker\) => addMarker\(marker, 'defending'\)\)/u);
assert.match(html, /marker\.id === target\.pip\.activeBowlerId/u);

// The old GoldenScreenLayout/OverlayPainter/Prototype review harness was deliberately removed after the
// production world and HUD became the only admissible runtime path. Validate the same frozen direction against
// those live sources; restoring the deleted review-only runtime would create a second UI implementation.
const candidateWorldPath = resolve(repository,
  'unity/VandePractice/Assets/VandePractice/Runtime/GoldenScreen/GoldenScreenCandidateWorld.cs');
const practiceWorldPath = resolve(repository,
  'unity/VandePractice/Assets/VandePractice/Runtime/Presentation/ProceduralPracticeWorld.cs');
const hudLayoutPath = resolve(repository,
  'unity/VandePractice/Assets/VandePractice/Runtime/UI/Production/ProductionHudLayout.cs');
const hudViewPath = resolve(repository,
  'unity/VandePractice/Assets/VandePractice/Runtime/UI/Production/ProductionHudView.cs');
const hudStatePath = resolve(repository,
  'unity/VandePractice/Assets/VandePractice/Runtime/UI/Production/ProductionHudState.cs');
const fieldPipPath = resolve(repository,
  'unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Environment/ProductionFieldPip.cs');
const touchInputPath = resolve(repository,
  'unity/VandePractice/Assets/VandePractice/Runtime/Input/VandeTouchInputCapture.cs');
const candidateWorld = readFileSync(candidateWorldPath, 'utf8');
const practiceWorld = readFileSync(practiceWorldPath, 'utf8');
const hudLayout = readFileSync(hudLayoutPath, 'utf8');
const hudView = readFileSync(hudViewPath, 'utf8');
const hudState = readFileSync(hudStatePath, 'utf8');
const fieldPip = readFileSync(fieldPipPath, 'utf8');
const touchInput = readFileSync(touchInputPath, 'utf8');

assert.equal(csharpNumber(candidateWorld, 'ReferenceWidth'), composition.viewport.width);
assert.equal(csharpNumber(candidateWorld, 'ReferenceHeight'), composition.viewport.height);
assert.equal(
  csharpNumber(practiceWorld, 'TargetHorizontalFovDegrees'),
  composition.camera.horizontalFovDegrees,
);
assert.equal(csharpNumber(hudLayout, 'LiveQuietMaximumOccupancy'), composition.hud.maximumOccupancy);
assert.equal(csharpNumber(hudLayout, 'PauseTargetDp'), composition.hud.pause.width);
assert.equal(csharpNumber(hudLayout, 'ReferenceScoreWidth'), composition.hud.score.width);
assert.equal(csharpNumber(hudLayout, 'ReferenceScoreHeight'), composition.hud.score.height);
assert.equal(csharpNumber(hudLayout, 'ReferenceConditionsWidth'), composition.hud.conditions.width);
assert.equal(csharpNumber(hudLayout, 'ReferenceConditionsHeight'), composition.hud.conditions.height);
assert.equal(csharpNumber(hudLayout, 'ReferenceFieldPipSize'), composition.hud.fieldPip.width);
assertClose(
  1 - csharpNumber(touchInput, 'TopFraction'),
  composition.touch.fraction,
  'live batting input fraction',
);

// The candidate must compose the actual production world/HUD and must remain quarantined from live Practice.
assert.match(candidateWorld, /root\.AddComponent<ProceduralPracticeWorld>\(\)/u);
assert.match(candidateWorld, /root\.AddComponent<ProductionHudView>\(\)/u);
assert.match(candidateWorld, /CanEnterLivePractice => false/u);
assert.match(candidateWorld, /GateAReady => false/u);
assert.match(candidateWorld, /VerticalFovForHorizontal\([\s\S]*?TargetHorizontalFovDegrees/u);
assert.match(candidateWorld, /hud\.SetFieldPipTexture\(world\.FieldPipTexture\)/u);

// The live radar is field-state driven: eleven defenders plus a separately projected batter. Its projection maps
// physics +z down the inset (bowler end at top, striker end at bottom) and highlights the authoritative bowler role.
assert.match(hudView, /fielderMarkers = new ProductionHudShape\[11\]/u);
assert.match(hudView, /scene\?\.Fielders != null && scene\.Fielders\.Length == 11/u);
assert.match(hudView, /ProductionFieldPipProjection\.Project\([\s\S]*?scene\.BatterLateralM/u);
assert.match(hudView, /player\.Role,[\s\S]*?"bowler"/u);
assert.match(hudView, /activeBowler \? HudAccentColour : HudTextColour/u);
assert.match(hudState, /normalizedY = Mathf\.Clamp01\(0\.5f - \(float\)z/u);
assert.match(hudState, /leftHanded \? -\(float\)x : \(float\)x/u);

// The rendered field-setting inset follows the frozen identity: the striker plus eleven defenders. The
// non-striker remains in the 3D world, but must not become a thirteenth radar marker. This source invariant is a
// guardrail only; the focused Unity receipt independently measures the rendered marker count.
const updateFieldPip = practiceWorld.match(
  /private void UpdateFieldPip\(\)[\s\S]*?fieldPip\.SetBall\([\s\S]*?\n\s*\}\n/u,
)?.[0];
assert.ok(updateFieldPip, 'live UpdateFieldPip implementation');
assert.match(updateFieldPip, /batterRig[\s\S]*?StrikerColour/u);
assert.match(updateFieldPip, /bowler[\s\S]*?BowlerColour/u);
assert.match(updateFieldPip, /role == "keeper" \? ProductionFieldPip\.KeeperColour/u);
assert.doesNotMatch(updateFieldPip, /nonStrikerRig|NonStrikerColour/u);
assert.match(fieldPip, /striker and eleven defenders/u);
assert.match(fieldPip, /non-striker[\s\S]*?deliberately omitted/u);

// The reference viewport retains the exact 10 px margin/6 px rail gap through the production layout calculation,
// while accessibility may expand controls on other viewports.
assert.match(hudLayout, /var margin = Mathf\.Max\(10f, 10f \* dp\)/u);
assert.match(hudLayout, /var gap = Mathf\.Max\(6f, 6f \* dp\)/u);
assert.match(hudLayout, /safe\.xMax - margin - pipSize/u);
assert.match(hudLayout, /fieldPip\.yMin - gap - pauseSize/u);
// At 844x390/160 dpi the quiet conditions rail must retain the frozen 28 px height. A prior half-height floor
// rendered 21.54 px and was independently rejected. Runtime/crop/corridor proof still comes from Unity evidence.
assert.match(hudLayout, /Mathf\.Max\(ReferenceConditionsHeight \* dp,/u);
assert.doesNotMatch(hudLayout, /ReferenceConditionsHeight \* 0\.5f \* dp/u);

exactKeys(target, ['schemaVersion', 'status', 'composition', 'artifacts'], 'target');
assert.ok(Array.isArray(target.artifacts) && target.artifacts.length >= 3, 'target artifacts');
for (const artifact of target.artifacts) {
  exactKeys(artifact, ['path', 'status', 'width', 'height', 'bytes', 'sha256'], `artifact ${artifact.path}`);
  assert.match(artifact.sha256, /^[0-9a-f]{64}$/u);
  const path = resolve(here, artifact.path);
  assert.equal(statSync(path).isFile(), true, `${artifact.path} regular file`);
  assert.deepEqual(
    pngIdentity(path),
    { bytes: artifact.bytes, width: artifact.width, height: artifact.height, sha256: artifact.sha256 },
    `${artifact.path} exact identity`,
  );
}

process.stdout.write(`GATE_A_GOLDEN_TARGET_OK markers=12 defence=11 fov=58 hud=${(hudOccupancy * 100).toFixed(3)}% artifacts=${target.artifacts.length}\n`);
