import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '@/content';
import { DAYS } from '@/content/daily';
import { VISUAL_IDS, VISUAL_VOCABULARY, glyphById, type VisualGlyph } from '@/content/lite/visualVocabulary';
import { compileDaily } from '@/engine';
import type { OptionVisual, Scenario, ScenarioDecision } from '@/engine/types';
import { LABEL_MAX_WORDS, LABEL_MIN_WORDS, TEXT_ONLY_NOTES, labelWords, validateVisuals, visualCoverage, visualPlanFor, visualPlanWith } from '@/lite/visuals';

const chapter1 = SCENARIOS['examination-crisis'];
const decision = (id: string) => chapter1.decisions.find((d) => d.id === id)!;

/** Deep copy of a decision with a per-option edit to its simple layer. */
function edited(d: ScenarioDecision, edit: (opts: Record<string, { label?: string; visual?: OptionVisual }>) => void): ScenarioDecision {
  const copy = JSON.parse(JSON.stringify(d)) as ScenarioDecision;
  edit(copy.simple!.options as Record<string, { label?: string; visual?: OptionVisual }>);
  return copy;
}

describe('Lite picture gate', () => {
  it('shows pictures for a fully tagged Chapter 1 question, with the 2–4 word labels and every option covered', () => {
    for (const id of ['d-first-response', 'd-services']) {
      const d = decision(id);
      const plan = visualPlanFor(d);
      expect(plan, id).not.toBeNull();
      expect(Object.keys(plan!).sort()).toEqual(d.options.map((o) => o.id).sort());
      for (const o of d.options) {
        const entry = plan![o.id];
        expect(labelWords(entry.label)).toBeGreaterThanOrEqual(LABEL_MIN_WORDS);
        expect(labelWords(entry.label)).toBeLessThanOrEqual(LABEL_MAX_WORDS);
        for (const part of ['actor', 'action', 'object'] as const) expect(glyphById(entry.visual[part])?.roles).toContain(part);
      }
    }
  });

  it('is all-or-none: one untagged answer turns the whole question to text', () => {
    const d = decision('d-first-response');
    expect(visualPlanFor(edited(d, (o) => delete o['o-wait-first'].visual))).toBeNull();
    expect(visualPlanFor(edited(d, (o) => delete o['o-acknowledge'].label))).toBeNull();
    const withoutSimple = JSON.parse(JSON.stringify(d)) as ScenarioDecision;
    delete withoutSimple.simple;
    expect(visualPlanFor(withoutSimple)).toBeNull();
  });

  it('needs every answer to differ in at least one of actor, action or object', () => {
    const d = decision('d-first-response');
    const same = edited(d, (o) => {
      o['o-wait-first'].visual = { ...o['o-acknowledge'].visual! };
    });
    expect(visualPlanFor(same)).toBeNull();
    const oneDiff = edited(d, (o) => {
      o['o-wait-first'].visual = { ...o['o-acknowledge'].visual!, action: 'wait' };
    });
    expect(visualPlanFor(oneDiff)).not.toBeNull();
  });

  it('rejects unknown ids, glyphs in the wrong role and labels outside 2–4 words', () => {
    const d = decision('d-services');
    expect(visualPlanFor(edited(d, (o) => (o['o-shut-transit'].visual = { actor: 'official', action: 'teleport', object: 'bus' })))).toBeNull();
    expect(visualPlanFor(edited(d, (o) => (o['o-shut-transit'].visual = { actor: 'bus', action: 'stop', object: 'official' })))).toBeNull();
    expect(visualPlanFor(edited(d, (o) => (o['o-shut-transit'].label = 'Stop')))).toBeNull();
    expect(visualPlanFor(edited(d, (o) => (o['o-shut-transit'].label = 'Stop every single bus right now')))).toBeNull();
  });

  it('only lets neutral glyphs through', () => {
    const d = decision('d-first-response');
    const notNeutral: VisualGlyph[] = VISUAL_VOCABULARY.map((g) => (g.id === 'lock' ? { ...g, neutral: false } : g));
    expect(visualPlanWith(d, VISUAL_VOCABULARY)).not.toBeNull();
    expect(visualPlanWith(d, notNeutral)).toBeNull();
    const v = validateVisuals(chapter1, notNeutral);
    expect(v.ok).toBe(false);
    expect(v.errors.join('\n')).toMatch(/'lock' is not a neutral glyph/);
  });
});

describe('Lite picture validation', () => {
  const daily: Scenario[] = Object.values(DAYS).map((day) => compileDaily(day));
  it.each([...Object.values(SCENARIOS), ...daily].map((s) => [s.id, s] as const))('%s has no picture errors', (_id, scenario) => {
    const v = validateVisuals(scenario);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('reports errors for bad tags without throwing', () => {
    const broken = JSON.parse(JSON.stringify(chapter1)) as Scenario;
    const opts = broken.decisions.find((d) => d.id === 'd-services')!.simple!.options as Record<string, { label?: unknown; visual?: unknown }>;
    opts['o-shut-transit'].visual = { actor: 'nobody', action: 'stop', object: 'bus', colour: 'red' };
    opts['o-wait-services'].label = 'Wait';
    opts['o-divert-transit'].visual = { actor: 'students', action: 'guide', object: 'road' };
    const v = validateVisuals(broken);
    const text = v.errors.join('\n');
    expect(v.ok).toBe(false);
    expect(text).toMatch(/visual.actor 'nobody' is not in the vocabulary/);
    expect(text).toMatch(/unexpected field 'colour'/);
    expect(text).toMatch(/label must have 2–4 words/);
    expect(text).toMatch(/repeats the picture of o-corridor-with-students/);
    expect(v.coverage.find((c) => c.id === 'd-services')?.visual).toBe(false);
  });

  it('reports a partially tagged question as text, not as an error', () => {
    const partial = JSON.parse(JSON.stringify(chapter1)) as Scenario;
    const opts = partial.decisions.find((d) => d.id === 'd-first-response')!.simple!.options as Record<string, { label?: string; visual?: OptionVisual }>;
    delete opts['o-wait-first'].visual;
    delete opts['o-wait-first'].label;
    const v = validateVisuals(partial);
    expect(v.errors).toEqual([]);
    const row = v.coverage.find((c) => c.id === 'd-first-response')!;
    expect(row.visual).toBe(false);
    expect(row.reason).toMatch(/Partially tagged \(3 of 4 pictures, 3 of 4 labels\)/);
  });

  it('Chapter 1 coverage: two picture questions, a reason for every text question, fair play always text', () => {
    const rows = visualCoverage(chapter1);
    expect(rows.filter((r) => r.visual).map((r) => r.id)).toEqual(['d-first-response', 'd-services']);
    for (const r of rows.filter((x) => x.kind === 'decision' && !x.visual)) expect(TEXT_ONLY_NOTES[r.id], r.id).toBeTruthy();
    const fair = rows.filter((r) => r.kind === 'fair-play');
    expect(fair).toHaveLength(chapter1.rightsMoments.length);
    for (const r of fair) expect(r.visual).toBe(false);
  });
});

describe('Lite picture vocabulary', () => {
  it('has unique, permanent-looking ids, at least one role each, and only neutral glyphs', () => {
    expect(new Set(VISUAL_IDS).size).toBe(VISUAL_IDS.length);
    for (const g of VISUAL_VOCABULARY) {
      expect(g.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(g.roles.length).toBeGreaterThan(0);
      expect(g.neutral).toBe(true);
      expect(g.shows.length).toBeGreaterThan(5);
    }
  });

  it('is no bigger than the content needs: every glyph is used by a tagged answer', () => {
    const used = new Set<string>();
    for (const d of chapter1.decisions)
      for (const so of Object.values(d.simple?.options ?? {})) if (so.visual) for (const id of Object.values(so.visual)) used.add(id);
    expect([...used].sort()).toEqual([...VISUAL_IDS].sort());
  });
});
