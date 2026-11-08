/**
 * Interface sounds and Coach Mode's mastery moment. Interface sounds stay secondary to cricket sound (constitution
 * §13: last in priority, ducked under release, pitch and bat contact) and are silent in Delivery Quiet Mode (§4: from
 * the bowler's approach to dead ball). No interface sound vibrates: haptics never confirm navigation (§12).
 */
import { playSound } from './bank';
import { emitCaption } from './captions';
import { audible, isQuiet, onQuietChange } from './engine';
import { playFeel } from './haptics';
import { getAudioSettings } from './settings';
import { logAudio } from './timingLog';

export type UiCue = 'select' | 'confirm' | 'lock';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A soft tick for a selection, two soft notes for a confirmation, the seal chime for locking an over. */
export function playUiCue(cue: UiCue): void {
  if (isQuiet()) return;
  const g = audible();
  if (!g) return;
  playSound(g, cue === 'select' ? 'ui_select' : cue === 'confirm' ? 'ui_confirm' : 'seal', g.ctx.currentTime + 0.005, 1, 'interface', now());
}

export type MasteryEvent = 'mastered' | 'stage_up';

let pending: MasteryEvent | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Coach Mode (src/practice/coach masteryEvent): 'mastered' is a quiet, warm moment, a soft rising chime and a
 * restrained success haptic, distinct from any crowd sound; 'stage_up' (less assistance next time) is the chime only.
 * Called during Delivery Quiet Mode, it waits for the ball to be dead and plays 250 ms after.
 */
export function playMasteryFeel(event: MasteryEvent = 'mastered'): void {
  if (isQuiet()) {
    pending = event === 'mastered' || pending === null ? event : pending;
    return;
  }
  // EMO1: the confirmation of a recorded improvement (the coach's mastery event), in the timing log.
  logAudio('moment', `improvement:${event}`, now());
  const g = audible();
  if (g) playSound(g, event === 'mastered' ? 'mastery' : 'stage_up', g.ctx.currentTime + 0.01, 1, 'interface', now());
  if (event === 'mastered' && getAudioSettings().haptics) playFeel('mastery');
  if (emitCaption(event)) logAudio('caption', event, now());
}

onQuietChange((quiet) => {
  if (quiet || !pending) return;
  const event = pending;
  pending = null;
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    playMasteryFeel(event);
  }, 250);
});
