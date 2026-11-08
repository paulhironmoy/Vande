#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { unitySourceDigest, verifyUnityWebGlRoot } from '../../verify-unity-webgl.mjs';
import {
  assertValidManifest,
  defaultEvidenceDir,
  ensureNewDirectory,
  fileRecord,
  hostUptime,
  integerOption,
  parseArgs,
  REPO_ROOT,
  safeId,
  sha256Bytes,
  sha256File,
  sourceBuildId,
  toolVersions,
  utcNow,
  writeJsonNew,
} from './lib.mjs';
import { probeNormalizedMedia } from './normalize.mjs';
import { verifyTrustedUnityExport } from './unity-provenance.mjs';

const SUPPORTED_RENDERERS = new Set(['three-webgl', 'classic', 'unity-webgl']);
export const UNITY_WEBGL_HOST_PREFIX = 'unity/';
export const UNITY_WEBGL_ADMISSION_VALUE = 'engineering-preview-unqualified';
const RUNTIME_IDENTITY_TRACKER_KEY = '__vandeCaptureRendererIdentityTracker';
export const WEB_CAPTURE_BINDING_POLICY = Object.freeze({
  serviceWorkers: 'block',
  redirects: 'reject',
  partialResponses: 'reject',
  unboundRequests: 'reject',
  webSockets: 'reject',
  queries: 'reject',
  auxiliaryPages: 'reject',
  dedicatedWorkers: 'reject',
  downloads: 'reject',
});

function emptySidecars() {
  return { events: [], physics: [], replay: [], frames: [], annotations: [] };
}

function environment(viewport, userAgent, browserVersion, qualityTier) {
  return {
    platform: 'production-web',
    device: `Chromium ${browserVersion}`,
    os: userAgent,
    soc: null,
    gpu: null,
    ramMb: null,
    viewport: { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.deviceScaleFactor },
    orientation: viewport.width >= viewport.height ? 'landscape' : 'portrait',
    refreshHz: null,
    qualityTier,
    thermal: null,
    battery: null,
    power: null,
    network: 'host network; no shaping applied',
    backgroundLoad: hostUptime(),
  };
}

function baseManifest({
  captureId,
  sourceId,
  embeddedBuildId,
  expectedRenderer,
  observedRenderer,
  admission,
  rendererProof,
  capturedAtUtc,
  durationMs,
  viewport,
  userAgent,
  browserVersion,
  files,
  eventPath,
  errors,
  deviations,
  complete,
  evaluator,
  expectedScenario,
  qualityTier,
  artifact,
  artifactProof,
  media,
}) {
  return {
    schemaVersion: 1,
    captureId,
    lane: 'vande_engine_truth',
    evidenceClass: 'diagnostic',
    status: complete ? 'captured' : 'failed',
    evaluator: { id: evaluator, role: 'capture operator', authoredSubject: false, independent: false },
    rights: {
      basis: 'VANDE-owned running product captured for internal evaluation',
      sourceUrl: null,
      redistribution: 'owned',
      notes: ['Raw evidence remains in the designated evidence workspace.'],
    },
    identity: {
      repositorySourceId: sourceId,
      embeddedBuildId,
      artifact,
      application: { title: 'VANDE Cricket', packageId: 'in.vande.cricket', version: null, store: null },
      renderer: { claimed: expectedRenderer, observed: observedRenderer, admission, proof: `${rendererProof ?? 'runtime renderer proof unavailable'}; ${artifactProof}` },
    },
    timing: { capturedAtUtc, hostUptime: hostUptime(), durationMs },
    environment: environment(viewport, userAgent, browserVersion, qualityTier),
    gameplay: {
      scenario: 'random-over first delivery; machine keyboard attack',
      seed: null,
      controls: 'production keyboard path (ArrowUp)',
      inputMethod: 'machine_keyboard',
      assistance: null,
      handedness: null,
      pitch: null,
      field: null,
      timeScale: 1,
      wholeSequence: complete,
    },
    capture: {
      method: 'Playwright production-browser video with DOM observation; no Practice test hook or queued swing',
      recorder: { class: 'playwright_video', bitRateBps: null },
      resolution: media ? { width: media.width, height: media.height } : { width: viewport.width, height: viewport.height },
      frameRate: media?.frameRate ?? null,
      codec: media?.codec ?? 'Playwright WebM (runtime-selected codec)',
      audio: {
        method: 'none',
        synchronized: false,
        limitations: ['Playwright video does not capture game audio; audiovisual timing is NOT AVAILABLE.'],
      },
      perturbations: ['Browser video recording can perturb frame pacing; no recorder-off control is included by this single run.'],
      limitations: [
        'Machine keyboard input is diagnostic evidence, never a human-control or player-skill result.',
        'DOM polling observes state and can add bounded host load.',
        'No deterministic seed or authoritative physics/replay sidecar is exposed by the uninstrumented production page.',
      ],
    },
    files,
    sidecars: { ...emptySidecars(), events: eventPath ? [eventPath] : [] },
    transformations: [],
    applicability: {
      metrics: {
        time_to_first_playable_ball_ms: 'diagnostic_only',
        taps_to_first_playable_ball: 'diagnostic_only',
        result_to_next_playable_ms: 'diagnostic_only',
        dead_time_ratio_percent: 'diagnostic_only',
        duplicate_frame_rate_percent: 'diagnostic_only',
        contact_to_impact_audio_ms: 'not_available',
      },
      excludedClaims: [
        'human control feel, preference, fun, desire or mastery',
        'input-to-photon latency',
        'contact-to-audio timing',
        'engine FPS or release performance',
        'physical-device behavior',
      ],
    },
    expectedScenario,
    observedDeviations: deviations,
    errors,
    tools: toolVersions({ playwright: browserVersion }),
  };
}

export function artifactInventory(root, { requireIndex = true } = {}) {
  const absoluteRoot = resolve(root);
  if (!existsSync(absoluteRoot) || !statSync(absoluteRoot).isDirectory()) throw new Error('--artifact-root must name a built web artifact directory');
  const records = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) throw new Error(`Web artifact contains a symlink: ${absolute}`);
      if (info.isDirectory()) walk(absolute);
      else if (info.isFile()) records.push({ path: relative(absoluteRoot, absolute).split(sep).join('/'), bytes: info.size, sha256: sha256File(absolute) });
    }
  };
  walk(absoluteRoot);
  if (requireIndex && !records.some((item) => item.path === 'index.html')) {
    throw new Error('Web artifact root does not contain index.html');
  }
  return { root: absoluteRoot, files: records };
}

export function artifactPathsForBinding(inventory) {
  return inventory.files.map((item) => item.path);
}

function inventoryByPath(inventory) {
  return new Map(inventory.files.map((record) => [record.path, record]));
}

export function verifyUnityHostArtifactBinding(hostInventory, unityExportRoot, verifiedUnityFiles) {
  if (!hostInventory || typeof hostInventory.root !== 'string' || !Array.isArray(hostInventory.files)) {
    throw new Error('A verified React host artifact inventory is required for Unity WebGL capture');
  }
  if (!(verifiedUnityFiles instanceof Map)) {
    throw new Error('The verified Unity export hash snapshot is required for host binding');
  }

  // VANDE publishes an embedded Unity payload, not Unity's standalone page.
  // Only the separate React host is required to own an index.html.
  const unityExport = artifactInventory(unityExportRoot, { requireIndex: false });
  if (resolve(hostInventory.root) === resolve(unityExport.root)) {
    throw new Error('React host artifact root and Unity export root must be separate directories');
  }

  const exportByPath = inventoryByPath(unityExport);
  if (exportByPath.size !== verifiedUnityFiles.size) {
    throw new Error('Unity export changed after provenance verification (file count mismatch)');
  }
  for (const [path, expectedSha256] of verifiedUnityFiles) {
    const observed = exportByPath.get(path);
    if (!observed || observed.sha256 !== expectedSha256) {
      throw new Error(`Unity export changed after provenance verification: ${path}`);
    }
  }

  const hostedUnity = hostInventory.files
    .filter((record) => record.path.startsWith(UNITY_WEBGL_HOST_PREFIX))
    .map((record) => ({ ...record, exportPath: record.path.slice(UNITY_WEBGL_HOST_PREFIX.length) }));
  const hostedByExportPath = new Map(hostedUnity.map((record) => [record.exportPath, record]));
  if (hostedByExportPath.size !== exportByPath.size) {
    throw new Error(`React host ${UNITY_WEBGL_HOST_PREFIX} publication does not exactly match the verified Unity export file count`);
  }

  const files = [];
  for (const record of unityExport.files) {
    const hosted = hostedByExportPath.get(record.path);
    if (!hosted || hosted.sha256 !== record.sha256 || hosted.bytes !== record.bytes) {
      throw new Error(`React host Unity publication differs from the verified Unity export: ${record.path}`);
    }
    files.push({
      exportPath: record.path,
      hostPath: hosted.path,
      bytes: record.bytes,
      sha256: record.sha256,
    });
  }
  for (const hosted of hostedUnity) {
    if (!exportByPath.has(hosted.exportPath)) {
      throw new Error(`React host Unity publication contains a file absent from the verified export: ${hosted.path}`);
    }
  }

  return {
    schemaVersion: 1,
    hostPrefix: UNITY_WEBGL_HOST_PREFIX,
    hostArtifactRoot: hostInventory.root,
    unityExportRoot: unityExport.root,
    fileCount: files.length,
    files,
  };
}

function assertArmedRuntimeOwnership(expectedRenderer, state) {
  if (!state || state.screen !== 'live' || state.phase !== 'live') {
    throw new Error('Runtime input ownership was not observed on the live delivery phase');
  }
  if (state.renderer !== expectedRenderer) {
    throw new Error(`Armed renderer mismatch: expected ${expectedRenderer}, observed ${state.renderer ?? 'missing'}`);
  }
  if (expectedRenderer === 'unity-webgl') {
    if (state.admission !== UNITY_WEBGL_ADMISSION_VALUE) {
      throw new Error(`Unity admission mismatch at armed input: expected ${UNITY_WEBGL_ADMISSION_VALUE}, observed ${state.admission ?? 'missing'}`);
    }
    if (state.reactInputArmed) {
      throw new Error('Unity capture exposed an armed React gesture surface instead of exclusive Unity input ownership');
    }
    const surface = state.unitySurface;
    if (!surface?.present || !surface.connected || surface.renderer !== 'unity-webgl' || !surface.visible ||
        !surface.pointerEnabled || !surface.hitTest || !surface.bridgeOperationActive || !surface.inputReady ||
        state.inputOwner !== 'unity-webgl-canvas') {
      throw new Error('Unity canvas was not visibly presented with exclusive live input ownership at the armed delivery');
    }
  } else {
    if (state.admission !== null) {
      throw new Error(`Non-Unity renderer carried a Unity admission marker at armed input: ${state.admission}`);
    }
    if (!state.reactInputArmed || state.inputOwner !== 'react-gesture-surface') {
      throw new Error(`${expectedRenderer} did not expose its armed React gesture surface`);
    }
  }
  return state;
}

export function assertAtomicRuntimeWatchStart(expectedRenderer, atomicStart) {
  if (!atomicStart?.ownershipValidated || !atomicStart.armedState || !atomicStart.watchStart) {
    throw new Error(`Atomic armed ownership/latch failed: ${atomicStart?.error ?? 'missing evidence'}`);
  }
  const armed = assertArmedRuntimeOwnership(expectedRenderer, atomicStart.armedState);
  const watch = atomicStart.watchStart;
  if (watch.baseline?.renderer !== armed.renderer || watch.baseline?.admission !== armed.admission) {
    throw new Error('Atomic renderer/admission baseline differs from the armed ownership snapshot');
  }
  if (expectedRenderer === 'unity-webgl') {
    const armedToken = armed.unitySurface?.elementToken;
    const latchedToken = watch.canvas?.elementToken;
    if (typeof armedToken !== 'string' || armedToken.length < 8 || armedToken !== latchedToken ||
        !watch.canvas?.baseline?.connected || !watch.canvas.baseline.unique ||
        watch.canvas.baseline.renderer !== 'unity-webgl') {
      throw new Error('Atomic armed Unity canvas snapshot differs from the exact latched canvas');
    }
  }
  return { armed, watchStart: watch };
}

export function assertRuntimePresentationContinuity(expectedRenderer, armedState, resultState, identityWatch) {
  const armed = assertArmedRuntimeOwnership(expectedRenderer, armedState);
  if (!resultState || (!resultState.result && resultState.phase !== 'dead')) {
    throw new Error('Dead-ball result state is missing from renderer continuity evidence');
  }
  if (resultState.renderer !== armed.renderer) {
    throw new Error(`Renderer drifted after armed input: ${armed.renderer} -> ${resultState.renderer ?? 'missing'}`);
  }
  if (resultState.admission !== armed.admission) {
    throw new Error(`Renderer admission drifted after armed input: ${armed.admission ?? 'missing'} -> ${resultState.admission ?? 'missing'}`);
  }
  if (!identityWatch || !Array.isArray(identityWatch.transitions)) {
    throw new Error('Renderer/admission mutation watch is missing from continuity evidence');
  }
  for (const [label, observed, expected] of [
    ['watch baseline renderer', identityWatch.baseline?.renderer, armed.renderer],
    ['watch baseline admission', identityWatch.baseline?.admission, armed.admission],
    ['watch final renderer', identityWatch.final?.renderer, resultState.renderer],
    ['watch final admission', identityWatch.final?.admission, resultState.admission],
  ]) {
    if (observed !== expected) throw new Error(`${label} mismatch: expected ${expected ?? 'missing'}, observed ${observed ?? 'missing'}`);
  }
  for (const transition of identityWatch.transitions) {
    const expected = transition.attribute === 'data-vande-practice-renderer' ? armed.renderer : armed.admission;
    if (transition.oldValue !== expected || transition.currentValue !== expected) {
      throw new Error(`Renderer/admission identity mutated after armed input: ${transition.attribute}`);
    }
  }
  if (expectedRenderer === 'unity-webgl') {
    const canvasWatch = identityWatch.canvas;
    if (!canvasWatch || canvasWatch.id !== 'vande-unity-practice-canvas' ||
        typeof canvasWatch.elementToken !== 'string' || canvasWatch.elementToken.length < 8 ||
        canvasWatch.elementToken !== armed.unitySurface?.elementToken ||
        !canvasWatch.baseline?.connected || !canvasWatch.baseline?.unique ||
        canvasWatch.baseline?.renderer !== 'unity-webgl') {
      throw new Error('Exact armed Unity canvas was not latched by the continuity watch');
    }
    if (!canvasWatch.final?.connected || !canvasWatch.final?.sameElement || !canvasWatch.final?.unique ||
        canvasWatch.final?.renderer !== 'unity-webgl') {
      throw new Error('Exact armed Unity canvas was disconnected or replaced before the result');
    }
    for (const transition of canvasWatch.rendererTransitions ?? []) {
      if (transition.oldValue !== 'unity-webgl' || transition.currentValue !== 'unity-webgl') {
        throw new Error('Exact armed Unity canvas data-renderer mutated after armed input');
      }
    }
    if ((canvasWatch.childListTransitions?.length ?? 0) > 0) {
      throw new Error('Exact armed Unity canvas was touched by a child-list mutation after armed input');
    }
    const surface = resultState.unitySurface;
    if (!surface?.present || !surface.connected || surface.renderer !== 'unity-webgl') {
      throw new Error('Unity canvas identity was not retained through the dead-ball result');
    }
    if (resultState.reactInputArmed) {
      throw new Error('React gesture input became armed during a Unity dead-ball result');
    }
  }
  return {
    schemaVersion: 1,
    renderer: armed.renderer,
    admission: armed.admission,
    armedInputOwner: armed.inputOwner,
    armedUnitySurface: expectedRenderer === 'unity-webgl' ? armed.unitySurface : null,
    resultRenderer: resultState.renderer,
    resultAdmission: resultState.admission,
    resultUnitySurface: expectedRenderer === 'unity-webgl' ? resultState.unitySurface : null,
    identityWatch,
    proof: expectedRenderer === 'unity-webgl'
      ? `armed renderer=${armed.renderer}; admission=${armed.admission}; visible connected Unity canvas owned input and passed center hit-test; result renderer/admission invariant`
      : `armed renderer=${armed.renderer}; React gesture surface owned input; result renderer/admission invariant`,
  };
}

export function assertCapturedKeyboardAction(action, resultState) {
  const expectedSwing = action === 'Space' || action === 'Enter' || action === 'NumpadEnter' || action === 'Numpad5'
    ? 'defend'
    : action === 'ArrowUp' || action === 'ArrowDown' || action === 'ArrowLeft' || action === 'ArrowRight' ||
        /^Numpad[1-46789]$/u.test(action)
      ? 'attack'
      : null;
  if (expectedSwing === null) throw new Error(`Unsupported captured keyboard action: ${action}`);
  if (!resultState || (!resultState.result && resultState.phase !== 'dead')) {
    throw new Error('Captured keyboard action has no authoritative dead-ball result');
  }
  if (resultState.swing !== expectedSwing) {
    throw new Error(
      `Captured keyboard action ${action} did not produce its authoritative swing: expected ${expectedSwing}, observed ${resultState.swing ?? 'missing'}`,
    );
  }
  return { action, expectedSwing, observedSwing: resultState.swing };
}

async function startRuntimeIdentityWatch(page, expectedRenderer) {
  return page.evaluate(browserRuntimeState, {
    startIdentityWatch: true,
    key: RUNTIME_IDENTITY_TRACKER_KEY,
    expectedRenderer,
    unityAdmission: UNITY_WEBGL_ADMISSION_VALUE,
  });
}

async function finishRuntimeIdentityWatch(page) {
  return page.evaluate((key) => {
    const tracker = globalThis.window[key];
    if (!tracker?.observer || typeof tracker.record !== 'function') return null;
    tracker.record(tracker.observer.takeRecords());
    tracker.observer.disconnect();
    const result = {
      startedAtPerfMs: tracker.startedAtPerfMs,
      finishedAtPerfMs: performance.now(),
      baseline: tracker.baseline,
      final: {
        renderer: document.documentElement.getAttribute('data-vande-practice-renderer'),
        admission: document.documentElement.getAttribute('data-vande-unity-practice'),
      },
      transitions: tracker.transitions,
      canvas: {
        id: 'vande-unity-practice-canvas',
        elementToken: tracker.canvasToken,
        baseline: tracker.canvasBaseline,
        final: {
          connected: Boolean(tracker.canvas?.isConnected),
          sameElement: document.getElementById('vande-unity-practice-canvas') === tracker.canvas,
          unique: document.querySelectorAll('#vande-unity-practice-canvas').length === 1,
          renderer: tracker.canvas?.getAttribute('data-renderer') ?? null,
        },
        rendererTransitions: tracker.canvasRendererTransitions,
        childListTransitions: tracker.canvasChildListTransitions,
      },
    };
    delete globalThis.window[key];
    return result;
  }, RUNTIME_IDENTITY_TRACKER_KEY);
}

export function canonicalArtifactBase(base) {
  let value;
  try {
    value = new URL(base);
  } catch {
    throw new Error(`Artifact URL is invalid: ${base}`);
  }
  if (!['http:', 'https:'].includes(value.protocol)) throw new Error(`Artifact URL must use HTTP(S): ${base}`);
  if (value.username || value.password || value.search || value.hash) throw new Error('Artifact URL must not contain credentials, a query or a fragment');
  if (/%(?:00|2e|2f|5c)/iu.test(value.pathname)) throw new Error('Artifact URL contains an encoded path-control sequence');
  let decoded;
  try {
    decoded = decodeURIComponent(value.pathname);
  } catch {
    throw new Error('Artifact URL path is not valid percent-encoding');
  }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Artifact URL path is unsafe');
  }
  value.pathname = value.pathname.endsWith('/') ? value.pathname : `${value.pathname}/`;
  return value.href;
}

export function runtimeArtifactIdentity(requestUrl, base, inventory) {
  const baseUrl = new URL(canonicalArtifactBase(base));
  let request;
  try {
    request = new URL(requestUrl);
  } catch {
    throw new Error(`Runtime request URL is invalid: ${requestUrl}`);
  }
  if (!['http:', 'https:'].includes(request.protocol) || request.origin !== baseUrl.origin) {
    throw new Error(`Runtime request is outside the bound artifact origin: ${requestUrl}`);
  }
  if (request.username || request.password || /%(?:00|2e|2f|5c)/iu.test(request.pathname)) {
    throw new Error(`Runtime request has an unsafe path: ${requestUrl}`);
  }
  if (request.search || request.hash) throw new Error(`Runtime request query/fragment is not bound by the frozen artifact contract: ${requestUrl}`);
  let requestPath;
  let basePath;
  try {
    requestPath = decodeURIComponent(request.pathname);
    basePath = decodeURIComponent(baseUrl.pathname);
  } catch {
    throw new Error(`Runtime request path is not valid percent-encoding: ${requestUrl}`);
  }
  if (requestPath.includes('\\') || requestPath.includes('\0') || !requestPath.startsWith(basePath)) {
    throw new Error(`Runtime request escapes the bound artifact base path: ${requestUrl}`);
  }
  let relativePath = requestPath.slice(basePath.length);
  if (relativePath === '') relativePath = 'index.html';
  if (relativePath.startsWith('/') || relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Runtime request path is unsafe: ${requestUrl}`);
  }
  if (!inventory.files.some((item) => item.path === relativePath)) {
    throw new Error(`Runtime request is absent from the frozen artifact inventory: ${relativePath}`);
  }
  return { path: relativePath, requestUrl: request.href, query: request.search };
}

export function runtimeArtifactPath(requestUrl, base, inventory) {
  return runtimeArtifactIdentity(requestUrl, base, inventory).path;
}

async function bindServedArtifact(base, inventory) {
  const baseUrl = new URL(canonicalArtifactBase(base));
  const fetchAndVerify = async (record) => {
    const encodedPath = record.path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    const requestUrl = new URL(encodedPath, baseUrl).href;
    const response = await fetch(requestUrl, {
      cache: 'no-store',
      redirect: 'error',
      headers: { 'accept-encoding': 'identity' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Artifact binding fetch failed ${response.status}: ${requestUrl}`);
    if (response.status !== 200 || response.url !== requestUrl || response.headers.get('content-range')) {
      throw new Error(`Artifact binding received a redirected or partial response: ${requestUrl}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const observed = sha256Bytes(bytes);
    if (observed !== record.sha256) throw new Error(`Served bytes do not match artifact for ${record.path}`);
    if (bytes.byteLength !== record.bytes) throw new Error(`Served byte count does not match artifact for ${record.path}`);
    return { path: record.path, sha256: observed, bytes: bytes.byteLength };
  };
  return Promise.all(inventory.files.map((record) => fetchAndVerify(record)));
}

export async function verifyRuntimeArtifactResponse(response, base, inventory) {
  const request = response.request();
  if (request.redirectedFrom() || request.redirectedTo()) throw new Error(`Runtime artifact response used a redirect: ${response.url()}`);
  if (request.url() !== response.url()) throw new Error(`Runtime artifact response identity differs from its exact request: ${request.url()} -> ${response.url()}`);
  const identity = runtimeArtifactIdentity(request.url(), base, inventory);
  const { path } = identity;
  if (response.status() !== 200 || response.headers()['content-range']) {
    throw new Error(`Runtime artifact response is not a complete 200 response for ${path}`);
  }
  const body = await response.body();
  const expected = inventory.files.find((item) => item.path === path);
  const observed = sha256Bytes(body);
  if (observed !== expected.sha256 || body.byteLength !== expected.bytes) {
    throw new Error(`Runtime response bytes do not match the frozen artifact for ${path}`);
  }
  return { ...identity, sha256: observed, bytes: body.byteLength, status: response.status() };
}

async function drainRuntimeVerifications(promises) {
  let offset = 0;
  while (offset < promises.length) {
    const pending = promises.slice(offset);
    offset = promises.length;
    await Promise.all(pending);
  }
}

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

async function clickWhenVisible(page, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const locator = await firstVisible(page, selectors);
    if (locator) {
      await locator.click({ timeout: 5_000 });
      return true;
    }
    await page.waitForTimeout(100);
  }
  return false;
}

function browserRuntimeState(command = null) {
  const root = document.querySelector('[data-testid="practice-play"]');
  const result = document.querySelector('[data-testid="practice-result"]');
  const reactSurface = document.querySelector('[role="application"][data-armed="true"]');
  const canvas = document.getElementById('vande-unity-practice-canvas');
  let bridgeOperationActive;
  try {
    const operationId = globalThis.window.VandeUnityPracticeWebHost?.pendingOperationId?.();
    bridgeOperationActive = typeof operationId === 'string' && operationId.length > 0;
  } catch {
    bridgeOperationActive = false;
  }
  let unitySurface = {
    present: false,
    connected: false,
    renderer: null,
    visible: false,
    pointerEnabled: false,
    hitTest: false,
    inputReady: false,
    bridgeOperationActive,
    viewportCoverage: 0,
    opacity: null,
    pointerEvents: null,
    elementToken: null,
  };
  if (canvas instanceof HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const style = getComputedStyle(canvas);
    const viewportArea = Math.max(1, globalThis.innerWidth * globalThis.innerHeight);
    const clippedWidth = Math.max(0, Math.min(rect.right, globalThis.innerWidth) - Math.max(rect.left, 0));
    const clippedHeight = Math.max(0, Math.min(rect.bottom, globalThis.innerHeight) - Math.max(rect.top, 0));
    const viewportCoverage = (clippedWidth * clippedHeight) / viewportArea;
    const opacity = Number.parseFloat(style.opacity || '1');
    const connected = canvas.isConnected;
    const visible = connected && rect.width > 0 && rect.height > 0 && viewportCoverage >= 0.9 &&
      style.display !== 'none' && style.visibility === 'visible' && Number.isFinite(opacity) && opacity >= 0.99 &&
      canvas.getAttribute('aria-hidden') !== 'true';
    const pointerEnabled = style.pointerEvents !== 'none';
    const sampleX = Math.min(globalThis.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
    const sampleY = Math.min(globalThis.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
    const hitTest = visible && document.elementFromPoint(sampleX, sampleY) === canvas;
    const renderer = canvas.getAttribute('data-renderer');
    const inputReady = renderer === 'unity-webgl' && visible && pointerEnabled && hitTest && bridgeOperationActive && !reactSurface;
    unitySurface = {
      present: true,
      connected,
      renderer,
      visible,
      pointerEnabled,
      hitTest,
      inputReady,
      bridgeOperationActive,
      viewportCoverage: Math.round(viewportCoverage * 10_000) / 10_000,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      elementToken: null,
    };
  }
  const inputOwner = reactSurface && unitySurface.inputReady
    ? 'conflict'
    : unitySurface.inputReady ? 'unity-webgl-canvas' : reactSurface ? 'react-gesture-surface' : null;
  const state = {
    atPerfMs: performance.now(),
    path: location.pathname,
    screen: root?.getAttribute('data-screen') ?? null,
    phase: root?.getAttribute('data-phase') ?? null,
    renderer: document.documentElement.getAttribute('data-vande-practice-renderer'),
    admission: document.documentElement.getAttribute('data-vande-unity-practice'),
    armed: Boolean(reactSurface),
    reactInputArmed: Boolean(reactSurface),
    inputOwner,
    unitySurface,
    score: document.querySelector('[data-testid="practice-score"]')?.textContent?.trim() ?? null,
    result: Boolean(result),
    outcome: result?.getAttribute('data-outcome') ?? null,
    swing: result?.getAttribute('data-swing') ?? null,
  };
  if (!command?.startIdentityWatch) return state;
  if (Object.hasOwn(globalThis.window, command.key)) {
    return { ownershipValidated: false, armedState: state, watchStart: null, error: 'identity_tracker_already_exists' };
  }
  const uniqueCanvas = document.querySelectorAll('#vande-unity-practice-canvas').length === 1;
  const ownershipValidated = state.screen === 'live' && state.phase === 'live' && state.renderer === command.expectedRenderer &&
    (command.expectedRenderer === 'unity-webgl'
      ? state.admission === command.unityAdmission && !state.reactInputArmed &&
        state.inputOwner === 'unity-webgl-canvas' && unitySurface.inputReady &&
        canvas instanceof HTMLCanvasElement && canvas.isConnected && uniqueCanvas
      : state.admission === null && state.reactInputArmed && state.inputOwner === 'react-gesture-surface');
  if (!ownershipValidated) {
    return { ownershipValidated: false, armedState: state, watchStart: null, error: 'armed_ownership_invalid' };
  }

  const canvasId = 'vande-unity-practice-canvas';
  const canvasToken = globalThis.crypto.randomUUID?.() ??
    `canvas-${performance.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  unitySurface.elementToken = canvasToken;
  const tracker = {
    startedAtPerfMs: performance.now(),
    baseline: { renderer: state.renderer, admission: state.admission },
    transitions: [],
    canvas,
    canvasToken,
    canvasBaseline: {
      connected: Boolean(canvas?.isConnected),
      unique: uniqueCanvas,
      renderer: canvas?.getAttribute('data-renderer') ?? null,
    },
    canvasRendererTransitions: [],
    canvasChildListTransitions: [],
    observer: null,
    record(records) {
      const atPerfMs = performance.now();
      for (const mutation of records) {
        if (mutation.type === 'attributes') {
          if (mutation.target === document.documentElement &&
              ['data-vande-practice-renderer', 'data-vande-unity-practice'].includes(mutation.attributeName)) {
            tracker.transitions.push({
              atPerfMs,
              attribute: mutation.attributeName,
              oldValue: mutation.oldValue,
              currentValue: document.documentElement.getAttribute(mutation.attributeName),
            });
          } else if (mutation.target === tracker.canvas && mutation.attributeName === 'data-renderer') {
            tracker.canvasRendererTransitions.push({
              atPerfMs,
              oldValue: mutation.oldValue,
              currentValue: tracker.canvas?.getAttribute('data-renderer') ?? null,
            });
          }
          continue;
        }
        if (mutation.type !== 'childList') continue;
        const removed = [...mutation.removedNodes];
        const added = [...mutation.addedNodes];
        const removedLatched = removed.some((node) => node === tracker.canvas ||
          (node instanceof Element && tracker.canvas instanceof Node && node.contains(tracker.canvas)));
        const addedLatched = added.some((node) => node === tracker.canvas ||
          (node instanceof Element && tracker.canvas instanceof Node && node.contains(tracker.canvas)));
        const addedReplacement = added.some((node) => node instanceof Element &&
          (node.id === canvasId || Boolean(node.querySelector(`#${canvasId}`))) && node !== tracker.canvas);
        const currentMatchesLatched = document.getElementById(canvasId) === tracker.canvas;
        const latchedConnected = Boolean(tracker.canvas?.isConnected);
        if (removedLatched || addedLatched || addedReplacement || !currentMatchesLatched || !latchedConnected) {
          tracker.canvasChildListTransitions.push({
            atPerfMs,
            removedLatched,
            addedLatched,
            addedReplacement,
            currentMatchesLatched,
            latchedConnected,
          });
        }
      }
    },
  };
  tracker.observer = new MutationObserver((records) => tracker.record(records));
  tracker.observer.observe(document.documentElement, {
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['data-vande-practice-renderer', 'data-vande-unity-practice', 'data-renderer'],
    childList: true,
    subtree: true,
  });
  Object.defineProperty(globalThis.window, command.key, { value: tracker, configurable: true, enumerable: false });
  return {
    ownershipValidated: true,
    armedState: state,
    watchStart: {
      startedAtPerfMs: tracker.startedAtPerfMs,
      baseline: tracker.baseline,
      canvas: { id: canvasId, elementToken: canvasToken, baseline: tracker.canvasBaseline },
    },
    error: null,
  };
}

function runtimeInputCandidate(state) {
  return state?.screen === 'live' && state.phase === 'live' &&
    (state.reactInputArmed || (state.renderer === 'unity-webgl' && state.unitySurface?.present));
}

async function waitForState(page, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await page.evaluate(browserRuntimeState).catch(() => null);
    if (value && predicate(value)) return value;
    await page.waitForTimeout(50);
  }
  return null;
}

async function observeStates(page, events, stop) {
  let previous = '';
  while (!stop.value) {
    const state = await page.evaluate(browserRuntimeState).catch(() => null);
    if (state) {
      const key = JSON.stringify({ ...state, atPerfMs: undefined });
      if (key !== previous) {
        events.push({ ...state, observedAtUtc: utcNow() });
        previous = key;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}

export async function captureWeb(options) {
  const base = canonicalArtifactBase(options.base ?? 'http://127.0.0.1:4173');
  const expectedRenderer = options.renderer;
  if (!SUPPORTED_RENDERERS.has(expectedRenderer)) {
    throw new Error(`renderer must be one of ${[...SUPPORTED_RENDERERS].join(', ')}`);
  }
  const viewport = {
    width: integerOption(options.width, '--width', { min: 320, max: 7680, fallback: 915 }),
    height: integerOption(options.height, '--height', { min: 240, max: 4320, fallback: 412 }),
    deviceScaleFactor: Number(options.device_scale_factor ?? 1),
  };
  if (!Number.isFinite(viewport.deviceScaleFactor) || viewport.deviceScaleFactor < 0.5 || viewport.deviceScaleFactor > 4) {
    throw new Error('--device-scale-factor must be from 0.5 to 4');
  }
  const timeoutMs = integerOption(options.timeout_ms, '--timeout-ms', { min: 5_000, max: 180_000, fallback: 90_000 });
  const out = ensureNewDirectory(options.output_dir ?? defaultEvidenceDir('web'), { rawEvidence: true });
  const raw = join(out, 'raw');
  mkdirSync(raw, { recursive: true, mode: 0o700 });
  const capturedAtUtc = utcNow();
  const captureId = options.capture_id ?? safeId(`vande-web-${expectedRenderer}`, capturedAtUtc);
  const evaluator = options.evaluator ?? 'capture-tooling-builder';
  const expectedScenario = 'Launch production web, choose Random Over, play at normal speed through one dead-ball result using the shipped keyboard input path.';
  const sourceBefore = sourceBuildId();
  if (options.expected_build_id && options.expected_build_id !== sourceBefore) {
    throw new Error(`Expected build ID ${options.expected_build_id} does not match derived current source ${sourceBefore}`);
  }
  if (!options.artifact_root) throw new Error('--artifact-root is required so the live URL can be bound to exact built bytes');
  const artifactRoot = resolve(options.artifact_root);
  const builtArtifact = artifactInventory(artifactRoot);
  let verifiedUnity = null;
  let trustedUnity = null;
  let unityHostBinding = null;
  if (expectedRenderer === 'unity-webgl') {
    if (!options.unity_export_root) {
      throw new Error('--unity-export-root is required and must be separate from the React --artifact-root');
    }
    const projectRoot = resolve(options.unity_project ?? join(REPO_ROOT, 'unity', 'VandePractice'));
    const unityExportRoot = resolve(options.unity_export_root);
    verifiedUnity = verifyUnityWebGlRoot(unityExportRoot, {
      expectedBuildId: sourceBefore,
      expectedSourceSha256: unitySourceDigest(projectRoot),
    });
    trustedUnity = verifyTrustedUnityExport(unityExportRoot, verifiedUnity.manifest, {
      expectedBuildId: sourceBefore,
      expectedSourceSha256: verifiedUnity.manifest.unitySourceSha256,
    });
    unityHostBinding = verifyUnityHostArtifactBinding(builtArtifact, unityExportRoot, verifiedUnity.files);
  }
  const servedVerification = await bindServedArtifact(base, builtArtifact);
  const artifactInventoryFile = join(out, 'web-artifact-inventory.json');

  let browser = null;
  let context = null;
  let page = null;
  let video = null;
  let browserVersion = 'unknown';
  let userAgent = 'unknown';
  let embeddedBuildId = null;
  let observedRenderer = null;
  let admission = null;
  let rendererProof = null;
  let runtimeContinuity = null;
  let identityWatchActive = false;
  const errors = [];
  const deviations = [];
  const events = [];
  const files = [];
  const runtimeRequestIdentities = new Set();
  const runtimeResponses = new Map();
  const runtimeVerificationPromises = [];
  let bindingFrozen = false;
  let primaryPage = null;
  const stop = { value: false };
  let observer = null;
  let complete = false;
  let tapCount = 0;
  const started = Date.now();
  let videoPath = null;

  try {
    browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
    browserVersion = browser.version();
    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      colorScheme: 'dark',
      serviceWorkers: WEB_CAPTURE_BINDING_POLICY.serviceWorkers,
      recordVideo: { dir: raw, size: { width: viewport.width, height: viewport.height } },
    });
    const bindPagePolicy = (candidate) => {
      candidate.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      candidate.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 1000)}`);
      });
      candidate.on('worker', (worker) => errors.push(`unbound dedicated worker: ${worker.url() || 'URL unavailable'}`));
      candidate.on('websocket', (socket) => errors.push(`unbound runtime WebSocket channel: ${socket.url()}`));
      candidate.on('download', (download) => errors.push(`unbound runtime download: ${download.suggestedFilename()}`));
      candidate.on('popup', (popup) => errors.push(`unbound popup page: ${popup.url() || 'URL unavailable'}`));
    };
    context.on('page', (candidate) => {
      bindPagePolicy(candidate);
      if (primaryPage === null) primaryPage = candidate;
      else if (candidate !== primaryPage) errors.push(`unbound auxiliary page: ${candidate.url() || 'URL unavailable'}`);
    });
    context.on('serviceworker', (worker) => errors.push(`unbound service worker: ${worker.url() || 'URL unavailable'}`));
    context.on('request', (request) => {
      try {
        if (bindingFrozen) throw new Error(`request began after the runtime binding was frozen: ${request.url()}`);
        if (request.method() !== 'GET') throw new Error(`runtime request method is not GET: ${request.method()} ${request.url()}`);
        runtimeRequestIdentities.add(runtimeArtifactIdentity(request.url(), base, builtArtifact).requestUrl);
      } catch (error) {
        errors.push(`unbound runtime request: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    context.on('requestfailed', (request) => errors.push(`runtime request failed: ${request.url()}: ${request.failure()?.errorText ?? 'unknown error'}`));
    context.on('response', (response) => {
      const verification = verifyRuntimeArtifactResponse(response, base, builtArtifact)
        .then((record) => runtimeResponses.set(record.requestUrl, record))
        .catch((error) => errors.push(`runtime artifact binding: ${error instanceof Error ? error.message : String(error)}`));
      runtimeVerificationPromises.push(verification);
    });
    page = await context.newPage();
    if (primaryPage !== page) errors.push('Playwright primary page was not the context-bound first page');
    video = page.video();
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (page.url() !== base) errors.push(`main page URL is not the exact bound artifact base: ${page.url()} != ${base}`);
    await page.waitForFunction(() => Boolean(document.documentElement.getAttribute('data-vande-build-id')), undefined, { timeout: 15_000 });
    ({ buildId: embeddedBuildId, userAgent } = await page.evaluate(() => ({
      buildId: document.documentElement.getAttribute('data-vande-build-id'),
      userAgent: navigator.userAgent,
    })));
    if (embeddedBuildId !== sourceBefore) errors.push(`embedded build ID mismatch: source=${sourceBefore}, runtime=${embeddedBuildId ?? 'missing'}`);
    observer = observeStates(page, events, stop);

    if (!(await clickWhenVisible(page, ['[data-testid="practice-random"]'], 20_000))) errors.push('Random Over action was not visible');
    else tapCount += 1;
    if (!(await clickWhenVisible(page, ['[data-testid="practice-play-start"]'], 30_000))) errors.push('Play action was not visible');
    else tapCount += 1;
    const liveOrIntro = await waitForState(page, (state) => state.phase === 'intro' || runtimeInputCandidate(state), 45_000);
    if (liveOrIntro?.phase === 'intro') {
      if (await clickWhenVisible(page, ['[data-testid="practice-intro-skip"]'], 5_000)) tapCount += 1;
      else errors.push('First-session teaching appeared but Skip was unavailable');
    }
    const armedCandidate = await waitForState(page, runtimeInputCandidate, 35_000);
    if (!armedCandidate) throw new Error('The shipped input surface never armed with observable ownership');
    const atomicStart = await startRuntimeIdentityWatch(page, expectedRenderer);
    if (atomicStart?.watchStart) identityWatchActive = true;
    const { armed } = assertAtomicRuntimeWatchStart(expectedRenderer, atomicStart);
    observedRenderer = armed.renderer;
    admission = armed.admission;
    rendererProof = `document[data-vande-practice-renderer=${observedRenderer}] at armed live input owned by ${armed.inputOwner}`;
    await page.keyboard.press('ArrowUp');
    tapCount += 1;
    const result = await waitForState(page, (state) => state.result || state.phase === 'dead', 45_000);
    if (!result) throw new Error('No dead-ball result appeared within the bounded capture');
    assertCapturedKeyboardAction('ArrowUp', result);
    const identityWatch = await finishRuntimeIdentityWatch(page);
    identityWatchActive = false;
    runtimeContinuity = assertRuntimePresentationContinuity(expectedRenderer, armed, result, identityWatch);
    rendererProof = runtimeContinuity.proof;
    complete = true;
    const screenshot = join(raw, 'dead-ball.png');
    await page.screenshot({ path: screenshot, animations: 'allow' });
    if (observedRenderer !== expectedRenderer) {
      errors.push(`renderer mismatch: expected ${expectedRenderer}, observed ${observedRenderer ?? 'missing'}`);
      complete = false;
    }
    if (expectedRenderer === 'unity-webgl' && admission !== UNITY_WEBGL_ADMISSION_VALUE) {
      errors.push(`Unity WebGL capture lacks the exact ${UNITY_WEBGL_ADMISSION_VALUE} admission marker`);
      complete = false;
    }
    await page.waitForLoadState('networkidle', { timeout: 5_000 });
    await drainRuntimeVerifications(runtimeVerificationPromises);
    await page.waitForTimeout(100);
    await drainRuntimeVerifications(runtimeVerificationPromises);
    bindingFrozen = true;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (identityWatchActive && page) {
      await finishRuntimeIdentityWatch(page).catch((error) => errors.push(`renderer identity watch: ${error instanceof Error ? error.message : String(error)}`));
    }
    await drainRuntimeVerifications(runtimeVerificationPromises).catch((error) => errors.push(`runtime artifact drain: ${error instanceof Error ? error.message : String(error)}`));
    stop.value = true;
    await observer?.catch((error) => errors.push(`state observer: ${error instanceof Error ? error.message : String(error)}`));
    await page?.close().catch((error) => errors.push(`page close: ${error instanceof Error ? error.message : String(error)}`));
    if (video) {
      try {
        const original = await video.path();
        const desired = join(raw, 'capture.webm');
        if (original !== desired && existsSync(original)) renameSync(original, desired);
        if (existsSync(desired)) videoPath = desired;
      } catch (error) {
        errors.push(`video finalization: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await context?.close().catch((error) => errors.push(`context close: ${error instanceof Error ? error.message : String(error)}`));
    await browser?.close().catch((error) => errors.push(`browser close: ${error instanceof Error ? error.message : String(error)}`));
  }

  for (const requestUrl of runtimeRequestIdentities) {
    if (!runtimeResponses.has(requestUrl)) errors.push(`runtime request had no hash-verified response: ${requestUrl}`);
  }
  const requiredUnityRuntime = verifiedUnity
    ? ['loader', 'data', 'framework', 'code'].map((key) => `${UNITY_WEBGL_HOST_PREFIX}${verifiedUnity.manifest[key].url}`)
    : [];
  for (const path of requiredUnityRuntime) {
    const requestUrl = new URL(path.split('/').map((part) => encodeURIComponent(part)).join('/'), base).href;
    if (!runtimeResponses.has(requestUrl)) errors.push(`required Unity runtime payload was not observed and hash-verified: ${path}`);
  }
  const runtimeVerification = [...runtimeResponses.values()].sort((left, right) => left.requestUrl.localeCompare(right.requestUrl));
  writeJsonNew(artifactInventoryFile, {
    schemaVersion: 3,
    sourceBuildId: sourceBefore,
    artifactRoot: builtArtifact.root,
    files: builtArtifact.files,
    binding: {
      base,
      policy: WEB_CAPTURE_BINDING_POLICY,
      preflight: servedVerification,
      runtime: runtimeVerification,
      requiredUnityRuntime,
      unityHostBinding,
      trustedUnityProvenance: trustedUnity,
      runtimePresentationContinuity: runtimeContinuity,
    },
  });
  const artifact = { path: basename(artifactInventoryFile), sha256: sha256File(artifactInventoryFile) };
  const artifactProof = `local inventory, all-file preflight and runtime-response verification${unityHostBinding ? ', plus exact React-host/Unity-export binding' : ''} ${basename(artifactInventoryFile)} sha256=${artifact.sha256}`;
  files.push(fileRecord(artifactInventoryFile, out, 'web_artifact_inventory', { mimeType: 'application/json', raw: true }));

  const sourceAfter = sourceBuildId();
  if (sourceAfter !== sourceBefore) {
    errors.push(`repository source changed during capture: ${sourceBefore} -> ${sourceAfter}`);
    complete = false;
  }
  if (embeddedBuildId !== sourceBefore) complete = false;
  const durationMs = Date.now() - started;
  let media = null;
  if (videoPath) {
    try {
      media = probeNormalizedMedia(videoPath);
    } catch (error) {
      errors.push(`video metadata verification: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const eventFile = join(out, 'events.json');
  writeJsonNew(eventFile, {
    schemaVersion: 1,
    captureId,
    sourceBuildId: sourceBefore,
    input: { kind: 'machine_keyboard', action: 'ArrowUp', actionCount: tapCount },
    events,
  });
  if (videoPath) files.push(fileRecord(videoPath, out, 'raw_video', { mimeType: 'video/webm', raw: true, durationMs: media?.durationMs ?? null }));
  const screenshot = join(raw, 'dead-ball.png');
  if (existsSync(screenshot)) files.push(fileRecord(screenshot, out, 'dead_ball_screenshot', { mimeType: 'image/png', raw: true }));
  files.push(fileRecord(eventFile, out, 'event_sidecar', { mimeType: 'application/json', raw: true }));
  complete = complete && errors.length === 0 && Boolean(videoPath);
  if (!videoPath) deviations.push('The browser did not finalize a video file.');
  const manifest = baseManifest({
    captureId,
    sourceId: sourceBefore,
    embeddedBuildId,
    expectedRenderer,
    observedRenderer,
    admission,
    rendererProof,
    capturedAtUtc,
    durationMs,
    viewport,
    userAgent,
    browserVersion,
    files,
    eventPath: basename(eventFile),
    errors,
    deviations,
    complete,
    evaluator,
    expectedScenario,
    qualityTier: options.quality_tier ?? null,
    artifact,
    artifactProof,
    media,
  });
  assertValidManifest(manifest, { root: out, verifyFiles: true });
  const manifestPath = writeJsonNew(join(out, 'manifest.json'), manifest);
  return { ok: complete, status: complete ? 'CAPTURED_DIAGNOSTIC' : 'FAILED', output: out, manifest: manifestPath, errors };
}

async function main() {
  const options = parseArgs(process.argv.slice(2), { booleans: ['help'] });
  if (options.help !== undefined) {
    process.stdout.write('Usage: node scripts/eval/compare/capture-web.mjs --renderer three-webgl|classic|unity-webgl --artifact-root HOST_DIR [--unity-export-root UNITY_DIR] [--base URL] [--quality-tier TIER] [--output-dir DIR] [--expected-build-id ID] [--evaluator ID]\nUnity WebGL requires a separate React host artifact root and provenance-valid Unity export root; the host must publish an exact copy under unity/.\n');
    return;
  }
  const result = await captureWeb(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    process.stderr.write(`capture-web: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
