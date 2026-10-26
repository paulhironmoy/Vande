/**
 * Audio and haptics. Match sound is synthesised (no recorded or copyrighted audio). Settings come from the root
 * store via syncAudioSettings (called by UiProvider).
 */
import { setHapticsEnabled, setHapticsNative } from './haptics';
import { setMatchHaptics, setMatchSound } from './match';

export { MatchAudio, playSealChime, installMatchAudioUnlock, playSwingFeel, playContactFeel } from './match';
export { haptic, type HapticKind } from './haptics';

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
