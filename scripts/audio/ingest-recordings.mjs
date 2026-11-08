#!/usr/bin/env node
/**
 * The owner's one command: turns recordings and downloads in the inbox into game-ready takes.
 *
 *   node scripts/audio/ingest-recordings.mjs --init      make the inbox ($HOME/VANDE-sound-inbox) and a blank sources.csv
 *   node scripts/audio/ingest-recordings.mjs             check, cut, clean, level and stage everything (repo untouched)
 *   node scripts/audio/ingest-recordings.mjs --apply     (the lead) also swap each ready sound's placeholders for the
 *                                                        takes in one step: files, both manifests, the register
 *   options: --inbox <dir>  --out <dir> (default <inbox>/staged)  --root <repo>  --min-snr <dB, 30>  --levels <json>
 *
 * For every file: its line in sources.csv (or a JSON file) must pass the licence rules (lib/sidecar.mjs). Then:
 *   1. decode; check every channel for clipping; mix to mono; resample to the shipped takes' rate (measured);
 *   2. measure the noise floor; find each hit (recordings hold about ten, 2 s apart);
 *   3. trim each hit to its onset exactly as src/audio/takes.ts finds it (0.1 × peak), keeping the 3 ms pre-roll;
 *      end it on its decay, before any second knock;
 *   4. refuse clipped, noisy, too quiet or crowded hits, with the reason;
 *   5. keep the best 5 (at least 3) per sound; level each to the live synthesised voice it replaces (the placeholders'
 *      rule), peak ≤ 0.95; encode with the shipped settings; name them <sound>-<n>.mp3 in a stable order.
 * Nothing reads a clock or a random source while processing: the same inbox gives the same bytes.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, loadavg } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREROLL_MS, clipCheck, db, detectHits, fadeOut, findOnset, noiseFloor, round, rmsWindows, samplePeak, trimToOnset, undb } from './lib/dsp.mjs';
import { MAX_SECONDS, kindOf } from './lib/kinds.mjs';
import { PATHS, loadManifest, proposeManifests, unityMeta, writeManifests, unifiedDiff } from './lib/manifest.mjs';
import { decodeNative, measureReference, sha256, toMono, toolVersions } from './lib/media.mjs';
import { finishTake } from './lib/pipeline.mjs';
import { csvTemplate, readJsonSidecar, readSourcesCsv, validateEntry } from './lib/sidecar.mjs';
import { FALLBACK_LUFS, LEVELS, SOUND_DIR, isPlaceholderFile } from './placeholders.mjs';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DEFAULT_INBOX = join(homedir(), 'VANDE-sound-inbox');
export const MIN_TAKES = 3;
export const MAX_TAKES = 5;
export const MIN_SNR_DB = 30;
export const MIN_PEAK_DBFS = -45;
export const MIN_RATE = 32000;
const AUDIO = new Set(['.wav', '.flac', '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.aif', '.aiff', '.caf', '.3gp', '.amr', '.webm', '.mp4', '.mov', '.wma']);
const MARKER = '.vande-staged.json';
const REG_BEGIN = '<!-- generated:ingested-takes -->';
const REG_END = '<!-- /generated:ingested-takes -->';

function listAudio(dir, base = dir, out = []) {
  for (const f of readdirSync(dir).sort()) {
    if (f.startsWith('.')) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f !== 'staged') listAudio(p, base, out);
    } else if (AUDIO.has(extname(f).toLowerCase())) out.push(relative(base, p));
  }
  return out;
}

/** Every inbox file with its description, or the reasons it cannot be used. */
export function readInbox(inbox) {
  const files = listAudio(inbox);
  const problems = [];
  const entries = new Map();
  const csv = join(inbox, 'sources.csv');
  if (existsSync(csv)) {
    const r = readSourcesCsv(csv);
    problems.push(...r.problems.map((m) => ({ file: 'sources.csv', reason: m })));
    for (const e of r.entries) {
      if (!e.file) {
        problems.push({ file: e.where, reason: 'the file name is missing' });
        continue;
      }
      if (entries.has(e.file)) problems.push({ file: e.file, reason: `described twice (${entries.get(e.file).where} and ${e.where})` });
      else entries.set(e.file, e);
    }
  }
  for (const f of files) {
    const stem = f.slice(0, -extname(f).length);
    for (const j of [`${f}.json`, `${stem}.json`]) {
      const jp = join(inbox, j);
      if (!existsSync(jp)) continue;
      const r = readJsonSidecar(jp, f);
      problems.push(...r.problems.map((m) => ({ file: f, reason: m })));
      if (r.entry) {
        if (entries.has(f)) problems.push({ file: f, reason: `described twice (${entries.get(f).where} and ${j})` });
        else entries.set(f, r.entry);
      }
      break;
    }
  }
  const valid = [];
  const warnings = [];
  for (const f of files) if (!entries.has(f)) problems.push({ file: f, reason: 'no line in sources.csv (or JSON file) describes it' });
  for (const [f, e] of entries) {
    const v = validateEntry(e, { fileExists: files.includes(f) });
    if (!v.ok) for (const reason of v.problems) problems.push({ file: f, reason });
    else {
      valid.push(v.value);
      warnings.push(...v.warnings.map((w) => ({ file: f, note: w })));
    }
  }
  valid.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { files, valid, problems, warnings };
}

/** Where a hit ends: its decay, a second knock, the next hit or the sound's longest take, whichever comes first. */
export function hitEnd(x, sr, onset, { floor, maxS, limit = x.length }) {
  const frame = Math.max(1, Math.round(sr / 1000));
  const search = Math.min(limit, onset + Math.round(0.02 * sr));
  let pk = onset;
  for (let i = onset; i < search; i++) if (Math.abs(x[i]) > Math.abs(x[pk])) pk = i;
  const p = Math.abs(x[pk]);
  const stopAt = Math.min(limit, onset + Math.round(maxS * sr));
  const quietThr = Math.max(p * undb(-50), floor * 2);
  let below = 0;
  let quiet10 = 0;
  for (let f = Math.floor(pk / frame) + 1; f * frame < stopAt; f++) {
    let fp = 0;
    for (let i = f * frame; i < Math.min(stopAt, (f + 1) * frame); i++) fp = Math.max(fp, Math.abs(x[i]));
    if (quiet10 >= 10 && fp >= 0.3 * p) return { end: Math.max(onset + frame, f * frame - Math.round(0.002 * sr)), why: 'second knock' };
    quiet10 = fp < 0.1 * p ? quiet10 + 1 : 0;
    below = fp < quietThr ? below + 1 : 0;
    if (below >= 20) return { end: Math.min(stopAt, (f - 19) * frame + Math.round(0.005 * sr)), why: 'decay' };
  }
  return { end: stopAt, why: stopAt === limit ? 'next hit' : 'longest take' };
}

/** All usable hits of one described file, and the refused ones with reasons. */
export function analyseFile(path, desc, rate, { minSnr = MIN_SNR_DB } = {}) {
  const native = decodeNative(path);
  const out = { file: desc.file, candidates: [], refused: [], floorDbfs: null, nativeRate: native.sampleRate, channels: native.channels.length, codec: native.codec };
  if (native.sampleRate < MIN_RATE) {
    out.refused.push({ at: null, reason: `recorded at ${native.sampleRate} Hz, too low (at least ${MIN_RATE}): set the recorder to its best quality` });
    return out;
  }
  let x = toMono(native, rate);
  const from = desc.start !== null ? Math.round(desc.start * rate) : 0;
  const to = desc.end !== null ? Math.min(x.length, Math.round(desc.end * rate)) : x.length;
  x = x.subarray(from, to);
  const floor = noiseFloor(x, rate);
  out.floorDbfs = round(db(floor));
  const { hits } = detectHits(x, rate, { floor });
  const pre = Math.round((PREROLL_MS * rate) / 1000);
  const maxS = MAX_SECONDS[desc.sound] ?? 0.5;
  for (let h = 0; h < hits.length; h++) {
    const hit = hits[h];
    const onset = hit.start + findOnset(x.subarray(hit.start, hit.end));
    const atS = round((from + onset) / rate, 3);
    const refuse = (reason) => out.refused.push({ at: atS, reason });
    const limit = h + 1 < hits.length ? hits[h + 1].start - Math.round(0.005 * rate) : x.length;
    const { end } = hitEnd(x, rate, onset, { floor, maxS, limit });
    if (onset < pre) {
      refuse('starts at the very beginning of the file: nothing before it to check');
      continue;
    }
    if ((end - onset) / rate < 0.02) {
      refuse('too short to be a hit (under 20 ms)');
      continue;
    }
    const peak = samplePeak(x.subarray(onset, end));
    if (db(peak) < MIN_PEAK_DBFS) {
      refuse(`too quiet (${round(db(peak), 1)} dBFS): move the phone closer`);
      continue;
    }
    const scale = native.sampleRate / rate;
    const clip = clipCheck(native.channels, Math.floor((from + onset - pre) * scale) - Math.round(0.002 * native.sampleRate), Math.ceil((from + end) * scale) + Math.round(0.002 * native.sampleRate));
    if (clip) {
      refuse(`${clip}: too loud for the recorder; move the phone a little further away`);
      continue;
    }
    const preWin = x.subarray(Math.max(0, onset - pre - Math.round(0.05 * rate)), onset - pre);
    const preRms = preWin.length ? Math.sqrt(preWin.reduce((s, v) => s + v * v, 0) / preWin.length) : 0;
    if (preRms > floor * undb(10)) {
      refuse(`something else was sounding just before the hit (${round(db(preRms / floor), 1)} dB over the room's quiet)`);
      continue;
    }
    const peakRms = Math.max(...rmsWindows(x.subarray(onset, end), rate).values, 0);
    const snr = db(peakRms / floor);
    if (snr < minSnr) {
      refuse(`too noisy: the hit is only ${round(snr, 1)} dB above the background (needs ${minSnr}); record somewhere quieter`);
      continue;
    }
    const { seg, pre: k } = trimToOnset(x.subarray(onset - pre, end), rate);
    if (k !== pre) {
      refuse('the onset moved when trimmed (an internal check): please send this file to the lead');
      continue;
    }
    fadeOut(seg, rate, Math.min(15, ((end - onset) / rate) * 250));
    out.candidates.push({ file: desc.file, at: atS, snr: round(snr, 1), seg, desc });
  }
  if (!hits.length) out.refused.push({ at: null, reason: 'no hit found: check the file plays, and that the hits are louder than the room' });
  return out;
}

/** Per sound: real recordings before stand-ins (O-C2), the best MAX_TAKES by signal over noise, named in file order. */
export function selectTakes(candidates) {
  const bySound = new Map();
  for (const c of candidates) {
    if (!bySound.has(c.desc.sound)) bySound.set(c.desc.sound, []);
    bySound.get(c.desc.sound).push(c);
  }
  const chosen = {};
  const dropped = [];
  for (const [sound, list] of bySound) {
    const real = list.filter((c) => c.desc.source !== 'stand-in');
    let pool = list;
    if (real.length) {
      pool = real;
      for (const c of list) if (c.desc.source === 'stand-in') dropped.push({ file: c.file, at: c.at, reason: `not used: ${sound} has real recordings (stand-ins only stand in when nothing real exists, O-C2)` });
    }
    const order = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.at - b.at);
    const ranked = [...pool].sort((a, b) => b.snr - a.snr || order(a, b));
    const keep = ranked.slice(0, MAX_TAKES);
    for (const c of ranked.slice(MAX_TAKES)) dropped.push({ file: c.file, at: c.at, reason: `not needed: ${sound} already has its ${MAX_TAKES} cleanest hits` });
    chosen[sound] = keep.sort(order);
  }
  return { chosen, dropped };
}

/** Register ids TC-<kind>-<nn> after the highest in REGISTER.md; a take whose bytes are already registered keeps its id. */
export function allocateRegisters(registerText, takes) {
  const used = new Map();
  for (const m of registerText.matchAll(/TC-(\d{2})-(\d{2})\b/g)) used.set(m[1], Math.max(used.get(m[1]) ?? 0, Number(m[2])));
  const known = new Map();
  for (const line of registerText.split('\n')) {
    const id = /\b(TC-\d{2}-\d{2})\b/.exec(line);
    if (id) for (const sha of line.matchAll(/\b([0-9a-f]{64})\b/g)) known.set(sha[1], id[1]);
  }
  return takes.map((t) => {
    if (known.has(t.sha256)) return known.get(t.sha256);
    const k = String(t.kind).padStart(2, '0');
    const n = (used.get(k) ?? 0) + 1;
    used.set(k, n);
    return `TC-${k}-${String(n).padStart(2, '0')}`;
  });
}

const list = (a) => [...new Set(a)].join(', ');

/** What a sound's takes are, and are not, in the manifest's words. */
export function honestFor(takes) {
  const parts = [];
  const owner = takes.filter((t) => t.desc.source === 'owner');
  const fs = takes.filter((t) => t.desc.source === 'freesound');
  const si = takes.filter((t) => t.desc.source === 'stand-in');
  if (owner.length) parts.push(`Recorded by the VANDE owner (owner-made, phone recording, ${list(owner.map((t) => t.desc.date))})${owner.some((t) => t.desc.description) ? `: ${list(owner.map((t) => t.desc.description).filter(Boolean))}` : ''}. A staged recording, not from a match.`);
  if (fs.length) parts.push(`Licensed recording from Freesound (${list(fs.map((t) => t.desc.licence.replace(/-/g, ' ')))}) by ${list(fs.map((t) => t.desc.author))}: ${list(fs.map((t) => `"${t.desc.title}"`))}. Not recorded by VANDE.`);
  if (si.length) parts.push(`STAND-IN, not a cricket recording: a generic licensed impact (${list(si.map((t) => t.desc.licence))}; ${list(si.map((t) => `"${t.desc.title}" by ${t.desc.author}`))}), until a real cricket recording exists.`);
  return parts.join(' ');
}

function wrap(text, width = 112) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur ? `${cur} ${w}` : w).length > width && cur) {
      lines.push(cur);
      cur = `  ${w}`;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Third-party notice lines: every CC BY take (required), and CC0 and stand-in takes credited anyway. */
export function noticeLines(sets) {
  const lines = [];
  for (const [sound, s] of Object.entries(sets)) {
    for (const t of s.takes) {
      const d = t.desc;
      if (d.source === 'owner') continue;
      const lic = d.licence === 'CC0-1.0' ? 'CC0 1.0' : `licensed ${d.licence.replace('CC-BY-', 'CC BY ')} (${d.licenceUrl}). Changed`;
      lines.push(...wrap(`- ${t.file}${d.source === 'stand-in' ? ' (stand-in)' : ''}: "${d.title}" by ${d.author} (${d.url}), ${lic}.`));
    }
    void sound;
  }
  return lines;
}

/** The proposed change to scripts/generate-notices.mjs (the lead's file): the block, and the header's wording. */
export function noticesPatch(root, lines, anyOwner) {
  const file = join(root, 'scripts/generate-notices.mjs');
  if (!existsSync(file) || !lines.length) return { patch: '', text: '' };
  const before = readFileSync(file, 'utf8');
  const js = (s) => `line('${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}');`;
  const block = ['line();', js('VANDE Practice contact sounds (public/audio/cricket/): trimmed to the hit, loudness-levelled, mono, MP3-encoded:'), ...lines.map(js)];
  const anchor = "line('CC0 needs no attribution; the credit is given anyway.');";
  let after = before.includes(anchor) ? before.replace(anchor, () => `${block.join('\n')}\n${anchor}`) : before;
  // Matches both the original header and the placeholder header the lead applied on 2026-11-03.
  after = after.replace('except the licensed crowd recordings listed below.', `except the licensed recordings listed below${anyOwner ? " and VANDE\\'s own recordings" : ''}.`);
  return { patch: unifiedDiff(before, after, 'scripts/generate-notices.mjs'), text: lines.join('\n') };
}

function registerRows(sets) {
  const rows = ['| Register | File | Sound | Source file @ s | Source | Licence | Author | URL | Date | Source SHA-256 | Bytes | SHA-256 | Hit LUFS (target) | Peak dBFS | SNR dB |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const [sound, s] of Object.entries(sets)) {
    for (const t of s.takes) {
      const d = t.desc;
      rows.push(`| ${t.register} | \`${t.file}\` | ${sound} | ${d.file} @ ${t.at} | ${d.source}${d.label ? ' (stand-in)' : ''} | ${d.licence} | ${d.author} | ${d.url || 'owner-made (no URL)'} | ${d.date} | \`${t.sourceSha256}\` | ${t.bytes} | \`${t.sha256}\` | ${t.m.hitLufs} (${t.m.targetLufs}) | ${t.peakDbfs} | ${t.snr} |`);
    }
  }
  return rows;
}

function assetRow(sets) {
  const takes = Object.values(sets).flatMap((s) => s.takes);
  const bytes = takes.reduce((n, t) => n + t.bytes, 0);
  const decoded = takes.reduce((n, t) => n + t.m.decodedSamples * 4, 0);
  const sources = list(takes.map((t) => (t.desc.source === 'owner' ? 'owner-made' : `${t.desc.licence} (${t.desc.author})`)));
  return `| Recorded contact takes | ${Object.keys(sets).join(', ')}, in place of their placeholders (the synthesised voices stay the fallback) | \`public/audio/cricket/\` ${list(takes.map((t) => t.file))}; \`src/audio/recordedManifest.ts\` CONTACT_TAKES; wedge \`sound/REGISTER.md\` ${list(takes.map((t) => t.register))} | ${sources}. \`CANDIDATE\` | ${takes.length} takes, chosen from the delivery record | ${bytes} bytes on disk; about ${decoded} bytes decoded (float32, 48 kHz; not measured on a phone) | background fetches and decodes, never during a delivery; SHA-256 checked | Builder checks: onset at 3 ms ± 0.5, peak ≤ 0.95, levelled to the live voice. Owner blind A/B pending (WA9 PROVISIONAL). | Not verified |`;
}

/** The whole run. With `apply`, the ready sounds are swapped into the repository (files, manifests, register). */
export async function ingest({ inbox = DEFAULT_INBOX, out, root = ROOT, apply = false, minSnr = MIN_SNR_DB, levelsFile, log = () => {} } = {}) {
  const stage = out ?? join(inbox, 'staged');
  const ref = measureReference(join(root, PATHS.publicDir));
  const rate = ref.sampleRate;
  const { kinds, contactKeys, sets: current } = await loadManifest(root);
  const lf = levelsFile ?? join(root, LEVELS);
  const levels = existsSync(lf) ? JSON.parse(readFileSync(lf, 'utf8')) : null;
  const inboxRead = readInbox(inbox);
  const problems = [...inboxRead.problems];
  const refused = [];
  const candidates = [];
  const files = [];
  for (const desc of inboxRead.valid) {
    const path = join(inbox, desc.file);
    let a;
    try {
      a = analyseFile(path, desc, rate, { minSnr });
    } catch (e) {
      problems.push({ file: desc.file, reason: `cannot be read as audio (${String(e.message).slice(0, 160)})` });
      continue;
    }
    files.push({ file: desc.file, sha256: sha256(readFileSync(path)), nativeRate: a.nativeRate, channels: a.channels, codec: a.codec, floorDbfs: a.floorDbfs, hits: a.candidates.length + a.refused.filter((r) => r.at !== null).length, usable: a.candidates.length });
    for (const r of a.refused) refused.push({ file: desc.file, ...r });
    candidates.push(...a.candidates);
  }
  const { chosen, dropped } = selectTakes(candidates);
  // Never mix a stand-in over a recording already shipped.
  for (const sound of Object.keys(chosen)) {
    if (current[sound] && !current[sound].placeholder && chosen[sound].every((c) => c.desc.source === 'stand-in')) {
      for (const c of chosen[sound]) dropped.push({ file: c.file, at: c.at, reason: `not used: ${sound} already ships real recordings` });
      delete chosen[sound];
    }
  }
  if (existsSync(stage)) {
    const marker = join(stage, MARKER);
    if (!existsSync(marker) && readdirSync(stage).length) throw new Error(`${stage} is not empty and was not made by this tool: choose another --out`);
    if (existsSync(marker)) for (const f of JSON.parse(readFileSync(marker, 'utf8')).files ?? []) rmSync(join(stage, f), { force: true, recursive: true });
  }
  mkdirSync(join(stage, 'audio'), { recursive: true });
  mkdirSync(join(stage, 'held'), { recursive: true });
  const written = [];
  const ready = {};
  const held = {};
  const registerFile = join(root, SOUND_DIR, 'REGISTER.md');
  const registerText = existsSync(registerFile) ? readFileSync(registerFile, 'utf8') : '';
  for (const sound of contactKeys) {
    const list2 = chosen[sound];
    if (!list2?.length) continue;
    const enough = list2.length >= MIN_TAKES;
    const target = levels?.voices?.[sound]?.hit_lufs ?? FALLBACK_LUFS;
    const takes = [];
    for (let n = 1; n <= list2.length; n++) {
      const c = list2[n - 1];
      const file = `${sound}-${n}.mp3`;
      const rel = join(enough ? 'audio' : 'held', file);
      const m = finishTake(c.seg, rate, { targetLufs: target, outFile: join(stage, rel), reference: ref });
      written.push(rel);
      if (m.problems.length) {
        refused.push({ file: c.file, at: c.at, reason: `after encoding: ${m.problems.join('; ')}` });
        continue;
      }
      takes.push({ id: file.replace(/\.mp3$/, ''), file, bytes: m.bytes, sha256: m.sha256, lufs: m.lufs, peakDbfs: m.peakDbfs, durationMs: m.durationMs, kind: kindOf(sound), at: c.at, snr: c.snr, desc: c.desc, m, sourceSha256: files.find((f) => f.file === c.file)?.sha256 });
    }
    if (takes.length >= MIN_TAKES && enough) ready[sound] = takes;
    else held[sound] = takes;
  }
  const regs = allocateRegisters(registerText, Object.values(ready).flat());
  Object.values(ready).flat().forEach((t, i) => (t.register = regs[i]));
  const sets = {};
  for (const [sound, takes] of Object.entries(ready)) sets[sound] = { placeholder: false, honest: honestFor(takes), takes };
  const manifestSets = { ...current };
  for (const [sound, s] of Object.entries(sets)) manifestSets[sound] = { placeholder: false, honest: s.honest, takes: s.takes.map(({ id, file, bytes, sha256: h, register, lufs, peakDbfs, durationMs }) => ({ id, file, bytes, sha256: h, register, lufs, peakDbfs, durationMs })) };
  const proposal = proposeManifests(root, manifestSets, contactKeys);
  const lines = noticeLines(sets);
  const notices = noticesPatch(root, lines, Object.values(sets).some((s) => s.takes.some((t) => t.desc.source === 'owner')));
  const rows = registerRows(sets);
  const summary = {
    what: 'scripts/audio/ingest-recordings.mjs: staged takes from the owner inbox. Builder output, not a certification.',
    inbox,
    tools: toolVersions(),
    load_average: loadavg().map((v) => round(v, 2)),
    reference: { codec: ref.codec, sampleRate: ref.sampleRate, channels: ref.channels, vbr: ref.vbr, encoder: ref.encoder, lufs: round(ref.lufs) },
    levels: levels ? { file: LEVELS, measured_utc: levels.measured_utc } : `none: ${FALLBACK_LUFS} LUFS`,
    files,
    problems,
    warnings: inboxRead.warnings,
    refused,
    dropped,
    ready: Object.fromEntries(Object.entries(ready).map(([s, t]) => [s, t.map((x) => ({ file: x.file, register: x.register, source: x.desc.file, at: x.at, bytes: x.bytes, sha256: x.sha256, hitLufs: x.m.hitLufs, targetLufs: x.m.targetLufs, peakDbfs: x.peakDbfs, onsetMs: x.m.onsetMs, snr: x.snr }))])),
    held: Object.fromEntries(Object.entries(held).map(([s, t]) => [s, `${t.length} good take(s); needs ${MIN_TAKES}`])),
  };
  const md = summaryMarkdown(summary);
  const put = (rel, text) => {
    writeFileSync(join(stage, rel), text);
    written.push(rel);
  };
  put('SUMMARY.md', md);
  put('summary.json', `${JSON.stringify(summary, null, 1)}\n`);
  put('recordedManifest.patch', Object.keys(sets).length ? proposal.tsPatch : '');
  put('ProductionRecordedManifest.patch', Object.keys(sets).length ? proposal.csPatch : '');
  put('register-rows.md', `${rows.join('\n')}\n`);
  put('notices.patch', notices.patch);
  put('notices-lines.txt', `${notices.text}\n`);
  put('asset-register-row.md', Object.keys(sets).length ? `${assetRow(sets)}\n` : '');
  writeFileSync(join(stage, MARKER), `${JSON.stringify({ tool: 'scripts/audio/ingest-recordings.mjs', files: [...written, 'audio', 'held'] }, null, 1)}\n`);
  const result = { stage, summary, sets, manifestSets, contactKeys, proposal, problems, ready, held, refused, dropped, kinds };
  if (apply && Object.keys(sets).length) result.applied = applyTakes(root, stage, sets, manifestSets, contactKeys, rows);
  log(md);
  return result;
}

/** One step per sound: its recorded takes in, its placeholder (and any older) files out, both manifests, the register. */
export function applyTakes(root, stage, sets, manifestSets, order, rows) {
  const web = join(root, PATHS.publicDir);
  const unity = join(root, PATHS.unityDir);
  const removed = [];
  const added = [];
  for (const [sound, s] of Object.entries(sets)) {
    const keep = new Set(s.takes.map((t) => t.file));
    for (const dir of [web, unity]) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        const base = f.replace(/\.meta$/, '');
        const mine = (isPlaceholderFile(base) && base.startsWith(`ph-${sound}-`)) || new RegExp(`^${sound}-\\d+\\.mp3$`).test(base);
        if (mine && !keep.has(base)) {
          rmSync(join(dir, f));
          removed.push(relative(root, join(dir, f)));
        }
      }
    }
    for (const t of s.takes) {
      copyFileSync(join(stage, 'audio', t.file), join(web, t.file));
      added.push(relative(root, join(web, t.file)));
      if (existsSync(unity)) {
        copyFileSync(join(stage, 'audio', t.file), join(unity, t.file));
        writeFileSync(join(unity, `${t.file}.meta`), unityMeta(t.file));
        added.push(relative(root, join(unity, t.file)));
      }
    }
  }
  writeManifests(root, manifestSets, order);
  const reg = join(root, SOUND_DIR, 'REGISTER.md');
  if (existsSync(reg)) {
    let text = readFileSync(reg, 'utf8');
    // The generated section keeps every earlier ingest's rows, except those of the sounds replaced now.
    const soundOf = (row) => row.split('|')[3]?.trim();
    const [head, rule, ...fresh] = rows;
    let earlier = [];
    if (text.includes(REG_BEGIN) && text.includes(REG_END)) {
      const old = text.slice(text.indexOf(REG_BEGIN), text.indexOf(REG_END) + REG_END.length);
      earlier = old.split('\n').filter((l) => /^\| TC-/.test(l) && !(soundOf(l) in sets));
      text = text.replace(old, '\u0000');
    } else text = `${text.trimEnd()}\n\n## 9. Ingested contact takes (scripts/audio/ingest-recordings.mjs --apply)\n\nWritten by the tool on --apply. Each row is one shipped take; the source files stay in the owner's inbox, never in the repository.\n\n\u0000\n`;
    text = text.replace('\u0000', () => [REG_BEGIN, head, rule, ...earlier, ...fresh, REG_END].join('\n'));
    // The swapped sounds' placeholder rows (§8) go with their files.
    text = text
      .split('\n')
      .filter((l) => !(/^\| TC-\d{2}-P\d{2} \| `ph-/.test(l) && soundOf(l) in sets))
      .join('\n');
    writeFileSync(reg, text);
  }
  return { removed, added };
}

function summaryMarkdown(s) {
  const L = [];
  L.push('# Sound kit: what happened', '');
  const ready = Object.entries(s.ready);
  L.push(ready.length ? `**Ready for the game:** ${ready.map(([k, t]) => `${k} (${t.length} takes)`).join(', ')}.` : '**Nothing is ready yet.** Each sound needs at least 3 clean hits.', '');
  if (Object.keys(s.held).length) L.push(`**Not enough clean hits yet:** ${Object.entries(s.held).map(([k, v]) => `${k}: ${v}`).join('; ')}. Record a few more of these.`, '');
  if (s.problems.length) {
    L.push('## Files that could not be used (fix the line in sources.csv and run again)', '', '| File | Why |', '| --- | --- |');
    for (const p of s.problems) L.push(`| ${p.file} | ${p.reason} |`);
    L.push('');
  }
  if (s.warnings.length) {
    L.push('## Worth checking', '');
    for (const w of s.warnings) L.push(`- ${w.file}: ${w.note}`);
    L.push('');
  }
  if (ready.length) {
    L.push('## Takes', '', '| Take | Register | From | Clean (dB over the room) | Level LUFS (target) | Peak dBFS | Onset ms | Bytes |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const [, t] of ready) for (const x of t) L.push(`| ${x.file} | ${x.register} | ${x.source} @ ${x.at} s | ${x.snr} | ${x.hitLufs} (${x.targetLufs}) | ${x.peakDbfs} | ${x.onsetMs} | ${x.bytes} |`);
    L.push('');
  }
  if (s.refused.length) {
    L.push('## Hits left out, and why', '', '| File | At (s) | Why |', '| --- | --- | --- |');
    for (const r of s.refused) L.push(`| ${r.file} | ${r.at ?? ''} | ${r.reason} |`);
    L.push('');
  }
  if (s.dropped.length) {
    L.push('## Good hits not needed', '');
    for (const d of s.dropped) L.push(`- ${d.file} @ ${d.at} s: ${d.reason}`);
    L.push('');
  }
  L.push('## Files', '', '| File | Rate | Channels | Room quiet (dBFS) | Hits | Usable |', '| --- | --- | --- | --- | --- | --- |');
  for (const f of s.files) L.push(`| ${f.file} | ${f.nativeRate} | ${f.channels} | ${f.floorDbfs} | ${f.hits} | ${f.usable} |`);
  L.push('', `Tools: ${s.tools.ffmpeg}; Node ${s.tools.node}. Load average ${s.load_average.join(', ')}.`, '', 'Next: tell the lead the staged folder is ready. Nothing in the game has changed yet.');
  return `${L.join('\n')}\n`;
}

async function main() {
  const a = process.argv.slice(2);
  const opt = (k) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const inbox = resolve(opt('--inbox') ?? DEFAULT_INBOX);
  if (a.includes('--init')) {
    mkdirSync(inbox, { recursive: true });
    const csv = join(inbox, 'sources.csv');
    if (!existsSync(csv)) writeFileSync(csv, csvTemplate());
    writeFileSync(join(inbox, 'README.txt'), `Put your recordings and downloads here, describe each one in sources.csv, then run:\n  node scripts/audio/ingest-recordings.mjs\nfrom the VANDE folder. The guide: release/product-sequence/stage-1-practice/wedge/sound/OWNER-GUIDE.md\n`);
    console.log(`Ready: ${inbox}\nPut your files there and fill in ${csv}.`);
    return 0;
  }
  if (!existsSync(inbox)) {
    console.log(`There is no inbox at ${inbox} yet. Run: node scripts/audio/ingest-recordings.mjs --init`);
    return 1;
  }
  const r = await ingest({ inbox, out: opt('--out') ? resolve(opt('--out')) : undefined, root: opt('--root') ? resolve(opt('--root')) : ROOT, apply: a.includes('--apply'), minSnr: Number(opt('--min-snr') ?? MIN_SNR_DB), levelsFile: opt('--levels') ? resolve(opt('--levels')) : undefined, log: (s) => console.log(s) });
  console.log(`Staged in ${r.stage}.${r.applied ? ` Applied: ${r.applied.added.length} files added, ${r.applied.removed.length} removed, both manifests and the register updated.` : ''}`);
  return r.problems.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(String(e?.stack || e));
      process.exit(2);
    },
  );
}

