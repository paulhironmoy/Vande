/**
 * Sealed Six match audio: the renderer's PresentationSink (a crowd bed following the renderer's envelope, timed
 * one-shot cues and haptics), the batter's tap feel, and the seal chime. Practice has its own sink
 * (src/audio/practice.ts); both play through the one mix (src/audio/engine.ts): cricket sounds on the effects bus,
 * crowd swells on the crowd bus, the dhol and the riser on the music bus, chimes on the interface bus, and release,
 * pitch and bat contact duck everything below them. Nothing plays until the first gesture, while Sound is off, or in
 * the background; where the browser has an audio session it joins the 'ambient' one.
 */
import type { Contact, TimingGrade } from '@/contracts';
import type { SceneEventKind } from '@/render3d/core/choreo';
import type { PresentationSink } from '@/render3d/types';
import { prepareBanks, playSound } from './bank';
import { prepareRecorded } from './recorded';
import { fadeBed, followGain } from './crowdBed';
import { audible, currentGraph, duckUnder, installAudioUnlock, isQuiet, setMasterSound } from './engine';
import { feelFor } from './feel';
import { haptic, playFeel } from './haptics';
import { voices, type VoiceTarget } from './voices';

let hapticsOn = true;

export function setMatchSound(on: boolean) {
  setMasterSound(on);
}
export function setMatchHaptics(on: boolean) {
  hapticsOn = on;
}

/** One-time unlock listeners (browser autoplay policy), and the graph and banks prepared in idle time. */
function prepareSharedAudio() {
  installAudioUnlock();
  prepareBanks();
}

/**
 * Practice's audio warm-up (src/practice/ui/audioWarm.ts on the launch screen and every Practice screen, and
 * createPracticeSink): the shared preparation, plus the session's recorded takes, requested now so that play never
 * fetches (src/audio/recorded.ts prepareRecorded). Sealed Six's MatchAudio prepares only the shared part.
 */
export function installMatchAudioUnlock() {
  prepareSharedAudio();
  prepareRecorded();
}

export interface MatchAudioOptions {
  haptics?: boolean;
  /**
   * Live batting: the batting screen plays the bat's sound and haptic itself, at the tap (playSwingFeel) and again
   * when the answer lands (playContactFeel), so the scene's own bat and edge cues are skipped (no double crack, no
   * late buzz).
   */
  liveContact?: boolean;
}

/** PresentationSink for the renderer. One per stage. */
export class MatchAudio implements PresentationSink {
  private lastCrowd = -1;

  constructor(private opts: MatchAudioOptions = {}) {
    prepareSharedAudio();
  }

  crowd(level: number) {
    if (Math.abs(level - this.lastCrowd) < 0.01) return;
    const g = audible();
    if (!g) return;
    this.lastCrowd = level;
    followGain(g, 0.025 + level * 0.12);
  }

  cue(kind: SceneEventKind, intensity: number, rate: number) {
    if (this.opts.liveContact && (kind === 'bat' || kind === 'edge')) return;
    // Live, the batter's own patterns are the only contact haptics (a pad buzz would blur into them).
    if (this.opts.haptics !== false && hapticsOn && !(this.opts.liveContact && kind === 'pad'))
      this.haptic(kind, intensity);
    const g = audible();
    if (!g) return;
    const when = g.ctx.currentTime + 0.005;
    if (kind === 'release') duckUnder('release', when);
    else if (kind === 'bounce') duckUnder('bounce', when);
    else if (kind === 'bat' || kind === 'edge' || kind === 'pad' || kind === 'stumps') duckUnder('contact', when);
    playCue(g.routed, kind, intensity, when, rate);
  }

  private haptic(kind: SceneEventKind, intensity: number) {
    if (kind === 'bat') haptic(intensity > 0.85 ? 'medium' : 'light');
    else if (kind === 'edge' || kind === 'pad') haptic('light');
    else if (kind === 'stumps' || kind === 'catch') haptic('heavy');
    else if (kind === 'six' || kind === 'boundary') haptic('success');
    else if (kind === 'seal') haptic('light');
    else if (kind === 'result') haptic('success');
  }

  dispose() {
    const g = currentGraph();
    if (g) fadeBed(g);
  }
}

/** Shared by live playback and offline rendering. */
export function playCue(v: VoiceTarget, kind: SceneEventKind, intensity: number, when: number, rate = 1) {
  const pitch = rate < 0.95 ? Math.max(0.55, Math.sqrt(rate)) : 1;
  switch (kind) {
    case 'release':
      voices.release(v, when, intensity);
      break;
    case 'bounce':
      voices.bounce(v, when, intensity, pitch);
      break;
    case 'bat':
      voices.bat(v, when, intensity, pitch);
      break;
    case 'edge':
      voices.edge(v, when, intensity, pitch);
      break;
    case 'pad':
      voices.pad(v, when, intensity, pitch);
      break;
    case 'stumps':
      voices.stumps(v, when, intensity, pitch);
      voices.roar(v, when + 0.12, 0.95, 3.2);
      break;
    case 'bails':
      voices.bails(v, when, intensity, pitch);
      break;
    case 'gloves':
      voices.gloves(v, when, intensity, pitch);
      break;
    case 'catch':
      voices.catch(v, when, intensity, pitch);
      voices.roar(v, when + 0.08, 1, 3.2);
      break;
    case 'fielded':
      voices.fielded(v, when, intensity);
      break;
    case 'throw':
      voices.throw(v, when);
      break;
    case 'boundary':
      voices.roar(v, when, 0.85, 2.8);
      voices.drums(v, when + 0.25, 0.8);
      break;
    case 'six':
      voices.roar(v, when, 1, 3.4);
      voices.drums(v, when + 0.2, 1);
      break;
    case 'appeal':
      voices.roar(v, when, 0.55, 1.4);
      break;
    case 'fireworks':
      voices.fireworks(v, when, intensity);
      break;
    case 'seal':
      voices.seal(v, when);
      break;
    case 'tension':
      voices.tension(v, when, 1.45 / Math.max(0.25, rate));
      break;
    case 'result':
      voices.resultHit(v, when);
      break;
    default:
      break;
  }
}

/** What the tap is predicted to hit, before the sealed answer arrives (see predictContact). */
type SwingGuess = 'middle' | 'edge' | 'miss' | 'none';

const guessOf = (c: Contact): SwingGuess =>
  c === 'middle' ? 'middle' : c === 'thick_edge' || c === 'thin_edge' ? 'edge' : c === 'none' ? 'none' : 'miss';

function liveVoice(): { v: VoiceTarget; when: number } | null {
  const g = audible();
  return g ? { v: g.target.effects, when: g.ctx.currentTime + 0.002 } : null;
}

/**
 * The tap itself, with no wait for the network: the predicted outcome's haptic pattern (a tick for an edge, a pulse
 * for the middle, a pulse and a beat for perfect; nothing for a leave or a miss) and the sound the shot is predicted
 * to make. Sound and vibration each follow their own setting.
 */
export function playSwingFeel(predicted: Contact, timing: TimingGrade = 'good'): void {
  const guess = guessOf(predicted);
  const pattern = feelFor(predicted, timing);
  if (pattern && hapticsOn) playFeel(pattern);
  const out = liveVoice();
  if (!out) return;
  if (guess === 'middle' || guess === 'edge') duckUnder('contact', out.when);
  if (guess === 'middle') voices.bat(out.v, out.when, 0.75);
  else if (guess === 'edge') voices.edge(out.v, out.when, 0.6);
  else if (guess === 'miss') voices.swish(out.v, out.when);
}

/**
 * The sealed answer lands: a different outcome from the predicted one plays its own pattern (at least 60 ms after the
 * first; the same outcome plays nothing more), and the middle of the bat rings (brighter for perfect timing) while an
 * edge the tap did not predict ticks. Nothing about runs or wickets.
 */
export function playContactFeel(
  contact: Contact,
  timing: TimingGrade,
  predicted: Contact,
  predictedTiming: TimingGrade = 'good',
): void {
  const guess = guessOf(predicted);
  const pattern = feelFor(contact, timing);
  if (pattern && pattern !== feelFor(predicted, predictedTiming) && hapticsOn) playFeel(pattern);
  const out = liveVoice();
  if (!out) return;
  if (contact === 'middle') {
    if (guess !== 'middle') voices.bat(out.v, out.when, 0.9);
    voices.ring(out.v, out.when + 0.004, timing === 'perfect');
  } else if ((contact === 'thick_edge' || contact === 'thin_edge') && guess !== 'edge') {
    voices.edge(out.v, out.when, contact === 'thick_edge' ? 0.8 : 0.55);
  }
}

/** UI-level cue outside the match (e.g. locking an over plays the seal chime). Silent in Delivery Quiet Mode. */
export function playSealChime() {
  if (isQuiet()) return;
  const g = audible();
  if (!g) return;
  playSound(g, 'seal', g.ctx.currentTime + 0.01, 1, 'interface', performance.now());
}
