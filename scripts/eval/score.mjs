#!/usr/bin/env node
/**
 * Scores the Rookie rubric (DUAL-CEILING-RUBRIC §3) and three ceiling dimensions (ceiling-rubric §6.4–6.6) from
 * criterion scores entered by the examiner with evidence ids. The arithmetic and the rules are mechanical here.
 *
 *   node scripts/eval/score.mjs release/player-experience/rookie/criteria-<label>.json
 *
 * Criteria file: { label, build, inProgress, criteria: { "<ID>": { score: 0-10 | null, evidence: [...], note } },
 *                  openCriticalTouches: ["R2", "UX", ...] }
 * Rules applied:
 *   R1    no evidence: 0 credit (score null or missing evidence → 0)
 *   R5    anchors (applied by the examiner when entering a score)
 *   R6    a ★ criterion below 7 fails that dimension's target, whatever the total
 *   R7    an open Critical defect caps every dimension it touches at 8.5
 *   R8    9.5 needs every ★ criterion at ≥ 9.0
 *   R4/§7 H gates are pending (no real players), so any score above 8.8 is at most PROVISIONAL
 * Writes <same name>.scores.json and prints markdown tables.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOKIE = [
  { id: 'R1', name: 'First-session clarity', w: 20, star: true, crit: ['F1', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'U2', 'M1', 'M2', 'RK1', 'RK2'] },
  { id: 'R2', name: 'Perceived control', w: 20, star: true, crit: ['CTL1', 'CTL2', 'CTL5', 'CTL7', 'CTL8', 'CTL9', 'RK3'] },
  { id: 'R3', name: 'Fairness and understandable failure', w: 15, star: true, crit: ['FAIR3', 'FAIR4', 'FAIR5', 'FAIR7', 'SYS1', 'SYS2', 'F6', 'COACH1', 'RK4'] },
  { id: 'R4', name: 'Ball readability', w: 10, star: true, crit: ['READ1', 'READ2', 'READ3', 'READ4'] },
  { id: 'R5', name: 'Coaching and visible improvement', w: 15, star: true, crit: ['COACH1', 'COACH2', 'COACH3', 'COACH4', 'COACH5', 'COACH6', 'COACH7', 'RK5'] },
  { id: 'R6', name: 'Emotional satisfaction', w: 10, star: false, crit: ['FBK1', 'FBK2', 'FBK3', 'FBK4', 'FBK5', 'COH9', 'F5'] },
  { id: 'R7', name: 'Desire to play another over', w: 10, star: false, crit: ['RK6'] },
];
/** Catalogue ★ criteria (ceiling-rubric §5, DUAL §2–4) that appear in my dimensions. */
const STAR = new Set(['CTL1', 'CTL2', 'CTL5', 'CTL7', 'CTL8', 'CTL10', 'FAIR1', 'FAIR2', 'FAIR3', 'FAIR4', 'FAIR5', 'FAIR6', 'COH2', 'COH3', 'COH4', 'COH6', 'COH7', 'COH8', 'COH11', 'READ1', 'READ2', 'READ3', 'COACH2', 'COACH4', 'F7', 'F8', 'PERF1', 'PERF2', 'PERF3', 'PERF6', 'U2', 'U5', 'M5', 'ART1', 'ART7', 'SYS1', 'SYS2']);
const UX = { id: 'UX', name: 'UX', target: 9.2, parts: [['U1', 15], ['U2', 15], ['U3', 15], ['U4', 15], ['U5', 15], ['U6', 15], ['U7', 10]] };
const MIN = { id: 'MIN', name: 'Minimalistic flow', target: 9.5, parts: [['M1', 25], ['M2', 20], ['M3', 15], ['M4', 15], ['M5', 25]] };
const ART = { id: 'ART', name: 'Artifact experience', target: 9.0, parts: [['ART1', 20], ['ART2', 15], ['ART3', 15], ['ART4', 15], ['READ', 10], ['ART5', 10], ['ART6', 10], ['ART8', 5]] };
/** Composite criteria: U1 = F1 and F2; U4 = mean of A11Y1–A11Y7; READ = mean of READ1–READ5. */
const COMPOSITE = { U1: ['F1', 'F2'], U4: ['A11Y1', 'A11Y2', 'A11Y3', 'A11Y4', 'A11Y5', 'A11Y6', 'A11Y7'], READ: ['READ1', 'READ2', 'READ3', 'READ4', 'READ5'] };

const r1 = (x) => Math.round(x * 10) / 10;

export function scoreAll(file) {
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  const c = spec.criteria;
  const val = (id) => {
    if (COMPOSITE[id]) {
      const xs = COMPOSITE[id].map(val);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    }
    const e = c[id];
    // R1: no evidence, no credit.
    return e && typeof e.score === 'number' && e.evidence && e.evidence.length ? e.score : 0;
  };
  const caps = new Set(spec.openCriticalTouches || []);
  const label = (score, target, starFail, starsAt9) => {
    if (starFail || score < target) return 'NOT PROVEN';
    if (!starsAt9 && target >= 9.5) return 'NOT PROVEN';
    return score > 8.8 ? 'PROVISIONAL (H gate pending)' : 'NOT PROVEN';
  };
  const rookie = ROOKIE.map((d) => {
    const scores = d.crit.map((id) => ({ id, score: val(id), star: STAR.has(id) || (d.id === 'R1' && false) }));
    let s = scores.reduce((a, b) => a + b.score, 0) / scores.length;
    const starLow = scores.filter((x) => x.star && x.score < 7).map((x) => x.id);
    const capped = caps.has(d.id);
    if (capped) s = Math.min(s, 8.5);
    return { ...d, score: r1(s), starLow, capped, criteria: scores };
  });
  const rookieTotal = r1(rookie.reduce((a, d) => a + d.score * d.w, 0) / 100);
  const starDims = rookie.filter((d) => d.star);
  const rookieStarFail = starDims.filter((d) => d.score < 7 || d.starLow.length).map((d) => d.id);
  const rookieStarsAt9 = starDims.every((d) => d.score >= 9);
  const dim = (D) => {
    const parts = D.parts.map(([id, w]) => ({ id, w, score: val(id), star: STAR.has(id) }));
    let s = parts.reduce((a, p) => a + p.score * p.w, 0) / 100;
    if (caps.has(D.id)) s = Math.min(s, 8.5);
    const starLow = parts.filter((p) => p.star && p.score < 7).map((p) => p.id);
    const starsAt9 = parts.filter((p) => p.star).every((p) => p.score >= 9);
    if (D.id === 'ART' && (c.ART7?.score ?? 0) < 9) starLow.push('ART7 gate');
    return { id: D.id, name: D.name, target: D.target, score: r1(s), starLow, label: label(s, D.target, starLow.length > 0, starsAt9), parts };
  };
  const out = {
    label: spec.label,
    build: spec.build,
    inProgress: Boolean(spec.inProgress),
    rookie: { total: rookieTotal, target: 9.5, starFail: rookieStarFail, label: label(rookieTotal, 9.5, rookieStarFail.length > 0, rookieStarsAt9), dims: rookie },
    ux: dim(UX),
    min: dim(MIN),
    art: dim(ART),
  };
  writeFileSync(file.replace(/\.json$/, '.scores.json'), JSON.stringify(out, null, 2));
  return out;
}

if (process.argv[2] && process.argv[3] !== '--md') {
  const o = scoreAll(process.argv[2]);
  console.log(`# ${o.label} (${o.build})${o.inProgress ? ' — IN PROGRESS' : ''}`);
  console.log(`Rookie ${o.rookie.total} / 9.5 — ${o.rookie.label}${o.rookie.starFail.length ? ` (★ below 7: ${o.rookie.starFail.join(', ')})` : ''}`);
  for (const d of o.rookie.dims) console.log(`  ${d.id} ${d.name} (${d.w}%${d.star ? ' ★' : ''}): ${d.score}${d.capped ? ' [R7 cap]' : ''}  — ${d.criteria.map((x) => `${x.id} ${x.score}`).join(', ')}`);
  for (const k of ['ux', 'min', 'art']) console.log(`${o[k].name} ${o[k].score} / ${o[k].target} — ${o[k].label}${o[k].starLow.length ? ` (★ below 7: ${o[k].starLow.join(', ')})` : ''}  — ${o[k].parts.map((p) => `${p.id} ${r1(p.score)}`).join(', ')}`);
}

/** Markdown for docs/EVALUATION.md: one table per scored area, every criterion with its score and evidence ids. */
export function markdown(file) {
  const o = scoreAll(file);
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  const ev = (id) => {
    if (COMPOSITE[id]) return COMPOSITE[id].map((x) => `${x}: ${(spec.criteria[x]?.evidence || []).join(', ') || '—'}`).join('; ');
    return (spec.criteria[id]?.evidence || []).join(', ') || '— (no evidence: 0)';
  };
  const note = (id) => (COMPOSITE[id] ? 'mean of its parts' : spec.criteria[id]?.note || '');
  const out = [];
  out.push(`**Rookie (DUAL-CEILING-RUBRIC §3), ${o.label} (${o.build})${o.inProgress ? ', in progress' : ''}: ${o.rookie.total} / 9.5, ${o.rookie.label}**`);
  out.push('');
  out.push('| Dimension | Weight | Score | Criteria (score) |');
  out.push('| --- | ---: | ---: | --- |');
  for (const d of o.rookie.dims) out.push(`| ${d.id} ${d.name}${d.star ? ' ★' : ''} | ${d.w}% | ${d.score}${d.capped ? ' (R7 cap)' : ''} | ${d.criteria.map((x) => `${x.id} ${r1(x.score)}`).join(', ')} |`);
  for (const k of ['ux', 'min', 'art']) {
    const D = o[k];
    out.push('');
    out.push(`**${D.name} (target ${D.target}), ${o.label}: ${D.score}, ${D.label}${D.starLow.length ? `; ★ below 7: ${D.starLow.join(', ')}` : ''}**`);
    out.push('');
    out.push('| Criterion | Weight | Score | Evidence | Note |');
    out.push('| --- | ---: | ---: | --- | --- |');
    for (const p of D.parts) out.push(`| ${p.id}${p.star ? ' ★' : ''} | ${p.w}% | ${r1(p.score)} | ${ev(p.id)} | ${note(p.id).replace(/\|/g, '/')} |`);
  }
  out.push('');
  out.push('Rookie criteria:');
  out.push('');
  out.push('| Criterion | Score | Evidence | Note |');
  out.push('| --- | ---: | --- | --- |');
  const seen = new Set();
  for (const d of o.rookie.dims) for (const x of d.criteria) if (!seen.has(x.id)) {
    seen.add(x.id);
    out.push(`| ${x.id}${x.star ? ' ★' : ''} | ${r1(x.score)} | ${ev(x.id)} | ${note(x.id).replace(/\|/g, '/')} |`);
  }
  return out.join('\n');
}

if (process.argv[2] && process.argv[3] === '--md') console.log(markdown(process.argv[2]));
