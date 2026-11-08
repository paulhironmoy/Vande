/**
 * What a delivery really did, for the tester mode's perception questions (stored beside the tester's answer): the
 * game's own coaching facts, never the player's or the app's guess.
 */
import type { CoachingFactsLike } from '../flow/types';

export function lineTruth(f: CoachingFactsLike): 'outside_off' | 'stumps' | 'leg_side' {
  const b = f.delivery.lineBand;
  return b === 'down_leg' ? 'leg_side' : b === 'outside_off' || b === 'wide_outside_off' ? 'outside_off' : 'stumps';
}

export function lengthTruth(f: CoachingFactsLike): 'full' | 'good' | 'short' {
  const b = f.delivery.lengthBand;
  return b === 'yorker' || b === 'full' ? 'full' : b === 'good' ? 'good' : 'short';
}

/** The main movement: climbing (a bouncer, or arriving at chest height or above), in, away, or none (under 8 cm). */
export function movementTruth(f: CoachingFactsLike): 'in' | 'away' | 'none' | 'up' {
  if (f.delivery.variation === 'bouncer' || f.movement.heightAtBatM >= 1.35) return 'up';
  const total = f.movement.airM + (f.movement.pitchM ?? 0);
  if (Math.abs(total) < 0.08) return 'none';
  return total > 0 ? 'away' : 'in';
}
