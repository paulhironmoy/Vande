/**
 * The baked venue's controller: decides whether a quality gets a pack, loads it between deliveries, swaps it in with a
 * dissolve and falls back to the procedural stand-in on any failure. The stand-in (stadium.ts) is always there first and
 * always the owner of every interactive behaviour; the baked venue only replaces its stands, back wall, parapet and roof.
 *
 * Rules (the rubric's PERF2 and PERF4, the Definition of Done VEN-03):
 * - nothing waits for the venue: the first interactive frame is the stand-in's;
 * - no download starts, and nothing is compiled or swapped, while a delivery is live (`isDelivery`, the session's Delivery
 *   Quiet Mode); a download in flight when a delivery starts is aborted and tried again at the next idle frame;
 * - a failed or oversized or corrupt pack, a missing stand-in, a context error: the stand-in stays (state `failed`); so does a
 *   browser asked to save data (Data Saver): no download is started;
 * - the dissolve is frozen during a delivery and instant under Reduced Motion;
 * - a lower quality (Lite, Classic) restores the stand-in at once (the stage only changes quality between balls).
 *
 * The heavy code (venueBaked.ts, venueGlb.ts and the pack URLs) is a lazy chunk. The default Android build does not contain
 * it at all: the build-time condition below folds to false there, so neither the chunk nor the pack files are emitted
 * (docs/ANDROID_RELEASE.md: `VITE_VENUE_BAKED=1` builds the sideload variant that includes them). `VITE_VENUE_OFF=1` leaves the
 * baked venue out of any build (a switch to drop it without deleting it).
 */
import type { Camera, Group, Object3D, Scene, WebGLRenderer } from 'three';
import type { QualityProfileId } from '@/contracts';
import type { BakedVenue, StandUniforms } from './venueBaked';

export type VenuePack = 'premium' | 'balanced';
export type VenueState = 'off' | 'idle' | 'loading' | 'loaded' | 'ready' | 'fading' | 'shown' | 'failed';

/** Whether this build contains the baked venue at all (false on the default Android build). */
export const BAKED_VENUE_BUILT =
  (import.meta.env.VITE_BUILD_TARGET !== 'android' || import.meta.env.VITE_VENUE_BAKED === '1') &&
  import.meta.env.VITE_VENUE_OFF !== '1';
/** The dissolve, in ms (instant under Reduced Motion). */
export const FADE_MS = 500;
/** How many times a download may be started before a player who keeps batting gives up on it. */
export const MAX_ATTEMPTS = 6;

/** Premium (High) gets the full pack, Balanced Standard the light one; Balanced Lite and Classic keep the stand-in. */
export function packFor(profile: QualityProfileId): VenuePack | null {
  return profile === 'high' ? 'premium' : profile === 'standard' ? 'balanced' : null;
}

export interface VenueHost {
  stadiumGroup: Group;
  scene: Scene;
  camera: Camera;
  renderer: WebGLRenderer;
  /** True from the run-up of a live delivery to its outcome (the session's Delivery Quiet Mode). */
  isDelivery(): boolean;
  reducedMotion(): boolean;
}

export interface VenueDeps {
  /** Fetches and builds a pack; the default imports the lazy chunk. Tests inject their own. */
  load?: (pack: VenuePack, uniforms: StandUniforms, signal: AbortSignal) => Promise<BakedVenue>;
  now?: () => number;
  /** Test builds only: the query value of `venue` (`off` keeps the stand-in), so one build can be compared with itself. */
  override?: string | null;
  /** Told of every state change (the stage mirrors it onto the canvas in test builds). */
  onState?: (state: VenueState) => void;
}

export interface VenueInspect {
  pack: VenuePack | null;
  state: VenueState;
  attempts: number;
  reason: string;
  stats: ReturnType<BakedVenue['stats']> | null;
}

export interface VenueController {
  /** The stage's quality changed (between balls) or was just mounted. */
  setProfile(profile: QualityProfileId): void;
  /** A delivery started (true) or ended (false): a download in flight is aborted on true. */
  setDelivery(on: boolean): void;
  /** One frame's spare moment: advances the load, the warm-up and the dissolve. Cheap when there is nothing to do. */
  tick(): void;
  inspect(): VenueInspect;
  dispose(): void;
}

async function defaultLoad(pack: VenuePack, uniforms: StandUniforms, signal: AbortSignal): Promise<BakedVenue> {
  // Written inline so the bundler folds it away when the build does not carry the venue.
  if (
    (import.meta.env.VITE_BUILD_TARGET !== 'android' || import.meta.env.VITE_VENUE_BAKED === '1') &&
    import.meta.env.VITE_VENUE_OFF !== '1'
  ) {
    const [{ loadBakedVenue }, { PACK_URLS }] = await Promise.all([import('./venueBaked'), import('./venuePacks')]);
    return loadBakedVenue(PACK_URLS[pack], uniforms, signal);
  }
  throw new Error('the baked venue is not part of this build');
}

/** The player asked the browser to save data (Data Saver): the venue's download is skipped and the stand-in stays. */
function saveData(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true
  );
}

/** The `venue` query value in test builds (`off` keeps the stand-in); production builds never read the address. */
function testOverride(): string | null {
  if (import.meta.env.VITE_PRACTICE_TEST_HOOKS !== '1' || typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get('venue');
}

export function createVenueController(host: VenueHost, deps: VenueDeps = {}): VenueController {
  const now = deps.now ?? (() => performance.now());
  const load = deps.load ?? defaultLoad;
  const override = deps.override === undefined ? testOverride() : deps.override;
  let pack: VenuePack | null = null;
  let profileKey: QualityProfileId | null = null;
  let state: VenueState = 'off';
  const go = (next: VenueState) => {
    if (state === next) return;
    state = next;
    deps.onState?.(next);
  };
  let baked: BakedVenue | null = null;
  let abort: AbortController | null = null;
  let generation = 0;
  let attempts = 0;
  let reason = '';
  let fadeMs = 0;
  let lastTick = 0;

  const parts = () =>
    (host.stadiumGroup.userData.venue ?? null) as { uniforms: StandUniforms; replaces: Object3D[] } | null;
  const standIn = (on: boolean) => parts()?.replaces.forEach((o) => (o.visible = on));

  const reset = () => {
    generation++;
    abort?.abort();
    abort = null;
    if (baked) {
      baked.dispose();
      baked = null;
    }
    standIn(true);
    fadeMs = 0;
    lastTick = 0;
    reason = '';
    go('off');
  };

  const fail = (why: unknown) => {
    generation++;
    abort = null;
    if (baked) {
      baked.dispose();
      baked = null;
    }
    standIn(true);
    reason = why instanceof Error ? why.message : String(why);
    go('failed');
  };

  const start = () => {
    const p = parts();
    if (!pack || !p) return fail('no stand-in to replace');
    const gen = ++generation;
    const ctl = (abort = new AbortController());
    go('loading');
    attempts++;
    load(pack, p.uniforms, ctl.signal).then(
      (venue) => {
        if (gen !== generation) {
          venue.dispose();
          return;
        }
        baked = venue;
        go('loaded');
      },
      (err: unknown) => {
        if (gen !== generation) return;
        if (ctl.signal.aborted) {
          // A delivery started first: try again at the next idle frame, a few times.
          reason = 'a delivery started first';
          go(attempts >= MAX_ATTEMPTS ? 'failed' : 'idle');
          return;
        }
        fail(err);
      },
    );
  };

  return {
    setProfile(profile) {
      if (profile === profileKey) return;
      reset();
      profileKey = profile;
      pack = BAKED_VENUE_BUILT && override !== 'off' && !saveData() ? packFor(profile) : null;
      attempts = 0;
      go(pack ? 'idle' : 'off');
    },
    setDelivery(on) {
      if (on && state === 'loading') {
        abort?.abort();
      }
    },
    tick() {
      const t = now();
      const dt = lastTick ? Math.min(100, t - lastTick) : 0;
      lastTick = t;
      if (host.isDelivery()) return;
      switch (state) {
        case 'idle':
          start();
          break;
        case 'loaded':
          try {
            baked!.setFade(0);
            baked!.warm(host.renderer, host.camera, host.scene);
            go('ready');
          } catch (err) {
            fail(err);
          }
          break;
        case 'ready':
          host.stadiumGroup.add(baked!.group);
          fadeMs = 0;
          go('fading');
          break;
        case 'fading': {
          fadeMs += dt;
          const f = host.reducedMotion() ? 1 : fadeMs / FADE_MS;
          baked!.setFade(f);
          if (f >= 1) {
            standIn(false);
            go('shown');
          }
          break;
        }
        default:
          break;
      }
    },
    inspect: () => ({ pack, state, attempts, reason, stats: baked ? baked.stats() : null }),
    dispose() {
      reset();
      profileKey = null;
      pack = null;
    },
  };
}
