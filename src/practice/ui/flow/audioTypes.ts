/**
 * src/audio as Practice sees it, bound in ../ports.ts: the independent sound settings (music, effects, crowd, haptics,
 * captions; persisted by src/audio under its own key), captions for essential cues, the interface cues (silent while
 * a delivery is in quiet mode) and the restrained mastery confirmation. The app's `sound` and `haptics` settings stay
 * the master switches above these.
 */
interface AudioSettingsLike {
  effects: number;
  crowd: number;
  music: number;
  haptics: boolean;
  releaseHaptic: boolean;
  captions: boolean;
}

/** One caption for an essential sound, worded by Practice (practice.caption.<key>). */
interface CaptionLike {
  id: number;
  key: string;
  kind: 'bat' | 'wicket' | 'boundary' | 'crowd' | 'coach';
  atMs: number;
  holdMs: number;
}

export interface AudioKit {
  getSettings(): Readonly<AudioSettingsLike>;
  setSettings(patch: Partial<AudioSettingsLike>): Readonly<AudioSettingsLike>;
  subscribeSettings(onChange: () => void): () => void;
  resetSettings(): void;
  /** Suggested level steps (Off, Low, Full). */
  levels: readonly number[];
  onCaption(fn: (c: CaptionLike) => void): () => void;
  /** A soft selection tick, a confirmation, the seal chime (no haptic; dropped while quiet). */
  uiCue(cue: 'select' | 'confirm' | 'lock'): void;
  masteryFeel(event: 'mastered' | 'stage_up'): void;
  /** The match context for the stage's emotion signals only (pressure, a milestone in reach); never the simulation. */
  deliveryContext(s: { runs: number; wicketsInHand: number; ballsLeft: number | null }): {
    pressure: number;
    milestone: 'fifty' | 'hundred' | null;
    wicketEndsInnings: boolean;
    runs: number;
  };
}
