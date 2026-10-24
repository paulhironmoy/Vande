/** Internal helpers shared by the simulation modules. Not part of the public API. */
import {
  DIMENSIONS,
  type Condition,
  type Dimension,
  type DistrictMood,
  type FeedKind,
  type GameState,
  type MapEffect,
  type Scenario,
  type ScoreDelta,
} from './types';
import { rngFloat, rngInt } from './prng';

export type Draft = GameState;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const round1 = (v: number): number => Math.round(v * 10) / 10;
export const round4 = (v: number): number => Math.round(v * 10000) / 10000;

export function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function nextId(d: Draft, prefix: string): string {
  d.counter += 1;
  return `${prefix}${d.counter}`;
}

export function drawFloat(d: Draft): number {
  const r = rngFloat(d.rng);
  d.rng = r.next;
  return r.value;
}

export function drawInt(d: Draft, lo: number, hi: number): number {
  const r = rngInt(d.rng, lo, hi);
  d.rng = r.next;
  return r.value;
}

export function pushFeed(
  d: Draft,
  kind: FeedKind,
  text: string,
  dims?: Dimension[],
  direction?: Partial<Record<Dimension, 'up' | 'down'>>,
): void {
  d.feed.push({ id: nextId(d, 'f'), tick: d.tick, kind, text, dims: dims && dims.length ? dims : undefined, direction });
  if (d.feed.length > 80) d.feed.splice(0, d.feed.length - 80);
}

export function checkCondition(c: Condition | undefined, s: GameState): boolean {
  if (!c) return true;
  if (c.flag && !s.flags[c.flag]) return false;
  if (c.notFlag && s.flags[c.notFlag]) return false;
  if (c.anyFlag && !c.anyFlag.some((f) => s.flags[f])) return false;
  if (c.minScore) for (const [k, v] of Object.entries(c.minScore)) if (v !== undefined && s.scores[k as Dimension] < v) return false;
  if (c.maxScore) for (const [k, v] of Object.entries(c.maxScore)) if (v !== undefined && s.scores[k as Dimension] > v) return false;
  if (c.opponent && !s.config.opponents.includes(c.opponent)) return false;
  if (c.notOpponent && s.config.opponents.includes(c.notOpponent)) return false;
  if (c.evidence) {
    const es = s.evidence[c.evidence.id];
    if (!es || !c.evidence.states.includes(es.state)) return false;
  }
  return true;
}

export interface DeltaSummary {
  dims: Dimension[];
  direction: Partial<Record<Dimension, 'up' | 'down'>>;
}

export function applyScoreDelta(d: Draft, delta: ScoreDelta | undefined, scale = 1): DeltaSummary {
  const summary: DeltaSummary = { dims: [], direction: {} };
  if (!delta) return summary;
  for (const dim of DIMENSIONS) {
    const raw = delta[dim];
    if (!raw) continue;
    const v = raw * scale;
    d.scores[dim] = clamp(d.scores[dim] + v, 0, 100);
    summary.dims.push(dim);
    summary.direction[dim] = v > 0 ? 'up' : 'down';
  }
  return summary;
}

export function setFlags(d: Draft, flags?: string[]): void {
  if (!flags) return;
  for (const f of flags) d.flags[f] = true;
}

export function clearFlags(d: Draft, flags?: string[]): void {
  if (!flags) return;
  for (const f of flags) delete d.flags[f];
}

const SIGNAL_TRAVEL_TICKS = 12;
const INSTITUTION_ACTIVE_TICKS = 10;

export function applyMapEffects(d: Draft, scenario: Scenario, effects: MapEffect[] | undefined, scale = 1): void {
  if (!effects) return;
  for (const e of effects) {
    const ds = e.district ? d.districts[e.district] : undefined;
    switch (e.kind) {
      case 'crowd':
        if (ds && e.magnitude !== undefined) ds.crowd = round4(clamp01(ds.crowd + e.magnitude * (e.magnitude > 0 ? scale : 1)));
        break;
      case 'mood':
        if (ds && e.mood) ds.mood = e.mood;
        break;
      case 'road':
        if (e.road && e.status && d.roads[e.road] !== undefined) d.roads[e.road] = e.status;
        break;
      case 'institution':
        if (ds) ds.institutionActiveUntil = d.tick + Math.max(1, Math.round(e.magnitude ?? INSTITUTION_ACTIVE_TICKS));
        break;
      case 'service':
        if (ds && e.magnitude !== undefined) ds.services = round4(clamp01(ds.services + e.magnitude * (e.magnitude < 0 ? scale : 1)));
        break;
      case 'signal':
        if (e.from && e.to && e.signal && d.districts[e.from] && d.districts[e.to]) {
          d.signals.push({ id: nextId(d, 's'), from: e.from, to: e.to, kind: e.signal, startedAt: d.tick, endsAt: d.tick + SIGNAL_TRAVEL_TICKS });
        }
        break;
      case 'incident':
        if (ds && e.incident !== undefined) {
          ds.incident = e.incident;
          if (e.incident) ds.mood = 'volatile';
        }
        break;
      case 'trust':
        if (ds && e.magnitude !== undefined) ds.trust = round4(clamp01(ds.trust + e.magnitude * (e.magnitude < 0 ? scale : 1)));
        break;
      case 'action':
        if (ds && e.action) {
          ds.lastAction = { kind: e.action, at: d.tick };
          if (ds.incident && ['deploy', 'protect', 'restore', 'relief'].includes(e.action)) ds.incident = null;
          if (scenario.districts.find((x) => x.id === e.district)?.institution) ds.institutionActiveUntil = Math.max(ds.institutionActiveUntil, d.tick + 6);
        }
        break;
      default:
        break;
    }
  }
}

export function deriveMood(crowd: number, trust: number, scores: GameState['scores']): DistrictMood {
  if (crowd > 0.6 && scores.safety < 50) return 'volatile';
  if (crowd > 0.35 || trust < 0.4) return 'tense';
  if (trust > 0.65 && scores.grievance > 60) return 'hopeful';
  return 'calm';
}

/** Makes an evidence item visible. Returns false when it was already visible or does not exist. */
export function revealEvidence(d: Draft, scenario: Scenario, id: string, kind: FeedKind, message?: string): boolean {
  const es = d.evidence[id];
  const item = scenario.evidence.find((e) => e.id === id);
  if (!es || !item || es.visible) return false;
  es.visible = true;
  es.arrivedAt = d.tick;
  es.updatedAt = d.tick;
  if (item.initialState === item.resolvedState) setFlags(d, item.setsFlagsOnResolve);
  pushFeed(d, kind, message ?? `New evidence — ${item.title} (${item.source})`);
  return true;
}

export function openDecision(d: Draft, scenario: Scenario, decisionId: string, kind: FeedKind = 'decision', message?: string): boolean {
  const decision = scenario.decisions.find((x) => x.id === decisionId);
  if (!decision || d.decisions[decisionId]) return false;
  d.decisions[decisionId] = {
    id: decisionId,
    status: 'pending',
    appearedAt: d.tick,
    expiresAt: d.tick + decision.expiresAfter,
  };
  d.pendingDecisionIds.push(decisionId);
  pushFeed(d, kind, message ?? `Decision needed — ${decision.title}`);
  return true;
}
