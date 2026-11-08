#!/usr/bin/env node
/**
 * Placeholder takes for every contact sound that has no recording yet: original synthesis (lib/synth.mjs, impact and
 * modal synthesis, no samples), three seeded takes per sound, processed exactly like a recording would be:
 *   trimmed to the onset with the runtime's 3 ms pre-roll (0.1 × peak, src/audio/takes.ts), cut on its decay,
 *   levelled to the live synthesised voice it stands in for (render-synth.mjs's measurement of bank.ts's sprite; −21
 *   LUFS, the shipped applause level, where no measurement exists), sample peak ≤ 0.95 after decoding, and encoded
 *   with the shipped applause takes' MP3 settings (measured from public/audio/cricket/applause-*.mp3).
 *
 *   node scripts/audio/placeholders.mjs                 stage into a temporary folder and print the summary
 *   node scripts/audio/placeholders.mjs --write         write public/audio/cricket/ph-*.mp3, the Unity copies (+ .meta),
 *                                                       both manifests' generated blocks and the processed record
 *   options: --out <dir>  --takes <n> (default 3)  --levels <synth-levels.json>  --root <repo>
 *            --drop <sound,…>   no placeholders for these sounds (their live synthesised voice plays again)
 *
 * Sounds that already have recordings are never touched. Same inputs, same bytes: no clock or random source is read.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endOnDecay, trimToOnset } from './lib/dsp.mjs';
import { PATHS, PLACEHOLDER_HONEST, loadManifest, proposeManifests, unityMeta, writeManifests } from './lib/manifest.mjs';
import { measureReference, toolVersions } from './lib/media.mjs';
import { finishTake } from './lib/pipeline.mjs';
import { RECIPES, renderTake } from './lib/synth.mjs';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const SOUND_DIR = 'release/product-sequence/stage-1-practice/wedge/sound';
export const LEVELS = `${SOUND_DIR}/placeholders/synth-levels.json`;
export const PROCESSED = `${SOUND_DIR}/placeholders/processed.json`;
export const FALLBACK_LUFS = -21;
export const TAKES = 3;

export const placeholderFile = (key, n) => `ph-${key}-${n}.mp3`;
export const isPlaceholderFile = (f) => /^ph-[a-z_]+-\d+\.mp3$/.test(f);

/**
 * Register ids: TC-<inventory, 2 digits>-P<nn>, numbered through each inventory kind's contact sounds in manifest
 * order, counting every contact sound (recorded or not), so a sound's ids never move when another is swapped out.
 */
export function placeholderRegisters(kinds, keys, takes) {
  const next = new Map();
  const out = {};
  for (const k of kinds) {
    if (k.align !== 'onset') continue;
    const ids = [];
    for (let n = 1; n <= takes; n++) {
      const c = (next.get(k.inventory) ?? 0) + 1;
      next.set(k.inventory, c);
      ids.push(`TC-${String(k.inventory).padStart(2, '0')}-P${String(c).padStart(2, '0')}`);
    }
    if (keys.includes(k.key)) out[k.key] = ids;
  }
  return out;
}

export async function generate({ root = ROOT, out, takes = TAKES, levelsFile = join(root, LEVELS), write = false, drop = [], log = () => {} } = {}) {
  const ref = measureReference(join(root, PATHS.publicDir));
  const { kinds, contactKeys, sets } = await loadManifest(root);
  const levels = existsSync(levelsFile) ? JSON.parse(readFileSync(levelsFile, 'utf8')) : null;
  const unknown = drop.filter((k) => !contactKeys.includes(k));
  if (unknown.length) throw new Error(`--drop: ${unknown.join(', ')} is not a contact sound (${contactKeys.join(', ')})`);
  const dropped = contactKeys.filter((k) => drop.includes(k) && sets[k]?.placeholder);
  const keys = contactKeys.filter((k) => (!sets[k] || sets[k].placeholder) && !drop.includes(k));
  const missing = keys.filter((k) => !RECIPES[k]);
  if (missing.length) throw new Error(`no placeholder recipe for ${missing.join(', ')}: add one to scripts/audio/lib/synth.mjs`);
  const registers = placeholderRegisters(kinds, keys, takes);
  const stage = out ?? join(process.env.VANDE_SOUNDKIT_TMP || tmpdir(), 'vande-placeholders');
  mkdirSync(stage, { recursive: true });
  const sr = ref.sampleRate;
  const record = [];
  const next = { ...sets };
  for (const k of dropped) delete next[k];
  for (const key of keys) {
    const target = levels?.voices?.[key]?.hit_lufs ?? FALLBACK_LUFS;
    const list = [];
    for (let n = 1; n <= takes; n++) {
      const raw = renderTake(key, n, sr);
      const { seg } = trimToOnset(raw, sr);
      const shaped = endOnDecay(seg, sr);
      const file = placeholderFile(key, n);
      const m = finishTake(shaped, sr, { targetLufs: target, outFile: join(stage, file), reference: ref });
      if (m.problems.length) throw new Error(`${file}: ${m.problems.join('; ')}`);
      list.push({ id: file.replace(/\.mp3$/, ''), file, bytes: m.bytes, sha256: m.sha256, register: registers[key][n - 1], lufs: m.lufs, peakDbfs: m.peakDbfs, durationMs: m.durationMs });
      record.push({ key, take: n, file, register: registers[key][n - 1], seed: `vande-placeholder|${key}|${n}`, level_source: levels?.voices?.[key] ? 'live synthesised voice (synth-levels.json hit_lufs)' : 'fallback −21 LUFS', ...m, problems: undefined });
      log(`${file.padEnd(26)} ${String(m.durationMs).padStart(4)} ms  hit ${m.hitLufs} LUFS (target ${m.targetLufs}${m.limitedByPeak ? ', peak-limited' : ''})  peak ${m.peakDbfs} dBFS  onset ${m.onsetMs} ms  ${m.bytes} B`);
    }
    next[key] = { placeholder: true, honest: PLACEHOLDER_HONEST, takes: list };
  }
  const processed = {
    what: 'Placeholder takes: original synthesis (scripts/audio/lib/synth.mjs), processed by scripts/audio/placeholders.mjs. Not recordings.',
    tools: toolVersions(),
    reference: { codec: ref.codec, sampleRate: ref.sampleRate, channels: ref.channels, vbr: ref.vbr, id3: ref.id3, encoder: ref.encoder, lufs: Math.round(ref.lufs * 100) / 100, files: ref.files.map((f) => f.file) },
    levels: levels ? { file: LEVELS, measured_utc: levels.measured_utc, chromium: levels.chromium } : 'none: every take at the −21 LUFS fallback',
    rules: { onset: '0.1 × peak (src/audio/takes.ts)', preroll_ms: 3, peak_cap: 0.95, level: 'hit loudness (loudest BS.1770 400 ms block, zero-padded) = the live voice’s', encoder: 'libmp3lame -q:a 4, mono, 48 kHz, Xing, no ID3' },
    takes: record,
    total_bytes: record.reduce((s, r) => s + r.bytes, 0),
    decoded_bytes_float32: record.reduce((s, r) => s + r.decodedSamples * 4, 0),
  };
  const result = { stage, keys, dropped, sets: next, processed, contactKeys };
  if (write) applyPlaceholders(root, result);
  else result.proposal = proposeManifests(root, next, contactKeys);
  return result;
}

/** Writes the generated files into the repository: web and Unity copies, both manifests, the processed record. */
export function applyPlaceholders(root, { stage, keys, dropped = [], sets, processed, contactKeys }) {
  const web = join(root, PATHS.publicDir);
  const unity = join(root, PATHS.unityDir);
  const keep = new Set(keys.flatMap((k) => sets[k].takes.map((t) => t.file)));
  for (const dir of [web, unity]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const base = f.replace(/\.meta$/, '');
      if (isPlaceholderFile(base) && [...keys, ...dropped].some((k) => base.startsWith(`ph-${k}-`)) && !keep.has(base)) rmSync(join(dir, f));
    }
  }
  for (const f of keep) {
    copyFileSync(join(stage, f), join(web, f));
    if (existsSync(unity)) {
      copyFileSync(join(stage, f), join(unity, f));
      writeFileSync(join(unity, `${f}.meta`), unityMeta(f));
    }
  }
  writeManifests(root, sets, contactKeys);
  mkdirSync(join(root, SOUND_DIR, 'placeholders'), { recursive: true });
  writeFileSync(join(root, PROCESSED), `${JSON.stringify(processed, null, 1)}\n`);
  const reg = join(root, SOUND_DIR, 'REGISTER.md');
  if (existsSync(reg)) writeFileSync(reg, withPlaceholderRows(readFileSync(reg, 'utf8'), processed.takes));
}

export const PH_BEGIN = '<!-- generated:placeholder-takes -->';
export const PH_END = '<!-- /generated:placeholder-takes -->';

/** REGISTER.md §8: one row per placeholder take, between markers (written by --write, trimmed by the ingest swap). */
export function withPlaceholderRows(text, rows) {
  const lines = [
    PH_BEGIN,
    '| Register | File | Sound | Source | Licence | Bytes | SHA-256 | Duration ms | Hit LUFS (target) | Peak dBFS | Onset ms |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.register} | \`${r.file}\` | ${r.key} | original synthesis, \`scripts/audio/lib/synth.mjs\`, seed \`${r.seed.replace(/\|/g, '\\|')}\` | VANDE original (no third-party material) | ${r.bytes} | \`${r.sha256}\` | ${r.durationMs} | ${r.hitLufs} (${r.targetLufs}) | ${r.peakDbfs} | ${r.onsetMs} |`),
    PH_END,
  ].join('\n');
  if (text.includes(PH_BEGIN) && text.includes(PH_END)) return text.slice(0, text.indexOf(PH_BEGIN)) + lines + text.slice(text.indexOf(PH_END) + PH_END.length);
  return `${text.trimEnd()}\n\n## 8. Placeholder takes (original synthesis, not recordings)\n\nWritten by \`scripts/audio/placeholders.mjs --write\`. These are VANDE's own synthesis: no recording, sample or third-party material, so no licence row is needed; they are listed so every shipped file has a register row. Each is replaced by \`scripts/audio/ingest-recordings.mjs --apply\` once its sound has recordings.\n\n${lines}\n`;
}

async function main() {
  const a = process.argv.slice(2);
  const opt = (k) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const root = opt('--root') ? resolve(opt('--root')) : ROOT;
  const drop = (opt('--drop') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const r = await generate({ root, out: opt('--out'), takes: Number(opt('--takes') || TAKES), levelsFile: opt('--levels') ? resolve(opt('--levels')) : join(root, LEVELS), write: a.includes('--write'), drop, log: (s) => console.log(s) });
  if (r.dropped.length) console.log(`No placeholders for: ${r.dropped.join(', ')} (their live synthesised voices play).`);
  console.log(`\n${r.keys.length} sounds × ${r.processed.takes.length / Math.max(1, r.keys.length)} placeholder takes, ${r.processed.total_bytes} bytes (decoded about ${r.processed.decoded_bytes_float32} bytes as float32).`);
  if (a.includes('--write')) console.log('Written: public/audio/cricket/ph-*.mp3, the Unity copies, both manifests and the processed record.');
  else {
    writeFileSync(join(r.stage, 'recordedManifest.patch'), r.proposal.tsPatch);
    writeFileSync(join(r.stage, 'ProductionRecordedManifest.patch'), r.proposal.csPatch);
    console.log(`Staged in ${r.stage} (nothing in the repository changed). Run with --write to apply.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(String(e?.stack || e));
    process.exit(1);
  });
}
