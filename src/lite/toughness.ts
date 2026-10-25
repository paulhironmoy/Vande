/**
 * Toughness tiers for Insight points. The tiers are computed from the game itself (never from player answer rates)
 * by scripts/lite-toughness.mjs and committed to src/content/lite/toughness.json.
 *
 * Stable API used by the Lite screen: `TOUGHNESS`, `tierOf`, `closeCallMargin`.
 */
import manifest from '@/content/lite/toughness.json';
import type { InsightTier, ToughnessManifest } from './contracts';

export const TOUGHNESS = manifest as ToughnessManifest;

/** Tier of a decision or fair-play moment by id; 'tricky' when unknown. */
export function tierOf(stepId: string): InsightTier {
  return TOUGHNESS.decisions[stepId]?.tier ?? TOUGHNESS.rights[stepId]?.tier ?? 'tricky';
}

/** Best and second-best within this many points is a close call; also the Insight close-second margin. */
export function closeCallMargin(): number {
  return TOUGHNESS.thresholds.closeCallMargin;
}
