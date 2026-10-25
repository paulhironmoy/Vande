/**
 * The per-question picture gate. A question shows pictures only when every one of its answers passes all four tests;
 * otherwise the whole question stays text with the kind badge. A lone picture draws the eye and nudges choices, so
 * the decision is always made per question, never per answer. Rendering uses only `visualPlanFor`.
 *
 * The four tests (docs/LITE-VISUALS.md):
 *   1. Concrete: a visible actor, action and object. Authors only tag answers that are; procedural, legal and
 *      true-versus-false statements stay untagged, so their question stays text.
 *   2. Distinct: every answer differs from every other answer in the question in at least one of the three parts.
 *   3. Neutral: only vocabulary glyphs flagged neutral, in their allowed roles.
 *   4. Label stays: a 2–4 word label under every picture.
 *
 * Stable API: `visualPlanFor(decision)`, plus `validateVisuals(scenario)` and `visualCoverage(scenario)` for the
 * validator tests and scripts/lite-visuals-report.mjs.
 */
import { VISUAL_VOCABULARY, type VisualGlyph, type VisualRole } from '@/content/lite/visualVocabulary';
import type { OptionVisual, Scenario, ScenarioDecision } from '@/engine/types';
import type { VisualPlan } from './contracts';

export const LABEL_MIN_WORDS = 2;
export const LABEL_MAX_WORDS = 4;

const ROLES: readonly (keyof OptionVisual)[] = ['actor', 'action', 'object'];

type Vocabulary = readonly VisualGlyph[];

function indexOf(vocabulary: Vocabulary): ReadonlyMap<string, VisualGlyph> {
  return new Map(vocabulary.map((g) => [g.id, g]));
}
const DEFAULT_INDEX = indexOf(VISUAL_VOCABULARY);

/** Words in a label, split on whitespace ("Reroute buses, hospital lane" has 4). */
export function labelWords(label: string): number {
  return label.trim().split(/\s+/).filter(Boolean).length;
}

function labelOk(label: unknown): label is string {
  if (typeof label !== 'string') return false;
  const n = labelWords(label);
  return n >= LABEL_MIN_WORDS && n <= LABEL_MAX_WORDS;
}

/** Problems with one visual against the vocabulary: unknown ids, wrong roles, non-neutral glyphs. */
function visualProblems(visual: unknown, index: ReadonlyMap<string, VisualGlyph>): string[] {
  if (!visual || typeof visual !== 'object') return ['visual must be an object with actor, action and object'];
  const v = visual as Record<string, unknown>;
  const out: string[] = [];
  for (const role of ROLES) {
    const id = v[role];
    if (typeof id !== 'string' || !id) {
      out.push(`visual.${role} is missing`);
      continue;
    }
    const glyph = index.get(id);
    if (!glyph) out.push(`visual.${role} '${id}' is not in the vocabulary`);
    else if (!glyph.roles.includes(role as VisualRole)) out.push(`visual.${role} '${id}' cannot be used as ${role === 'action' ? 'an' : 'the'} ${role}`);
    else if (!glyph.neutral) out.push(`visual.${role} '${id}' is not a neutral glyph`);
  }
  for (const key of Object.keys(v)) if (!(ROLES as readonly string[]).includes(key)) out.push(`visual has an unexpected field '${key}'`);
  return out;
}

const keyOf = (v: OptionVisual) => `${v.actor}|${v.action}|${v.object}`;

/** The gate with an explicit vocabulary (tests use this to check the neutral rule). */
export function visualPlanWith(decision: ScenarioDecision, vocabulary: Vocabulary): VisualPlan | null {
  const index = vocabulary === VISUAL_VOCABULARY ? DEFAULT_INDEX : indexOf(vocabulary);
  const simple = decision.simple;
  if (!simple || !decision.options.length) return null;
  const plan: VisualPlan = {};
  const seen = new Set<string>();
  for (const o of decision.options) {
    const so = simple.options[o.id];
    if (!so || !so.visual || !labelOk(so.label)) return null;
    if (visualProblems(so.visual, index).length) return null;
    const key = keyOf(so.visual);
    if (seen.has(key)) return null;
    seen.add(key);
    plan[o.id] = { visual: { actor: so.visual.actor, action: so.visual.action, object: so.visual.object }, label: so.label.trim() };
  }
  return plan;
}

/** Visual plan for a question, or null when it must stay text. */
export function visualPlanFor(decision: ScenarioDecision): VisualPlan | null {
  return visualPlanWith(decision, VISUAL_VOCABULARY);
}

/**
 * Review notes for questions that stay text on purpose (Chapter 1). They explain the coverage report; they do not
 * change the gate, which only looks at the tags.
 */
export const TEXT_ONLY_NOTES: Readonly<Record<string, string>> = {
  'd-investigation': 'Procedural: the answers differ in who checks and how independent they are, which a picture cannot show.',
  'd-civic-square': 'Force: moving or clearing people would need crowd-control imagery.',
  'd-racket': 'Force: an arrest and a raid are among the answers.',
  'd-communication': 'Statements: the answers differ in what is said and whether it is true, which a picture cannot show neutrally.',
  'd-resolution': 'Statements: blaming people and promising answers are words, not visible actions.',
  'd-bait-cancel': 'Timing: "now" versus "in 48 hours" is the difference, and cancelling would need a cross mark.',
  'd-bait-disperse': 'Force: holding people and clearing a square are among the answers.',
  'd-bait-shutdown': 'Lock-up: locking up the student leaders is among the answers.',
};

export interface VisualCoverageEntry {
  id: string;
  kind: 'decision' | 'fair-play';
  title: string;
  visual: boolean;
  /** Why it is visual or text. */
  reason: string;
}

export interface VisualValidation {
  ok: boolean;
  errors: string[];
  coverage: VisualCoverageEntry[];
}

/**
 * Checks every `label` and `visual` in a scenario's simple layer. Errors: unknown ids or wrong roles, non-neutral
 * glyphs, labels outside 2–4 words, duplicate compositions within a question. Partially tagged questions are not
 * errors: they are reported in the coverage and fall back to text.
 */
export function validateVisuals(scenario: Scenario, vocabulary: Vocabulary = VISUAL_VOCABULARY): VisualValidation {
  const index = indexOf(vocabulary);
  const errors: string[] = [];
  const coverage: VisualCoverageEntry[] = [];
  scenario.decisions.forEach((d, i) => {
    const simple = d.simple;
    const title = simple?.title ?? d.title;
    let tagged = 0;
    let labelled = 0;
    const seen = new Map<string, string>();
    for (const o of d.options) {
      const so = simple?.options[o.id];
      if (!so) continue;
      const path = `${scenario.id}: decisions[${i}].simple.options.${o.id}`;
      if (so.label !== undefined) {
        labelled++;
        if (typeof so.label !== 'string' || !labelOk(so.label)) errors.push(`${path}.label must have ${LABEL_MIN_WORDS}–${LABEL_MAX_WORDS} words (got "${String(so.label)}")`);
      }
      if (so.visual !== undefined) {
        tagged++;
        for (const p of visualProblems(so.visual, index)) errors.push(`${path}.${p}`);
        const v = so.visual as OptionVisual;
        if (v && typeof v === 'object') {
          const key = keyOf(v);
          const other = seen.get(key);
          if (other) errors.push(`${path}.visual repeats the picture of ${other}; every answer needs a different actor, action or object`);
          else seen.set(key, o.id);
        }
      }
    }
    const plan = visualPlanWith(d, vocabulary);
    let reason: string;
    if (plan) reason = `All ${d.options.length} answers pass: concrete, distinct, neutral, labelled.`;
    else if (tagged === 0 && labelled === 0) reason = TEXT_ONLY_NOTES[d.id] ?? 'Not tagged: stays text.';
    else reason = `Partially tagged (${tagged} of ${d.options.length} pictures, ${labelled} of ${d.options.length} labels): stays text until every answer passes.`;
    coverage.push({ id: d.id, kind: 'decision', title, visual: Boolean(plan), reason });
  });
  for (const r of scenario.rightsMoments) coverage.push({ id: r.id, kind: 'fair-play', title: r.simple?.question ?? r.question, visual: false, reason: 'Fair-play question: always text.' });
  return { ok: errors.length === 0, errors, coverage };
}

/** Coverage only (which questions show pictures, and why the others stay text). */
export function visualCoverage(scenario: Scenario): VisualCoverageEntry[] {
  return validateVisuals(scenario).coverage;
}
