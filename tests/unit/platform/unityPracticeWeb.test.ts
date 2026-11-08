import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeUnityPracticeMessage, packUnityPracticeMessage, type UnityPracticePacket } from '@/contracts';
import { createWebUnityPracticeBridge } from '@/platform/unityPracticeWeb';

const BUILD_ID = 'abcdef0+123456789abc';
const manifest = {
  schema: 2 as const,
  buildId: BUILD_ID,
  unitySourceSha256: '1'.repeat(64),
  unityVersion: '6000.3.test',
  productVersion: '0.1.0',
  loader: { url: 'Build/VandePractice.loader.js', sha256: '2'.repeat(64) },
  data: { url: 'Build/VandePractice.data', sha256: '3'.repeat(64) },
  framework: { url: 'Build/VandePractice.framework.js', sha256: '4'.repeat(64) },
  code: { url: 'Build/VandePractice.wasm', sha256: '5'.repeat(64) },
  streamingAssetsUrl: 'StreamingAssets',
};

function sriSha256(hex: string): string {
  let binary = '';
  for (let offset = 0; offset < hex.length; offset += 2) {
    binary += String.fromCharCode(Number.parseInt(hex.slice(offset, offset + 2), 16));
  }
  return `sha256-${btoa(binary)}`;
}

function installLoadedLoader(): void {
  const loaderUrl = new URL(manifest.loader.url, new URL('/unity/vande-webgl-manifest.json', location.href)).href;
  const loader = document.createElement('script');
  loader.dataset.vandeUnityLoader = loaderUrl;
  loader.dataset.vandeUnitySha256 = manifest.loader.sha256;
  loader.integrity = sriSha256(manifest.loader.sha256);
  loader.dataset.loaded = 'true';
  document.head.append(loader);
}

async function hostPacket(): Promise<UnityPracticePacket> {
  return packUnityPracticeMessage(
    makeUnityPracticeMessage(
      {
        buildId: 'web-build',
        sessionId: 'web-session',
        messageId: 'host-1',
        sequence: 0,
        sender: 'host',
      },
      'host.initialize',
      {
        locale: 'en-IN',
        pixelsPerDp: 1,
        quality: 'standard',
        deviceTier: 'full',
        handedness: 'right',
        assistance: 'play',
        reducedMotion: false,
        textScale: 1,
        highContrast: false,
        captions: true,
        audio: true,
        haptics: false,
        coordinateSystem: 'vande-striker-frame-v1',
        handednessPolicy: 'physics-right-handed-presentation-mirrors-once',
      },
    ),
  );
}

async function unityPacket(): Promise<UnityPracticePacket> {
  return packUnityPracticeMessage(
    makeUnityPracticeMessage(
      {
        buildId: 'web-build',
        sessionId: 'web-session',
        messageId: 'unity-1',
        sequence: 0,
        sender: 'unity',
      },
      'unity.ready',
      { renderer: 'WebGL 2', unityVersion: '6000.3.test' },
    ),
  );
}

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  delete window.createUnityInstance;
  delete window.VandeUnityPracticeWebHost;
});

describe('Unity Practice WebGL bridge', () => {
  it('loads the manifest, binds the React canvas and forwards validated packets both ways', async () => {
    installLoadedLoader();

    const sendMessage = vi.fn();
    const quit = vi.fn(async () => undefined);
    window.createUnityInstance = vi.fn(async (canvas) => {
      // Unity 6's loader queries `#${canvas.id}` while binding. A missing id becomes the invalid selector "#" and
      // makes the real player fall back before it can report ready.
      expect(canvas.id).toBe('vande-unity-practice-canvas');
      expect(() => document.querySelector(`#${canvas.id}`)).not.toThrow();
      expect(document.querySelector(`#${canvas.id}`)).toBe(canvas);
      const operationId = window.VandeUnityPracticeWebHost?.pendingOperationId();
      if (operationId) window.VandeUnityPracticeWebHost?.runtimeLoadedFromUnity(operationId);
      return { SendMessage: sendMessage, Quit: quit };
    });
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    const bridge = createWebUnityPracticeBridge('/unity/vande-webgl-manifest.json', fetcher, BUILD_ID);
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    bridge.attachCanvas?.(canvas);

    expect(await bridge.availability()).toEqual({
      available: true,
      reason: 'ready',
      unityVersion: '6000.3.test',
      pixelsPerDp: 1,
      systemTextScale: 1,
    });
    const seen: UnityPracticePacket[] = [];
    await bridge.onMessage((packet) => seen.push(packet));
    const initialize = await hostPacket();
    expect(await bridge.launch(initialize)).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith('VandeBridge', 'ReceivePacket', JSON.stringify(initialize));

    const ready = await unityPacket();
    const operationId = window.VandeUnityPracticeWebHost?.pendingOperationId();
    if (!operationId) throw new Error('Web host operation was not installed.');
    window.VandeUnityPracticeWebHost?.readyFromUnity(operationId, JSON.stringify(ready));
    await vi.waitFor(() => expect(seen).toEqual([ready]));

    expect(await bridge.setReadyVisible?.(true, 'Localized cue')).toBe(true);
    expect(canvas.style.opacity).toBe('1');
    expect(canvas.style.pointerEvents).toBe('none');
    expect(await bridge.setVisible(true)).toBe(true);
    expect(canvas.style.pointerEvents).toBe('auto');
    expect(await bridge.unload()).toBe(true);
    expect(quit).toHaveBeenCalledOnce();
  });

  it('refuses to reveal a disconnected canvas while preserving hidden and unload cleanup', async () => {
    installLoadedLoader();

    const quit = vi.fn(async () => undefined);
    window.createUnityInstance = vi.fn(async () => {
      const operationId = window.VandeUnityPracticeWebHost?.pendingOperationId();
      if (operationId) window.VandeUnityPracticeWebHost?.runtimeLoadedFromUnity(operationId);
      return { SendMessage: vi.fn(), Quit: quit };
    });
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    const bridge = createWebUnityPracticeBridge('/unity/vande-webgl-manifest.json', fetcher, BUILD_ID);
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    bridge.attachCanvas?.(canvas);

    expect(await bridge.launch(await hostPacket())).toBe(true);
    expect(await bridge.setVisible(false)).toBe(true);
    canvas.remove();

    expect(await bridge.setVisible(true)).toBe(false);
    expect(canvas.style.opacity).toBe('0');
    expect(canvas.style.pointerEvents).toBe('none');
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(await bridge.setVisible(false)).toBe(true);
    expect(await bridge.unload()).toBe(true);
    expect(canvas.dataset.renderer).toBeUndefined();
    expect(quit).toHaveBeenCalledOnce();
  });

  it('fails closed when no generated Unity WebGL manifest exists', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    const bridge = createWebUnityPracticeBridge('/unity/vande-webgl-manifest.json', fetcher, BUILD_ID);
    expect(await bridge.availability()).toEqual({
      available: false,
      reason: 'web',
      unityVersion: null,
      pixelsPerDp: 1,
      systemTextScale: 1,
    });
    expect(await bridge.launch(await hostPacket())).toBe(false);
  });

  it.each([
    [
      'legacy schema',
      {
        schema: 1,
        unityVersion: '6000.3.test',
        productVersion: '0.1.0',
        loaderUrl: 'Build/VandePractice.loader.js',
        dataUrl: 'Build/VandePractice.data',
        frameworkUrl: 'Build/VandePractice.framework.js',
        codeUrl: 'Build/VandePractice.wasm',
        streamingAssetsUrl: 'StreamingAssets',
      },
    ],
    ['another source build', { ...manifest, buildId: 'abcdef1+123456789abc' }],
    ['malformed artifact digest', { ...manifest, code: { ...manifest.code, sha256: 'not-a-digest' } }],
    ['missing artifact digest', { ...manifest, code: { url: manifest.code.url } }],
    ['extra top-level field', { ...manifest, unexpected: true }],
    ['path traversal', { ...manifest, loader: { ...manifest.loader, url: '../loader.js' } }],
    ['encoded traversal', { ...manifest, loader: { ...manifest.loader, url: '%2e%2e/loader.js' } }],
    ['double-encoded traversal', { ...manifest, loader: { ...manifest.loader, url: '%252e%252e/loader.js' } }],
    ['encoded dot segment', { ...manifest, loader: { ...manifest.loader, url: 'Build/%2e/loader.js' } }],
    ['encoded forward slash', { ...manifest, loader: { ...manifest.loader, url: 'Build%2floader.js' } }],
    ['encoded backslash', { ...manifest, loader: { ...manifest.loader, url: 'Build%5cloader.js' } }],
    ['query', { ...manifest, loader: { ...manifest.loader, url: `${manifest.loader.url}?raw=1` } }],
    ['fragment', { ...manifest, loader: { ...manifest.loader, url: `${manifest.loader.url}#loader` } }],
    ['colon', { ...manifest, loader: { ...manifest.loader, url: 'https:loader.js' } }],
    ['artifact outside Build', { ...manifest, loader: { ...manifest.loader, url: 'Other/loader.js' } }],
    ['encoded StreamingAssets traversal', { ...manifest, streamingAssetsUrl: '%2e%2e/StreamingAssets' }],
    ['unexpected StreamingAssets subtree', { ...manifest, streamingAssetsUrl: 'Build/StreamingAssets' }],
  ])('rejects a manifest with %s and leaves the retained renderer available', async (_label, candidate) => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(candidate), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    const bridge = createWebUnityPracticeBridge('/unity/vande-webgl-manifest.json', fetcher, BUILD_ID);
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    bridge.attachCanvas?.(canvas);

    expect(await bridge.availability()).toEqual({
      available: false,
      reason: 'web',
      unityVersion: null,
      pixelsPerDp: 1,
      systemTextScale: 1,
    });
    expect(await bridge.launch(await hostPacket())).toBe(false);
    expect(window.createUnityInstance).toBeUndefined();
    expect(canvas.style.opacity).toBe('0');
    expect(canvas.style.pointerEvents).toBe('none');
  });

  it('rejects an already-loaded loader whose integrity does not match the manifest', async () => {
    const loaderUrl = new URL(manifest.loader.url, new URL('/unity/vande-webgl-manifest.json', location.href)).href;
    const loader = document.createElement('script');
    loader.dataset.vandeUnityLoader = loaderUrl;
    loader.dataset.vandeUnitySha256 = 'f'.repeat(64);
    loader.integrity = sriSha256('f'.repeat(64));
    loader.dataset.loaded = 'true';
    document.head.append(loader);
    window.createUnityInstance = vi.fn();
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    const bridge = createWebUnityPracticeBridge('/unity/vande-webgl-manifest.json', fetcher, BUILD_ID);
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    bridge.attachCanvas?.(canvas);

    expect(await bridge.availability()).toEqual({
      available: true,
      reason: 'ready',
      unityVersion: '6000.3.test',
      pixelsPerDp: 1,
      systemTextScale: 1,
    });
    expect(await bridge.launch(await hostPacket())).toBe(false);
    expect(window.createUnityInstance).not.toHaveBeenCalled();
  });
});
