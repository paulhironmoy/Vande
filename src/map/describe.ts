import type { MapState } from '@/engine/types';

const name = (map: MapState, id: string): string => map.districts.find((d) => d.id === id)?.name ?? id;

/**
 * Plain-English descriptions of what changed between two map states.
 * Deterministic and ordered by importance (incidents first, then crowds, roads, signals, services, trust, actions).
 */
export function describeMapChange(prev: MapState | undefined, next: MapState): string[] {
  if (!prev) return [];
  const out: string[] = [];
  const incidents: string[] = [];
  const crowds: string[] = [];
  const moods: string[] = [];
  const roads: string[] = [];
  const signals: string[] = [];
  const services: string[] = [];
  const trust: string[] = [];
  const actions: string[] = [];
  const institutions: string[] = [];

  for (const d of next.districts) {
    const p = prev.districts.find((x) => x.id === d.id);
    if (!p) continue;
    if (d.incident !== p.incident) {
      if (d.incident === 'vandalism') incidents.push(`Vandalism reported at ${d.name}`);
      else if (d.incident === 'clash') incidents.push(`Clashes at ${d.name}`);
      else if (d.incident === 'fire') incidents.push(`Fire reported at ${d.name}`);
      else if (d.incident === 'outage') incidents.push(`Services down at ${d.name}`);
      else if (d.incident === 'intimidation') incidents.push(`Intimidation reported at ${d.name}`);
      else if (d.incident === null && p.incident) incidents.push(`${d.name} incident contained`);
    }
    const dc = d.crowd - p.crowd;
    if (dc >= 0.12) crowds.push(`Crowd gathering at ${d.name}`);
    else if (dc <= -0.12) crowds.push(`Crowd dispersing at ${d.name}`);
    if (d.mood !== p.mood) {
      if (d.mood === 'volatile') moods.push(`${d.name} turning volatile`);
      else if (d.mood === 'tense') moods.push(`Tension rising at ${d.name}`);
      else if (d.mood === 'hopeful') moods.push(`Mood lifting at ${d.name}`);
      else if (d.mood === 'calm') moods.push(`${d.name} calming`);
    }
    const ds = d.services - p.services;
    if (ds <= -0.2) services.push(`Services failing at ${d.name}`);
    else if (ds >= 0.2) services.push(`Services restored at ${d.name}`);
    const dt = d.trust - p.trust;
    if (dt <= -0.15) trust.push(`Trust falling in ${d.name}`);
    else if (dt >= 0.15) trust.push(`Trust rising in ${d.name}`);
    if (d.institutionActive && !p.institutionActive && d.institution) institutions.push(`${d.institution} responding`);
  }

  for (const r of next.roads) {
    const p = prev.roads.find((x) => x.id === r.id);
    if (!p || p.status === r.status) continue;
    const from = name(next, r.from);
    const to = name(next, r.to);
    if (r.status === 'closed') roads.push(`Road from ${from} to ${to} closed`);
    else if (r.status === 'congested') roads.push(`Congestion on the ${from}–${to} road`);
    else if (r.status === 'open') roads.push(`${from}–${to} road reopened`);
  }

  for (const s of next.signals) {
    if (prev.signals.some((x) => x.id === s.id)) continue;
    const from = name(next, s.from);
    const to = name(next, s.to);
    if (s.kind === 'rumor') signals.push(`Rumour spreading from ${from} to ${to}`);
    else if (s.kind === 'manipulated') signals.push(`Manipulated claim spreading toward ${to}`);
    else if (s.kind === 'verified') signals.push(`Verified update reaching ${to}`);
    else if (s.kind === 'official') signals.push(`Official statement reaching ${to}`);
  }

  const seen = new Set(prev.recentActions.map((a) => `${a.district}|${a.kind}|${a.at}`));
  for (const a of next.recentActions) {
    if (seen.has(`${a.district}|${a.kind}|${a.at}`)) continue;
    const n = name(next, a.district);
    switch (a.kind) {
      case 'deploy':
        actions.push(`Teams deployed at ${n}`);
        break;
      case 'dialogue':
        actions.push(`Dialogue opened at ${n}`);
        break;
      case 'announce':
        actions.push(`Public announcement from ${n}`);
        break;
      case 'investigate':
        actions.push(`Investigation under way at ${n}`);
        break;
      case 'restore':
        actions.push(`Services being restored at ${n}`);
        break;
      case 'protect':
        actions.push(`Protection in place at ${n}`);
        break;
      case 'relief':
        actions.push(`Relief reaching ${n}`);
        break;
      case 'legal':
        actions.push(`Legal process started at ${n}`);
        break;
    }
  }

  out.push(...incidents, ...crowds, ...roads, ...signals, ...institutions, ...services, ...moods, ...trust, ...actions);
  return out;
}
