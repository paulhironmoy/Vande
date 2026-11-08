/**
 * The voice banks: every sound of a delivery plays from a buffer rendered once, off the input path, so a cue costs
 * two nodes (a buffer source and its gain) and builds nothing else (no hot-path allocation beyond what Web Audio needs).
 *
 *   effects   every Practice effect and interface voice (voices.ts, fxVoices.ts), rendered in one OfflineAudioContext
 *             at the live sample rate into one sprite; each cue plays its slot (start(when, offset, duration))
 *   crowd     the crowd reactions (crowdVoices.ts), rendered by plain DSP in idle slices of at most a few ms, at
 *             CROWD_RATE, paused during Delivery Quiet Mode so no delivery ever shares a frame with the work
 *
 * Until a bank is ready (the first second or so after the warm-up) callers fall back to live synthesis.
 *
 * Licensed recordings (src/audio/recorded.ts, recordedManifest.ts) come first where a sound has them and the caller
 * says which delivery it belongs to: the take follows the delivery record. Otherwise, and whenever a take is missing or
 * failed to load, the synthesised voice plays exactly as before. The timing log says which (`detail`: `rec:<take>`,
 * `synth` from the sprite, `synth:live`).
 */
import type { CrowdReaction } from './emotionCore';
import { warmBed } from './crowdBed';
import { CROWD_RATE, crowdRender } from './crowdVoices';
import { isQuiet, onGraph, trackVoice, type Bus, type LiveGraph } from './engine';
import { fxVoices } from './fxVoices';
import { pickTake, playTake } from './recorded';
import { logAudio } from './timingLog';
import { voices, type VoiceTarget } from './voices';

/** Which delivery a sound belongs to, and which use of that sound in it (src/audio/takes.ts takeIndex). */
export interface TakePick {
  delivery: string;
  occurrence: number;
}


export type FxId =
  | 'release_slow'
  | 'release_fast'
  | 'bounce'
  | 'bounce_hard'
  | 'bounce_green'
  | 'bounce_turning'
  | 'sweet'
  | 'middle'
  | 'mistimed'
  | 'block'
  | 'edge_thick'
  | 'edge_thin'
  | 'top_edge'
  | 'swish'
  | 'pad'
  | 'body'
  | 'stumps'
  | 'bails'
  | 'gloves'
  | 'fielded'
  | 'throw'
  | 'board'
  | 'dhol'
  | 'ui_select'
  | 'ui_confirm'
  | 'seal'
  | 'mastery'
  | 'stage_up';

/** Each effect: its slot length (s) and how it is rendered (at intensity 1; playback sets the gain). */
export const FX_SOURCES: ReadonlyArray<readonly [FxId, number, (v: VoiceTarget, t: number) => void]> = [
  ['release_slow', 0.32, (v, t) => voices.release(v, t, 0.6)],
  ['release_fast', 0.32, (v, t) => voices.release(v, t, 1.05)],
  ['bounce', 0.16, (v, t) => voices.bounce(v, t, 0.6)],
  ['bounce_hard', 0.14, (v, t) => fxVoices.bounce(v, t, 'hard')],
  ['bounce_green', 0.18, (v, t) => fxVoices.bounce(v, t, 'green')],
  ['bounce_turning', 0.2, (v, t) => fxVoices.bounce(v, t, 'turning')],
  [
    'sweet',
    0.5,
    (v, t) => {
      voices.bat(v, t, 1);
      voices.ring(v, t + 0.004, true);
    },
  ],
  [
    'middle',
    0.34,
    (v, t) => {
      voices.bat(v, t, 0.9);
      voices.ring(v, t + 0.004, false);
    },
  ],
  ['mistimed', 0.22, (v, t) => fxVoices.mistimed(v, t)],
  ['block', 0.16, (v, t) => fxVoices.block(v, t)],
  ['edge_thick', 0.12, (v, t) => voices.edge(v, t, 0.8)],
  ['edge_thin', 0.12, (v, t) => voices.edge(v, t, 0.55)],
  ['top_edge', 0.12, (v, t) => fxVoices.topEdge(v, t)],
  ['swish', 0.18, (v, t) => voices.swish(v, t)],
  ['pad', 0.2, (v, t) => voices.pad(v, t, 1)],
  ['body', 0.16, (v, t) => fxVoices.body(v, t)],
  ['stumps', 0.26, (v, t) => voices.stumps(v, t, 1)],
  ['bails', 0.42, (v, t) => voices.bails(v, t, 1)],
  ['gloves', 0.14, (v, t) => voices.gloves(v, t, 1)],
  ['fielded', 0.14, (v, t) => voices.fielded(v, t, 1)],
  ['throw', 0.24, (v, t) => voices.throw(v, t)],
  ['board', 0.22, (v, t) => fxVoices.board(v, t)],
  ['dhol', 1.62, (v, t) => voices.drums(v, t, 1)],
  ['ui_select', 0.09, (v, t) => fxVoices.uiSelect(v, t)],
  ['ui_confirm', 0.27, (v, t) => fxVoices.uiConfirm(v, t)],
  ['seal', 0.57, (v, t) => voices.seal(v, t)],
  ['mastery', 1, (v, t) => fxVoices.mastery(v, t)],
  ['stage_up', 0.4, (v, t) => fxVoices.stageUp(v, t)],
];

const GAP_S = 0.02;

/** The sprite layout: each effect's offset and length (s), in FX_SOURCES order. */
export function fxLayout(): { slots: Record<FxId, readonly [number, number]>; seconds: number } {
  const slots = {} as Record<FxId, readonly [number, number]>;
  let at = GAP_S;
  for (const [id, len] of FX_SOURCES) {
    slots[id] = [at, len];
    at += len + GAP_S;
  }
  return { slots, seconds: at };
}

const LAYOUT = fxLayout();
let fxSprite: AudioBuffer | null = null;
let fxBuilding = false;
const crowd: Partial<Record<CrowdReaction, AudioBuffer>> = {};
/** Most needed first: the contact and close-call reactions, then the outcomes. */
const CROWD_ORDER: readonly CrowdReaction[] = ['lift', 'ooh', 'applause', 'cheer', 'dismay', 'relief', 'groan', 'eruption', 'ovation'];
let crowdQueued = false;

export const fxReady = () => fxSprite !== null;
export const crowdReady = (k: CrowdReaction) => crowd[k] !== undefined;

/** Plays an effect from the sprite on a bus. False when the bank is not ready (the caller synthesises live). */
export function playFx(g: LiveGraph, id: FxId, when: number, gain: number, bus: Bus = 'effects', rate = 1): boolean {
  const sprite = fxSprite;
  if (!sprite || gain <= 0) return sprite !== null;
  const [offset, len] = LAYOUT.slots[id];
  const src = g.ctx.createBufferSource();
  src.buffer = sprite;
  if (rate !== 1) src.playbackRate.value = rate;
  const amp = g.ctx.createGain();
  amp.gain.value = gain;
  src.connect(amp).connect(g.input[bus]);
  src.start(when, offset, len);
  trackVoice(src, when + len / rate);
  return true;
}

const FX_RENDER = Object.fromEntries(FX_SOURCES.map(([id, , render]) => [id, render])) as Record<FxId, (v: VoiceTarget, t: number) => void>;

/**
 * Plays an effect heard at context time `when`: a recorded take (when `pick` names the delivery and one is loaded; its
 * onset lands on `when`), else from the sprite, else (before the bank is ready) the same voice synthesised live through
 * a gain. `dueMs` is the performance time it belongs to (for the timing log).
 */
export function playSound(g: LiveGraph, id: FxId, when: number, gain: number, bus: Bus, dueMs: number, rate = 1, pick?: TakePick): void {
  if (gain <= 0) return;
  const take = pick ? pickTake(id, pick.delivery, pick.occurrence) : null;
  let heard = when;
  let detail: string;
  if (take) {
    heard = playTake(g, take, when, gain, bus, rate);
    detail = `rec:${take.take.id}`;
  } else if (playFx(g, id, when, gain, bus, rate)) {
    detail = 'synth';
  } else {
    const amp = g.ctx.createGain();
    amp.gain.value = gain;
    amp.connect(g.input[bus]);
    FX_RENDER[id]({ ctx: g.ctx, out: amp, noise: g.noise, track: trackVoice }, when);
    detail = 'synth:live';
  }
  logAudio('sound', id, dueMs, { ctx: g.ctx, ctxTime: heard, level: gain, bus, detail });
}

/**
 * Plays a crowd reaction on the crowd bus: a recorded take when `pick` names the delivery and one is loaded (at its own
 * pitch), else the rendered synthesis. Returns what played (`rec:<take>` or `synth`), or null when neither is ready.
 */
export function playReaction(g: LiveGraph, kind: CrowdReaction, when: number, gain: number, rate: number, pick: TakePick): string | null {
  const take = pickTake(`crowd:${kind}`, pick.delivery, pick.occurrence);
  if (take) {
    if (gain > 0) playTake(g, take, when, gain, 'crowd', 1);
    return `rec:${take.take.id}`;
  }
  return playCrowdReaction(g, kind, when, gain, rate) ? 'synth' : null;
}

/** Plays a synthesised crowd reaction on the crowd bus. False when it is not rendered yet. */
export function playCrowdReaction(g: LiveGraph, kind: CrowdReaction, when: number, gain: number, rate = 1): boolean {
  const buf = crowd[kind];
  if (!buf) return false;
  if (gain <= 0) return true;
  const src = g.ctx.createBufferSource();
  src.buffer = buf;
  if (rate !== 1) src.playbackRate.value = rate;
  const amp = g.ctx.createGain();
  amp.gain.value = gain;
  src.connect(amp).connect(g.input.crowd);
  src.start(when);
  trackVoice(src, when + buf.duration / rate);
  return true;
}

type Deadline = { timeRemaining(): number };
function idle(cb: (d: Deadline) => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: (d: Deadline) => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(cb, { timeout: 2000 });
    return;
  }
  setTimeout(() => {
    const start = performance.now();
    cb({ timeRemaining: () => Math.max(0, 4 - (performance.now() - start)) });
  }, 30);
}

async function buildFx(g: LiveGraph): Promise<void> {
  const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (fxBuilding || fxSprite || !Offline) return;
  fxBuilding = true;
  try {
    const sr = g.ctx.sampleRate;
    const off = new Offline(1, Math.ceil(LAYOUT.seconds * sr), sr);
    const v: VoiceTarget = { ctx: off, out: off.destination, noise: g.noise };
    for (const [id, , render] of FX_SOURCES) render(v, LAYOUT.slots[id][0]);
    fxSprite = await off.startRendering();
  } catch {
    fxSprite = null;
  } finally {
    fxBuilding = false;
  }
}

function buildCrowd(g: LiveGraph): void {
  if (crowdQueued) return;
  crowdQueued = true;
  let k = 0;
  let job: ReturnType<typeof crowdRender> | null = null;
  let buf: AudioBuffer | null = null;
  let data: Float32Array | null = null;
  let pos = 0;
  const step = (d: Deadline) => {
    try {
      // Never during a delivery: the work waits for the ball to be dead.
      while (!isQuiet() && d.timeRemaining() > 1.5) {
        if (!job) {
          while (k < CROWD_ORDER.length && crowd[CROWD_ORDER[k]]) k++;
          if (k >= CROWD_ORDER.length) return;
          job = crowdRender(CROWD_ORDER[k], CROWD_RATE);
          buf = g.ctx.createBuffer(1, job.length, CROWD_RATE);
          data = buf.getChannelData(0);
          pos = 0;
        }
        const end = Math.min(job.length, pos + 512);
        job.render(data!, pos, end);
        pos = end;
        if (pos >= job.length) {
          job.finish(data!);
          crowd[CROWD_ORDER[k]] = buf!;
          job = null;
          k++;
        }
      }
    } catch {
      return; // a device that cannot render keeps the live fallback
    }
    idle(step);
  };
  idle(step);
}

/**
 * Starts both builds and warms the crowd bed, once the graph exists (idempotent). The recorded takes are Practice's
 * alone: createPracticeSink() loads them in its setup (src/audio/recorded.ts), so Sealed Six never holds them.
 */
export function prepareBanks(): void {
  onGraph((g) => {
    idle(() => {
      warmBed(g);
      void buildFx(g);
    });
    buildCrowd(g);
  });
}

