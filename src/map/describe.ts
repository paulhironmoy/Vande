import type { MapState } from '@/engine/types';
import { simpleInstitutionName } from './simple';

const name = (map: MapState, id: string): string => map.districts.find((d) => d.id === id)?.name ?? id;

export interface DescribeOptions {
  /** Simple play style: very short, plain sentences (≤ 9 words). */
  simple?: boolean;
}

/**
 * Plain-English descriptions of what changed between two map states.
 * Deterministic and ordered by importance (incidents first, then crowds, roads, signals, services, trust, actions).
 */
export function describeMapChange(prev: MapState | undefined, next: MapState, opts: DescribeOptions = {}): string[] {
  if (!prev) return [];
  if (opts.simple) return describeSimple(prev, next);
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

/** Simple play style wording. Same ordering as the full version. */
function describeSimple(prev: MapState, next: MapState): string[] {
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
      if (d.incident === 'vandalism') incidents.push(`A window was broken at ${d.name}`);
      else if (d.incident === 'clash') incidents.push(`A fight started at ${d.name}`);
      else if (d.incident === 'fire') incidents.push(`Fire at ${d.name}`);
      else if (d.incident === 'outage') incidents.push(`Lights out at ${d.name}`);
      else if (d.incident === 'intimidation') incidents.push(`People being scared at ${d.name}`);
      else if (d.incident === null && p.incident) incidents.push(`${d.name} is safe again`);
    }
    const dc = d.crowd - p.crowd;
    if (dc >= 0.12) crowds.push(`Lots of people gathering at ${d.name}`);
    else if (dc <= -0.12) crowds.push(`People leaving ${d.name}`);
    if (d.mood !== p.mood) {
      if (d.mood === 'volatile') moods.push(`People at ${d.name} are getting angry`);
      else if (d.mood === 'tense') moods.push(`People at ${d.name} are worried`);
      else if (d.mood === 'hopeful') moods.push(`People at ${d.name} feel hopeful`);
      else if (d.mood === 'calm') moods.push(`${d.name} is calm now`);
    }
    const ds = d.services - p.services;
    if (ds <= -0.2) services.push(`Shops and buses stopping at ${d.name}`);
    else if (ds >= 0.2) services.push(`Shops and buses running again at ${d.name}`);
    const dt = d.trust - p.trust;
    if (dt <= -0.15) trust.push(`People at ${d.name} trust you less`);
    else if (dt >= 0.15) trust.push(`People at ${d.name} trust you more`);
    if (d.institutionActive && !p.institutionActive && d.institution)
      institutions.push(`The ${simpleInstitutionName(d.institution).toLowerCase()} is helping at ${d.name}`);
  }

  for (const r of next.roads) {
    const p = prev.roads.find((x) => x.id === r.id);
    if (!p || p.status === r.status) continue;
    const to = name(next, r.to);
    const from = name(next, r.from);
    if (r.status === 'closed') roads.push(`Road to ${to} is blocked`);
    else if (r.status === 'congested') roads.push(`Traffic jam near ${from}`);
    else if (r.status === 'open') roads.push(`Road to ${to} is open again`);
  }

  for (const s of next.signals) {
    if (prev.signals.some((x) => x.id === s.id)) continue;
    const from = name(next, s.from);
    const to = name(next, s.to);
    if (s.kind === 'rumor') signals.push(`Rumour moving from ${from} to ${to}`);
    else if (s.kind === 'manipulated') signals.push(`Fake story moving from ${from} to ${to}`);
    else if (s.kind === 'verified') signals.push(`True news reaching ${to}`);
    else if (s.kind === 'official') signals.push(`Official news reaching ${to}`);
  }

  const seen = new Set(prev.recentActions.map((a) => `${a.district}|${a.kind}|${a.at}`));
  for (const a of next.recentActions) {
    if (seen.has(`${a.district}|${a.kind}|${a.at}`)) continue;
    const n = name(next, a.district);
    switch (a.kind) {
      case 'deploy':
        actions.push(`Helpers arriving at ${n}`);
        break;
      case 'dialogue':
        actions.push(`People are talking it over at ${n}`);
        break;
      case 'announce':
        actions.push(`A message to the whole city from ${n}`);
        break;
      case 'investigate':
        actions.push(`Checking what happened at ${n}`);
        break;
      case 'restore':
        actions.push(`Fixing things at ${n}`);
        break;
      case 'protect':
        actions.push(`Keeping people safe at ${n}`);
        break;
      case 'relief':
        actions.push(`Help is reaching ${n}`);
        break;
      case 'legal':
        actions.push(`A fair process started at ${n}`);
        break;
    }
  }

  return [...incidents, ...crowds, ...roads, ...signals, ...institutions, ...services, ...moods, ...trust, ...actions];
}
