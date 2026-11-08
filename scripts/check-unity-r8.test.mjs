import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inspectCameraAccessR8Mapping, inspectSystemGesturesR8Mapping, inspectUnityR8Mapping } from './check-unity-r8.mjs';

const host = 'in.vande.cricket.unity.UnityPracticeHost';
const valid = `${host} -> ${host}:
# {"id":"sourceFile","fileName":"UnityPracticeHost.java"}
    java.lang.String pendingOperationIdFromUnity() -> pendingOperationIdFromUnity
    1:2:void runtimeLoadedFromUnity(java.lang.String):1:2 -> runtimeLoadedFromUnity
    3:4:void readyFromUnity(java.lang.String,java.lang.String):3:4 -> readyFromUnity
    5:6:void emitFromUnity(java.lang.String,java.lang.String):5:6 -> emitFromUnity
next.Class -> a.b:
`;

describe('Unity release R8 mapping', () => {
  it('accepts the literal JNI class and all C#-called entrypoints', () => {
    assert.deepEqual(inspectUnityR8Mapping(valid), { ok: true, errors: [] });
  });

  it('rejects a renamed host class or entrypoint', () => {
    assert.equal(inspectUnityR8Mapping(valid.replace(`${host}:`, 'a.b:')).ok, false);
    const result = inspectUnityR8Mapping(valid.replace(' -> readyFromUnity', ' -> a'));
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /readyFromUnity/);
  });
});

const camera = 'in.vande.cricket.plugins.CameraAccessPlugin';
const validCamera = `${camera} -> ${camera}:
# {"id":"sourceFile","fileName":"CameraAccessPlugin.java"}
    1:2:void getStatus(com.getcapacitor.PluginCall):20:21 -> getStatus
    3:4:void request(com.getcapacitor.PluginCall):26:27 -> request
    5:6:void afterRequest(com.getcapacitor.PluginCall):35:36 -> afterRequest
    7:8:void openSettings(com.getcapacitor.PluginCall):41:42 -> openSettings
    java.lang.String state() -> a
other.Class -> a.b:
`;

describe('Camera permission helper R8 mapping', () => {
  it('accepts the plugin class with its three methods and its permission callback under their own names', () => {
    assert.deepEqual(inspectCameraAccessR8Mapping(validCamera), { ok: true, errors: [] });
    // The Unity check ignores the helper: its mapping is read independently.
    assert.equal(inspectUnityR8Mapping(validCamera).ok, false);
  });

  it('rejects a renamed or removed class, a renamed method and a missing permission callback', () => {
    assert.equal(inspectCameraAccessR8Mapping(validCamera.replace(`${camera}:`, 'a.b:')).ok, false);
    assert.equal(inspectCameraAccessR8Mapping('').ok, false);
    for (const name of ['getStatus', 'request', 'openSettings', 'afterRequest']) {
      const result = inspectCameraAccessR8Mapping(validCamera.replace(` -> ${name}`, ' -> a'));
      assert.equal(result.ok, false, name);
      assert.match(result.errors.join('\n'), new RegExp(name));
    }
    const noCallback = validCamera.split('\n').filter((line) => !line.includes('afterRequest')).join('\n');
    assert.match(inspectCameraAccessR8Mapping(noCallback).errors.join('\n'), /afterRequest/);
  });
});

const gestures = 'in.vande.cricket.plugins.SystemGesturesPlugin';
const validGestures = `${gestures} -> ${gestures}:
# {"id":"sourceFile","fileName":"SystemGesturesPlugin.java"}
    1:2:void setBattingExclusion(com.getcapacitor.PluginCall):40:41 -> setBattingExclusion
    void apply() -> a
other.Class -> a.b:
`;

describe('System gestures plugin R8 mapping', () => {
  it('accepts the plugin class with its reflective method under their own names', () => {
    assert.deepEqual(inspectSystemGesturesR8Mapping(validGestures), { ok: true, errors: [] });
    assert.equal(inspectCameraAccessR8Mapping(validGestures).ok, false);
  });

  it('rejects a renamed class, a renamed method and an empty mapping', () => {
    assert.equal(inspectSystemGesturesR8Mapping(validGestures.replace(`${gestures}:`, 'a.b:')).ok, false);
    assert.equal(inspectSystemGesturesR8Mapping('').ok, false);
    const result = inspectSystemGesturesR8Mapping(validGestures.replace(' -> setBattingExclusion', ' -> a'));
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /setBattingExclusion/);
  });
});
