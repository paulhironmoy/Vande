import { DIMENSIONS, type GameState, type MapDistrictView, type MapState, type Scenario } from './types';
import { clamp01 } from './state';

const RECENT_ACTION_TICKS = 10;

export function deriveMapState(state: GameState, scenario: Scenario, focus?: string): MapState {
  const pendingByDistrict: Record<string, number> = {};
  for (const id of state.pendingDecisionIds) {
    const dec = scenario.decisions.find((x) => x.id === id);
    if (dec?.district) pendingByDistrict[dec.district] = (pendingByDistrict[dec.district] ?? 0) + 1;
  }
  const openByDistrict: Record<string, number> = {};
  for (const item of scenario.evidence) {
    const es = state.evidence[item.id];
    if (!es || !es.visible || es.destroyed || !item.district) continue;
    const open = es.state === 'unverified' || es.markedUnresolved;
    if (open) openByDistrict[item.district] = (openByDistrict[item.district] ?? 0) + 1;
  }
  const districts: MapDistrictView[] = scenario.districts.map((def) => {
    const ds = state.districts[def.id];
    return {
      id: def.id,
      name: def.name,
      kind: def.kind,
      x: def.x,
      y: def.y,
      crowd: ds?.crowd ?? def.baseline.crowd,
      mood: ds?.mood ?? 'calm',
      trust: ds?.trust ?? def.baseline.trust,
      services: ds?.services ?? def.baseline.services,
      institution: def.institution,
      institutionActive: !!ds && ds.institutionActiveUntil >= state.tick,
      incident: ds?.incident ?? null,
      lastAction: ds?.lastAction,
      pendingDecisions: pendingByDistrict[def.id] ?? 0,
      openEvidence: openByDistrict[def.id] ?? 0,
    };
  });
  const roads = scenario.roads.map((r) => ({ id: r.id, from: r.from, to: r.to, status: state.roads[r.id] ?? 'open' }));
  const signals = state.signals
    .filter((sg) => sg.startedAt <= state.tick && sg.endsAt >= state.tick)
    .map((sg) => ({
      id: sg.id,
      from: sg.from,
      to: sg.to,
      kind: sg.kind,
      progress: sg.endsAt === sg.startedAt ? 1 : clamp01((state.tick - sg.startedAt) / (sg.endsAt - sg.startedAt)),
    }));
  const meanScore = DIMENSIONS.reduce((acc, d) => acc + state.scores[d], 0) / DIMENSIONS.length / 100;
  const avgTrust = districts.length ? districts.reduce((acc, d) => acc + d.trust, 0) / districts.length : 0.5;
  const health = clamp01(0.7 * meanScore + 0.3 * avgTrust);
  const recentActions = districts
    .filter((d) => d.lastAction && state.tick - d.lastAction.at <= RECENT_ACTION_TICKS)
    .map((d) => ({ district: d.id, kind: d.lastAction!.kind, at: d.lastAction!.at }));
  return { tick: state.tick, districts, roads, signals, health: Math.round(health * 100) / 100, recentActions, focus };
}
