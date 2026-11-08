import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAndroidAdbEndpoint } from './android-adb-endpoint.mjs';

test('debug evidence retains the local default ADB endpoint', () => {
  assert.deepEqual(resolveAndroidAdbEndpoint({}), { host: '127.0.0.1', port: 5037 });
});

test('sealed evidence requires a dedicated loopback ADB server with discovery disabled', () => {
  const base = {
    ANDROID_ADB_SERVER_ADDRESS: '127.0.0.1',
    ANDROID_ADB_SERVER_PORT: '5038',
    ADB_LOCAL_TRANSPORT_MAX_PORT: '5553',
    ADB_MDNS_AUTO_CONNECT: '0',
  };
  assert.deepEqual(resolveAndroidAdbEndpoint(base, { sealed: true }), {
    host: '127.0.0.1',
    port: 5038,
  });
  assert.throws(() => resolveAndroidAdbEndpoint({ ...base, ANDROID_ADB_SERVER_ADDRESS: 'localhost' }, { sealed: true }), /127\.0\.0\.1/u);
  assert.throws(() => resolveAndroidAdbEndpoint({ ...base, ANDROID_ADB_SERVER_PORT: '5037' }, { sealed: true }), /non-default/u);
  assert.throws(() => resolveAndroidAdbEndpoint({ ...base, ANDROID_ADB_SERVER_PORT: '70000' }, { sealed: true }), /1 through 65535/u);
  assert.throws(() => resolveAndroidAdbEndpoint({ ...base, ADB_LOCAL_TRANSPORT_MAX_PORT: '5585' }, { sealed: true }), /5553/u);
  assert.throws(() => resolveAndroidAdbEndpoint({ ...base, ADB_MDNS_AUTO_CONNECT: 'adb-tls-connect' }, { sealed: true }), /ADB_MDNS_AUTO_CONNECT=0/u);
  assert.throws(() => resolveAndroidAdbEndpoint({ ...base, ADB_SERVER_SOCKET: 'tcp:127.0.0.1:5037' }, { sealed: true }), /ADB_SERVER_SOCKET.*unset/u);
  assert.throws(() => resolveAndroidAdbEndpoint({ ...base, ADB_SERVER_SOCKET: '' }, { sealed: true }), /ADB_SERVER_SOCKET.*unset/u);
});
