/**
 * Practice's sound, crowd emotion and haptics: the stage's PracticeSink (src/render3d/practice/types.ts). It owns the
 * session's one emotion machine (src/audio/emotion.ts), which the 3D crowd reads through emotionNow(), and which keeps
 * running with the sound muted or off, in Classic and in Delivery Quiet Mode. Everything follows resolved events at
 * their own time and the match context; nothing here reaches the simulation, its timing or an outcome.
 *
 *   cue()      the physical sounds: release, pitch (by surface), pad, stumps, bails, gloves, fielding, the boards
 *   feel()     the contact, by quality: sweet spot, middle, mistimed, a defensive block, inside or outside or top
 *              edge, pad, the swish of a miss (no contact sound and no vibration on a miss); its caption
 *   moment()   the emotion machine: the crowd bed's curve, the crowd's reactions, the dhol after a four or a six
 *              (not after a last-ball boundary that cannot win a chase), the §12 haptics of a close call, a four, a six
 *              and a wicket, and their captions
 *   quiet()    Delivery Quiet Mode (no interface sound from the approach to dead ball)
 *   context()  the match context for the coming delivery
 *
 * Every call may carry the performance time it belongs to (atPerfMs, ahead of time is best): sounds are then scheduled
 * on the audio clock to be heard at that moment, and haptics and captions wait for it. Release, pitch and bat contact
 * duck every lower bus. Until the stage sends its first moment, cue() and crowd() keep Sealed Six's mapping.
 *
 * Recorded takes (src/audio/recorded.ts) are chosen from the delivery record: context() carries its seed and its over
 * and ball index, and each sound's n-th use in the delivery hashes with them (src/audio/takes.ts). The exact-ball retry
 * of a record therefore hears the same takes; only the player's own contact changes which kind of sound plays. The use
 * counts restart at each 'approach' and advance whether or not the sound is audible, so muting never shifts a choice.
 */
import type { ContactKind, PitchCondition, SwingTiming } from '@/contracts/practice';
import type { SceneEventKind } from '@/render3d/core/choreo';
import type { ContactFeel, PracticeSink } from '@/render3d/practice/types';
import { playReaction, playSound, type FxId, type TakePick } from './bank';
import { contactCaption, dismissalCaption, emitCaption, type CaptionKey } from './captions';
import { bedBrightness, bedGain, fadeBed, followCurve, followGain, resyncBed } from './crowdBed';
import {
  CROWD,
  createEmotionMachine,
  type CrowdEmotion,
  type CrowdReaction,
  type DeliveryContext,
  type EmotionMoment,
} from './emotion';
import {
  audible,
  currentGraph,
  duckUnder,
  isQuiet,
  onAudioResume,
  setQuiet,
  silenceCrowd,
  type Bus,
  type LiveGraph,
} from './engine';
import type { FeelPattern } from './feel';
import { hapticsEnabled, playFeel } from './haptics';
import { MatchAudio, installMatchAudioUnlock } from './match';
import { getAudioSettings } from './settings';
import { deliveryTakeKey, takeUnit } from './takes';
import { audioLogOn, clearEmotionSource, logAudio, perfToCtx, setEmotionSource } from './timingLog';
import { voices } from './voices';

/** The coming delivery's context as the stage forwards it: the match context, the pitch and the record's identity. */
export type SinkDeliveryContext = DeliveryContext & {
  conditions?: PitchCondition;
  /** The delivery record's seed and its over and ball index (the flow passes them to stage.bowl()). */
  seed?: string;
  overIndex?: number;
  ballIndex?: number;
};

export interface PracticeSoundscape extends PracticeSink {
  /** A scene cue: the physical sound (bat and edge come from feel()). `atPerfMs`: the performance time it belongs to. */
  cue(kind: SceneEventKind, intensity: number, rate: number, atPerfMs?: number): void;
  crowd(level: number): void;
  /** The contact, by quality; `contact` and `timing` (the physics' ContactReport) pick the exact signature. */
  feel(feel: ContactFeel, intensity: number, contact?: ContactKind, timing?: SwingTiming, atPerfMs?: number): void;
  /** A resolved moment of the delivery (the stage's StageMoment), at its own time. */
  moment(m: EmotionMoment, atPerfMs?: number): void;
  /** The stage's per-frame emotion: only used before the first moment arrives. */
  emotion(state: { arousal: number }): void;
  /** Delivery Quiet Mode began or ended. */
  quiet(on: boolean): void;
  /**
   * The match context for the coming delivery (the stage forwards bowl()'s context; conditions pick the pitch sound;
   * the seed and the over and ball index pick the recorded takes).
   */
  context(ctx: SinkDeliveryContext): void;
  /** The crowd's emotion now (or at atMs): the one curve the 3D crowd follows. One object, updated in place. */
  emotionNow(atMs?: number): Readonly<CrowdEmotion>;
  dispose(): void;
}

const now = () => performance.now();
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const reducedMotion = () => typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced';
const BOUNCE: Readonly<Record<PitchCondition, FxId>> = {
  balanced: 'bounce',
  hard: 'bounce_hard',
  green: 'bounce_green',
  turning: 'bounce_turning',
};
/** Crowd reactions sit this far under unit gain (each is normalised to its own loudness: src/audio/crowdVoices.ts). */
const CROWD_TRIM = 0.8;

function edgeSound(kind: ContactKind | null, intensity: number): FxId {
  if (kind === 'top_edge') return 'top_edge';
  if (kind === 'inside_edge' || kind === 'leading_edge') return 'edge_thick';
  if (kind === 'outside_edge') return 'edge_thin';
  return intensity >= 0.65 ? 'edge_thick' : 'edge_thin';
}

/** The release whoosh at the bowler's pace, from its two rendered intensities (0.6 and 1.05). */
const releaseGain = (i: number) => (0.08 + 0.06 * Math.min(1.1, i)) / (0.08 + 0.06 * (i >= 0.8 ? 1.05 : 0.6));

const practiceHaptics = () => hapticsEnabled() && getAudioSettings().haptics;

function feelNow(pattern: FeelPattern): void {
  if (practiceHaptics()) playFeel(pattern);
}

function captionNow(key: CaptionKey): void {
  if (emitCaption(key)) logAudio('caption', key, now());
}

export function createPracticeSink(): PracticeSoundscape {
  // Also requests the session's recorded takes, if Practice's warm-up has not already (src/audio/recorded.ts).
  installMatchAudioUnlock();
  const machine = createEmotionMachine();
  const legacy = new MatchAudio({ liveContact: true });
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let moments = false;
  let framed = false;
  let bedSynced = false;
  let disposed = false;
  let conditions: PitchCondition = 'balanced';
  let contactKind: ContactKind | null = null;
  let contactTiming: SwingTiming | null = null;
  let contactAt = Number.NEGATIVE_INFINITY;
  /** The delivery record's take key, and each sound's uses so far in this delivery. */
  let takeKey = deliveryTakeKey(null);
  const uses = new Map<string, number>();
  const takeFor = (name: string): TakePick => {
    const occurrence = uses.get(name) ?? 0;
    uses.set(name, occurrence + 1);
    return { delivery: takeKey, occurrence };
  };

  const later = <T>(fn: (arg: T) => void, dueMs: number, arg: T) => {
    const wait = dueMs - now();
    if (wait <= 1) fn(arg);
    else {
      if (timers.length > 32) timers.splice(0, 16);
      timers.push(setTimeout(fn, wait, arg));
    }
  };
  const feelAt = (pattern: FeelPattern, dueMs: number) => later(feelNow, dueMs, pattern);
  const captionAt = (key: CaptionKey | null, dueMs: number) => {
    if (key) later(captionNow, dueMs, key);
  };
  /** The bed after a moment it could not follow (sound off, or not yet unlocked): straight to the curve. */
  const resync = () => {
    const g = audible();
    if (!g) return;
    resyncBed(g, machine.state(), now());
    bedSynced = true;
  };

  function sound(id: FxId, gain: number, dueMs: number, bus: Bus = 'effects', duck?: 'release' | 'bounce' | 'contact') {
    const pick = takeFor(id);
    const g = audible();
    if (!g) return;
    const when = perfToCtx(g.ctx, dueMs);
    if (duck) duckUnder(duck, when);
    playSound(g, id, when, gain, bus, dueMs, 1, pick);
  }

  function react(g: LiveGraph, kind: CrowdReaction, level: number, dueMs: number, pick: TakePick) {
    const when = perfToCtx(g.ctx, dueMs);
    const gain = CROWD_TRIM * (0.3 + 0.7 * level);
    // A little variation of the synthesised reaction's pitch, ±3 %, from the delivery record (an exact replay matches).
    const rate = 1 + 0.03 * (2 * takeUnit(pick.delivery, `crowd:${kind}`, pick.occurrence) - 1);
    let played = playReaction(g, kind, when, gain, rate, pick);
    if (!played && (kind === 'cheer' || kind === 'eruption' || kind === 'ovation')) {
      voices.roar(
        g.target.crowd,
        when,
        (kind === 'eruption' ? 1 : 0.85) * level,
        kind === 'ovation' ? 4 : kind === 'eruption' ? 3.4 : 2.8,
      );
      played = 'synth:live';
    }
    logAudio('crowd', kind, dueMs, { ctx: g.ctx, ctxTime: when, level, bus: 'crowd', detail: played ?? 'none' });
  }

  const source = () => machine.sample(now());
  setEmotionSource(source);
  // Hooks build: the crowd's level as a 20 Hz series, so a drop or a swell can be measured from the log.
  const sampler = audioLogOn()
    ? setInterval(() => {
        const e = machine.sample(now());
        logAudio('crowd', 'level', now(), { level: e.arousal, detail: `${e.phase}:${e.mood}` });
      }, 50)
    : null;
  const offResume = onAudioResume(() => {
    const g = audible();
    if (g && moments) resyncBed(g, machine.state(), now());
  });

  return {
    cue(kind: SceneEventKind, intensity: number, rate: number, atPerfMs?: number) {
      if (disposed) return;
      if (!moments) {
        legacy.cue(kind, intensity, rate);
        return;
      }
      const due = atPerfMs ?? now();
      switch (kind) {
        case 'release':
          sound(intensity >= 0.8 ? 'release_fast' : 'release_slow', releaseGain(intensity), due, 'effects', 'release');
          if (getAudioSettings().releaseHaptic) feelAt('whisper', due);
          break;
        case 'bounce':
          sound(BOUNCE[conditions], 1, due, 'effects', 'bounce');
          break;
        case 'pad':
          sound('pad', 0.6 + 0.4 * clamp01(intensity), due, 'effects', 'contact');
          break;
        case 'stumps':
          sound('stumps', clamp01(intensity), due, 'effects', 'contact');
          break;
        case 'bails':
          sound('bails', 1, due);
          break;
        case 'gloves':
          sound('gloves', 0.5 + 0.5 * clamp01(intensity), due);
          break;
        case 'catch':
          sound('gloves', 1, due);
          break;
        case 'fielded':
          sound('fielded', clamp01(intensity), due);
          break;
        case 'throw':
          sound('throw', 1, due);
          break;
        case 'boundary':
          sound('board', 0.8, due);
          break;
        case 'seal':
          if (!isQuiet()) sound('seal', 1, due, 'interface');
          break;
        case 'fireworks':
          if (!reducedMotion()) legacy.cue(kind, intensity, rate);
          break;
        default:
          // bat and edge: feel() plays the contact; six: the crowd and the dhol come from the moment.
          break;
      }
    },

    crowd(level: number) {
      if (disposed) return;
      if (!moments && !framed) legacy.crowd(level);
      else if (moments && !bedSynced) resync();
    },

    emotion(state: { arousal: number }) {
      if (disposed) return;
      framed = true;
      if (moments) {
        if (!bedSynced) resync();
        return;
      }
      const g = audible();
      if (g) followGain(g, bedGain(state.arousal), bedBrightness(state.arousal));
    },

    feel(feel: ContactFeel, intensity: number, contact?: ContactKind, timing?: SwingTiming, atPerfMs?: number) {
      if (disposed) return;
      const due = atPerfMs ?? now();
      const recent = Math.abs(due - contactAt) < 40;
      const kind = contact ?? (recent ? contactKind : null);
      const tm = timing ?? (recent ? contactTiming : null);
      // A defended middle (the stage's 'block' feel): the dead bat's damped thud and a light tap, never the crack.
      if ((feel as string) === 'block') {
        sound('block', 0.9, due, 'effects', 'contact');
        feelAt('tap', due);
        captionAt('block', due);
        return;
      }
      switch (feel) {
        case 'sweet':
          sound('sweet', 1, due, 'effects', 'contact');
          feelAt('double', due);
          captionAt('sweet_spot', due);
          break;
        case 'middle': {
          const mistimed = tm ? tm === 'mistimed' : intensity < 0.7;
          sound(mistimed ? 'mistimed' : 'middle', 1, due, 'effects', 'contact');
          feelAt(mistimed ? 'soft' : 'pulse', due);
          captionAt(mistimed ? 'mistimed' : 'middle', due);
          break;
        }
        case 'edge': {
          const fx = edgeSound(kind, intensity);
          sound(fx, 1, due, 'effects', 'contact');
          feelAt('tick', due);
          captionAt(
            kind ? contactCaption(kind, tm ?? undefined) : fx === 'edge_thick' ? 'inside_edge' : 'outside_edge',
            due,
          );
          break;
        }
        case 'pad':
          feelAt('tap', due);
          captionAt(kind === 'body' ? 'body' : 'pad', due);
          break;
        case 'miss':
          // The swing's air only: no contact sound and no vibration on a miss.
          sound('swish', 0.8, due);
          captionAt('play_and_miss', due);
          break;
        default:
          // Bowled, catch, four and six: their sound, haptic and caption follow the confirmed moment. Before the stage
          // sends moments, the scene cue plays them and the feel (at the same physical moment) captions them.
          if (!moments)
            captionAt(
              feel === 'bowled'
                ? 'bowled'
                : feel === 'catch'
                  ? 'caught'
                  : feel === 'four'
                    ? 'four'
                    : feel === 'six'
                      ? 'six'
                      : null,
              due,
            );
          break;
      }
    },

    moment(m: EmotionMoment, atPerfMs?: number) {
      if (disposed) return;
      const due = atPerfMs ?? now();
      if (m.kind === 'approach') {
        moments = true;
        contactKind = null;
        contactTiming = null;
        uses.clear();
      } else if ((m.kind === 'contact' || m.kind === 'pad') && m.contact) {
        contactKind = m.contact;
        contactTiming = m.timing ?? null;
        contactAt = due;
      }
      const s = machine.moment(m, due);
      const reaction = s.reaction;
      const level = s.reactionLevel;
      // A reaction may start later than its moment (a wicket's shift follows the silence).
      const reactAt = reaction ? Math.max(due, s.rAt) : due;
      const crowdCaption = s.caption;
      const padded = s.padded;
      // A last-ball boundary that cannot win the chase gets the crowd's polite applause, but no celebratory drums.
      const celebrate = s.verdict !== 'lost';
      // Counted whether or not it is heard, so muting never shifts a later take.
      const reactionPick = reaction ? takeFor(`crowd:${reaction}`) : null;
      if (audioLogOn()) logAudio('moment', m.kind, due, { level: machine.sample(due).arousal });
      const g = audible();
      if (g) {
        followCurve(g, s, now(), perfToCtx(g.ctx, due));
        bedSynced = true;
        if (m.kind === 'wicket') silenceCrowd(perfToCtx(g.ctx, due), CROWD.silenceHoldMs / 1000 - 0.05);
        if (reaction && reactionPick) react(g, reaction, level, reactAt, reactionPick);
      } else bedSynced = false;
      switch (m.kind) {
        case 'beaten':
          feelAt('restrained', due);
          break;
        case 'four':
          captionAt('four', due);
          feelAt('confirm', due);
          if (celebrate) sound('dhol', 0.85, due + 250, 'music');
          break;
        case 'six':
          captionAt('six', due);
          feelAt(reducedMotion() ? 'confirm' : 'confirm_strong', due);
          if (celebrate) {
            sound('dhol', 1, due + 200, 'music');
            sound('dhol', 0.9, due + 1640, 'music');
          }
          break;
        case 'wicket':
          if (m.dismissal) captionAt(dismissalCaption(m.dismissal), due);
          feelAt('decisive', due);
          break;
        case 'survived':
          if (padded) captionAt('not_out', due);
          break;
        default:
          break;
      }
      captionAt(crowdCaption, due);
    },

    quiet(on: boolean) {
      if (!disposed) setQuiet(on);
    },

    context(ctx: SinkDeliveryContext) {
      if (disposed) return;
      if (ctx.conditions) conditions = ctx.conditions;
      takeKey = deliveryTakeKey(ctx);
      machine.context(ctx, now());
    },

    emotionNow(atMs?: number) {
      return machine.sample(atMs ?? now());
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const t of timers.splice(0)) clearTimeout(t);
      if (sampler !== null) clearInterval(sampler);
      offResume();
      clearEmotionSource(source);
      setQuiet(false);
      legacy.dispose();
      const g = currentGraph();
      if (g) fadeBed(g);
    },
  };
}
