/**
 * Vite plugin for the camera pack (scripts/camera/pack.mjs): bakes the pack description into the app (`__CAMERA_PACK__`,
 * `__CAMERA_BUNDLED__`, `__CAMERA_BASE_URL__`) and emits the pack's files under `models/pose/<version>/` for builds that
 * host them, never to the service worker's precache (vite.config.ts globIgnores) and never to a default Android build.
 *
 *   web build                       pack emitted, downloaded on demand from the app's own origin
 *   Android build, default          no pack, the Camera option is hidden (nothing dead-ends)
 *   Android + VITE_CAMERA_BUNDLED=1 the owner's sideload build: the pack is packaged in the app, no download
 *   VITE_CAMERA_MODEL_BASE_URL=...  a store build downloads from that origin; files are not emitted here
 *   tests (vitest)                  no pack: the unit tests inject their own
 */
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { buildCameraPack } from './pack.mjs';

export function cameraPack({ android = false, env = process.env } = {}) {
  const bundled = android && env.VITE_CAMERA_BUNDLED === '1';
  const remote = (env.VITE_CAMERA_MODEL_BASE_URL ?? '').trim();
  let built = null;
  let active = false;
  return {
    name: 'vande:camera-pack',
    async config(_config, { command }) {
      active = !env.VITEST && (!android || bundled || remote !== '');
      if (active) {
        try {
          built = await buildCameraPack();
        } catch (e) {
          // A missing or changed input must not break every unrelated build: Camera is simply not offered, loudly.
          console.warn(`\n[vande:camera-pack] the camera pack was NOT built, Camera will not be offered in this build: ${e.message}\n`);
          active = false;
          built = null;
        }
      }
      return {
        define: {
          __CAMERA_PACK__: JSON.stringify(active && built ? built.info : null),
          __CAMERA_BUNDLED__: JSON.stringify(bundled),
          __CAMERA_BASE_URL__: JSON.stringify(remote),
        },
        ...(command === 'build' ? {} : {}),
      };
    },
    configureServer(server) {
      if (!built) return;
      const prefix = `/${built.info.dir}`;
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        const i = url.indexOf(prefix);
        if (i < 0) return next();
        const file = path.join(built.dir, path.basename(url));
        if (!existsSync(file)) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      if (!built || remote !== '') return;
      for (const f of built.files) this.emitFile({ type: 'asset', fileName: `${built.info.dir}${f.file}`, source: f.data });
      this.emitFile({ type: 'asset', fileName: `${built.info.dir}MANIFEST.json`, source: `${JSON.stringify({ version: built.info.version, files: built.info.files.map((f) => ({ path: f.file, bytes: f.bytes, sha256: f.sha256 })) }, null, 2)}\n` });
    },
  };
}
