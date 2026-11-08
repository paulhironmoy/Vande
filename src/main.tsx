import '@fontsource-variable/manrope';
import '@/styles/tokens.css';
import '@/styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerPwa } from '@/pwa/register';

document.documentElement.lang = 'en';
// This is the identity compiled into the installed web payload, not a value inferred later from the checkout. The
// Android evidence harness reads it before making any gameplay assertion so a stale/reused APK fails closed.
document.documentElement.setAttribute('data-vande-build-id', __BUILD_ID__);

interface VandeAndroidEvidenceSurface {
  readonly buildId: string;
  readonly unityAvailability: () => Promise<{
    available: boolean;
    reason: string;
    unityVersion: string | null;
  }>;
}

const evidenceWindow = window as Window & { __vandeAndroidEvidence?: VandeAndroidEvidenceSurface };
if (!Object.hasOwn(evidenceWindow, '__vandeAndroidEvidence')) {
  Object.defineProperty(evidenceWindow, '__vandeAndroidEvidence', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      buildId: __BUILD_ID__,
      // Read-only and lazy: normal startup does not probe or load the optional Unity bridge. A harness may request
      // the same bounded availability decision that the product uses before constructing a Practice renderer.
      async unityAvailability() {
        const { nativeUnityPracticeBridge } = await import('@/platform/unityPractice');
        const bridge = await nativeUnityPracticeBridge();
        return bridge.availability();
      },
    } satisfies VandeAndroidEvidenceSurface),
  });
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

registerPwa();
