/**
 * Verified Unity WebGL transport.
 *
 * The generated player is only a presentation/input surface. TypeScript remains
 * authoritative for delivery physics, scoring, innings, replay identity and Coach.
 * Manifest and artifact identity are fail-closed before the player is admitted.
 */
import {
  UNITY_PRACTICE_MAX_PACKET_BYTES,
  unpackUnityPracticePacket,
  type UnityPracticePacket,
} from '@/contracts';
import type {
  UnityPracticeAvailability,
  UnityPracticeBridge,
  UnityPracticeNativeError,
} from './unityPractice';

interface UnityWebGlArtifact {
  url: string;
  sha256: string;
}

interface UnityWebGlManifest {
  schema: 2;
  buildId: string;
  unitySourceSha256: string;
  unityVersion: string;
  productVersion: string;
  loader: UnityWebGlArtifact;
  data: UnityWebGlArtifact;
  framework: UnityWebGlArtifact;
  code: UnityWebGlArtifact;
  streamingAssetsUrl: string;
}

interface UnityWebGlInstance {
  SendMessage(objectName: string, methodName: string, value?: string): void;
  Quit(): Promise<void>;
}

interface VandeUnityPracticeWebHost {
  pendingOperationId(): string | null;
  runtimeLoadedFromUnity(operationId: string): void;
  emitFromUnity(operationId: string, packet: string): void;
  readyFromUnity(operationId: string, packet: string): void;
}

type UnityInstanceFactory = (
  canvas: HTMLCanvasElement,
  config: {
    dataUrl: string;
    frameworkUrl: string;
    codeUrl: string;
    streamingAssetsUrl: string;
    companyName: string;
    productName: string;
    productVersion: string;
  },
  onProgress?: (progress: number) => void,
) => Promise<UnityWebGlInstance>;

declare global {
  interface Window {
    createUnityInstance?: UnityInstanceFactory;
    VandeUnityPracticeWebHost?: VandeUnityPracticeWebHost;
  }
}

const DEFAULT_MANIFEST_URL = '/unity/vande-webgl-manifest.json';
const ERROR_EVENT = 'vande-unity-webgl-error';
const MAX_EVENT_BYTES = UNITY_PRACTICE_MAX_PACKET_BYTES * 2 + 4 * 1024;
const BUILD_SUBTREE = 'Build/';
const STREAMING_ASSETS_PATH = 'StreamingAssets';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeRelativeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false;
  // Keep the manifest a literal path manifest, rather than letting the URL parser or
  // an intermediary reinterpret URI syntax. In particular, encoded dot/slash
  // segments can be normalised after this check and escape the manifest directory.
  // eslint-disable-next-line no-control-regex -- rejecting control characters and space in a manifest path is the purpose of this test
  if (value.startsWith('/') || /[\\%?#:]/u.test(value) || /[\u0000-\u0020\u007f]/u.test(value)) return false;
  return !value.split('/').some((part) => part === '' || part === '.' || part === '..');
}

function safeArtifactUrl(value: unknown): value is string {
  return safeRelativeUrl(value) && value.startsWith(BUILD_SUBTREE) && value.length > BUILD_SUBTREE.length;
}

function manifestSubtreeUrl(value: string, manifestUrl: string): string | null {
  if (!safeRelativeUrl(value)) return null;
  try {
    const manifest = new URL(manifestUrl, globalThis.location.href);
    const subtree = new URL('.', manifest);
    const resolved = new URL(value, subtree);
    if (resolved.origin !== subtree.origin ||
        !resolved.pathname.startsWith(subtree.pathname) ||
        resolved.search !== '' || resolved.hash !== '') return null;
    return resolved.href;
  } catch {
    return null;
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function sha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function buildId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{7,40}(?:\+[0-9a-f]{12})?$/.test(value);
}

function artifact(value: unknown, manifestUrl: string): value is UnityWebGlArtifact {
  return record(value) && exactKeys(value, ['url', 'sha256']) &&
    safeArtifactUrl(value.url) && manifestSubtreeUrl(value.url, manifestUrl) !== null && sha256(value.sha256);
}

function parseManifest(value: unknown, expectedBuildId: string, manifestUrl: string): UnityWebGlManifest | null {
  if (!record(value) || !exactKeys(value, [
    'schema', 'buildId', 'unitySourceSha256', 'unityVersion', 'productVersion',
    'loader', 'data', 'framework', 'code', 'streamingAssetsUrl',
  ]) || value.schema !== 2) return null;
  if (!buildId(value.buildId) || value.buildId !== expectedBuildId) return null;
  if (!sha256(value.unitySourceSha256)) return null;
  if (typeof value.unityVersion !== 'string' || value.unityVersion.length === 0 || value.unityVersion.length > 64) return null;
  if (typeof value.productVersion !== 'string' || value.productVersion.length === 0 || value.productVersion.length > 64) return null;
  if (!artifact(value.loader, manifestUrl) || !artifact(value.data, manifestUrl) ||
      !artifact(value.framework, manifestUrl) || !artifact(value.code, manifestUrl)) return null;
  if (value.streamingAssetsUrl !== STREAMING_ASSETS_PATH ||
      manifestSubtreeUrl(value.streamingAssetsUrl, manifestUrl) === null) return null;
  return value as unknown as UnityWebGlManifest;
}

function resolvedUrl(path: string, manifestUrl: string): string {
  const resolved = manifestSubtreeUrl(path, manifestUrl);
  if (!resolved) throw new Error('Unity WebGL manifest URL escapes its publication directory.');
  return resolved;
}

async function validPacket(value: string, sender: 'host' | 'unity'): Promise<UnityPracticePacket | null> {
  if (new TextEncoder().encode(value).byteLength > MAX_EVENT_BYTES) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!record(parsed) || Object.keys(parsed).length !== 2) return null;
    if (typeof parsed.body !== 'string' || typeof parsed.sha256 !== 'string') return null;
    const packet = { body: parsed.body, sha256: parsed.sha256 };
    const message = await unpackUnityPracticePacket(packet);
    return message.sender === sender ? packet : null;
  } catch {
    return null;
  }
}

function sriSha256(hex: string): string {
  let binary = '';
  for (let offset = 0; offset < hex.length; offset += 2) {
    binary += String.fromCharCode(Number.parseInt(hex.slice(offset, offset + 2), 16));
  }
  return `sha256-${globalThis.btoa(binary)}`;
}

function loadScript(url: string, expectedSha256: string): Promise<void> {
  const existing = Array.from(document.scripts).find((script) => script.dataset.vandeUnityLoader === url);
  const integrity = sriSha256(expectedSha256);
  if (existing && (existing.dataset.vandeUnitySha256 !== expectedSha256 || existing.integrity !== integrity)) {
    return Promise.reject(new Error('Unity WebGL loader provenance does not match the manifest.'));
  }
  if (existing?.dataset.loaded === 'true') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = existing ?? document.createElement('script');
    const loaded = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    const failed = () => reject(new Error('Unity WebGL loader failed.'));
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', failed, { once: true });
    if (!existing) {
      script.src = url;
      script.async = true;
      script.dataset.vandeUnityLoader = url;
      script.dataset.vandeUnitySha256 = expectedSha256;
      script.integrity = integrity;
      script.crossOrigin = 'anonymous';
      document.head.append(script);
    }
  });
}

/** Creates the lazy, single-instance bridge used by the Unity-default web Practice route. */
export function createWebUnityPracticeBridge(
  manifestUrl = DEFAULT_MANIFEST_URL,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  expectedBuildId = __BUILD_ID__,
): UnityPracticeBridge {
  let canvas: HTMLCanvasElement | null = null;
  let manifest: UnityWebGlManifest | null = null;
  let manifestTask: Promise<UnityWebGlManifest | null> | null = null;
  let instance: UnityWebGlInstance | null = null;
  let instanceTask: Promise<UnityWebGlInstance> | null = null;
  let currentOperationId: string | null = null;
  let runtimeLoaded = false;
  let active = false;
  let inboundTail: Promise<void> = Promise.resolve();
  const messageListeners = new Set<(packet: UnityPracticePacket, receivedPerfMs: number) => void>();
  const errorListeners = new Set<(error: UnityPracticeNativeError) => void>();

  const emitError = (code: string, detail: string) => {
    const error = { code, detail, operationId: null } satisfies UnityPracticeNativeError;
    for (const listener of errorListeners) listener(error);
  };

  const acceptInbound = (operationId: string, value: string) => {
    if (!active || operationId !== currentOperationId) return;
    const receivedPerfMs = performance.now();
    inboundTail = inboundTail.then(async () => {
      const packet = await validPacket(value, 'unity');
      if (!packet || !active || operationId !== currentOperationId) return;
      for (const listener of messageListeners) listener(packet, receivedPerfMs);
    }, () => undefined);
  };
  const onError = (event: Event) => {
    if (!active) return;
    const detail = (event as CustomEvent<unknown>).detail;
    emitError('webgl_runtime', typeof detail === 'string' ? detail : 'Unity WebGL reported a runtime error.');
  };
  globalThis.addEventListener(ERROR_EVENT, onError);

  let ownsWebHost = false;
  const installWebHost = (): boolean => {
    if (globalThis.window.VandeUnityPracticeWebHost !== undefined) return false;
    globalThis.window.VandeUnityPracticeWebHost = {
      pendingOperationId: () => currentOperationId,
      runtimeLoadedFromUnity(operationId) {
        if (operationId === currentOperationId) runtimeLoaded = true;
      },
      emitFromUnity: acceptInbound,
      readyFromUnity: acceptInbound,
    };
    ownsWebHost = true;
    return true;
  };

  const releaseWebHost = () => {
    if (ownsWebHost) delete globalThis.window.VandeUnityPracticeWebHost;
    ownsWebHost = false;
  };

  const readManifest = (): Promise<UnityWebGlManifest | null> => {
    if (manifest) return Promise.resolve(manifest);
    if (manifestTask) return manifestTask;
    manifestTask = fetcher(manifestUrl, { cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => response.ok ? parseManifest(await response.json(), expectedBuildId, manifestUrl) : null)
      .catch(() => null)
      .then((value) => {
        manifest = value;
        return value;
      });
    return manifestTask;
  };

  const ensureInstance = async (): Promise<UnityWebGlInstance> => {
    if (instance) return instance;
    if (instanceTask) return instanceTask;
    const target = canvas;
    const build = await readManifest();
    if (!target) throw new Error('Unity WebGL canvas is not attached.');
    if (!build) throw new Error('Unity WebGL manifest is unavailable.');
    instanceTask = (async () => {
      await loadScript(resolvedUrl(build.loader.url, manifestUrl), build.loader.sha256);
      const factory = globalThis.window.createUnityInstance;
      if (!factory) throw new Error('Unity WebGL loader did not expose createUnityInstance.');
      const created = await factory(target, {
        dataUrl: resolvedUrl(build.data.url, manifestUrl),
        frameworkUrl: resolvedUrl(build.framework.url, manifestUrl),
        codeUrl: resolvedUrl(build.code.url, manifestUrl),
        streamingAssetsUrl: resolvedUrl(build.streamingAssetsUrl, manifestUrl),
        companyName: 'VANDE',
        productName: 'VANDE Cricket Practice',
        productVersion: build.productVersion,
      });
      instance = created;
      return created;
    })();
    try {
      return await instanceTask;
    } catch (error) {
      instanceTask = null;
      emitError('webgl_load', error instanceof Error ? error.message : 'Unity WebGL failed to load.');
      throw error;
    }
  };

  return {
    attachCanvas(value) {
      if (instance && canvas !== value) throw new Error('Unity WebGL cannot move to another canvas while active.');
      canvas = value;
      // Unity 6's generated loader derives a CSS selector from the canvas id. An empty id becomes the invalid
      // selector "#" before the runtime can bind, so keep the app's stable id and also fail safe for other hosts.
      if (!value.id) value.id = 'vande-unity-practice-canvas';
      value.dataset.renderer = 'unity-webgl';
      value.style.opacity = '0';
      value.style.pointerEvents = 'none';
    },

    async availability(): Promise<UnityPracticeAvailability> {
      const build = await readManifest();
      return build
        ? { available: true, reason: 'ready', unityVersion: build.unityVersion, pixelsPerDp: 1, systemTextScale: 1 }
        : { available: false, reason: 'web', unityVersion: null, pixelsPerDp: 1, systemTextScale: 1 };
    },

    async launch(packet) {
      if (active || currentOperationId !== null || !(await validPacket(JSON.stringify(packet), 'host'))) return false;
      if (!installWebHost()) return false;
      currentOperationId = globalThis.crypto.randomUUID?.() ??
        `unity-web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      runtimeLoaded = false;
      try {
        const player = await ensureInstance();
        if (!runtimeLoaded) throw new Error('Unity WebGL runtime did not bind to the VANDE host.');
        active = true;
        player.SendMessage('VandeBridge', 'ReceivePacket', JSON.stringify(packet));
        return true;
      } catch {
        active = false;
        currentOperationId = null;
        releaseWebHost();
        return false;
      }
    },

    async send(packet) {
      if (!active || !instance || !(await validPacket(JSON.stringify(packet), 'host'))) return false;
      try {
        instance.SendMessage('VandeBridge', 'ReceivePacket', JSON.stringify(packet));
        return true;
      } catch {
        return false;
      }
    },

    async setVisible(visible) {
      if (!active || !canvas) return false;
      if (visible && !canvas.isConnected) {
        canvas.style.opacity = '0';
        canvas.style.pointerEvents = 'none';
        canvas.setAttribute('aria-hidden', 'true');
        return false;
      }
      canvas.style.opacity = visible ? '1' : '0';
      canvas.style.pointerEvents = visible ? 'auto' : 'none';
      if (visible) canvas.removeAttribute('aria-hidden');
      else canvas.setAttribute('aria-hidden', 'true');
      return true;
    },

    async setReadyVisible(visible) {
      if (!active || !canvas) return false;
      if (visible && !canvas.isConnected) {
        canvas.style.opacity = '0';
        canvas.style.pointerEvents = 'none';
        canvas.setAttribute('aria-hidden', 'true');
        return false;
      }
      canvas.style.opacity = visible ? '1' : '0';
      canvas.style.pointerEvents = 'none';
      if (visible) canvas.removeAttribute('aria-hidden');
      else canvas.setAttribute('aria-hidden', 'true');
      return true;
    },

    async unload() {
      active = false;
      const current = instance;
      instance = null;
      instanceTask = null;
      if (canvas) {
        canvas.style.opacity = '0';
        canvas.style.pointerEvents = 'none';
        canvas.removeAttribute('data-renderer');
      }
      if (!current) {
        currentOperationId = null;
        runtimeLoaded = false;
        releaseWebHost();
        return true;
      }
      try {
        await current.Quit();
        currentOperationId = null;
        runtimeLoaded = false;
        releaseWebHost();
        return true;
      } catch {
        return false;
      }
    },

    async onMessage(listener) {
      messageListeners.add(listener);
      return async () => { messageListeners.delete(listener); };
    },

    async onError(listener) {
      errorListeners.add(listener);
      return async () => { errorListeners.delete(listener); };
    },
  };
}
