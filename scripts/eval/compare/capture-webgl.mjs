#!/usr/bin/env node

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unitySourceDigest, verifyUnityWebGlRoot } from '../../verify-unity-webgl.mjs';
import {
  assertValidManifest,
  defaultEvidenceDir,
  ensureNewDirectory,
  hostUptime,
  parseArgs,
  REPO_ROOT,
  safeId,
  sourceBuildId,
  toolVersions,
  utcNow,
  writeJsonNew,
} from './lib.mjs';
import { artifactInventory, captureWeb, verifyUnityHostArtifactBinding } from './capture-web.mjs';
import { verifyTrustedUnityExport } from './unity-provenance.mjs';

export function assessWebGlAvailability({ exportRoot, hostRoot, projectRoot, sourceId }) {
  try {
    const sourceSha256 = unitySourceDigest(projectRoot);
    const verified = verifyUnityWebGlRoot(exportRoot, {
      expectedBuildId: sourceId,
      expectedSourceSha256: sourceSha256,
    });
    const provenance = verifyTrustedUnityExport(exportRoot, verified.manifest, {
      expectedBuildId: sourceId,
      expectedSourceSha256: sourceSha256,
    });
    if (!hostRoot) {
      throw new Error('--host-artifact-root is required so the React host and Unity export can be verified separately');
    }
    const hostArtifact = artifactInventory(hostRoot);
    const hostBinding = verifyUnityHostArtifactBinding(hostArtifact, exportRoot, verified.files);
    return {
      available: true,
      status: 'AVAILABLE_FOR_RUNTIME_CAPTURE',
      reason: null,
      buildId: verified.manifest.buildId,
      unityVersion: verified.manifest.unityVersion,
      unitySourceSha256: sourceSha256,
      artifactCount: verified.files.size,
      hostArtifactCount: hostArtifact.files.length,
      hostedUnityArtifactCount: hostBinding.fileCount,
      exporterReceiptSha256: provenance.receiptSha256,
    };
  } catch (error) {
    return {
      available: false,
      status: 'NOT_AVAILABLE',
      reason: error instanceof Error ? error.message : String(error),
      buildId: null,
      unityVersion: null,
      unitySourceSha256: null,
      artifactCount: 0,
      hostArtifactCount: 0,
      hostedUnityArtifactCount: 0,
    };
  }
}

function notAvailableManifest({ sourceId, reason, captureId, evaluator }) {
  return {
    schemaVersion: 1,
    captureId,
    lane: 'vande_engine_truth',
    evidenceClass: 'diagnostic',
    status: 'not_available',
    evaluator: { id: evaluator, role: 'capture operator', authoredSubject: false, independent: false },
    rights: {
      basis: 'VANDE-owned source; no qualifying current Unity WebGL runtime was captured',
      sourceUrl: null,
      redistribution: 'owned',
      notes: ['This record is an explicit availability failure, not Unity evidence.'],
    },
    identity: {
      repositorySourceId: sourceId,
      embeddedBuildId: null,
      artifact: null,
      application: { title: 'VANDE Cricket', packageId: 'in.vande.cricket', version: null, store: null },
      renderer: { claimed: 'unity-webgl', observed: null, admission: null, proof: null },
    },
    timing: { capturedAtUtc: utcNow(), hostUptime: hostUptime(), durationMs: null },
    environment: {
      platform: 'unity-webgl preflight',
      device: null,
      os: null,
      soc: null,
      gpu: null,
      ramMb: null,
      viewport: null,
      orientation: null,
      refreshHz: null,
      qualityTier: null,
      thermal: null,
      battery: null,
      power: null,
      network: null,
      backgroundLoad: hostUptime(),
    },
    gameplay: {
      scenario: 'Unity WebGL production runtime capture',
      seed: null,
      controls: null,
      inputMethod: null,
      assistance: null,
      handedness: null,
      pitch: null,
      field: null,
      timeScale: null,
      wholeSequence: false,
    },
    capture: {
      method: 'current-source Unity WebGL export provenance preflight',
      recorder: { class: 'none', bitRateBps: null },
      resolution: null,
      frameRate: null,
      codec: null,
      audio: { method: 'none', synchronized: false, limitations: ['No qualifying runtime capture exists.'] },
      perturbations: [],
      limitations: ['NOT AVAILABLE: Three.js or Classic output is never relabelled as Unity WebGL.'],
    },
    files: [],
    sidecars: { events: [], physics: [], replay: [], frames: [], annotations: [] },
    transformations: [],
    applicability: {
      metrics: {},
      excludedClaims: ['Unity WebGL runtime, presentation, parity, performance, input, audio or player-experience claims'],
    },
    expectedScenario: 'A provenance-valid current-source Unity WebGL export and a runtime that proves renderer=unity-webgl before capture.',
    observedDeviations: [reason],
    errors: [],
    tools: toolVersions(),
  };
}

export async function captureWebGl(options) {
  const sourceId = sourceBuildId();
  if (options.expected_build_id && options.expected_build_id !== sourceId) {
    throw new Error(`Expected build ID ${options.expected_build_id} does not match derived current source ${sourceId}`);
  }
  const exportRoot = resolve(options.export_root ?? join(REPO_ROOT, 'unity', 'VandePractice', 'Builds', 'WebGL'));
  const hostRoot = options.host_artifact_root ? resolve(options.host_artifact_root) : null;
  const projectRoot = resolve(options.project ?? join(REPO_ROOT, 'unity', 'VandePractice'));
  const availability = assessWebGlAvailability({ exportRoot, hostRoot, projectRoot, sourceId });
  const evaluator = options.evaluator ?? 'capture-tooling-builder';
  if (!availability.available || !options.base) {
    const reason = availability.available
      ? 'A provenance-valid export exists, but --base was not supplied for a live runtime identity check.'
      : availability.reason;
    const out = ensureNewDirectory(options.output_dir ?? defaultEvidenceDir('webgl-not-available'), { rawEvidence: true });
    const captureId = options.capture_id ?? safeId('vande-unity-webgl-not-available');
    const manifest = notAvailableManifest({ sourceId, reason, captureId, evaluator });
    assertValidManifest(manifest);
    const manifestPath = writeJsonNew(join(out, 'manifest.json'), manifest);
    return { ok: false, status: 'NOT_AVAILABLE', reason, output: out, manifest: manifestPath, availability };
  }
  return captureWeb({
    ...options,
    renderer: 'unity-webgl',
    artifact_root: hostRoot,
    unity_export_root: exportRoot,
    expected_build_id: sourceId,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2), { booleans: ['help'] });
  if (options.help) {
    process.stdout.write('Usage: node scripts/eval/compare/capture-webgl.mjs [--base URL] --host-artifact-root HOST_DIR [--export-root UNITY_DIR] [--output-dir DIR] [--evaluator ID]\nWithout a separate verified React host, provenance-valid current-source Unity export and live URL, the result is explicitly NOT_AVAILABLE.\n');
    return;
  }
  const result = await captureWebGl(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 3;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`capture-webgl: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
