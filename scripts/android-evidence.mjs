/** Pure helpers for Android evidence. Importing this module never connects to or changes a device. */

export const BUILD_ID_PATTERN = /^[0-9a-f]{7,40}(?:\+[0-9a-f]{12})?$/;

const NATIVE_AVAILABILITY_REASONS = new Set([
  'ready',
  'linked_unverified',
  'web',
  'plugin_missing',
  'unity_export_missing',
  'unsupported_native_abi',
  'unsupported_graphics_api',
  'low_memory_device',
  'version_mismatch',
  'unresponsive',
  'error',
]);

const RENDERERS = new Set(['unity-native', 'unity-webgl', 'three-webgl', 'classic']);
const ANDROID_RETAINED_RENDERERS = new Set(['three-webgl', 'classic']);
const UNITY_EVIDENCE_MESSAGE_TYPES = new Set([
  'bridge.ack',
  'unity.ready',
  'unity.clock_sync',
  'unity.release',
  'unity.pointer',
  'unity.gesture',
  'unity.dead',
  'unity.stats',
  'unity.benchmark',
  'unity.pause_request',
  'unity.quiet',
  'unity.unloaded',
  'unity.error',
]);

const exactKeys = (value, expected) => {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};

const restrictedIdentifier = (value, max, nullable = false) => {
  if (value === null && nullable) return null;
  return typeof value === 'string' && value.length <= max && /^[A-Za-z0-9._:+-]+$/.test(value)
    ? value
    : null;
};

const diagnosticDetail = (value, max) => {
  if (typeof value !== 'string' || value.length === 0) return null;
  // eslint-disable-next-line no-control-regex -- the control characters are exactly what this check rejects or strips
  const bounded = value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
  if (/(?:\{\s*"|"(?:body|payload|packet)"\s*:|\b(?:packet|payload|gesture|coordinates?)\b\s*[=:])/i.test(bounded)) {
    return '[redacted unsafe native detail]';
  }
  return bounded;
};

/** Strictly normalizes the untrusted page binding before evidence retention. Unknown/expanded shapes are dropped. */
export function normalizeUnityNativeEvidenceEvent(value, limits) {
  if (typeof value !== 'object' || value === null || typeof limits !== 'object' || limits === null) return null;
  const operationId = restrictedIdentifier(value.operationId, limits.operationId, true);
  if (value.operationId !== null && operationId === null) return null;
  if (value.event === 'message') {
    if (!exactKeys(value, ['deliveryId', 'event', 'operationId', 'sequence', 'type'])) return null;
    if (!UNITY_EVIDENCE_MESSAGE_TYPES.has(value.type)) return null;
    const deliveryId = restrictedIdentifier(value.deliveryId, limits.deliveryId, true);
    if (value.deliveryId !== null && deliveryId === null) return null;
    if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) return null;
    return { event: 'message', operationId, type: value.type, sequence: value.sequence, deliveryId };
  }
  if (value.event === 'error') {
    if (!exactKeys(value, ['code', 'detail', 'event', 'operationId'])) return null;
    const code = restrictedIdentifier(value.code, limits.code, true);
    if (value.code !== null && code === null) return null;
    return { event: 'error', operationId, code, detail: diagnosticDetail(value.detail, limits.detail) };
  }
  return null;
}

export function normalizeUnityNativeListenerRegistration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !exactKeys(value, ['epoch', 'ok', 'reason', 'utc'])
      || !Number.isSafeInteger(value.epoch) || value.epoch < 1
      || typeof value.ok !== 'boolean'
      || typeof value.reason !== 'string' || value.reason.length < 1 || value.reason.length > 160
      // eslint-disable-next-line no-control-regex -- the control characters are exactly what this check rejects or strips
      || /[\u0000-\u001f\u007f]/u.test(value.reason)
      || typeof value.utc !== 'string' || !Number.isFinite(Date.parse(value.utc))
      || new Date(Date.parse(value.utc)).toISOString() !== value.utc) return null;
  return { epoch: value.epoch, utc: value.utc, ok: value.ok, reason: value.reason };
}

export function retainUnityNativeEvidenceEvent(store, {
  epoch,
  value,
  limits,
  capturedUtc,
  maxEvents,
}) {
  const normalized = Number.isSafeInteger(epoch) && epoch >= 1
    ? normalizeUnityNativeEvidenceEvent(value, limits)
    : null;
  if (!normalized) {
    store.droppedEvents += 1;
    return false;
  }
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1
      || typeof capturedUtc !== 'string' || !Number.isFinite(Date.parse(capturedUtc))
      || new Date(Date.parse(capturedUtc)).toISOString() !== capturedUtc) {
    store.droppedEvents += 1;
    return false;
  }
  while (store.events.length >= maxEvents) {
    store.events.shift();
    store.droppedEvents += 1;
  }
  store.events.push({ epoch, utc: capturedUtc, ...normalized });
  return true;
}

export function retainUnityNativeListenerRegistration(store, entry, maxRegistrations) {
  const normalized = normalizeUnityNativeListenerRegistration(entry);
  if (!normalized || !Number.isSafeInteger(maxRegistrations) || maxRegistrations < 1) {
    store.droppedRegistrations += 1;
    return false;
  }
  while (store.registrations.length >= maxRegistrations) {
    store.registrations.shift();
    store.droppedRegistrations += 1;
  }
  store.registrations.push(normalized);
  return true;
}

export function validBuildId(value) {
  return typeof value === 'string' && BUILD_ID_PATTERN.test(value);
}

/** Refuses malformed or expanded native results before they enter an evidence record. */
export function normalizeNativeAvailability(value) {
  if (typeof value !== 'object' || value === null) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys[0] !== 'available' || keys[1] !== 'reason' || keys[2] !== 'unityVersion') return null;
  if (typeof value.available !== 'boolean' || !NATIVE_AVAILABILITY_REASONS.has(value.reason)) return null;
  if (value.unityVersion !== null && typeof value.unityVersion !== 'string') return null;
  return {
    available: value.available,
    reason: value.reason,
    unityVersion: value.unityVersion,
  };
}

/**
 * Decides only whether the observed renderer is admissible for this named harness run. An accepted retained fallback
 * remains a fallback; it is never relabelled as native Unity evidence.
 */
export function assessUnityRenderer({ requested, allowFallback, renderer }) {
  const known = typeof renderer === 'string' && RENDERERS.has(renderer);
  if (!requested) {
    return {
      ok: known,
      classification: known ? 'renderer_recorded' : 'renderer_marker_missing',
      expected: 'one declared renderer marker',
    };
  }
  if (renderer === 'unity-native') {
    return { ok: true, classification: 'unity_native', expected: 'unity-native' };
  }
  if (allowFallback && typeof renderer === 'string' && ANDROID_RETAINED_RENDERERS.has(renderer)) {
    return {
      ok: true,
      classification: 'retained_fallback_explicitly_allowed',
      expected: 'unity-native, or an explicitly allowed three-webgl/classic fallback',
    };
  }
  return {
    ok: false,
    classification: known ? 'unexpected_renderer' : 'renderer_marker_missing',
    expected: allowFallback
      ? 'unity-native, or an explicitly allowed three-webgl/classic fallback'
      : 'unity-native',
  };
}

/**
 * Finds Android SystemUI's one-time immersive-mode confirmation action without relying on a screen coordinate.
 * The caller may use the returned centre with `adb shell input tap`. A generic app `button1` is deliberately not
 * accepted: the dump must identify SystemUI and the fullscreen education surface, so this helper cannot dismiss a
 * VANDE dialog or consent prompt by accident.
 */
export function immersiveConfirmationAction(xml) {
  if (typeof xml !== 'string' || xml.length === 0) return null;
  const systemUi = /package="com\.android\.systemui"/.test(xml);
  const education = /text="Viewing full screen"|content-desc="Viewing full screen"|immersive[_ -]?mode/i.test(xml);
  if (!systemUi || !education) return null;

  for (const match of xml.matchAll(/<node\b[^>]*>/g)) {
    const node = match[0];
    if (!/package="com\.android\.systemui"/.test(node)) continue;
    const action = /text="Got it"/i.test(node)
      || /resource-id="(?:android:id\/button1|com\.android\.systemui:id\/(?:ok|confirm))"/.test(node);
    if (!action) continue;
    const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!bounds) continue;
    const [, leftRaw, topRaw, rightRaw, bottomRaw] = bounds;
    const left = Number(leftRaw);
    const top = Number(topRaw);
    const right = Number(rightRaw);
    const bottom = Number(bottomRaw);
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) continue;
    return {
      x: Math.round((left + right) / 2),
      y: Math.round((top + bottom) / 2),
      bounds: { left, top, right, bottom },
    };
  }
  return null;
}

/**
 * Static source inspection only. This can show the written order of admission calls; it cannot establish what a
 * physical process loaded before or during a run.
 */
export function inspectUnityAdmissionSource(source) {
  if (typeof source !== 'string') return { ordered: false, positions: null };
  const start = source.indexOf('public static Availability availability(Activity host)');
  const end = source.indexOf('public static synchronized boolean blocked()', start);
  if (start < 0 || end <= start) return { ordered: false, positions: null };
  const method = source.slice(start, end);
  const positions = {
    linkedGate: method.indexOf('BuildConfig.VANDE_UNITY_LINKED'),
    abiGate: method.indexOf('UnityPracticeAbiGate.inspect()'),
    graphicsGate: method.indexOf('UnityPracticeGraphicsGate.inspect(host)'),
    memoryGate: method.indexOf('UnityPracticeMemoryGate.inspect(host)'),
    reflectiveVerification: method.indexOf('verifyPlayerApi()'),
  };
  const values = Object.values(positions);
  return {
    ordered: values.every((position) => position >= 0)
      && positions.linkedGate < positions.abiGate
      && positions.abiGate < positions.graphicsGate
      && positions.graphicsGate < positions.memoryGate
      && positions.memoryGate < positions.reflectiveVerification,
    positions,
  };
}
