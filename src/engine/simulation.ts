import {
  DIMENSIONS,
  type ActionTag,
  type DecisionOption,
  type DecisionState,
  type Dimension,
  type DistrictState,
  type GameConfig,
  type GameState,
  type GameStats,
  type OpponentPlay,
  type PlayerAction,
  type Scenario,
  type ScenarioDecision,
  type ScenarioEvent,
  type ScoreDelta,
  type Scores,
} from './types';
import { createRng, hashString } from './prng';
import { adaptOpponents, canonicalOpponents, scheduleOpponents } from './opponents';
import { applyEvidenceVerb } from './evidence';
import {
  applyMapEffects,
  applyScoreDelta,
  checkCondition,
  clamp,
  clamp01,
  clearFlags,
  clone,
  deriveMood,
  nextId,
  openDecision,
  pushFeed,
  revealEvidence,
  round1,
  round4,
  setFlags,
  type Draft,
} from './state';

const HISTORY_EVERY = 5;
const UNDO_REOPEN_TICKS = 10;
const FORCE_TAGS: ActionTag[] = ['force', 'detention', 'suppressive'];
const KIND_CROWD_WEIGHT: Record<string, number> = {
  campus: 1, civic: 1, transit: 0.6, records: 0.5, media: 0.4, residential: 0.4, market: 0.35, industrial: 0.3, hospital: 0.2,
};

export function roundScores(s: Scores): Scores {
  const out = { ...s };
  for (const d of DIMENSIONS) out[d] = round1(out[d]);
  return out;
}

function emptyStats(): GameStats {
  return {
    decisionsMade: 0, decisionsExpired: 0, falseAccusations: 0, disproportionateActions: 0, unverifiedActions: 0,
    manipulationsDetected: 0, manipulationsSucceeded: 0, evidenceResolved: 0, evidencePreserved: 0, evidenceDestroyed: 0,
    rightsCorrect: 0, rightsTotal: 0,
  };
}

export function createGame(config: GameConfig, scenario: Scenario): GameState {
  const opponents = canonicalOpponents(config.opponents);
  const normalised: GameConfig = { ...config, opponents, seed: config.seed >>> 0 };
  const seedMix = hashString(`${scenario.id}|${normalised.seed}|${normalised.difficulty}|${opponents.join(',')}`);
  const scheduled = scheduleOpponents(scenario, normalised, createRng(seedMix));
  const scores: Scores = { ...(config.carryScores ?? scenario.startingScores) };
  const districts: Record<string, DistrictState> = {};
  for (const d of scenario.districts) {
    districts[d.id] = {
      id: d.id,
      crowd: d.baseline.crowd,
      mood: deriveMood(d.baseline.crowd, d.baseline.trust, scores),
      trust: d.baseline.trust,
      services: d.baseline.services,
      institutionActiveUntil: -1,
      incident: null,
    };
  }
  const roads: GameState['roads'] = {};
  for (const r of scenario.roads) roads[r.id] = 'open';
  const evidence: GameState['evidence'] = {};
  for (const e of scenario.evidence) {
    evidence[e.id] = {
      id: e.id, visible: false, arrivedAt: -1, state: e.initialState, inspected: false, compared: false,
      preserved: false, markedUnresolved: false, destroyed: false, updatedAt: -1,
    };
  }
  return {
    version: 1,
    config: normalised,
    tick: 0,
    duration: scenario.duration,
    status: 'briefing',
    rng: scheduled.rng,
    scores,
    history: [{ tick: 0, scores: roundScores(scores) }],
    districts,
    roads,
    signals: [],
    evidence,
    decisions: {},
    pendingDecisionIds: [],
    rights: {},
    pendingRightsIds: [],
    feed: [],
    flags: {},
    delayed: [],
    opponents: scheduled.runtimes,
    log: [],
    stats: emptyStats(),
    counter: 0,
  };
}

export function timeLeft(state: GameState): number {
  return Math.max(0, state.duration - state.tick);
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

export function reduce(state: GameState, action: PlayerAction, scenario: Scenario): GameState {
  if (state.status === 'ended') return state;
  const d = clone(state);
  let changed = false;
  switch (action.type) {
    case 'start':
      if (d.status === 'briefing' || d.status === 'paused') {
        d.status = 'running';
        if (state.status === 'briefing') pushFeed(d, 'system', 'The crisis is live. Hear the grievance, verify, then act.');
        changed = true;
      }
      break;
    case 'pause':
      if (d.status === 'running') {
        d.status = 'paused';
        changed = true;
      }
      break;
    case 'resume':
      if (d.status === 'paused') {
        d.status = 'running';
        changed = true;
      }
      break;
    case 'decide':
      changed = resolveDecision(d, scenario, action.decisionId, action.optionId, false);
      break;
    case 'undo':
      changed = undoDecision(d, scenario);
      break;
    case 'evidence':
      changed = applyEvidenceVerb(d, scenario, action.evidenceId, action.verb, action.compareWith);
      break;
    case 'rights':
      changed = answerRights(d, scenario, action.momentId, action.optionId);
      break;
    default:
      break;
  }
  if (!changed) return state;
  d.log.push(action);
  return d;
}

function optionOf(decision: ScenarioDecision, optionId: string): DecisionOption | undefined {
  return decision.options.find((o) => o.id === optionId);
}

function enforceFloor(delta: ScoreDelta, dim: Dimension, atMost: number): void {
  const v = delta[dim] ?? 0;
  if (v > atMost) delta[dim] = atMost;
}

function resolveDecision(d: Draft, scenario: Scenario, decisionId: string, optionId: string, auto: boolean): boolean {
  const decision = scenario.decisions.find((x) => x.id === decisionId);
  const ds = d.decisions[decisionId];
  if (!decision || !ds || ds.status !== 'pending') return false;
  const option = optionOf(decision, optionId);
  if (!option) return false;

  const before: Omit<GameState, 'undo'> = (() => {
    const copy = clone(d);
    delete copy.undo;
    return copy;
  })();

  const relied = option.requiresEvidence ?? [];
  const reliedViews = relied.map((id) => ({ id, item: scenario.evidence.find((e) => e.id === id), es: d.evidence[id] }));
  const isAccusation = option.tags.includes('accusation');
  const falseBasis = isAccusation && reliedViews.some((r) => r.item && (r.item.truth === 'false' || r.item.truth === 'misleading') && r.es.state !== 'manipulated');
  const unverifiedBasis = reliedViews.some((r) => !r.es.visible || r.es.destroyed || r.es.state === 'unverified' || r.es.state === 'unknown');
  const forceLike = option.tags.some((t) => FORCE_TAGS.includes(t));
  const disproportionate = option.tags.includes('disproportionate') || (forceLike && !!option.proportionateIf && !checkCondition(option.proportionateIf, d));

  const delta: ScoreDelta = { ...(falseBasis && option.falseAccusationEffects ? option.falseAccusationEffects : option.effects) };
  if (falseBasis) {
    if (!option.falseAccusationEffects) {
      delta.freedom = (delta.freedom ?? 0) - 12;
      delta.trust = (delta.trust ?? 0) - 10;
      delta.evidence = (delta.evidence ?? 0) - 8;
    }
    enforceFloor(delta, 'freedom', -8);
    enforceFloor(delta, 'trust', -8);
  }
  if (disproportionate) {
    const extra = option.disproportionateEffects ?? { freedom: -10, trust: -8 };
    for (const [k, v] of Object.entries(extra)) if (v) delta[k as Dimension] = (delta[k as Dimension] ?? 0) + v;
    enforceFloor(delta, 'freedom', -6);
    enforceFloor(delta, 'trust', -6);
  }
  const summary = applyScoreDelta(d, delta);

  const sourceId = `${decisionId}:${optionId}`;
  for (const spec of option.delayed ?? []) {
    d.delayed.push({
      id: nextId(d, 'd'), dueAt: d.tick + spec.afterTicks, effects: spec.effects, message: spec.message,
      condition: spec.condition, mapEffects: spec.mapEffects, setsFlags: spec.setsFlags, sourceId,
    });
  }
  applyMapEffects(d, scenario, option.mapEffects);
  setFlags(d, option.setsFlags);
  clearFlags(d, option.clearsFlags);
  for (const id of option.unlocksEvidence ?? []) revealEvidence(d, scenario, id, 'evidence');
  for (const r of reliedViews) if (r.es.visible) r.es.usedInDecision = decisionId;

  const resolved: DecisionState = {
    ...ds, status: auto ? 'expired' : 'resolved', chosenOption: optionId, decidedAt: d.tick, auto: auto || undefined,
    falseAccusation: falseBasis || undefined, disproportionate: disproportionate || undefined, unverifiedBasis: unverifiedBasis || undefined,
  };
  d.decisions[decisionId] = resolved;
  d.pendingDecisionIds = d.pendingDecisionIds.filter((id) => id !== decisionId);

  if (auto) d.stats.decisionsExpired += 1;
  else d.stats.decisionsMade += 1;
  if (falseBasis) d.stats.falseAccusations += 1;
  if (disproportionate) d.stats.disproportionateActions += 1;
  if (unverifiedBasis && relied.length > 0) d.stats.unverifiedActions += 1;

  let warning: NonNullable<GameState['lastFeedback']>['warning'];
  let text = option.consequence;
  if (falseBasis) {
    warning = 'false-accusation';
    text = `${option.consequence} The claim it rested on was false: a false accusation, and people saw it.`;
  } else if (disproportionate) {
    warning = 'disproportionate';
    text = `${option.consequence} The response was out of proportion to the threat, and it showed.`;
  } else if (unverifiedBasis && relied.length > 0) {
    warning = 'unverified-basis';
    text = `${option.consequence} You acted before the evidence was verified.`;
  }
  d.lastFeedback = { tick: d.tick, title: option.title, text, dims: summary.dims, direction: summary.direction, warning, mapEffects: option.mapEffects };
  pushFeed(d, 'decision', auto ? `No decision on “${decision.title}” — ${option.title.toLowerCase()} by default. ${option.consequence}` : `${option.title}. ${text}`, summary.dims, summary.direction);

  if (!auto && decision.rightsMomentId && !d.rights[decision.rightsMomentId]) {
    d.rights[decision.rightsMomentId] = { id: decision.rightsMomentId, status: 'pending', appearedAt: d.tick };
    d.pendingRightsIds.push(decision.rightsMomentId);
    d.stats.rightsTotal += 1;
  }

  delete d.undo;
  if (!auto && option.undoTicks && !falseBasis && !disproportionate) {
    d.undo = { decisionId, optionId, expiresAt: d.tick + option.undoTicks, snapshot: before };
  }
  adaptOpponents(d, scenario, option.tags);
  return true;
}

/**
 * Reverses the last undoable decision. Score deltas are inverted, scheduled delayed effects removed and
 * the decision reopened; events that fired in between are kept (the snapshot only restores the decision slices).
 */
function undoDecision(d: Draft, scenario: Scenario): boolean {
  const u = d.undo;
  if (!u || d.tick > u.expiresAt) return false;
  const decision = scenario.decisions.find((x) => x.id === u.decisionId);
  const option = decision ? optionOf(decision, u.optionId) : undefined;
  if (!decision || !option) return false;
  const inverse: ScoreDelta = {};
  for (const [k, v] of Object.entries(option.effects)) if (v) inverse[k as Dimension] = -v;
  applyScoreDelta(d, inverse);
  d.delayed = d.delayed.filter((x) => x.sourceId !== `${u.decisionId}:${u.optionId}`);
  clearFlags(d, option.setsFlags);
  setFlags(d, option.clearsFlags);
  const prev = u.snapshot.decisions[u.decisionId];
  d.decisions[u.decisionId] = { ...prev, status: 'pending', expiresAt: Math.max(prev.expiresAt, d.tick + UNDO_REOPEN_TICKS) };
  if (!d.pendingDecisionIds.includes(u.decisionId)) d.pendingDecisionIds.unshift(u.decisionId);
  for (const id of option.requiresEvidence ?? []) {
    const es = d.evidence[id];
    if (es && es.usedInDecision === u.decisionId) delete es.usedInDecision;
  }
  if (decision.rightsMomentId && d.rights[decision.rightsMomentId]?.status === 'pending') {
    delete d.rights[decision.rightsMomentId];
    d.pendingRightsIds = d.pendingRightsIds.filter((id) => id !== decision.rightsMomentId);
    d.stats.rightsTotal = Math.max(0, d.stats.rightsTotal - 1);
  }
  d.stats.decisionsMade = Math.max(0, d.stats.decisionsMade - 1);
  d.lastFeedback = { tick: d.tick, title: 'Reversed', text: `${option.title} was withdrawn before it took effect.`, dims: [], direction: {} };
  pushFeed(d, 'system', `Reversed: ${option.title}.`);
  delete d.undo;
  return true;
}

function answerRights(d: Draft, scenario: Scenario, momentId: string, optionId: string): boolean {
  const moment = scenario.rightsMoments.find((m) => m.id === momentId);
  const rs = d.rights[momentId];
  if (!moment || !rs || rs.status !== 'pending') return false;
  const opt = moment.options.find((o) => o.id === optionId);
  if (!opt) return false;
  rs.status = 'answered';
  rs.chosenOption = optionId;
  rs.correct = opt.correct;
  d.pendingRightsIds = d.pendingRightsIds.filter((id) => id !== momentId);
  if (opt.correct) {
    d.stats.rightsCorrect += 1;
    const summary = applyScoreDelta(d, { trust: 2, evidence: 1 });
    pushFeed(d, 'rights', `Principle applied: ${moment.principle}`, summary.dims, summary.direction);
  } else {
    pushFeed(d, 'rights', `Principle to remember: ${moment.principle}`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export function tick(state: GameState, scenario: Scenario, n = 1): GameState {
  if (state.status !== 'running' || n <= 0) return state;
  const d = clone(state);
  for (let i = 0; i < n && d.status === 'running'; i++) stepOnce(d, scenario);
  return d;
}

function fireEvent(d: Draft, scenario: Scenario, ev: ScenarioEvent, scale: number, kind: 'event' | 'opponent'): void {
  const summary = applyScoreDelta(d, ev.effects, scale);
  applyMapEffects(d, scenario, ev.mapEffects, scale);
  setFlags(d, ev.setsFlags);
  clearFlags(d, ev.clearsFlags);
  pushFeed(d, kind, ev.message, summary.dims, summary.direction);
}

function firePlay(d: Draft, scenario: Scenario, play: OpponentPlay): void {
  const rt = d.opponents[play.opponent];
  if (!rt) return;
  rt.fired.push(play.id);
  if (!checkCondition(play.condition, d)) return;
  switch (play.kind) {
    case 'inject-evidence': {
      const item = scenario.evidence.find((e) => e.id === play.target);
      if (item) revealEvidence(d, scenario, play.target, 'opponent', play.message ?? `Circulating now — ${item.title} (${item.source})`);
      break;
    }
    case 'event': {
      const ev = scenario.events.find((e) => e.id === play.target);
      if (ev && checkCondition(ev.condition, d)) fireEvent(d, scenario, ev, rt.intensity, 'opponent');
      break;
    }
    case 'decision': {
      const dec = scenario.decisions.find((x) => x.id === play.target);
      if (dec && checkCondition(dec.condition, d)) openDecision(d, scenario, dec.id, 'opponent', play.message);
      break;
    }
    case 'destroy-evidence': {
      const item = scenario.evidence.find((e) => e.id === play.target);
      const es = d.evidence[play.target];
      if (!item || !es || !es.visible || es.destroyed) return;
      if (es.preserved) {
        pushFeed(d, 'opponent', `An attempt to destroy ${item.title} failed. It had been preserved.`);
        return;
      }
      if (!item.perishable) return;
      es.destroyed = true;
      es.updatedAt = d.tick;
      d.stats.evidenceDestroyed += 1;
      const summary = applyScoreDelta(d, { evidence: -4 }, rt.intensity);
      pushFeed(d, 'opponent', play.message ?? `${item.title} was destroyed before it could be secured.`, summary.dims, summary.direction);
      break;
    }
    default:
      break;
  }
}

function driftDistricts(d: Draft, scenario: Scenario): void {
  const pressure = (100 - d.scores.grievance) / 100;
  const fear = d.scores.safety < 40 ? 0.1 : 0;
  for (const def of scenario.districts) {
    const ds = d.districts[def.id];
    if (!ds) continue;
    const w = KIND_CROWD_WEIGHT[def.kind] ?? 0.4;
    const targetCrowd = clamp01(def.baseline.crowd + (0.5 * pressure + fear) * w);
    ds.crowd = round4(ds.crowd + (targetCrowd - ds.crowd) * 0.02);
    const targetTrust = clamp01(0.7 * (d.scores.trust / 100) + 0.3 * def.baseline.trust);
    ds.trust = round4(ds.trust + (targetTrust - ds.trust) * 0.03);
    const targetServices = clamp01(def.baseline.services * (0.55 + 0.45 * (d.scores.economy / 100)));
    ds.services = round4(ds.services + (targetServices - ds.services) * 0.03);
    if (ds.incident) {
      ds.mood = 'volatile';
      if (d.scores.safety >= 70 && d.tick % 20 === 0) ds.incident = null;
    } else if (d.tick % 12 === 0) {
      ds.mood = deriveMood(ds.crowd, ds.trust, d.scores);
    }
  }
}

function stepOnce(d: Draft, scenario: Scenario): void {
  d.tick += 1;
  const t = d.tick;

  // Timeline events fire at their tick; events authored with `at` beyond the duration only fire through plays.
  for (const ev of scenario.events) {
    if (ev.at === t && checkCondition(ev.condition, d)) fireEvent(d, scenario, ev, 1, 'event');
  }
  for (const item of scenario.evidence) {
    if (!item.injectedBy && item.availableAt === t) revealEvidence(d, scenario, item.id, 'evidence');
  }
  for (const dec of scenario.decisions) {
    if (d.decisions[dec.id]) continue;
    const byTick = dec.triggerAt === t;
    const byFlag = !!dec.triggerFlag && !!d.flags[dec.triggerFlag];
    if ((byTick || byFlag) && checkCondition(dec.condition, d)) openDecision(d, scenario, dec.id);
  }
  for (const rt of Object.values(d.opponents)) {
    for (const [playId, at] of Object.entries(rt.schedule)) {
      if (at > t || rt.fired.includes(playId)) continue;
      const play = scenario.opponentPlays.find((p) => p.id === playId);
      if (play) firePlay(d, scenario, play);
      else rt.fired.push(playId);
    }
  }
  if (d.delayed.length) {
    const due = d.delayed.filter((x) => x.dueAt <= t);
    d.delayed = d.delayed.filter((x) => x.dueAt > t);
    for (const de of due) {
      if (!checkCondition(de.condition, d)) continue;
      const summary = applyScoreDelta(d, de.effects);
      applyMapEffects(d, scenario, de.mapEffects);
      setFlags(d, de.setsFlags);
      pushFeed(d, 'delayed', de.message, summary.dims, summary.direction);
    }
  }
  for (const id of [...d.pendingDecisionIds]) {
    const ds = d.decisions[id];
    const dec = scenario.decisions.find((x) => x.id === id);
    if (ds && dec && ds.expiresAt <= t) resolveDecision(d, scenario, id, dec.defaultOption, true);
  }
  for (const sg of d.signals) {
    if (sg.endsAt !== t) continue;
    const dest = d.districts[sg.to];
    if (!dest) continue;
    const delta = sg.kind === 'rumor' || sg.kind === 'manipulated' ? -0.05 : 0.04;
    dest.trust = round4(clamp01(dest.trust + delta));
  }
  d.signals = d.signals.filter((sg) => sg.endsAt >= t);
  if (d.undo && d.undo.expiresAt <= t) delete d.undo;
  driftDistricts(d, scenario);
  if (t % HISTORY_EVERY === 0) d.history.push({ tick: t, scores: roundScores(d.scores) });
  if (t >= d.duration) endChapter(d, scenario);
}

function endChapter(d: Draft, scenario: Scenario): void {
  for (const id of [...d.pendingDecisionIds]) {
    const dec = scenario.decisions.find((x) => x.id === id);
    if (dec) resolveDecision(d, scenario, id, dec.defaultOption, true);
  }
  d.pendingRightsIds = [];
  delete d.undo;
  if (d.history[d.history.length - 1]?.tick !== d.tick) d.history.push({ tick: d.tick, scores: roundScores(d.scores) });
  d.status = 'ended';
  pushFeed(d, 'system', 'The chapter closes. The city settles into what you decided.');
}

export { clamp };
