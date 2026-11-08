#!/usr/bin/env node
/**
 * Offline scans of every captured state's player-facing text (rendered text plus accessible names), from a run's
 * metrics/capture.json:
 *   F8 ★  technical device wording (ceiling rubric: tier, fps, frame rate, GPU, WebGL, renderer, software graphics,
 *         benchmark, shader, MSAA, or Full, Assisted or Lite used as tier names)
 *   RK2   cricket jargon in the first session (line, length, seam, swing, spin, cutter, yorker, edge, LBW and similar);
 *         each hit is listed with its sentence so the evaluator can judge whether it is glossed
 *
 *   node scripts/eval/scan.mjs <label>   → runs/<label>/metrics/scan.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './lib/env.mjs';

const TECH = [
  /\btiers?\b/i,
  /\bfps\b/i,
  /\bframe ?rates?\b/i,
  /\bGPU\b/i,
  /\bWebGL\b/i,
  /\brender(er|ing)?\b/i,
  /\bsoftware graphics\b/i,
  /\bbenchmark/i,
  /\bshaders?\b/i,
  /\bMSAA\b/i,
  /\bFull Batter View\b/,
  /\bAssisted Performance\b/,
  /\b(Full|Assisted|Lite)\b(?=\s*(tier|graphics|mode|view|quality|profile|·|$))/,
  /\bdevice check\b/i,
  /\bcutoff\b/i,
];
const JARGON = [/\bline\b/i, /\blength\b/i, /\bseam(er|ing)?\b/i, /\bswing(ing|er)?\b/i, /\bspin(ner|ning)?\b/i, /\bcutters?\b/i, /\byorkers?\b/i, /\bedges?d?\b/i, /\bLBW\b/, /\bbouncers?\b/i, /\boff[ -]?(side|stump)\b/i, /\bleg[ -]?(side|stump)\b/i, /\boutswing|inswing/i, /\bgood length\b/i, /\bfull toss\b/i, /\bgoogly|wrong'?un|carrom|doosra\b/i, /\bpace band\b/i, /\bfinger spin|wrist spin|off-?break|leg-?break\b/i, /\bdrift|dip|turn\b/i, /\bfootwork\b/i, /\bcover drive|square cut|pull shot\b/i];
/** States a first-time player passes through before and during the first over (capture names). */
const FIRST_SESSION = /^(01|02|07|08|09|10|11|12-why|13-replay|14|40|41|42)/;

function sentencesWith(text, re) {
  return text
    .split(/(?<=[.!?·\n])\s+/)
    .filter((s) => re.test(s))
    .map((s) => s.trim().slice(0, 160));
}

export function scan(label) {
  const dir = join(REPO, 'release', 'player-experience', 'rookie', 'runs', label);
  const cap = JSON.parse(readFileSync(join(dir, 'metrics', 'capture.json'), 'utf8'));
  const tech = [];
  const jargon = [];
  for (const s of cap.shots) {
    const text = `${s.visibleText || ''}\n${(s.labels || []).join('\n')}`;
    for (const re of TECH) for (const hit of sentencesWith(text, re)) tech.push({ state: s.name, viewport: s.viewport, term: re.source, text: hit, file: s.file });
    if (FIRST_SESSION.test(s.name)) for (const re of JARGON) for (const hit of sentencesWith(text, re)) jargon.push({ state: s.name, viewport: s.viewport, term: re.source, text: hit });
  }
  const uniq = (rows) => {
    const seen = new Set();
    return rows.filter((r) => {
      const k = `${r.state}|${r.term}|${r.text}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const out = { label, statesScanned: cap.shots.length, technical: uniq(tech), jargon: uniq(jargon) };
  writeFileSync(join(dir, 'metrics', 'scan.json'), JSON.stringify(out, null, 2));
  return out;
}

if (process.argv[2]) {
  const r = scan(process.argv[2]);
  console.log(`${r.statesScanned} states; technical wording: ${r.technical.length}; first-session jargon: ${r.jargon.length}`);
  for (const t of r.technical.slice(0, 30)) console.log(`F8  ${t.state} [${t.viewport}] ${t.term}: ${t.text}`);
  for (const j of r.jargon.slice(0, 40)) console.log(`RK2 ${j.state} [${j.viewport}] ${j.term}: ${j.text}`);
}
