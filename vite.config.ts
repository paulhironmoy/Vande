/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import type { Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const base = process.env.BASE_PATH || '/';
/**
 * Pages: the game and the static privacy and account-deletion pages everywhere; the admin console and the highlight
 * render page only in web builds (never packaged into the Android app, never precached by the service worker).
 */
const ANDROID = process.env.VITE_BUILD_TARGET === 'android';
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

/** Android builds ship no web-only social card images (they exist for link previews on the web). */
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
      for (const rel of ['og']) rmSync(resolve(outDir, rel), { recursive: true, force: true });
    },
  };
}
const now = new Date();
const buildId =
  process.env.BUILD_ID ||
  `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}.${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}`;

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
        const connect = ["'self'", api, posthog, google].filter(Boolean).join(' ');
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
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    preloadPrimaryFont(),
    contentSecurityPolicy(),
    legalPlaceholders(),
    dropWebOnlyAssets(),
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
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        globIgnores: ['admin.html', 'render.html', 'assets/admin-*', 'assets/render-*', 'og/**'],
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
    include: ['tests/unit/**/*.test.{ts,tsx}', 'backend/test/**/*.test.ts'],
    css: false,
    restoreMocks: true,
  },
});
