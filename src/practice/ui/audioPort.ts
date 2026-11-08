/**
 * src/audio bound for Practice (kept apart from ./ports.ts so the launch screen's settings can use it without loading
 * the physics): the independent sound settings, captions, the interface cues, the mastery confirmation and the match
 * context for the stage's emotion signals.
 */
import {
  AUDIO_LEVELS,
  deliveryContext,
  getAudioSettings,
  onCaption,
  playMasteryFeel,
  playUiCue,
  resetAudioSettings,
  setAudioSettings,
  subscribeAudioSettings,
} from '@/audio';
import type { AudioKit } from './flow/types';

export const audioKit: AudioKit | null = {
  getSettings: getAudioSettings,
  setSettings: setAudioSettings,
  subscribeSettings: subscribeAudioSettings,
  resetSettings: () => void resetAudioSettings(),
  levels: AUDIO_LEVELS,
  onCaption: (fn) => onCaption(fn),
  uiCue: playUiCue,
  masteryFeel: playMasteryFeel,
  deliveryContext: (s) => deliveryContext(s),
};
