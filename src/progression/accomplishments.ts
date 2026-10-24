/**
 * Civic Passport accomplishments: behaviour-based, explained, earned once. Data-driven: add an entry here
 * and it appears on the Passport screen and is evaluated after every completed daily or chapter.
 * No counters, no streaks, nothing that rewards repeating a meaningless action.
 */
import type { ChapterResult, ScenarioId } from '@/engine/types';
import type { IconName } from '@/components/ui/Icon';

export interface AccomplishmentContext {
  result: ChapterResult;
  /** Strategy fingerprint letters for this run (D/E/S/P/X/W per decision). */
  fingerprint: string;
  official: boolean;
  dailyId?: string;
  scenarioId?: ScenarioId;
}

export interface AccomplishmentDefinition {
  id: string;
  title: string;
  simpleTitle: string;
  icon: IconName;
  /** ≤ 8 words: how to earn it. */
  howTo: string;
  simpleHowTo: string;
  /** Returns the plain reason it was earned, or null. */
  evaluate(ctx: AccomplishmentContext): string | null;
}

const count = (fp: string, letter: string) => fp.split('').filter((c) => c === letter).length;

export const ACCOMPLISHMENTS: readonly AccomplishmentDefinition[] = [
  {
    id: 'evidence-first',
    title: 'Evidence First',
    simpleTitle: 'Clue Checker',
    icon: 'eye',
    howTo: 'Check three clues, act on none unchecked.',
    simpleHowTo: 'Check three clues before acting.',
    evaluate: ({ result }) => {
      const s = result.stats;
      if (s.evidenceResolved >= 3 && s.unverifiedActions === 0 && s.falseAccusations === 0) return `You checked ${s.evidenceResolved} clues and never acted on an unchecked one.`;
      return null;
    },
  },
  {
    id: 'rights-guardian',
    title: 'Rights Guardian',
    simpleTitle: 'Freedom Keeper',
    icon: 'shield',
    howTo: 'No harsh action; freedom ends at 70+.',
    simpleHowTo: 'Stay fair and keep freedom high.',
    evaluate: ({ result }) => {
      const s = result.stats;
      if (s.disproportionateActions === 0 && s.falseAccusations === 0 && result.scores.freedom >= 70) return `No harsh or sweeping action, and freedom ended at ${Math.round(result.scores.freedom)}.`;
      return null;
    },
  },
  {
    id: 'coalition-builder',
    title: 'Coalition Builder',
    simpleTitle: 'Bridge Builder',
    icon: 'users',
    howTo: 'Talk first twice; trust ends at 65+.',
    simpleHowTo: 'Talk to people and keep trust high.',
    evaluate: ({ result, fingerprint }) => {
      if (count(fingerprint, 'D') >= 2 && result.scores.trust >= 65) return `You chose dialogue ${count(fingerprint, 'D')} times and trust ended at ${Math.round(result.scores.trust)}.`;
      return null;
    },
  },
  {
    id: 'institutional-reformer',
    title: 'Institutional Reformer',
    simpleTitle: 'Problem Fixer',
    icon: 'building',
    howTo: 'Two proper checks; the problem gets solved.',
    simpleHowTo: 'Use proper checks to fix the problem.',
    evaluate: ({ result, fingerprint }) => {
      if (count(fingerprint, 'E') >= 2 && result.scores.grievance >= 65) return `Proper checks ${count(fingerprint, 'E')} times, and the real problem was fixed (${Math.round(result.scores.grievance)}).`;
      return null;
    },
  },
  {
    id: 'calm-under-pressure',
    title: 'Calm Under Pressure',
    simpleTitle: 'Cool Head',
    icon: 'clock',
    howTo: 'Answer every decision in time, nothing harsh.',
    simpleHowTo: 'Answer everything in time, stay calm.',
    evaluate: ({ result, fingerprint }) => {
      const s = result.stats;
      if (s.decisionsExpired === 0 && s.decisionsMade >= 4 && !fingerprint.includes('X')) return `All ${s.decisionsMade} decisions answered in time, none of them harsh.`;
      return null;
    },
  },
  {
    id: 'transparent-leader',
    title: 'Transparent Leader',
    simpleTitle: 'Open Leader',
    icon: 'megaphone',
    howTo: 'Tell people the facts; trust rises 10+.',
    simpleHowTo: 'Share the facts and earn trust.',
    evaluate: ({ result, fingerprint }) => {
      const rise = result.scores.trust - result.startScores.trust;
      if (count(fingerprint, 'D') >= 1 && rise >= 10) return `You kept people informed and trust rose by ${Math.round(rise)}.`;
      return null;
    },
  },
  {
    id: 'restorative-strategist',
    title: 'Restorative Strategist',
    simpleTitle: 'City Mender',
    icon: 'sparkle',
    howTo: 'Keep services running; safety and shops 65+.',
    simpleHowTo: 'Keep shops and services going safely.',
    evaluate: ({ result, fingerprint }) => {
      if (count(fingerprint, 'S') >= 1 && result.scores.economy >= 65 && result.scores.safety >= 65) return `Services and relief came first; safety (${Math.round(result.scores.safety)}) and shops (${Math.round(result.scores.economy)}) held.`;
      return null;
    },
  },
] as const;

export function accomplishmentById(id: string): AccomplishmentDefinition | undefined {
  return ACCOMPLISHMENTS.find((a) => a.id === id);
}
