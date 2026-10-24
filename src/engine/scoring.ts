import {
  DIMENSIONS,
  DIMENSION_LABELS,
  type CampaignResult,
  type ChapterResult,
  type Dimension,
  type Difficulty,
  type GameMode,
  type GameState,
  type KeyDecision,
  type ManipulationOutcome,
  type OpponentId,
  type RepublicCondition,
  type RepublicOutcome,
  type Scenario,
  type ScenarioId,
  type Scores,
} from './types';
import { checkCondition, clamp, round1 } from './state';
import { roundScores } from './simulation';
import { encodeChallenge } from './challenge';

export function meanScore(s: Scores): number {
  return DIMENSIONS.reduce((acc, d) => acc + s[d], 0) / DIMENSIONS.length;
}

function weakestOf(s: Scores): Dimension {
  let w: Dimension = DIMENSIONS[0];
  for (const d of DIMENSIONS) if (s[d] < s[w]) w = d;
  return w;
}

/** Balance-weighted chapter score: a collapsing dimension drags the whole score down. */
export function chapterScore(scores: Scores): number {
  const mean = meanScore(scores);
  const min = Math.min(...DIMENSIONS.map((d) => scores[d]));
  return clamp(Math.round(mean - 0.35 * (mean - min)), 0, 100);
}

export function classifyOutcome(scores: Scores): RepublicOutcome {
  const mean = meanScore(scores);
  const min = Math.min(...DIMENSIONS.map((d) => scores[d]));
  if (min >= 55 && mean >= 68) return 'resilient';
  const weakest = weakestOf(scores);
  if (weakest === 'evidence' && scores.evidence < 45) return 'manipulated';
  if (weakest === 'economy' && scores.economy < 45) return 'economically-disrupted';
  if (scores.freedom >= 60 && scores.safety < 45) return 'free-fragile';
  if (scores.safety >= 60 && (scores.freedom < 50 || scores.trust < 45)) return 'order-without-trust';
  if (weakest === 'trust' || weakest === 'grievance') return 'institutionally-weakened';
  switch (weakest) {
    case 'freedom':
      return 'order-without-trust';
    case 'safety':
      return 'free-fragile';
    case 'evidence':
      return 'manipulated';
    case 'economy':
      return 'economically-disrupted';
    default:
      return 'institutionally-weakened';
  }
}

/** Scores regress toward the middle between chapters so consequences persist without locking the game. */
export function carryScores(prev: Scores): Scores {
  const out = {} as Scores;
  for (const d of DIMENSIONS) out[d] = round1(prev[d] * 0.6 + 50 * 0.4);
  return out;
}

const IMPROVEMENT_BY_DIMENSION: Record<Dimension, string> = {
  freedom: 'Keep enforcement narrow and evidence-led. Restrictions on peaceful assembly need a specific, proven threat.',
  grievance: 'Acknowledge the grievance early and open a credible, time-bound process people can watch.',
  safety: 'Protect flashpoints before incidents start: lawful presence, open routes and quick relief.',
  evidence: 'Inspect metadata and compare sources before acting. Preserve perishable records as soon as they appear.',
  trust: 'Communicate what is known, what is not, and when the next update comes. Correct your own errors publicly.',
  economy: 'Keep transit and markets running with targeted measures instead of blanket closures.',
};

function keyDecisionOf(state: GameState, scenario: Scenario): KeyDecision | undefined {
  let best: KeyDecision | undefined;
  for (const ds of Object.values(state.decisions)) {
    if (ds.status === 'pending' || !ds.chosenOption) continue;
    const decision = scenario.decisions.find((x) => x.id === ds.id);
    const option = decision?.options.find((o) => o.id === ds.chosenOption);
    if (!decision || !option) continue;
    let impact = 0;
    for (const v of Object.values(option.effects)) impact += Math.abs(v ?? 0);
    for (const de of option.delayed ?? []) for (const v of Object.values(de.effects)) impact += Math.abs(v ?? 0);
    if (ds.falseAccusation) for (const v of Object.values(option.falseAccusationEffects ?? { freedom: -12, trust: -10 })) impact += Math.abs(v ?? 0);
    if (ds.disproportionate) for (const v of Object.values(option.disproportionateEffects ?? { freedom: -10, trust: -8 })) impact += Math.abs(v ?? 0);
    const flags: KeyDecision['flags'] = [];
    if (ds.falseAccusation) flags.push('false-accusation');
    if (ds.disproportionate) flags.push('disproportionate');
    if (ds.unverifiedBasis) flags.push('unverified-basis');
    if (ds.auto) flags.push('auto');
    const candidate: KeyDecision = { decisionId: ds.id, optionId: option.id, title: decision.title, optionTitle: option.title, impact: Math.round(impact), tick: ds.decidedAt ?? ds.appearedAt, flags };
    if (!best || candidate.impact > best.impact || (candidate.impact === best.impact && candidate.tick < best.tick)) best = candidate;
  }
  return best;
}

function manipulationsOf(state: GameState, scenario: Scenario): ManipulationOutcome[] {
  const out: ManipulationOutcome[] = [];
  for (const item of scenario.evidence) {
    if (!item.injectedBy) continue;
    const es = state.evidence[item.id];
    if (!es || !es.visible) continue;
    const exposed = es.state === 'manipulated' || es.state === 'unknown';
    const actedOn = !!es.usedInDecision && !!state.decisions[es.usedInDecision]?.falseAccusation;
    const succeeded = actedOn || !exposed;
    let note: string;
    if (actedOn) note = 'You acted on it before it was exposed.';
    else if (!exposed) note = es.destroyed ? 'It was destroyed before anyone could examine it.' : 'It was never exposed and kept circulating.';
    else note = `Exposed as ${es.state}. ${item.resolutionNote}`;
    out.push({ evidenceId: item.id, title: item.title, opponent: item.injectedBy, succeeded, note });
  }
  return out;
}

function missedEvidenceOf(state: GameState, scenario: Scenario): ChapterResult['missedEvidence'] {
  const referenced = new Set<string>();
  for (const dec of scenario.decisions) for (const opt of dec.options) for (const id of opt.requiresEvidence ?? []) referenced.add(id);
  const out: ChapterResult['missedEvidence'] = [];
  for (const item of scenario.evidence) {
    if (item.truth !== 'true' && item.truth !== 'false') continue;
    if (!referenced.has(item.id)) continue;
    const es = state.evidence[item.id];
    if (!es || !es.visible || es.destroyed) continue;
    if (es.state !== item.initialState || es.state === item.resolvedState) continue;
    out.push({ id: item.id, title: item.title, note: item.resolutionNote });
  }
  return out;
}


const FORCE_LIKE = new Set(['force', 'detention', 'suppressive']);

/**
 * Spoiler-free strategy fingerprint: one letter per resolved decision in order of appearance.
 * X suppressive/disproportionate/censorship (or a false accusation), W waited or expired, P proportionate
 * enforcement, E evidence or legal process, S services/relief/protection, D dialogue/transparency.
 */
export function computeFingerprint(state: GameState, scenario: Scenario): string {
  const order = scenario.decisions.map((d, i) => [d.id, i] as const);
  const index = new Map(order);
  const resolved = Object.values(state.decisions)
    .filter((ds) => ds.status !== 'pending' && ds.chosenOption)
    .sort((a, b) => a.appearedAt - b.appearedAt || (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0));
  let out = '';
  for (const ds of resolved) {
    const decision = scenario.decisions.find((d) => d.id === ds.id);
    const option = decision?.options.find((o) => o.id === ds.chosenOption);
    if (!option) continue;
    const tags = new Set(option.tags);
    let code: string;
    if (tags.has('disproportionate') || tags.has('suppressive') || tags.has('censorship') || ds.disproportionate || ds.falseAccusation) code = 'X';
    else if (ds.auto || ds.status === 'expired' || tags.has('wait')) code = 'W';
    else if ([...tags].some((t) => FORCE_LIKE.has(t))) code = 'P';
    else if (tags.has('investigative') || tags.has('legal-process') || tags.has('accusation')) code = 'E';
    else if (tags.has('service') || tags.has('relief') || tags.has('protect-assembly') || tags.has('protect-press')) code = 'S';
    else code = 'D';
    out += code;
  }
  return out;
}

export function computeChapterResult(state: GameState, scenario: Scenario, completedAt?: string): ChapterResult {
  const scores = roundScores(state.scores);
  const score = chapterScore(scores);
  const pick = (rules: Scenario['resolution']['resolved']) => rules.filter((r) => checkCondition(r.condition, state)).map((r) => r.text);
  const improvements = pick(scenario.resolution.improvements);
  const manipulations = manipulationsOf(state, scenario);
  const stats = { ...state.stats, manipulationsSucceeded: manipulations.filter((m) => m.succeeded).length };
  const weakest = weakestOf(scores);
  const closing = score >= 70 ? scenario.resolution.closing.good : score >= 50 ? scenario.resolution.closing.mixed : scenario.resolution.closing.poor;
  return {
    scenarioId: scenario.id,
    chapter: scenario.chapter,
    config: state.config,
    scores,
    startScores: roundScores(state.history[0]?.scores ?? state.scores),
    score,
    fingerprint: computeFingerprint(state, scenario),
    resolved: pick(scenario.resolution.resolved),
    unresolved: pick(scenario.resolution.unresolved),
    manipulations,
    rightsProtected: pick(scenario.resolution.rightsProtected),
    rightsHarmed: pick(scenario.resolution.rightsHarmed),
    improvement: improvements[0] ?? IMPROVEMENT_BY_DIMENSION[weakest],
    closing,
    keyDecision: keyDecisionOf(state, scenario),
    missedEvidence: missedEvidenceOf(state, scenario),
    stats,
    durationTicks: state.tick,
    completedAt: completedAt ?? new Date().toISOString(),
  };
}

const VALUE_LABELS: Record<Dimension, string> = {
  freedom: 'Peaceful assembly and free expression',
  grievance: 'A grievance heard and addressed',
  safety: 'Public safety without excess',
  evidence: 'Evidence over rumour',
  trust: 'Public trust in institutions',
  economy: 'Daily life kept moving',
};

export function computeCampaignResult(
  chapters: ChapterResult[],
  meta: { mode: GameMode; seed: number; difficulty: Difficulty; opponents: OpponentId[]; id: string; completedAt: string },
): CampaignResult {
  if (chapters.length === 0) throw new Error('computeCampaignResult needs at least one chapter');
  const last = chapters[chapters.length - 1];
  const finalScores = roundScores(last.scores);
  const avgChapter = chapters.reduce((acc, c) => acc + c.score, 0) / chapters.length;
  const score = clamp(Math.round(0.5 * chapterScore(finalScores) + 0.5 * avgChapter), 0, 100);
  const outcome = classifyOutcome(finalScores);
  let mostConsequential: CampaignResult['mostConsequential'];
  for (const c of chapters) {
    if (c.keyDecision && (!mostConsequential || c.keyDecision.impact > mostConsequential.impact)) {
      mostConsequential = { ...c.keyDecision, scenarioId: c.scenarioId };
    }
  }
  const missedEvidence = chapters.flatMap((c) => c.missedEvidence.map((m) => ({ scenarioId: c.scenarioId, ...m })));
  const valuesProtected = DIMENSIONS.filter((d) => finalScores[d] >= 60)
    .sort((a, b) => finalScores[b] - finalScores[a])
    .slice(0, 3)
    .map((d) => VALUE_LABELS[d]);
  const scenario: ScenarioId | 'campaign' = chapters.length >= 3 ? 'campaign' : chapters[0].scenarioId;
  const challengeCode = encodeChallenge({ v: 1, scenario, seed: meta.seed, difficulty: meta.difficulty, opponents: meta.opponents, score });
  return {
    id: meta.id,
    mode: meta.mode,
    seed: meta.seed,
    difficulty: meta.difficulty,
    opponents: meta.opponents,
    chapters,
    finalScores,
    score,
    outcome,
    mostConsequential,
    missedEvidence,
    valuesProtected,
    hardestDecision: mostConsequential ? `${mostConsequential.title} — ${mostConsequential.optionTitle}` : undefined,
    completedAt: meta.completedAt,
    challengeCode,
  };
}

const EMA = 0.3;

function isCampaign(r: CampaignResult | ChapterResult): r is CampaignResult {
  return (r as CampaignResult).finalScores !== undefined;
}

export function updateRepublic(prev: RepublicCondition, result: CampaignResult | ChapterResult): RepublicCondition {
  const s = isCampaign(result) ? result.finalScores : result.scores;
  const incoming = { freedom: s.freedom, safety: s.safety, trust: s.trust, economy: s.economy, legitimacy: (s.grievance + s.evidence) / 2 };
  const fresh = prev.campaigns === 0 && prev.crises === 0;
  const blend = (old: number, next: number) => round1(fresh ? next : old * (1 - EMA) + next * EMA);
  return {
    freedom: blend(prev.freedom, incoming.freedom),
    safety: blend(prev.safety, incoming.safety),
    trust: blend(prev.trust, incoming.trust),
    economy: blend(prev.economy, incoming.economy),
    legitimacy: blend(prev.legitimacy, incoming.legitimacy),
    campaigns: prev.campaigns + (isCampaign(result) ? 1 : 0),
    crises: prev.crises + (isCampaign(result) ? result.chapters.length : 1),
    updatedAt: result.completedAt,
  };
}

const REPUBLIC_LABELS: Record<keyof Omit<RepublicCondition, 'campaigns' | 'crises' | 'updatedAt'>, string> = {
  freedom: 'freedom',
  safety: 'safety',
  trust: 'trust',
  economy: 'the economy',
  legitimacy: 'institutional legitimacy',
};

export function describeCondition(rep: RepublicCondition): { label: string; summary: string } {
  const keys = ['freedom', 'safety', 'trust', 'economy', 'legitimacy'] as const;
  if (rep.campaigns === 0 && rep.crises === 0) return { label: 'Untested', summary: 'Your Republic has not faced a crisis yet.' };
  const mean = keys.reduce((acc, k) => acc + rep[k], 0) / keys.length;
  let weakest: (typeof keys)[number] = keys[0];
  for (const k of keys) if (rep[k] < rep[weakest]) weakest = k;
  const weakText = `Weakest: ${REPUBLIC_LABELS[weakest]}.`;
  if (mean >= 75) return { label: 'Resilient', summary: `Institutions are trusted and the streets are calm. ${weakText}` };
  if (mean >= 62) return { label: 'Steady', summary: `Holding together under pressure. ${weakText}` };
  if (mean >= 50) return { label: 'Strained', summary: `Functioning, but the cracks show. ${weakText}` };
  if (mean >= 38) return { label: 'Fragile', summary: `One more crisis could tip it. ${weakText}` };
  return { label: 'In crisis', summary: `The Republic is struggling to hold. ${weakText}` };
}

export const DIMENSION_LABEL = DIMENSION_LABELS;
