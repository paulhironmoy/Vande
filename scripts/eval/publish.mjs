#!/usr/bin/env node
/**
 * Copies the key captured states of a run from the bulk folder (EVAL_BULK, scratch) into
 * release/player-experience/rookie/runs/<label>/selected/ (AGENTS.md: only summaries and selected captures in release/).
 *
 *   EVAL_BULK=/path/to/scratch/eval-bulk node scripts/eval/publish.mjs <label> [viewports]
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { REPO } from './lib/env.mjs';

const KEY = /^(01-launch|02-practice-menu|03-random-setup|04-predefined-empty|05-predefined-full|07a-setup|07-field|08-live-runup|09-live-flight|10-after-contact|11-result|12-why|12c-coach|12d-coach-demo|13b-closeup|14-over-summary|15d-coach-compare|16-paused|21-classic-flight|31-fallback-software|31-fallback-nowebgl|40c-first-demo|41-first-runup|42-first-explained)\.png$/;

const [label, vpsArg] = process.argv.slice(2);
const vps = (vpsArg || '640x360,915x412,1280x800').split(',');
const bulk = join(process.env.EVAL_BULK || join(tmpdir(), 'vande-eval-bulk'), label);
const out = join(REPO, 'release', 'player-experience', 'rookie', 'runs', label, 'selected');
mkdirSync(out, { recursive: true });
let n = 0;
for (const vp of vps) {
  const dir = join(bulk, 'shots', vp);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) if (KEY.test(f)) {
    copyFileSync(join(dir, f), join(out, `${vp}-${f}`));
    n++;
  }
}
const close = join(bulk, 'closeups');
if (existsSync(close)) for (const f of readdirSync(close)) if (/^(standard|high|premium)-/.test(f)) {
  copyFileSync(join(close, f), join(out, `closeup-${f}`));
  n++;
}
console.log(`${n} files → ${out}`);
