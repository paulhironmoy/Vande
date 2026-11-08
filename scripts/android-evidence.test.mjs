import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  assessUnityRenderer,
  immersiveConfirmationAction,
  inspectUnityAdmissionSource,
  normalizeNativeAvailability,
  normalizeUnityNativeEvidenceEvent,
  normalizeUnityNativeListenerRegistration,
  retainUnityNativeEvidenceEvent,
  retainUnityNativeListenerRegistration,
  validBuildId,
} from './android-evidence.mjs';

describe('Android evidence identity', () => {
  it('accepts repository build identities and rejects timestamps or unbounded strings', () => {
    assert.equal(validBuildId('38924bd+123456789abc'), true);
    assert.equal(validBuildId('0123456789abcdef'), true);
    assert.equal(validBuildId('20261028.1200'), false);
    assert.equal(validBuildId('../38924bd'), false);
  });

  it('initializes the harness-start identity from the declared source snapshot', () => {
    const harness = readFileSync(new URL('./android-practice.mjs', import.meta.url), 'utf8');
    assert.match(harness, /const sourceBuildIdAtStart = host\('scripts\/build-id\.sh'\);/);
    assert.match(harness, /sourceBuildIdAtHarnessStart:\s*sourceBuildIdAtStart,/);
    assert.doesNotMatch(harness, /^\s*sourceBuildIdAtHarnessStart,\s*$/m);
  });
});

describe('Android Unity evidence', () => {
  it('admits incomplete native evidence only in explicitly marked preview and harness builds', () => {
    const releaseBuild = readFileSync(new URL('./build-android.sh', import.meta.url), 'utf8');
    const lifecycleBuild = readFileSync(new URL('./android-practice.sh', import.meta.url), 'utf8');

    assert.match(releaseBuild, /if \[\[ \$PREVIEW == 1 && \$UNITY == 1 \]\]; then[\s\S]*ENGINEERING_PREVIEW=1/);
    assert.match(
      releaseBuild,
      /WEB_ARGS=\(npm run build\)[\s\S]*VITE_UNITY_PRACTICE_ENGINEERING_PREVIEW="\$ENGINEERING_PREVIEW" "\$\{WEB_ARGS\[@\]\}"/,
    );
    assert.match(lifecycleBuild, /VITE_UNITY_PRACTICE=1 \\\n+\s*VITE_UNITY_PRACTICE_ENGINEERING_PREVIEW=1/);
    assert.match(lifecycleBuild, /VITE_UNITY_PRACTICE=0 \\\n+\s*VITE_UNITY_PRACTICE_ENGINEERING_PREVIEW=0/);
  });

  it('captures only bounded operation metadata on every requested WebView epoch', () => {
    const harness = readFileSync(new URL('./android-practice.mjs', import.meta.url), 'utf8');
    assert.match(harness, /const UNITY_EVENT_LIMIT = 256;/);
    assert.match(harness, /const UNITY_EVENT_STRING_LIMITS = Object\.freeze\(\{ operationId: 128, type: 64, deliveryId: 128, code: 64, detail: 256 \}\);/);
    assert.match(harness, /candidate\.exposeBinding\(bindingName, \(_source, value\) => recordUnityNativeEvent\(epoch, value\)\)/);
    assert.match(harness, /plugin\.addListener\('message', onMessage\)/);
    assert.match(harness, /plugin\.addListener\('error', onError\)/);
    assert.match(harness, /await attachUnityNativeEventEvidence\(candidate, epoch\);/);

    assert.match(harness, /retainUnityNativeEvidenceEvent\(results\.unityNativeEvents,/);
    assert.match(harness, /retainUnityNativeListenerRegistration\([\s\S]*results\.unityNativeEvents,/);
    assert.match(harness, /const identityText = \(value, max\)[\s\S]*value\.slice\(0, max \+ 1\)/);
    assert.match(harness, /const diagnosticText = \(value, max\)[\s\S]*value\.slice\(0, max\)/);

    const limits = { operationId: 128, type: 64, deliveryId: 128, code: 64, detail: 256 };
    assert.deepEqual(normalizeUnityNativeEvidenceEvent({
      event: 'message', operationId: 'op-1', type: 'unity.dead', sequence: 4, deliveryId: 'delivery-1',
    }, limits), {
      event: 'message', operationId: 'op-1', type: 'unity.dead', sequence: 4, deliveryId: 'delivery-1',
    });
    assert.equal(normalizeUnityNativeEvidenceEvent({
      event: 'message', operationId: 'op-1', type: 'unity.dead', sequence: 4, deliveryId: 'delivery-1', packet: 'secret',
    }, limits), null);
    assert.deepEqual(normalizeUnityNativeEvidenceEvent({
      event: 'error', operationId: 'op-1', code: 'unity_runtime', detail: 'packet={"body":"secret"}',
    }, limits), {
      event: 'error', operationId: 'op-1', code: 'unity_runtime', detail: '[redacted unsafe native detail]',
    });

    const store = { events: [], droppedEvents: 0, registrations: [], droppedRegistrations: 0 };
    assert.equal(retainUnityNativeEvidenceEvent(store, {
      epoch: 1,
      value: { event: 'message', operationId: 'op-1', type: 'unity.dead', sequence: 4, deliveryId: 'delivery-1' },
      limits,
      capturedUtc: '2026-10-29T10:00:00.000Z',
      maxEvents: 2,
    }), true);
    assert.equal(retainUnityNativeEvidenceEvent(store, {
      epoch: 1,
      value: { event: 'message', operationId: 'op-1', type: 'unity.dead', sequence: 4, deliveryId: 'delivery-1', packet: 'rejected' },
      limits,
      capturedUtc: '2026-10-29T10:00:00.001Z',
      maxEvents: 2,
    }), false);
    assert.equal(store.droppedEvents, 1);
    const overlengthOperationId = 'x'.repeat(limits.operationId + 20);
    const pageForwardedOperationId = overlengthOperationId.slice(0, limits.operationId + 1);
    assert.equal(retainUnityNativeEvidenceEvent(store, {
      epoch: 1,
      value: {
        event: 'message', operationId: pageForwardedOperationId, type: 'unity.dead', sequence: 5, deliveryId: 'delivery-1',
      },
      limits,
      capturedUtc: '2026-10-29T10:00:00.002Z',
      maxEvents: 2,
    }), false);
    assert.equal(store.droppedEvents, 2);

    const registration = {
      epoch: 1,
      utc: '2026-10-29T10:00:00.000Z',
      ok: true,
      reason: 'message_and_error_listeners_attached',
    };
    assert.deepEqual(normalizeUnityNativeListenerRegistration(registration), registration);
    assert.equal(retainUnityNativeListenerRegistration(store, registration, 2), true);
    assert.equal(retainUnityNativeListenerRegistration(store, { ...registration, extra: true }, 2), false);
    assert.equal(store.droppedRegistrations, 1);
  });

  it('bounds filtered VANDE Unity logcat evidence before JSON retention', () => {
    const harness = readFileSync(new URL('./android-practice.mjs', import.meta.url), 'utf8');
    assert.match(harness, /const UNITY_LOGCAT_LINE_LIMIT = 128;/);
    assert.match(harness, /const UNITY_LOGCAT_CHAR_LIMIT = 512;/);
    assert.match(harness, /grep -E 'VANDE Unity\|UnityPracticeHost\|UnityPracticePlugin\|VandeUnityPractice'/);
    assert.match(harness, /diagnosticCandidates\.slice\(-UNITY_LOGCAT_LINE_LIMIT\)\.map\(\(line\) =>/);
    assert.match(harness, /line\.slice\(0, UNITY_LOGCAT_CHAR_LIMIT\)/);
    assert.match(harness, /redacted VANDE Unity diagnostic line containing packet, payload or gesture data/);
    assert.match(harness, /Gate-A app PID remained stable across native Unity launch/);
    assert.match(harness, /Unity\.\*\(Queue Destroy\|Quitting process\)/);
    assert.match(harness, /onUnityPlayer\(Unloaded\|Quitted\)/);
    assert.match(harness, /BOUNDED_FILTERED_PROCESS_DIAGNOSTIC/);
  });

  it('fails strict native evidence when any bounded native error event was observed', () => {
    const harness = readFileSync(new URL('./android-practice.mjs', import.meta.url), 'utf8');
    assert.match(harness, /const nativeErrors = results\.unityNativeEvents\.events\.filter/);
    assert.match(harness, /if \(UNITY_REQUESTED && !ALLOW_UNITY_FALLBACK\)/);
    assert.match(harness, /strict native Unity run emitted no native error event/);
  });

  it('keeps independent launch fail-safe caps ordered with bounded cross-thread slack', () => {
    const nativeHost = readFileSync(new URL('../android/app/src/main/java/in/vande/cricket/unity/UnityPracticeHost.java', import.meta.url), 'utf8');
    const platformBridge = readFileSync(new URL('../src/platform/unityPractice.ts', import.meta.url), 'utf8');
    const coordinator = readFileSync(new URL('../src/practice/unity/coordinator.ts', import.meta.url), 'utf8');
    const milliseconds = (source, name) => {
      const match = source.match(new RegExp(`(?:const|long) ${name} = ([0-9_]+);`));
      assert.ok(match, `missing ${name}`);
      return Number(match[1].replaceAll('_', ''));
    };
    const nativeMs = milliseconds(nativeHost, 'LAUNCH_TIMEOUT_MS');
    const bridgeMs = milliseconds(platformBridge, 'UNITY_LAUNCH_TIMEOUT_MS');
    const coordinatorMs = milliseconds(coordinator, 'UNITY_PRACTICE_LAUNCH_TIMEOUT_MS');

    assert.ok(nativeMs >= 30_000, 'native absolute operation cap regressed below its bounded engineering budget');
    assert.ok(bridgeMs - nativeMs >= 5_000, 'the bridge cap needs bounded cross-thread slack after native expiration');
    assert.ok(coordinatorMs - bridgeMs >= 5_000, 'the coordinator cap needs bounded cross-thread slack after bridge expiration');

    const reserve = nativeHost.indexOf('scheduleLaunchTimeout(requestedOperationId);');
    const constructPost = nativeHost.indexOf('MAIN.post(() -> attachOnMain(host, requestedOperationId));');
    assert.ok(reserve >= 0 && constructPost > reserve, 'the native deadline must be reserved before player construction is posted');
    assert.match(nativeHost, /launchDeadlineElapsedRealtimeMs = SystemClock\.elapsedRealtime\(\) \+ LAUNCH_TIMEOUT_MS/);
    assert.match(nativeHost, /failIfLaunchDeadlineExpiredOnMain\(requestedOperationId, "player_constructed"\)/);
    assert.match(nativeHost, /failIfLaunchDeadlineExpiredOnMain\(requestedOperationId, "player_view_attached"\)/);
    assert.match(nativeHost, /launchDeadlineExpiredLocked\(requestedOperationId\)/);
  });

  it('preserves the literal Unity-to-Android JNI host through release minification', () => {
    const rules = readFileSync(new URL('../android/app/proguard-rules.pro', import.meta.url), 'utf8');
    assert.match(rules, /-keep class in\.vande\.cricket\.unity\.UnityPracticeHost\s*\{[\s\S]*public static \*;[\s\S]*\}/);
  });

  it('targets only the bounded SystemUI fullscreen confirmation action', () => {
    const xml = `<?xml version="1.0"?><hierarchy>
      <node text="Viewing full screen" resource-id="" package="com.android.systemui" bounds="[400,100][2000,700]" />
      <node text="Got it" resource-id="android:id/button1" package="com.android.systemui" clickable="true" bounds="[1600,420][1900,620]" />
    </hierarchy>`;
    assert.deepEqual(immersiveConfirmationAction(xml), {
      x: 1750,
      y: 520,
      bounds: { left: 1600, top: 420, right: 1900, bottom: 620 },
    });
    assert.equal(immersiveConfirmationAction(xml.replaceAll('com.android.systemui', 'in.vande.cricket')), null);
    assert.equal(immersiveConfirmationAction('<node text="Got it" resource-id="android:id/button1" package="com.android.systemui" bounds="[1,1][2,2]" />'), null);

    const harness = readFileSync(new URL('./android-practice.mjs', import.meta.url), 'utf8');
    const dump = harness.indexOf("const dump = await shell('uiautomator dump /data/local/tmp/vande-immersive-window.xml')");
    const confirmed = harness.indexOf("dump.includes('/data/local/tmp/vande-immersive-window.xml')", dump);
    const read = harness.indexOf("shell('cat /data/local/tmp/vande-immersive-window.xml')", confirmed);
    assert.ok(dump >= 0 && confirmed > dump && read > confirmed, 'stale SystemUI XML must not be read after a failed dump');
    const watcher = harness.indexOf('const immersiveConfirmation = !immersiveConfirmationHandled');
    const geometry = harness.indexOf('await captureBattingGeometry(`${label}: Play`)', watcher);
    assert.ok(watcher >= 0 && geometry > watcher, 'the SystemUI watcher must start before landscape geometry can wait');
    assert.match(harness, /Gate-A native Unity emitted no quit\/process-termination signal/);
  });

  it('keeps an explicitly allowed retained renderer honest and passing', () => {
    assert.deepEqual(
      assessUnityRenderer({ requested: true, allowFallback: true, renderer: 'classic' }),
      {
        ok: true,
        classification: 'retained_fallback_explicitly_allowed',
        expected: 'unity-native, or an explicitly allowed three-webgl/classic fallback',
      },
    );
  });

  it('does not accept a retained renderer as native Unity without the explicit cohort flag', () => {
    assert.equal(assessUnityRenderer({ requested: true, allowFallback: false, renderer: 'three-webgl' }).ok, false);
    assert.equal(assessUnityRenderer({ requested: true, allowFallback: true, renderer: 'unity-webgl' }).ok, false);
    assert.equal(assessUnityRenderer({ requested: true, allowFallback: true, renderer: null }).ok, false);
  });

  it('validates the exact availability evidence shape', () => {
    assert.deepEqual(normalizeNativeAvailability({
      available: false,
      reason: 'low_memory_device',
      unityVersion: null,
    }), {
      available: false,
      reason: 'low_memory_device',
      unityVersion: null,
    });
    assert.equal(normalizeNativeAvailability({ available: true, reason: 'invented', unityVersion: 'x' }), null);
    assert.equal(normalizeNativeAvailability({ available: true, reason: 'ready', unityVersion: 'x', extra: true }), null);
  });

  it('labels only the written gate order as static source evidence', () => {
    const source = `
      public static Availability availability(Activity host) {
        BuildConfig.VANDE_UNITY_LINKED;
        UnityPracticeAbiGate.inspect();
        UnityPracticeGraphicsGate.inspect(host);
        UnityPracticeMemoryGate.inspect(host);
        verifyPlayerApi();
      }
      public static synchronized boolean blocked() { return false; }
    `;
    assert.equal(inspectUnityAdmissionSource(source).ordered, true);
    assert.equal(inspectUnityAdmissionSource(source.replace('verifyPlayerApi();', '').replace('BuildConfig.VANDE_UNITY_LINKED;', 'verifyPlayerApi();')).ordered, false);
  });
});
