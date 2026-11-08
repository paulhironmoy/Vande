import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inspectUnityR8Mapping } from './check-unity-r8.mjs';

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
