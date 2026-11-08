#!/usr/bin/env node
/**
 * Builds the camera pack (docs/PRACTICE_CAMERA_INPUT.md section 2): the pose engine and model a player downloads when, and
 * only when, they choose Camera. Three files, written to node_modules/.cache/vande-camera-pack/<id>/ and described by
 * `info.json` (baked into the app by scripts/camera/vite-plugin.mjs):
 *   engine.bin  the engine's WASM (module-worker variant, SIMD), gzip level 9
 *   worker.bin  one self-contained ES module: src/input/camera/pose.worker.ts with the MediaPipe JS and the Emscripten loader
 *               inlined, minified, gzip
 *   model.bin   pose_landmarker_lite.task as it is (it is a zip of float16 weights: gzip would save 14%)
 * Every input is pinned by size and sha256 here, so a changed package or model stops the build instead of shipping.
 *
 *   node scripts/camera/pack.mjs          prints the pack, its sizes and hashes
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PIN = {
  version: '0.10.35',
  /** sha256 of the files we use from @mediapipe/tasks-vision@0.10.35 and of the vendored model. */
  engineWasm: '617b8e0248dbd27e9d7ece4218004eae4cefb499196d1bb4fa0e3fef21708756',
  loaderJs: '1f1d6215324a1fe62f6742d49a3db911170987ca18ad8c1b75f1a1c82acf2b44',
  bundleMjs: '55d7ab624fbb70dcc5adc4ae6d7ea9cfcb569139d3dbfbf2b1deafcb966bc0fe',
  model: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const read = (p) => readFileSync(path.join(ROOT, p));

function pinned(label, buf, want) {
  const got = sha(buf);
  if (got !== want) throw new Error(`camera pack: ${label} is not the pinned file (sha256 ${got}, expected ${want})`);
  return buf;
}

/** The loader has a bundler-friendly `new URL(..., import.meta.url)` fallback that is never reached (the page passes bytes). */
function plainLoaderPlugin() {
  return {
    name: 'vande:camera-plain-loader',
    enforce: 'pre',
    // The loader imports node:module for its Node-only path; a worker never takes that path, so a stub replaces it.
    resolveId: (source) => (source === 'node:module' ? '\0vande-node-module-stub' : null),
    load: (id) => (id === '\0vande-node-module-stub' ? 'export const createRequire = () => { throw new Error("not available in a worker"); };' : null),
    transform(code, id) {
      if (!id.endsWith('vision_wasm_module_internal.js')) return null;
      const re = /new URL\("vision_wasm_module_raw_internal\.wasm", import\.meta\.url\)\.href/;
      if (!re.test(code)) throw new Error('camera pack: the engine loader changed shape (new URL fallback not found)');
      return { code: code.replace(re, '"vision_wasm_module_raw_internal.wasm"'), map: null };
    },
  };
}

async function bundleWorker() {
  const { build } = await import('vite');
  const out = await build({
    configFile: false,
    root: ROOT,
    logLevel: 'warn',
    resolve: { alias: { '@': path.join(ROOT, 'src') } },
    plugins: [plainLoaderPlugin()],
    build: {
      write: false,
      minify: true,
      target: 'es2022',
      sourcemap: false,
      lib: { entry: path.join(ROOT, 'src/input/camera/pose.worker.ts'), formats: ['es'], fileName: () => 'pose-worker.js' },
      rollupOptions: { output: { codeSplitting: false } },
    },
  });
  const chunks = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output).filter((o) => o.type === 'chunk');
  if (chunks.length !== 1) throw new Error(`camera pack: expected one worker chunk, got ${chunks.length}`);
  return Buffer.from(chunks[0].code, 'utf8');
}

/** Builds (or reads from the cache) the pack. Returns { info, dir, files } with the stored bytes of each file. */
export async function buildCameraPack({ cacheDir = path.join(ROOT, 'node_modules/.cache/vande-camera-pack') } = {}) {
  const pkg = JSON.parse(read('node_modules/@mediapipe/tasks-vision/package.json').toString('utf8'));
  if (pkg.version !== PIN.version) throw new Error(`camera pack: @mediapipe/tasks-vision is ${pkg.version}, the pack pins ${PIN.version}`);
  const wasm = pinned('engine WASM', read('node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm'), PIN.engineWasm);
  pinned('engine loader', read('node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js'), PIN.loaderJs);
  pinned('engine bundle', read('node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'), PIN.bundleMjs);
  const model = pinned('model', read('assets-src/camera/pose_landmarker_lite.task'), PIN.model);

  const sources = ['pose.worker.ts', 'host.ts', 'protocol.ts', 'types.ts'].map((f) => read(`src/input/camera/${f}`));
  const key = sha(Buffer.concat([Buffer.from(PIN.version), ...sources, Buffer.from('v1')])).slice(0, 16);
  const keyDir = path.join(cacheDir, `build-${key}`);
  const infoPath = path.join(keyDir, 'info.json');
  if (!existsSync(infoPath)) {
    const worker = await bundleWorker();
    const stored = {
      engine: { file: 'engine.bin', data: gzipSync(wasm, { level: 9 }), raw: wasm.length, gzip: true },
      worker: { file: 'worker.bin', data: gzipSync(worker, { level: 9 }), raw: worker.length, gzip: true },
      model: { file: 'model.bin', data: model, raw: model.length, gzip: false },
    };
    const files = Object.entries(stored).map(([name, f]) => ({ name, file: f.file, bytes: f.data.length, sha256: sha(f.data), rawBytes: f.raw, gzip: f.gzip }));
    const id = sha(Buffer.from(files.map((f) => f.sha256).join(''))).slice(0, 12);
    const info = { id, version: PIN.version, dir: `models/pose/${PIN.version}/`, files, totalBytes: files.reduce((n, f) => n + f.bytes, 0) };
    mkdirSync(keyDir, { recursive: true });
    for (const f of Object.values(stored)) writeFileSync(path.join(keyDir, f.file), f.data);
    writeFileSync(infoPath, `${JSON.stringify(info, null, 2)}\n`);
  }
  const info = JSON.parse(readFileSync(infoPath, 'utf8'));
  return { info, dir: keyDir, files: info.files.map((f) => ({ ...f, data: readFileSync(path.join(keyDir, f.file)) })) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const t0 = Date.now();
  const { info, dir } = await buildCameraPack();
  console.log(`camera pack ${info.id} (engine ${info.version}) in ${dir}  [${Date.now() - t0} ms]`);
  for (const f of info.files) console.log(`  ${f.file.padEnd(11)} ${String(f.bytes).padStart(9)} B  (unpacked ${String(f.rawBytes).padStart(9)} B)  sha256 ${f.sha256}`);
  console.log(`  total download ${info.totalBytes} B`);
}
