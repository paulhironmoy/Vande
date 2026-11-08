import { describe, expect, it } from 'vitest';
import {
  isRuntimeImageOrJsonRequest,
  isUnityRuntimeRequest,
  unityRuntimePathPrefix,
} from '@/pwa/cachePolicy';

const ORIGIN = 'https://play.vande.example';

describe('service-worker Unity cache policy', () => {
  it('resolves the Unity runtime prefix under root and nested deployments', () => {
    expect(unityRuntimePathPrefix('/')).toBe('/unity/');
    expect(unityRuntimePathPrefix('/Vande/')).toBe('/Vande/unity/');
    expect(unityRuntimePathPrefix('/Vande')).toBe('/Vande/unity/');
  });

  it.each([
    '/unity',
    '/unity/vande-webgl-manifest.json',
    '/unity/Build/VandePractice.loader.js',
    '/unity/Build/VandePractice.data',
    '/unity/Build/VandePractice.framework.js',
    '/unity/Build/VandePractice.wasm',
  ])('classifies same-origin Unity runtime request %s', (pathname) => {
    expect(isUnityRuntimeRequest(new URL(pathname, ORIGIN), ORIGIN, '/')).toBe(true);
  });

  it('honours a nested base without matching cross-origin or lookalike paths', () => {
    expect(isUnityRuntimeRequest(new URL('/Vande/unity/Build/game.wasm', ORIGIN), ORIGIN, '/Vande/')).toBe(true);
    expect(isUnityRuntimeRequest(new URL('/unity/Build/game.wasm', ORIGIN), ORIGIN, '/Vande/')).toBe(false);
    expect(isUnityRuntimeRequest(new URL('/Vande/unity-preview/config.json', ORIGIN), ORIGIN, '/Vande/')).toBe(false);
    expect(isUnityRuntimeRequest(new URL('/Vande/unity/config.json', 'https://cdn.example'), ORIGIN, '/Vande/')).toBe(false);
  });

  it('excludes Unity JSON and images from the stale-while-revalidate runtime cache', () => {
    const manifest = new URL('/unity/vande-webgl-manifest.json', ORIGIN);
    const texture = new URL('/unity/StreamingAssets/texture.png', ORIGIN);
    const ordinaryJson = new URL('/config/locale.json', ORIGIN);
    const ordinaryImage = new URL('/media/photo.png', ORIGIN);

    expect(isRuntimeImageOrJsonRequest('', manifest, ORIGIN, '/')).toBe(false);
    expect(isRuntimeImageOrJsonRequest('image', texture, ORIGIN, '/')).toBe(false);
    expect(isRuntimeImageOrJsonRequest('', ordinaryJson, ORIGIN, '/')).toBe(true);
    expect(isRuntimeImageOrJsonRequest('image', ordinaryImage, ORIGIN, '/')).toBe(true);
  });
});
