#!/usr/bin/env node
/**
 * Renders the game's live synthesised contact voices exactly as the game does (src/audio/bank.ts FX_SOURCES rendered
 * into one OfflineAudioContext at the sprite's own layout, with voices.ts makeNoise), in headless Chromium, and
 * measures each one. The placeholders are levelled to these measurements, and the owner's A/B kit uses the renders.
 *
 *   node scripts/audio/render-synth.mjs --out <dir for WAVs> [--levels <levels.json>] [--rate 48000]
 *
 * Free tools only: Vite (the project's bundler) and Playwright's Chromium (a devDependency). Run it as a heavy job.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findOnset, hitLoudness, integratedLufs, round, samplePeak, db } from './lib/dsp.mjs';
import { writeWav } from './lib/media.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export async function renderSynth({ rate = 48000, ids = null } = {}) {
  const { build } = await import('vite');
  const { chromium } = await import('playwright');
  const dir = join(process.env.VANDE_SOUNDKIT_TMP || tmpdir(), `vande-render-synth-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, 'entry.ts');
  writeFileSync(
    entry,
    `import { FX_SOURCES, fxLayout } from '@/audio/bank';
import { makeNoise } from '@/audio/voices';
(window as any).__render = async (sr: number, ids: string[] | null) => {
  const layout = fxLayout();
  const off = new OfflineAudioContext(1, Math.ceil(layout.seconds * sr), sr);
  const v = { ctx: off, out: off.destination, noise: makeNoise(off) };
  for (const [id, , render] of FX_SOURCES) render(v as never, layout.slots[id][0]);
  const buf = await off.startRendering();
  const d = buf.getChannelData(0);
  const out: Record<string, { at: number; len: number; data: number[] }> = {};
  for (const [id] of FX_SOURCES) {
    if (ids && !ids.includes(id)) continue;
    const [at, len] = layout.slots[id];
    const a = Math.round(at * sr);
    out[id] = { at, len, data: Array.from(d.subarray(a, a + Math.round(len * sr))) };
  }
  return out;
};
`,
  );
  const res = await build({
    configFile: false,
    logLevel: 'error',
    root: ROOT,
    resolve: { alias: { '@': join(ROOT, 'src') } },
    build: { write: false, minify: false, lib: { entry, formats: ['iife'], name: 'VandeSynth', fileName: () => 'synth.js' } },
  });
  const code = (Array.isArray(res) ? res[0] : res).output.find((o) => o.type === 'chunk').code;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: code });
    const raw = await page.evaluate(([sr, only]) => window.__render(sr, only), [rate, ids]);
    const version = browser.version();
    return { rate, chromium: version, voices: Object.fromEntries(Object.entries(raw).map(([id, v]) => [id, { ...v, data: Float32Array.from(v.data) }])) };
  } finally {
    await browser.close();
  }
}

/** The level, peak and onset of each rendered voice (at unit gain, as the sprite holds it). */
export function measureVoices(rendered) {
  const out = {};
  for (const [id, v] of Object.entries(rendered.voices)) {
    const x = v.data;
    out[id] = {
      slot_s: v.len,
      hit_lufs: round(hitLoudness(x, rendered.rate)),
      integrated_lufs: round(integratedLufs(x, rendered.rate)),
      peak_dbfs: round(db(samplePeak(x))),
      onset_ms: round((findOnset(x) / rendered.rate) * 1000),
    };
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : null;
  };
  const out = opt('--out');
  const rate = Number(opt('--rate') || 48000);
  const r = await renderSynth({ rate });
  if (out) {
    mkdirSync(out, { recursive: true });
    for (const [id, v] of Object.entries(r.voices)) writeWav(join(out, `synth-${id}.wav`), v.data, rate, { float: true });
  }
  const levels = { what: 'The game’s synthesised voices at unit gain, rendered as bank.ts renders its effects sprite (one OfflineAudioContext, its own layout), measured by scripts/audio/lib/dsp.mjs (hit_lufs: the loudest BS.1770 400 ms block of the slot, zero-padded).', method: 'scripts/audio/render-synth.mjs', rate, chromium: r.chromium, node: process.version, measured_utc: new Date().toISOString(), voices: measureVoices(r) };
  const lv = opt('--levels');
  if (lv) writeFileSync(lv, `${JSON.stringify(levels, null, 1)}\n`);
  else console.log(JSON.stringify(levels, null, 1));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
