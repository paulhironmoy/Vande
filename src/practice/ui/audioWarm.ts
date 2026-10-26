/**
 * The first pointer or key press after src/audio's unlock listener is installed creates the AudioContext and its
 * noise buffers synchronously (100–450 ms on a phone). No swing may ever pay for that, so Practice installs the
 * unlock early (the launch choice and every Practice screen) and remembers whether a press has happened since: the
 * Practice tap, Quick random over, Continue or Resume then carry the cost. When none has (Practice opened directly by
 * a link or a reload), the flow asks for one "Start batting" tap before the first delivery.
 */
import { installMatchAudioUnlock } from '@/audio';

let listening = false;
let warmed = false;

export function prepareAudioUnlock(): void {
  installMatchAudioUnlock();
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const mark = () => {
    warmed = true;
    window.removeEventListener('pointerdown', mark, true);
    window.removeEventListener('keydown', mark, true);
  };
  window.addEventListener('pointerdown', mark, true);
  window.addEventListener('keydown', mark, true);
}

/** Whether a press has happened since the unlock was installed (so audio is already warm). */
export function audioWarmed(): boolean {
  return warmed;
}
