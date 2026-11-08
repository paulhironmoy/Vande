/**
 * The first pointer or key press after src/audio's unlock listener is installed creates the AudioContext and its
 * noise buffers synchronously (100–450 ms on a phone). No swing may ever pay for that, so Practice installs the
 * unlock early (the launch screen and every Practice screen): every path to a delivery passes through a tap
 * (Practice, Quick Practice, Play, Next ball, Replay exact ball, Continue), and that tap carries the cost.
 */
import { installMatchAudioUnlock } from '@/audio';

export function prepareAudioUnlock(): void {
  installMatchAudioUnlock();
}
