/**
 * The player-facing quality tiers (docs/PERFORMANCE.md, "Tiers"): the one place that maps the technical profiles and
 * device tiers to the three names a player ever sees.
 *
 *   Premium   the High profile (full materials, 2048 shadows, light shafts, the full animated crowd)
 *   Balanced  the Standard and Lite profiles (lighter shadows or blob shadows, a smaller or static crowd, fewer effects)
 *   Classic   the 2D stage (the same physics, deliveries, timing windows and scoring)
 *
 * Copy says Automatic, Premium, Balanced or Classic; never tiers, profiles, frame rates or GPUs. Technical words appear
 * only in the hidden diagnostics, or when a device genuinely fails (and then in product language with one action).
 *
 * Selection (once per app version, discreetly, while the pitch is prepared; benchmark.ts and classify.ts):
 *   Premium   Full Batter View at Standard with headroom, confirmed by a second run at High
 *   Balanced  Full at Standard (Standard); Full on a phone that reports 2 GB or less (Lite); Assisted (Lite)
 *   Classic   Below the cutoff: no WebGL 2, a software rasteriser, under 45 fps at Standard and again at Lite,
 *             repeated context loss, or an event-to-frame response over 100 ms
 *
 * Degradation (monitor.ts: between balls only, never up, on the median of the last three deliveries). Every step
 * removes visual expense; none touches what the batter reads or does:
 *   Premium → Balanced (Standard)              under 55 fps
 *   Premium or Balanced (Standard) → (Lite)    under 50 fps (a fall from Premium goes straight to Lite)
 *   Balanced (Lite) → Classic                  under 45 fps once Assisted, or a second context loss at any level
 * A Full device already at Lite (2 GB or less) first becomes Assisted under 50 fps: nothing visual is left to remove,
 * so only its timing tolerance grows.
 * Never reduced at any step (INVARIANTS): the ball (drawn 1.22× with its outline, ground shadow and trace), the
 * physics and its timing windows, the input path, the bowler's release cues, and the timing of sound and haptics. The
 * timing tolerance only grows as the device tier drops (toleranceFor) and is recorded with every delivery.
 */
import type { DeviceAssessment, QualityProfileId } from '@/contracts';
import { allowedQualityChoices, effectiveQuality, type QualityChoice } from './classify';

/** What a player calls the graphics. */
export type QualityTier = 'premium' | 'balanced' | 'classic';

/** Settings offer Automatic (the device check decides) or one of the three tiers. */
export type QualityTierChoice = 'auto' | QualityTier;

/** Best first. */
export const QUALITY_TIERS: readonly QualityTier[] = ['premium', 'balanced', 'classic'];

/** The rendering a tier is drawn with: which stage and which profiles. */
export const TIER_RENDERING: Readonly<Record<QualityTier, { stage: '3d' | '2d'; profiles: readonly QualityProfileId[] }>> = {
  premium: { stage: '3d', profiles: ['high'] },
  balanced: { stage: '3d', profiles: ['standard', 'lite'] },
  classic: { stage: '2d', profiles: ['lite'] },
};

/** What no tier, profile or step down may ever reduce (checked by the stage's and the physics' own tests). */
export const INVARIANTS = ['ball_readability', 'timing_windows', 'input_path', 'release_cues', 'feedback_timing'] as const;

/** The steps down, in order, and what each removes (documentation and diagnostics; monitor.ts applies them). */
export const DEGRADATION_STEPS: ReadonlyArray<{ from: { stage: '3d' | '2d'; profile: QualityProfileId }; to: { stage: '3d' | '2d'; profile: QualityProfileId }; underFps: number; removes: readonly string[] }> = [
  { from: { stage: '3d', profile: 'high' }, to: { stage: '3d', profile: 'standard' }, underFps: 55, removes: ['shadow_map_2048_to_1024', 'light_shafts', 'crowd_6500_to_3600', 'player_detail_40m_to_22m', 'fewer_particles', 'resolution_900_1440_to_720_900'] },
  { from: { stage: '3d', profile: 'standard' }, to: { stage: '3d', profile: 'lite' }, underFps: 50, removes: ['shadow_map_to_blob_shadows', 'crowd_animation', 'crowd_3600_to_1400', 'player_detail_22m_to_9m', 'fewer_particles', 'resolution_720_900_to_540_720'] },
  { from: { stage: '3d', profile: 'lite' }, to: { stage: '2d', profile: 'lite' }, underFps: 45, removes: ['3d_stadium_players_and_lighting'] },
];

/** The tier a rendering is presented as: Premium = High, Balanced = Standard or Lite, Classic = the 2D stage. */
export function tierForQuality(q: { stage: '3d' | '2d'; profile: QualityProfileId }): QualityTier {
  if (q.stage === '2d') return 'classic';
  return q.profile === 'high' ? 'premium' : 'balanced';
}

/** The best tier the device check earned (null before any check). */
export function tierForAssessment(a: DeviceAssessment | null): QualityTier | null {
  if (!a) return null;
  if (a.tier === 'below') return 'classic';
  return a.profile === 'high' ? 'premium' : 'balanced';
}

/** A stored technical choice, as the player sees it in settings. */
export function tierChoiceFor(choice: QualityChoice): QualityTierChoice {
  if (choice === 'auto' || choice === 'classic') return choice;
  return choice === 'high' ? 'premium' : 'balanced';
}

/**
 * The technical choice behind a player's pick on this device: Premium is High; Balanced is Standard where the device
 * earned Standard or High, Lite where it earned only Lite (an Assisted device, or a phone reporting 2 GB or less).
 */
export function qualityChoiceForTier(choice: QualityTierChoice, a: DeviceAssessment | null): QualityChoice {
  if (choice === 'auto' || choice === 'classic') return choice;
  if (choice === 'premium') return 'high';
  return a && a.tier !== 'below' && a.profile === 'lite' ? 'lite' : 'standard';
}

/** The choices to offer, never more than the device earned: Automatic, Premium (if earned), Balanced (unless Below), Classic. */
export function tierChoices(a: DeviceAssessment | null): QualityTierChoice[] {
  const allowed = allowedQualityChoices(a);
  const out: QualityTierChoice[] = ['auto'];
  if (allowed.includes('high')) out.push('premium');
  if (allowed.includes('standard') || allowed.includes('lite')) out.push('balanced');
  out.push('classic');
  return out;
}

const TECHNICAL: readonly string[] = ['auto', 'lite', 'standard', 'high', 'classic'];

/**
 * The effective rendering for a choice (stored technical or player-facing), with the tier it is presented as. A
 * choice the device did not earn falls back to what it did earn, as effectiveQuality does.
 */
export function effectiveTier(a: DeviceAssessment | null, choice: QualityChoice | QualityTierChoice): { stage: '3d' | '2d'; profile: QualityProfileId; tier: QualityTier } {
  const technical: QualityChoice = TECHNICAL.includes(choice) ? (choice as QualityChoice) : qualityChoiceForTier(choice as QualityTierChoice, a);
  const q = effectiveQuality(a, technical);
  return { ...q, tier: tierForQuality(q) };
}

/** Whether a change of rendering is one the player would name differently (worth one calm notice between balls). */
export function tierChanged(prev: { stage: '3d' | '2d'; profile: QualityProfileId }, next: { stage: '3d' | '2d'; profile: QualityProfileId }): boolean {
  return tierForQuality(prev) !== tierForQuality(next);
}
