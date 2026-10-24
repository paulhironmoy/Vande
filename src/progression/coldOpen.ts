import type { Scenario } from '@/engine/types';

/**
 * Three short cold-open lines for a daily. Compiled dailies carry their cold open in `briefing.lines`
 * (the daily compiler contract); campaign scenarios use their briefing lines too.
 */
export function coldOpenLines(scenario: Scenario | undefined, simple: boolean): string[] {
  if (!scenario) return [];
  const lines = (simple ? scenario.simple?.briefing?.lines : undefined) ?? scenario.briefing.lines ?? [];
  return lines.slice(0, 3);
}
