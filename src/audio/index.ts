/**
 * Audio, crowd emotion and haptics. Every sound has an original synthesised voice (docs/AUDIO.md). Where a licensed
 * recording is registered (src/audio/recordedManifest.ts: CC0 or CC BY, each in the wedge's sound REGISTER.md) it plays
 * instead, chosen from the delivery record; the synthesised voice remains the fallback whenever a take is missing.
 * The app's Sound and Vibration switches come from the root store via syncAudioSettings (called by UiProvider);
 * the per-bus levels, Practice vibration, the release tick and captions are this module's own settings.
 *
 * '@/audio/emotion' is the pure emotion model on its own: import it directly where no audio graph is wanted.
 */
import { setHapticsEnabled, setHapticsNative } from './haptics';
import { setMatchHaptics, setMatchSound } from './match';

export { MatchAudio, playSealChime, installMatchAudioUnlock, playSwingFeel, playContactFeel } from './match';
export { haptic, type HapticKind } from './haptics';
export { createPracticeSink, type PracticeSoundscape, type SinkDeliveryContext } from './practice';
export { recordedSoundsOn, recordedStatus, setRecordedSounds } from './recorded';
export { playUiCue, playMasteryFeel, type UiCue, type MasteryEvent } from './ui';
export {
  AUDIO_LEVELS,
  AUDIO_SETTINGS_KEY,
  DEFAULT_AUDIO_SETTINGS,
  getAudioSettings,
  resetAudioSettings,
  setAudioSettings,
  subscribeAudioSettings,
  type AudioSettings,
} from './settings';
export { CAPTION_KEYS, onCaption, type Caption, type CaptionKey, type CaptionKind } from './captions';
export {
  createEmotionMachine,
  deliveryContext,
  matchPressure,
  type CrowdEmotion,
  type CrowdMood,
  type DeliveryContext,
  type EmotionMachine,
  type EmotionMoment,
  type MatchSituation,
} from './emotion';

export function syncAudioSettings(s: { sound: boolean; haptics: boolean }) {
  setMatchSound(s.sound);
  setHapticsEnabled(s.haptics);
  setMatchHaptics(s.haptics);
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  try {
    setHapticsNative(Boolean(cap?.isNativePlatform?.()));
  } catch {
    setHapticsNative(false);
  }
}
