/**
 * Plain-language words for the map in the Simple play style (young or new players).
 * Short, concrete, no jargon. Everything here mirrors the full-language helpers in layout.ts / describe.ts.
 */
import type { MapDistrictView } from '@/engine/types';

const INSTITUTIONS: Record<string, string> = {
  'District Collectorate': 'City office',
  'University Registrar': 'Exam office',
  'Election Records Office': 'Vote office',
  'Transit Authority': 'Bus and train office',
  'Press Club': "Reporters' building",
  'Civil Hospital': 'Hospital',
};

/** Kid-friendly display name for an institution; unknown names pass through unchanged. */
export function simpleInstitutionName(name: string | undefined): string {
  if (!name) return '';
  return INSTITUTIONS[name] ?? name;
}

export function simpleCrowdWords(crowd: number): string {
  if (crowd < 0.06) return 'nobody around';
  if (crowd < 0.22) return 'a few people';
  if (crowd < 0.45) return 'some people';
  if (crowd < 0.72) return 'lots of people';
  return 'a huge crowd';
}

export function simpleMoodWords(mood: MapDistrictView['mood']): string {
  switch (mood) {
    case 'calm':
      return 'calm';
    case 'tense':
      return 'worried';
    case 'volatile':
      return 'angry';
    case 'hopeful':
      return 'hopeful';
  }
}

export function simpleTrustWords(trust: number): string {
  if (trust < 0.4) return 'trust low';
  if (trust < 0.65) return 'trust okay';
  return 'trust good';
}

export function simpleIncidentWords(incident: MapDistrictView['incident']): string | null {
  switch (incident) {
    case 'vandalism':
      return 'a window was broken';
    case 'clash':
      return 'a fight started';
    case 'fire':
      return 'fire';
    case 'outage':
      return 'lights out';
    case 'intimidation':
      return 'people being scared';
    default:
      return null;
  }
}

/** Accessible name for a district button in the Simple play style. */
export function simpleDistrictAriaLabel(d: MapDistrictView): string {
  const parts = [`${d.name}: ${simpleCrowdWords(d.crowd)}, ${simpleMoodWords(d.mood)}, ${simpleTrustWords(d.trust)}`];
  const inc = simpleIncidentWords(d.incident);
  if (inc) parts.push(inc);
  if (d.institutionActive && d.institution) parts.push(`the ${simpleInstitutionName(d.institution).toLowerCase()} is helping`);
  if (d.pendingDecisions > 0) parts.push(`${d.pendingDecisions} ${d.pendingDecisions === 1 ? 'choice' : 'choices'} waiting`);
  if (d.openEvidence > 0) parts.push(`${d.openEvidence} ${d.openEvidence === 1 ? 'clue' : 'clues'}`);
  return parts.join(', ');
}
