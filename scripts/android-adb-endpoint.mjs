const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_ADB_PORT = 5037;

function parsePort(raw) {
  if (raw === undefined || raw === '') return DEFAULT_ADB_PORT;
  if (!/^[1-9][0-9]{0,4}$/u.test(raw)) {
    throw new Error('ANDROID_ADB_SERVER_PORT must be an integer from 1 through 65535');
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error('ANDROID_ADB_SERVER_PORT must be an integer from 1 through 65535');
  }
  return port;
}

/** Resolve the one ADB endpoint used by both the shell wrapper and Playwright. */
export function resolveAndroidAdbEndpoint(env = process.env, { sealed = false } = {}) {
  const explicitHost = env.ANDROID_ADB_SERVER_ADDRESS;
  const explicitPort = env.ANDROID_ADB_SERVER_PORT;
  const host = explicitHost?.trim() || LOOPBACK_HOST;
  const port = parsePort(explicitPort);

  if (sealed) {
    if (explicitHost !== LOOPBACK_HOST) {
      throw new Error('sealed Android evidence requires ANDROID_ADB_SERVER_ADDRESS=127.0.0.1');
    }
    if (explicitPort === undefined || explicitPort === '' || port === DEFAULT_ADB_PORT) {
      throw new Error('sealed Android evidence requires an explicit non-default ANDROID_ADB_SERVER_PORT');
    }
    if (env.ADB_LOCAL_TRANSPORT_MAX_PORT !== '5553') {
      throw new Error('sealed Android evidence requires ADB_LOCAL_TRANSPORT_MAX_PORT=5553');
    }
    if (env.ADB_MDNS_AUTO_CONNECT !== '0') {
      throw new Error('sealed Android evidence requires ADB_MDNS_AUTO_CONNECT=0');
    }
    if (Object.hasOwn(env, 'ADB_SERVER_SOCKET')) {
      throw new Error('sealed Android evidence requires ADB_SERVER_SOCKET to be unset');
    }
  }

  return Object.freeze({ host, port });
}
