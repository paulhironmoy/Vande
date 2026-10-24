import type {
  ConfidenceState,
  DecisionOption,
  EvidenceVerb,
  GameState,
  Scenario,
  ScenarioEvidence,
} from './types';
import { applyScoreDelta, pushFeed, setFlags, type Draft } from './state';

export interface EvidenceActionView {
  verb: EvidenceVerb;
  label: string;
  enabled: boolean;
  hint?: string;
  compareWith?: string;
}

const OFFICIAL = new Set(['official', 'institution']);

function itemOf(scenario: Scenario, id: string): ScenarioEvidence | undefined {
  return scenario.evidence.find((e) => e.id === id);
}

function isAvailable(s: GameState, id: string): boolean {
  const es = s.evidence[id];
  return !!es && es.visible && !es.destroyed;
}

/** Candidates the player can compare this item with: visible corroborating/contradicting sources. */
export function compareCandidates(s: GameState, scenario: Scenario, item: ScenarioEvidence): { id: string; relation: 'corroborates' | 'contradicts' }[] {
  const out: { id: string; relation: 'corroborates' | 'contradicts' }[] = [];
  for (const id of item.corroboratedBy ?? []) if (isAvailable(s, id)) out.push({ id, relation: 'corroborates' });
  for (const id of item.contradictedBy ?? []) if (isAvailable(s, id)) out.push({ id, relation: 'contradicts' });
  // Official sources first so the strongest comparison is the default.
  return out.sort((a, b) => {
    const ao = OFFICIAL.has(itemOf(scenario, a.id)?.sourceType ?? '') ? 0 : 1;
    const bo = OFFICIAL.has(itemOf(scenario, b.id)?.sourceType ?? '') ? 0 : 1;
    return ao - bo;
  });
}

function isResolved(item: ScenarioEvidence, state: ConfidenceState): boolean {
  return state === item.resolvedState || state === 'manipulated' || state === 'verified';
}

function markResolved(d: Draft, item: ScenarioEvidence, previous: ConfidenceState): void {
  const es = d.evidence[item.id];
  if (isResolved(item, previous) || !isResolved(item, es.state)) return;
  d.stats.evidenceResolved += 1;
  if (es.state === 'manipulated') d.stats.manipulationsDetected += 1;
  setFlags(d, item.setsFlagsOnResolve);
  const matchesTruth = es.state === item.resolvedState;
  const summary = applyScoreDelta(d, matchesTruth ? { evidence: 3 } : { evidence: 1 });
  pushFeed(d, 'evidence', `${item.title} — ${item.resolutionNote}`, summary.dims, summary.direction);
}

/** Applies an evidence verb to the draft. Returns false when the action is not applicable. */
export function applyEvidenceVerb(d: Draft, scenario: Scenario, evidenceId: string, verb: EvidenceVerb, compareWith?: string): boolean {
  const item = itemOf(scenario, evidenceId);
  const es = d.evidence[evidenceId];
  if (!item || !es || !es.visible || es.destroyed) return false;
  const previous = es.state;
  switch (verb) {
    case 'inspect': {
      if (es.inspected) return false;
      es.inspected = true;
      es.updatedAt = d.tick;
      const anomaly = item.metadata.some((m) => m.anomaly);
      if (anomaly && (item.truth === 'false' || item.truth === 'misleading')) es.state = 'manipulated';
      else if (anomaly && item.truth === 'unknowable') es.state = 'unknown';
      if (es.state === previous) pushFeed(d, 'evidence', `Metadata inspected — ${item.title}. Nothing conclusive yet.`);
      markResolved(d, item, previous);
      return true;
    }
    case 'compare': {
      const candidates = compareCandidates(d, scenario, item);
      const chosen = compareWith ? candidates.find((c) => c.id === compareWith) : candidates[0];
      if (!chosen) return false;
      es.compared = true;
      es.updatedAt = d.tick;
      const other = itemOf(scenario, chosen.id);
      if (chosen.relation === 'contradicts') {
        es.state = item.truth === 'false' || item.truth === 'misleading' ? 'manipulated' : 'unknown';
      } else if (es.state !== 'manipulated') {
        const official = OFFICIAL.has(other?.sourceType ?? '');
        es.state = official && item.truth === 'true' ? 'verified' : 'corroborated';
      }
      if (es.state === previous) pushFeed(d, 'evidence', `Compared ${item.title} with ${other?.source ?? 'another source'}.`);
      markResolved(d, item, previous);
      return true;
    }
    case 'preserve': {
      if (es.preserved) return false;
      es.preserved = true;
      es.updatedAt = d.tick;
      d.stats.evidencePreserved += 1;
      const summary = applyScoreDelta(d, { evidence: 1 });
      pushFeed(d, 'evidence', `${item.title} preserved with a record of custody.`, summary.dims, summary.direction);
      return true;
    }
    case 'unresolved':
      if (es.markedUnresolved) return false;
      es.markedUnresolved = true;
      es.updatedAt = d.tick;
      return true;
    case 'clear-unresolved':
      if (!es.markedUnresolved) return false;
      es.markedUnresolved = false;
      es.updatedAt = d.tick;
      return true;
    default:
      return false;
  }
}

/** Verification actions available for an item, for the evidence detail UI. */
export function evidenceActions(state: GameState, scenario: Scenario, evidenceId: string): EvidenceActionView[] {
  const item = itemOf(scenario, evidenceId);
  const es = state.evidence[evidenceId];
  if (!item || !es || !es.visible) return [];
  if (es.destroyed) return [{ verb: 'inspect', label: 'Inspect metadata', enabled: false, hint: 'This item was destroyed before it could be secured.' }];
  const out: EvidenceActionView[] = [];
  out.push(
    es.inspected
      ? { verb: 'inspect', label: 'Inspect metadata', enabled: false, hint: 'Metadata inspected' }
      : { verb: 'inspect', label: 'Inspect metadata', enabled: true, hint: 'Check device, time, location and custody details.' },
  );
  const candidates = compareCandidates(state, scenario, item);
  if (candidates.length === 0) {
    out.push({
      verb: 'compare',
      label: 'Compare sources',
      enabled: false,
      hint: 'No other source yet. Mark unresolved and return when more arrives.',
    });
  } else {
    for (const c of candidates.slice(0, 3)) {
      const other = itemOf(scenario, c.id);
      out.push({ verb: 'compare', label: `Compare with ${other?.source ?? c.id}`, enabled: true, compareWith: c.id, hint: other?.title });
    }
  }
  out.push(
    es.preserved
      ? { verb: 'preserve', label: 'Preserve evidence', enabled: false, hint: 'Preserved. It can no longer be destroyed.' }
      : { verb: 'preserve', label: 'Preserve evidence', enabled: true, hint: item.perishable ? 'Perishable: secure it before it is lost.' : 'Record custody for later proceedings.' },
  );
  out.push(
    es.markedUnresolved
      ? { verb: 'clear-unresolved', label: 'Clear unresolved mark', enabled: true }
      : { verb: 'unresolved', label: 'Mark unresolved', enabled: true, hint: 'Keep it flagged to return later.' },
  );
  return out;
}

/** Warning shown on a decision option that relies on evidence. */
export function confidenceWarning(
  state: GameState,
  scenario: Scenario,
  option: DecisionOption,
): { level: 'none' | 'caution' | 'warning'; text: string } {
  const relied = option.requiresEvidence ?? [];
  if (relied.length === 0) return { level: 'none', text: '' };
  const states = relied.map((id) => ({ id, es: state.evidence[id], item: itemOf(scenario, id) }));
  if (states.some((x) => !x.es || !x.es.visible)) return { level: 'warning', text: 'You have not seen the evidence this relies on.' };
  if (states.some((x) => x.es.destroyed)) return { level: 'warning', text: 'Evidence this relies on was destroyed before it was secured.' };
  if (states.some((x) => x.es.state === 'manipulated')) return { level: 'warning', text: 'This relies on evidence shown to be manipulated.' };
  if (states.some((x) => x.es.state === 'unverified' || x.es.state === 'unknown')) {
    return { level: 'caution', text: 'Evidence is still unverified. Acting now risks a false accusation.' };
  }
  if (states.every((x) => x.es.state === 'verified')) return { level: 'none', text: 'Based on verified evidence.' };
  return { level: 'none', text: 'Based on corroborated evidence.' };
}
