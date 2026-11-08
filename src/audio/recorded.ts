/**
 * Recorded takes at runtime: loaded once in the background, chosen deterministically from the delivery record, and
 * played with exactly two nodes. The synthesised voice is always the fallback.
 *
 *   loading    Practice only (prepareRecorded, from Practice's audio warm-up), in its setup, before the first ball:
 *              every registered take's file is requested at once, so play itself never fetches anything; each is decoded
 *              as soon as the graph exists, one at a time in manifest (priority) order, never starting work during a
 *              delivery (Delivery Quiet Mode). Each file must match its registered byte count and SHA-256 where the
 *              platform can check it; anything that fails is never played. A kind is used only when every one of its
 *              takes has settled (loaded or failed), so the choice cannot depend on how far loading has got. The
 *              compressed bytes are dropped once decoded; recordedMemory() reports the decoded size.
 *   choosing   takeIndex(delivery key, sound, occurrence) over the manifest's takes (src/audio/takes.ts). A take that
 *              failed to load plays the synthesised voice instead, on every run alike.
 *   timing     contact takes are aligned on their own transient, found in the decoded buffer (so no codec's encoder
 *              delay can shift it): the onset is heard at the physics contact time (COH6).
 */
import { isQuiet, onGraph, onQuietChange, trackVoice, type Bus, type LiveGraph } from './engine';
import { RECORDED_KINDS, type RecordedKey, type RecordedKind, type RecordedTake } from './recordedManifest';
import { alignedStart, findOnset, takeIndex } from './takes';

export interface LoadedTake {
  take: RecordedTake;
  kind: RecordedKind;
  buffer: AudioBuffer;
  /** The onset in buffer seconds (0 for kinds aligned on the start). */
  onsetS: number;
}

type Slot = LoadedTake | 'failed';

export interface RecordedIO {
  /** The bytes of a file under the base URL. */
  fetch(url: string): Promise<ArrayBuffer>;
  decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer>;
  /** SHA-256 of the bytes as lowercase hex, or null where the platform cannot compute it. */
  sha256(data: ArrayBuffer): Promise<string | null>;
  /** URL prefix of public/audio/cricket/. */
  base: string;
}

/** Practice loads its takes in its setup; unit tests load them explicitly, with their own IO. */
const RECORDED_AUTOLOAD = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE !== 'test';

let manifest: readonly RecordedKind[] = RECORDED_KINDS;
let byKey = new Map<RecordedKey, RecordedKind>(manifest.map((k) => [k.key, k]));
const ready = new Map<RecordedKey, Slot[]>();
let enabled = true;
let loading: Promise<void> | null = null;
/** Every take's bytes, requested at once; each entry is dropped once its take is decoded. */
let requested: Promise<Map<RecordedTake, Promise<ArrayBuffer | null>>> | null = null;
let generation = 0;
let decodedBytes = 0;
const timing: { requestedMs: number | null; fetchedMs: number | null; readyMs: number | null } = {
  requestedMs: null,
  fetchedMs: null,
  readyMs: null,
};
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function baseUrl(): string {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const base = env?.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}audio/cricket/`;
}

function hex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

function defaultRecordedIO(): RecordedIO {
  return {
    async fetch(url) {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.arrayBuffer();
    },
    decode(ctx, data) {
      // The callback form too: older WebViews return undefined from decodeAudioData.
      return new Promise<AudioBuffer>((resolve, reject) => {
        const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
        if (p && typeof p.then === 'function') p.then(resolve, reject);
      });
    },
    async sha256(data) {
      const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
      if (!subtle) return null;
      return hex(await subtle.digest('SHA-256', data));
    },
    base: baseUrl(),
  };
}

function whenNotQuiet(): Promise<void> {
  if (!isQuiet()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = onQuietChange((q) => {
      if (!q) {
        off();
        resolve();
      }
    });
  });
}

/** One downsampling render, off the main thread (a 2.5 s take at 48 kHz is 480 KB; at 24 kHz half that). */
async function downsample(buf: AudioBuffer, rate: number): Promise<AudioBuffer> {
  const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Offline || !(buf.sampleRate > rate)) return buf;
  try {
    const off = new Offline(1, Math.max(1, Math.ceil(buf.duration * rate)), rate);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start(0);
    const out = await off.startRendering();
    return out && out.length > 0 ? out : buf;
  } catch {
    return buf;
  }
}

async function loadTake(
  g: LiveGraph,
  kind: RecordedKind,
  take: RecordedTake,
  io: RecordedIO,
  bytes: Promise<ArrayBuffer | null> | undefined,
): Promise<Slot> {
  try {
    const data = await bytes;
    if (!data || data.byteLength !== take.bytes) return 'failed';
    const sum = await io.sha256(data);
    if (sum !== null && sum !== take.sha256) return 'failed';
    let buffer = await io.decode(g.ctx, data);
    if (kind.maxRate) buffer = await downsample(buffer, kind.maxRate);
    if (!buffer || buffer.length === 0) return 'failed';
    const onsetS = kind.align === 'onset' ? findOnset(buffer.getChannelData(0)) / buffer.sampleRate : 0;
    decodedBytes += buffer.length * buffer.numberOfChannels * 4;
    return { take, kind, buffer, onsetS };
  } catch {
    return 'failed';
  }
}

/**
 * Requests every registered take's file at once (network only; nothing is decoded here), so a Practice session asks
 * for its files in its setup, before the first ball, and never while it plays. A delivery in progress is waited out
 * first. Idempotent: a later call returns the same requests.
 */
export function prefetchRecorded(
  io: RecordedIO = defaultRecordedIO(),
): Promise<Map<RecordedTake, Promise<ArrayBuffer | null>>> {
  if (requested) return requested;
  const gen = generation;
  requested = (async () => {
    await whenNotQuiet();
    const files = new Map<RecordedTake, Promise<ArrayBuffer | null>>();
    if (gen !== generation) return files;
    timing.requestedMs = nowMs();
    for (const kind of manifest) {
      for (const take of kind.takes) {
        files.set(
          take,
          io.fetch(io.base + take.file).then(
            (b) => b,
            () => null,
          ),
        );
      }
    }
    void Promise.all(files.values()).then(() => {
      if (gen === generation) timing.fetchedMs = nowMs();
    });
    return files;
  })();
  return requested;
}

let prepared = false;

/**
 * Practice's setup (src/audio/match.ts installMatchAudioUnlock, which Practice's launch screen and every Practice
 * screen call, and createPracticeSink): every take's file requested now, each decoded once the graph exists. Sealed
 * Six never calls it, so it never holds a take. Idempotent; off in unit tests (they load with their own IO).
 */
export function prepareRecorded(): void {
  if (!RECORDED_AUTOLOAD || prepared) return;
  prepared = true;
  void prefetchRecorded();
  onGraph((g) => void loadRecorded(g));
}

/** Loads every registered take once from its requested bytes (idempotent; a later call returns the same promise). */
export function loadRecorded(g: LiveGraph, io: RecordedIO = defaultRecordedIO()): Promise<void> {
  if (loading) return loading;
  const gen = generation;
  loading = (async () => {
    const files = await prefetchRecorded(io);
    for (const kind of manifest) {
      if (!kind.takes.length) continue;
      const slots: Slot[] = [];
      for (const take of kind.takes) {
        await whenNotQuiet();
        if (gen !== generation) return;
        slots.push(await loadTake(g, kind, take, io, files.get(take)));
        files.delete(take);
      }
      if (gen !== generation) return;
      ready.set(kind.key, slots);
    }
    timing.readyMs = nowMs();
  })();
  return loading;
}

/**
 * The take for the `occurrence`-th use of `key` in the delivery `deliveryKey`; null when the synthesised voice plays
 * instead (no takes, not all settled yet, that take failed, or recordings are switched off).
 */
export function pickTake(key: RecordedKey, deliveryKey: string, occurrence: number): LoadedTake | null {
  if (!enabled) return null;
  const kind = byKey.get(key);
  const slots = ready.get(key);
  if (!kind || !slots || slots.length !== kind.takes.length || !slots.length) return null;
  const slot = slots[takeIndex(deliveryKey, key, occurrence, slots.length)];
  return slot === 'failed' ? null : slot;
}

/**
 * Plays a take on a bus so that its onset is heard at context time `when` (two nodes: the source and its gain).
 * Returns the context time the onset is heard at.
 */
export function playTake(g: LiveGraph, t: LoadedTake, when: number, gain: number, bus: Bus, rate = 1): number {
  const src = g.ctx.createBufferSource();
  src.buffer = t.buffer;
  if (rate !== 1) src.playbackRate.value = rate;
  const amp = g.ctx.createGain();
  amp.gain.value = gain;
  src.connect(amp).connect(g.input[bus]);
  const { start, offset } = alignedStart(when, t.onsetS, t.kind.prerollMs / 1000, g.ctx.currentTime, rate);
  src.start(start, offset);
  trackVoice(src, start + (t.buffer.duration - offset) / (rate > 0 ? rate : 1));
  return start + (t.onsetS - offset) / (rate > 0 ? rate : 1);
}

/** Recorded takes on or off for this session (the owner's A/B; the synthesised voices play while off). */
export function setRecordedSounds(on: boolean): void {
  enabled = on;
}

export const recordedSoundsOn = () => enabled;

/** Which kinds are ready, and how many of their takes loaded (diagnostics and tests). */
export function recordedStatus(): Array<{ key: RecordedKey; takes: number; loaded: number }> {
  return manifest
    .filter((k) => k.takes.length)
    .map((k) => {
      const slots = ready.get(k.key);
      return { key: k.key, takes: k.takes.length, loaded: slots ? slots.filter((s) => s !== 'failed').length : 0 };
    });
}

/** The decoded takes' size in memory (bytes: samples × channels × 4) and how many takes it covers. */
export function recordedMemory(): { decodedBytes: number; takes: number } {
  let takes = 0;
  for (const slots of ready.values()) for (const s of slots) if (s !== 'failed') takes++;
  return { decodedBytes, takes };
}

/** When the files were requested, all fetched and all decoded (performance.now() ms; null until then). */
export function recordedTiming(): Readonly<typeof timing> {
  return { ...timing };
}

// Test builds only (VITE_PRACTICE_TEST_HOOKS=1): examiners read the loading cost through window.__vandeRecorded().
if (
  (import.meta as unknown as { env?: { VITE_PRACTICE_TEST_HOOKS?: string } }).env?.VITE_PRACTICE_TEST_HOOKS === '1' &&
  typeof window !== 'undefined'
) {
  (window as unknown as { __vandeRecorded?: () => unknown }).__vandeRecorded = () => ({
    status: recordedStatus(),
    memory: recordedMemory(),
    timing: recordedTiming(),
  });
}

/** TEST HOOK: forget every loaded take; optionally replace the manifest (null restores the shipped one). */
export function resetRecorded(next?: readonly RecordedKind[] | null): void {
  generation++;
  loading = null;
  requested = null;
  prepared = false;
  decodedBytes = 0;
  timing.requestedMs = timing.fetchedMs = timing.readyMs = null;
  ready.clear();
  enabled = true;
  if (next !== undefined) {
    manifest = next ?? RECORDED_KINDS;
    byKey = new Map(manifest.map((k) => [k.key, k]));
  }
}
