/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import type { Plugin } from 'vite';
import { cameraPack } from './scripts/camera/vite-plugin.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const base = process.env.BASE_PATH || '/';
/**
 * Pages: the game and the static privacy and account-deletion pages everywhere; the admin console and the highlight
 * render page only in web builds (never packaged into the Android app, never precached by the service worker).
 */
const ANDROID = process.env.VITE_BUILD_TARGET === 'android';
// Unity remains an explicit candidate lane until the ADR's physical-device and
// web-feasibility gates pass. When selected, the artifact gate below fails
// closed rather than silently launching a stale Unity player.
const UNITY_PRACTICE_WEB = !ANDROID && process.env.VITE_UNITY_PRACTICE_WEB === '1';
const UNITY_PRACTICE = (ANDROID && process.env.VITE_UNITY_PRACTICE === '1') || UNITY_PRACTICE_WEB;
const legalPages = ['privacy.html', 'delete-account.html'];
const webOnlyPages = ANDROID ? [] : ['admin.html', 'render.html'];
const pageInputs = Object.fromEntries(
  ['index.html', ...legalPages, ...webOnlyPages]
    .filter((f) => existsSync(new URL(`./${f}`, import.meta.url)))
    .map((f) => [f.replace(/\.html$/, ''), fileURLToPath(new URL(`./${f}`, import.meta.url))]),
);

/**
 * Fills the operator and support address in the static legal pages from the build environment
 * (VITE_OPERATOR_NAME, VITE_SUPPORT_EMAIL); unset, they say plainly where to find them instead.
 */
function legalPlaceholders(): Plugin {
  let env: Record<string, string> = {};
  return {
    name: 'vande:legal-placeholders',
    configResolved(config) {
      env = config.env as Record<string, string>;
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!html.includes('{{SUPPORT_EMAIL}}') && !html.includes('{{OPERATOR}}')) return html;
        const email = (env.VITE_SUPPORT_EMAIL || '').trim();
        const operator = (env.VITE_OPERATOR_NAME || '').trim() || 'the developer named on our Google Play listing';
        const mail = email
          ? html.replaceAll('<a href="mailto:{{SUPPORT_EMAIL}}">{{SUPPORT_EMAIL}}</a>', `<a href="mailto:${email}">${email}</a>`)
          : html.replaceAll('<a href="mailto:{{SUPPORT_EMAIL}}">{{SUPPORT_EMAIL}}</a>', 'the support address on our Google Play listing');
        return mail.replaceAll('{{OPERATOR}}', operator);
      },
    },
  };
}

/**
 * Android builds ship neither web-only social cards nor the WebGL Unity player. Native Android links Unity through
 * unityLibrary; copying the separate WebGL wasm/data payload into the APK would be dead weight and duplicate engine
 * code. The retained Three.js/Classic chunks stay because they are the required device fallback.
 */
function dropWebOnlyAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'vande:drop-web-only-assets',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!ANDROID) return;
      // The camera pack (models/pose) stays only in the owner's sideload build (VITE_CAMERA_BUNDLED=1), never in a default one.
      const camera = process.env.VITE_CAMERA_BUNDLED === '1' ? [] : ['models/pose'];
      // The 2048 px hero plates are web-only (the 1280 px ones serve phones); the baked venue's packs are not in public/ at all (see venue.ts).
      // The shell follows the web stage's evening light, so no code uses the day plate (Unity's light): it does not ship either.
      const venue = ['practice/venue/wide', 'practice/venue/hero-day-1280.webp'];
      for (const rel of ['og', 'unity', ...camera, ...venue]) rmSync(resolve(outDir, rel), { recursive: true, force: true });
    },
  };
}
const now = new Date();
/**
 * The identity stamped into the bundle (__BUILD_ID__) and checked against the Unity player: BUILD_ID from the
 * environment (CI sets the commit), otherwise scripts/build-id.sh, which prints the short commit plus a fingerprint of
 * any uncommitted changes and needs a git checkout.
 */
function repositoryBuildId(): string {
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  try {
    return execFileSync('bash', [fileURLToPath(new URL('./scripts/build-id.sh', import.meta.url))], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    throw new Error(
      'Cannot derive the build ID with scripts/build-id.sh (it needs a git checkout). Set BUILD_ID instead, for ' +
        'example BUILD_ID=$(git rev-parse --short HEAD), or any 7 to 40 hex digits.',
      { cause: error },
    );
  }
}
const buildId = repositoryBuildId();
if (!/^[0-9a-f]{7,40}(?:\+[0-9a-f]{12})?$/.test(buildId)) {
  throw new Error(`Invalid repository build ID: ${buildId}`);
}

/**
 * A Unity-default web bundle must never silently publish an old player. The
 * verifier binds the manifest, every runtime artifact and the complete Unity
 * source tree to the same repository build identity. Vitest is excluded
 * because its bridge tests provide isolated manifests and never launch Vite's
 * player.
 */
function verifiedUnityWebGl(): Plugin {
  const verify = () => {
    execFileSync(process.execPath, [
      fileURLToPath(new URL('./scripts/verify-unity-webgl.mjs', import.meta.url)),
      '--root',
      fileURLToPath(new URL('./public/unity', import.meta.url)),
      '--expected-build-id',
      buildId,
    ], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      stdio: 'inherit',
    });
  };
  return {
    name: 'vande:verified-unity-webgl',
    apply: () => UNITY_PRACTICE_WEB,
    configResolved(config) {
      if (config.command === 'serve' && config.mode !== 'test') verify();
    },
    buildStart() {
      verify();
    },
  };
}

/**
 * Preloads the Latin subset of the primary typeface so the first text paint uses Manrope instead of swapping in later.
 * The hashed file name is only known at bundle time, so the tag is injected from the output bundle.
 */
function preloadPrimaryFont(): Plugin {
  return {
    name: 'vande:preload-primary-font',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return [];
        const fileName = Object.keys(bundle).find((f) => /manrope-latin-wght-normal-[\w-]+\.woff2$/.test(f));
        if (!fileName) return [];
        return [
          {
            tag: 'link',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: true, href: `${base}${fileName}` },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

/**
 * Strict Content-Security-Policy for production builds (meta tag; hosting headers can tighten it further).
 * Scripts only from the app itself (plus WebAssembly for compressed 3D asset decoders); network access only to the
 * configured API, analytics and identity origins. Not applied in dev, where Vite injects inline HMR scripts.
 */
function contentSecurityPolicy(): Plugin {
  let env: Record<string, string> = {};
  const origin = (u: string | undefined) => {
    try {
      return u ? new URL(u).origin : '';
    } catch {
      return '';
    }
  };
  return {
    name: 'vande:csp',
    apply: 'build',
    configResolved(config) {
      env = config.env as Record<string, string>;
    },
    transformIndexHtml: {
      order: 'pre',
      handler() {
        const api = env.VITE_API_URL ? origin(env.VITE_API_URL) : env.VITE_API_LOCAL === '1' ? 'http://127.0.0.1:8787' : '';
        const posthog = env.VITE_ANALYTICS_PROVIDER === 'posthog' ? origin(env.VITE_POSTHOG_HOST) : '';
        const google = env.VITE_GOOGLE_CLIENT_ID ? 'https://accounts.google.com' : '';
        const camera = origin(env.VITE_CAMERA_MODEL_BASE_URL);
        const connect = ["'self'", api, posthog, google, camera].filter(Boolean).join(' ');
        const policy = [
          "default-src 'self'",
          `script-src 'self' 'wasm-unsafe-eval'${google ? ` ${google}` : ''}`,
          "worker-src 'self' blob:",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "media-src 'self' data: blob:",
          "font-src 'self' data:",
          `connect-src ${connect}`,
          `frame-src ${google || "'none'"}`,
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ');
        return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
      },
    },
  };
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_DATE__: JSON.stringify(now.toISOString()),
    __UNITY_PRACTICE_ENABLED__: JSON.stringify(UNITY_PRACTICE),
    __UNITY_PRACTICE_WEB_ENABLED__: JSON.stringify(UNITY_PRACTICE_WEB),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    verifiedUnityWebGl(),
    preloadPrimaryFont(),
    contentSecurityPolicy(),
    legalPlaceholders(),
    dropWebOnlyAssets(),
    cameraPack({ android: ANDROID }),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg', 'og/*.png'],
      manifest: {
        id: 'vande-cricket',
        name: 'VANDE Cricket',
        short_name: 'VANDE Cricket',
        description: 'Lock your over. Reveal the rivalry. One-over cricket duels with friends, sealed until the reveal.',
        lang: 'en',
        dir: 'ltr',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        background_color: '#06051f',
        theme_color: '#06051f',
        categories: ['games', 'sports'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Daily Six', short_name: 'Daily Six', url: `${base}daily`, description: "Bat against today's sealed over" },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest,mp3}'],
        globIgnores: ['admin.html', 'render.html', 'assets/admin-*', 'assets/render-*', 'og/**', 'unity/**', 'models/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: pageInputs },
    // Keep every font as a separate cacheable file; inlining small subsets would bloat the render-blocking CSS.
    assetsInlineLimit: (filePath) => (/\.(woff2?|ttf|otf)$/i.test(filePath) ? false : undefined),
  },
  server: { port: 5173, strictPort: false },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    // Simulation sweeps and audio mastering take seconds here and several times longer on shared CI runners.
    testTimeout: 30_000,
    include: ['tests/unit/**/*.test.{ts,tsx}', 'backend/test/**/*.test.ts'],
    css: false,
    restoreMocks: true,
  },
});
