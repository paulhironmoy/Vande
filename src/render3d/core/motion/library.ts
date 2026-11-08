/**
 * The runtime motion library: the VMP1 packs (MOTION-SPEC; decoder ./vmp.ts, MOTION's, unchanged but for one export)
 * fetched lazily by the 3D Practice stage (never in the initial bundle, never for Classic), decoded once, and handed
 * to the clip sampler (core/clips `vmp:<id>`) and to the field hook (core/fieldClips) together.
 *
 * Loaded packs take effect only between deliveries (`commitMotion`, called where a delivery's first script or the
 * between-balls scene is built), so one delivery is always drawn with one set of clips: nothing switches mid-ball.
 * A missing or bad pack leaves its clips to the built-in stand-ins.
 */
import { setMotionSources, type MotionSource, type SampledPose } from '../clips';
import { registerFieldMotion } from '../fieldClips';
import { createPoseOut, parsePack, sampleMotion, type MotionClip } from './vmp';

/** The packs the Practice stage uses (MOTION-SPEC §4), in load order. */
export const MOTION_PACKS = [
  'locomotion',
  'batter',
  'fielder',
  'fielder_actions',
  'keeper',
  'bowler',
  'nonstriker',
  'batter_strokes',
  'result_moments',
] as const;
/**
 * Batter clips drawn with the bat in the bottom hand only, the top hand free (the celebration's fist pump, the walk-off's
 * trailing bat). Every other pack clip with a bat key has both hands on the handle. Unity keeps the same two names
 * (`BatterOneHandCarry`); MOTION-SPEC section 11.
 */
export const ONE_HAND_BAT_CLIPS: ReadonlySet<string> = new Set(['bat_celebrate_win', 'bat_walk_off']);
/** Packs the field hook (WEB-FIELD) draws from. */
const FIELD_PACKS = new Set(['locomotion', 'fielder', 'fielder_actions', 'keeper']);

interface Loaded {
  clips: Map<string, MotionClip>;
  field: Map<string, MotionClip>;
  bytes: number;
}

let pending: Loaded | null = null;
let committed: Loaded | null = null;
let loading: Promise<number> | null = null;

const contactScratch = createPoseOut();

function source(clip: MotionClip): MotionSource {
  return {
    duration: clip.duration,
    loop: clip.loop,
    speedMps: clip.speedMps,
    markers: clip.markers,
    ...(ONE_HAND_BAT_CLIPS.has(clip.name) ? { oneHand: true } : {}),
    sample: (t: number, out: SampledPose) => {
      sampleMotion(clip, t, out);
    },
    contacts: (t: number) => sampleMotion(clip, t, contactScratch).contacts,
    ground: (t: number) => {
      const g = { x: 0, z: 0, yawDeg: 0 };
      sampleMotion(clip, t, contactScratch, g);
      return g;
    },
  };
}

async function defaultFetch(url: string): Promise<ArrayBuffer | null> {
  try {
    const r = await fetch(url);
    return r.ok ? await r.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** The packs' base URL (Vite's BASE_URL, e.g. /Vande/ on Pages). */
export function motionBase(): string {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}practice/motion/`;
}

/**
 * Fetches and decodes the packs once (resolves to the number of clips decoded). They wait in `pending` until the next
 * `commitMotion`. Safe to call again: the first load is shared.
 */
export function loadMotionPacks(
  base = motionBase(),
  fetchBytes: (url: string) => Promise<ArrayBuffer | null> = defaultFetch,
): Promise<number> {
  if (loading) return loading;
  loading = (async () => {
    const out: Loaded = { clips: new Map(), field: new Map(), bytes: 0 };
    // Fetched in parallel; decoded in pack order (so a later pack's clip of the same id wins deterministically).
    const all = await Promise.all(MOTION_PACKS.map((pack) => fetchBytes(`${base}${pack}.vmp`).catch(() => null)));
    for (let i = 0; i < MOTION_PACKS.length; i++) {
      const pack = MOTION_PACKS[i];
      const bytes = all[i];
      if (!bytes) continue;
      try {
        const decoded = parsePack(bytes);
        out.bytes += decoded.bytes;
        for (const [id, clip] of decoded.clips) {
          out.clips.set(id, clip);
          if (FIELD_PACKS.has(pack)) out.field.set(id, clip);
        }
      } catch {
        /* a bad pack leaves its clips to the built-ins */
      }
    }
    pending = out;
    return out.clips.size;
  })();
  return loading;
}

/**
 * Makes loaded packs current, if any are waiting. Call only between deliveries (a delivery's first script, the
 * between-balls scene): returns true when the set changed.
 */
export function commitMotion(): boolean {
  if (!pending || pending === committed) return false;
  committed = pending;
  pending = null;
  setMotionSources(new Map([...committed.clips].map(([id, clip]) => [id, source(clip)])));
  registerFieldMotion({
    clips: committed.field,
    sample: (clip, t, out) => sampleMotion(clip as MotionClip, t, out).contacts,
  });
  return true;
}

/** Bytes of the packs in use (the size report). */
export function motionBytes(): number {
  return committed?.bytes ?? 0;
}

/** Tests: forget everything loaded. */
export function resetMotionLibrary(): void {
  pending = null;
  committed = null;
  loading = null;
  setMotionSources(null);
  registerFieldMotion(null);
}
