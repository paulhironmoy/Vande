#!/usr/bin/env node
/**
 * Per-state interface census from a run's metrics/capture.json (M2, U2, A11Y7, U3 type sizes):
 *   actions    reachable, enabled buttons and links, excluding quiet navigation and disclosure (back, settings,
 *              pause, "Why?", close, sound, help: the lead's M2 ruling)
 *   inputs     selection controls (radio, tab, switch, slider, option, slots and pitch map) reported apart
 *   competing  actions carrying ≥ 60% of the dominant action's visual weight (equal-weight buttons, §2)
 *   live       during a delivery (run-up and flight): anything tappable except pause fails M2
 *   U2         a visible title or heading, one dominant action where there are actions, and a way back
 *
 *   node scripts/eval/census.mjs <label>   → runs/<label>/metrics/census.json and a printed table
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './lib/env.mjs';

const QUIET = /^(back|close|settings|practice settings|help|pause|sound|sound on|sound off|mute|unmute|menu|info|more|more options|why\??|show why|hide why|alternatives|alternative shots|done|cancel|skip|captions?|conditions:.*|movement and variation:.*|more bowler options)$/i;
const INPUT_ROLES = new Set(['radio', 'tab', 'switch', 'slider', 'option', 'checkbox', 'spinbutton']);
/** States captured while a ball is in play (run-up to dead ball), the first-run demonstration, and the tier frames. */
const LIVE = /^(08|09|10|15a|20|21|22|31|32|41|60|12c|12d|13b|40c)-/;
const BACK = /^(back|close|leave|exit|menu|home|done|end innings|back to)/i;

export function census(label) {
  const dir = join(REPO, 'release', 'player-experience', 'rookie', 'runs', label);
  const cap = JSON.parse(readFileSync(join(dir, 'metrics', 'capture.json'), 'utf8'));
  const rows = [];
  for (const s of cap.shots) {
    const reach = (s.controls || []).filter((c) => c.reachable && !c.disabled);
    // Selection inputs and the field map's inspectable fielders and gaps (disclosure, not actions).
    const isInput = (c) => INPUT_ROLES.has(c.role) || /practice-(slot|ref)-\d|pitch-map|build-(band|variation|family|arm|spin|mode)|random-(difficulty|pitch|bowling)|setup-assist|settings-|field-(gap|fielder)-|field-map/.test(c.testid || '') || /^(gap at|gap:|fielder|.*: (a well-hit|past the ring|catcher))/i.test(c.name.trim());
    const quiet = reach.filter((c) => !isInput(c) && QUIET.test(c.name.trim()));
    const actions = reach.filter((c) => !isInput(c) && !QUIET.test(c.name.trim()));
    const inputs = reach.filter(isInput);
    const top = [...actions].sort((a, b) => b.weight - a.weight)[0];
    const competing = actions.filter((c) => c !== top && top && c.weight >= 0.6 * top.weight);
    const live = LIVE.test(s.name);
    const tappableLive = live ? reach.filter((c) => !/^pause$/i.test(c.name.trim())) : [];
    const heading = (s.headings || []).filter(Boolean);
    // On the play screen the way back is pause → leave; the launch screen is the root.
    const back = reach.some((c) => BACK.test(c.name.trim()) || /^pause$/i.test(c.name.trim())) || /^01/.test(s.name);
    const small = reach.filter((c) => !c.target48).map((c) => `${c.name || c.testid} ${c.rect.w}×${c.rect.h}`);
    rows.push({
      state: s.name,
      viewport: s.viewport,
      actions: actions.map((c) => c.name),
      quiet: quiet.map((c) => c.name),
      inputs: inputs.length,
      competing: competing.map((c) => c.name),
      m2: live ? tappableLive.length === 0 : actions.length <= 3 && competing.length === 0,
      liveTappable: tappableLive.map((c) => c.name),
      heading: heading[0] ?? null,
      u2: live || (Boolean(heading.length || /^0[89]|^1[0-3]|^2[0-3]|^3[0-2]|^4[0-2]/.test(s.name)) && (actions.length === 0 || competing.length === 0) && back),
      under48: small,
      minFontPx: s.text?.minFontPx ?? null,
      textIssues: (s.issues || []).length,
      file: s.file,
    });
  }
  const out = { label, states: rows.length, m2Fails: rows.filter((r) => !r.m2).length, u2Fails: rows.filter((r) => !r.u2).length, rows };
  writeFileSync(join(dir, 'metrics', 'census.json'), JSON.stringify(out, null, 2));
  return out;
}

if (process.argv[2]) {
  const o = census(process.argv[2]);
  console.log(`${o.states} states; M2 fails ${o.m2Fails}; U2 fails ${o.u2Fails}`);
  for (const r of o.rows) console.log(`${r.m2 ? ' ' : 'M2'} ${r.u2 ? ' ' : 'U2'} ${r.viewport.padEnd(9)} ${r.state.padEnd(28)} actions ${r.actions.length} [${r.actions.join(' | ').slice(0, 90)}] competing ${r.competing.length}${r.liveTappable.length ? ` LIVE-TAPPABLE: ${r.liveTappable.join(', ')}` : ''} <48: ${r.under48.length} minFont ${r.minFontPx}`);
}
