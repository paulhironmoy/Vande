#!/usr/bin/env node
/**
 * The owner's blind A/B for the placeholders: for each contact sound, one clip of its three placeholder takes and one
 * clip of the live synthesised voice (bank.ts's sprite render, three times, as every ball plays it), at the same
 * level, padded to the same length and encoded at the same constant bitrate (so no file's size or length tells), sides
 * X and Y assigned by a fixed seed, the key in a separate file, and a small listening page.
 *
 *   node scripts/audio/placeholder-ab.mjs --synth <dir of synth-<id>.wav from render-synth.mjs> [--out <dir>]
 *   … --recorded   the same kit for the sounds that now ship recordings (WA9: recordings against the synthesis)
 *
 * No agent may rate these clips or predict a rating: only the owner's ratings count (WA9 stays PROVISIONAL).
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnv1a32, hitLoudness, rng, round } from './lib/dsp.mjs';
import { FFMPEG, decodeMono, sha256, writeWav } from './lib/media.mjs';
import { PATHS, loadManifest } from './lib/manifest.mjs';
import { spawnSync } from 'node:child_process';
import { ROOT, SOUND_DIR } from './placeholders.mjs';

const SR = 48000;
const GAP_S = 0.6;
const CLIP_S = 2.4;

function clipOf(parts) {
  const x = new Float32Array(Math.round(CLIP_S * SR));
  parts.forEach((p, i) => {
    const at = Math.round((0.15 + i * GAP_S) * SR);
    for (let k = 0; k < p.length && at + k < x.length; k++) x[at + k] += p[k];
  });
  return x;
}

function encodeCbr(x, file) {
  const tmp = `${file}.wav`;
  writeWav(tmp, x, SR, { float: true });
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', String(SR), '-ac', '1', '-map_metadata', '-1', '-id3v2_version', '0', file]);
  rmSync(tmp, { force: true });
  if (r.status !== 0) throw new Error(String(r.stderr));
}

export async function buildKit({ synthDir, recorded = false, out = join(ROOT, SOUND_DIR, 'ab-kit', recorded ? 'contacts-recorded' : 'placeholders') }) {
  const { sets, contactKeys } = await loadManifest(ROOT);
  const keys = contactKeys.filter((k) => sets[k] && sets[k].placeholder === !recorded);
  if (!keys.length) throw new Error(recorded ? 'no contact sound ships recordings yet' : 'no placeholders ship');
  const side = recorded ? 'recorded' : 'placeholder';
  const r = rng(fnv1a32(recorded ? 'vande-ab-contacts-recorded' : 'vande-ab-placeholders-20261103'));
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(out)) if (/^pair-\d+-[XY]\.mp3$/.test(f)) rmSync(join(out, f));
  const key = { seed: recorded ? 'vande-ab-contacts-recorded' : 'vande-ab-placeholders-20261103', clip_s: CLIP_S, gap_s: GAP_S, pairs: [] };
  const pairs = [];
  keys.forEach((sound, i) => {
    const ph = sets[sound].takes.map((t) => decodeMono(join(ROOT, PATHS.publicDir, t.file), SR));
    const synth = decodeMono(join(synthDir, `synth-${sound}.wav`), SR);
    const clips = { [side]: clipOf(ph.slice(0, 3)), synthesised: clipOf([synth, synth, synth]) };
    // Matched in level, so neither side wins by being louder (the takes already match the voice within 0.5 LU).
    const g = 10 ** ((hitLoudness(clips.synthesised, SR) - hitLoudness(clips[side], SR)) / 20);
    clips[side] = clips[side].map((v) => v * g);
    const sides = r() < 0.5 ? [side, 'synthesised'] : ['synthesised', side];
    const pair = `pair-${String(i + 1).padStart(2, '0')}`;
    const entry = { pair, sound, X: sides[0], Y: sides[1], [`${side}_takes`]: sets[sound].takes.slice(0, 3).map((t) => t.file) };
    const fileOf = (which) => join(out, `${pair}-${sides[0] === which ? 'X' : 'Y'}.mp3`);
    const level = (which) => hitLoudness(decodeMono(fileOf(which), SR), SR);
    encodeCbr(clips.synthesised, fileOf('synthesised'));
    encodeCbr(clips[side], fileOf(side));
    // Matched again after encoding: the encoder's low-pass takes more from a brighter voice.
    for (let pass = 0; pass < 3; pass++) {
      const gap = level('synthesised') - level(side);
      if (Math.abs(gap) <= 0.1) break;
      clips[side] = clips[side].map((v) => v * 10 ** (gap / 20));
      encodeCbr(clips[side], fileOf(side));
    }
    for (const [label, which] of [['X', sides[0]], ['Y', sides[1]]]) {
      const file = fileOf(which);
      entry[`${label}_hit_lufs`] = round(level(which));
      entry[`${label}_bytes`] = readFileSync(file).length;
      entry[`${label}_sha256`] = sha256(readFileSync(file));
    }
    key.pairs.push(entry);
    pairs.push({ pair, sound });
  });
  // The playing order is shuffled too, with the same seed.
  const order = pairs.map((p) => p.pair);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  writeFileSync(join(out, 'KEY-open-only-after-rating.json'), `${JSON.stringify(key, null, 1)}\n`);
  writeFileSync(join(out, 'PLAYLIST.json'), `${JSON.stringify({ play_order: order, files: order.flatMap((p) => [`${p}-X.mp3`, `${p}-Y.mp3`]) }, null, 1)}\n`);
  writeFileSync(join(out, 'index.html'), page(order));
  return { out, key, order };
}

function page(order) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Placeholder listening test</title>
<style>
:root { --bg: #f7f6f2; --fg: #1d1c1a; --muted: #5d5a54; --card: #ffffff; --line: #d9d5cc; --accent: #1f5f8b; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #151514; --fg: #ecebe7; --muted: #a9a59c; --card: #1f1f1d; --line: #3a3934; --accent: #7fb6dc; } }
:root[data-theme="dark"] { --bg: #151514; --fg: #ecebe7; --muted: #a9a59c; --card: #1f1f1d; --line: #3a3934; --accent: #7fb6dc; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 1.5rem; margin: 0 0 8px; }
p { color: var(--muted); margin: 0 0 12px; }
.pair { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
.pair h2 { font-size: 1rem; margin: 0 0 10px; }
.row { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; margin: 6px 0; }
button { font: inherit; padding: 8px 16px; border-radius: 8px; border: 1px solid var(--accent); background: transparent; color: var(--accent); cursor: pointer; min-height: 44px; }
button:focus-visible, input:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
label { white-space: nowrap; }
textarea { width: 100%; min-height: 160px; font: 13px/1.4 ui-monospace, monospace; background: var(--card); color: var(--fg); border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
</style>
</head>
<body>
<main>
<h1>Placeholder listening test</h1>
<p>Each pair has two clips, X and Y. One is a placeholder take, the other is the game's current sound; you are not told which. Play each clip (more than once if you like), at your usual game volume on the phone speaker, then on headphones.</p>
<p>For each clip, rate how much it <strong>sounds like cricket</strong>, from 1 (not at all) to 5 (exactly). Then pick the one you prefer. Do not open the key file until you are done.</p>
<div id="pairs"></div>
<div class="pair"><h2>Your answers</h2><p>Press the button, then paste the text into RATINGS-placeholders.md (or send it to the lead).</p><div class="row"><button id="copy" type="button">Show my answers</button></div><textarea id="out" readonly aria-label="Your answers"></textarea></div>
</main>
<script>
const ORDER = ${JSON.stringify(order)};
const STORE = 'vande-placeholder-ab';
let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { saved = {}; }
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (e) {} };
const box = document.getElementById('pairs');
ORDER.forEach((pair, n) => {
  const d = document.createElement('section');
  d.className = 'pair';
  d.innerHTML = '<h2>' + (n + 1) + ' of ' + ORDER.length + ' (' + pair + ')</h2>';
  ['X', 'Y'].forEach((side) => {
    const row = document.createElement('div');
    row.className = 'row';
    const a = new Audio(pair + '-' + side + '.mp3');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Play ' + side;
    b.onclick = () => { a.currentTime = 0; a.play(); };
    row.appendChild(b);
    for (let v = 1; v <= 5; v++) {
      const l = document.createElement('label');
      const i = document.createElement('input');
      i.type = 'radio'; i.name = pair + side; i.value = v;
      i.checked = saved[pair + side] === v;
      i.onchange = () => { saved[pair + side] = v; save(); };
      l.append(i, ' ' + v);
      row.appendChild(l);
    }
    d.appendChild(row);
  });
  const pref = document.createElement('div');
  pref.className = 'row';
  pref.append('Prefer: ');
  ['X', 'Y', 'none'].forEach((v) => {
    const l = document.createElement('label');
    const i = document.createElement('input');
    i.type = 'radio'; i.name = pair + 'pref'; i.value = v;
    i.checked = saved[pair + 'pref'] === v;
    i.onchange = () => { saved[pair + 'pref'] = v; save(); };
    l.append(i, ' ' + v);
    pref.appendChild(l);
  });
  d.appendChild(pref);
  box.appendChild(d);
});
document.getElementById('copy').onclick = () => {
  const lines = ['| Pair | X (1-5) | Y (1-5) | Prefer |', '| --- | --- | --- | --- |'];
  ORDER.forEach((p) => lines.push('| ' + p + ' | ' + (saved[p + 'X'] || '') + ' | ' + (saved[p + 'Y'] || '') + ' | ' + (saved[p + 'pref'] || '') + ' |'));
  document.getElementById('out').value = lines.join('\\n');
};
</script>
</body>
</html>
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  let synthDir = opt('--synth');
  if (!synthDir) {
    const { renderSynth } = await import('./render-synth.mjs');
    synthDir = join(process.env.VANDE_SOUNDKIT_TMP || tmpdir(), 'vande-ab-synth');
    mkdirSync(synthDir, { recursive: true });
    const rendered = await renderSynth();
    for (const [id, v] of Object.entries(rendered.voices)) writeWav(join(synthDir, `synth-${id}.wav`), v.data, rendered.rate, { float: true });
  }
  const k = await buildKit({ synthDir: resolve(synthDir), recorded: a.includes('--recorded'), out: opt('--out') ? resolve(opt('--out')) : undefined });
  console.log(`${k.key.pairs.length} pairs in ${k.out}; key in KEY-open-only-after-rating.json (do not open before rating).`);
}
