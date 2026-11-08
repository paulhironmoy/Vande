/**
 * A camera session the tests drive by hand: it never opens a camera, reads no picture and loads no pack. The tests say
 * when `start()` finishes or fails, what the person looks like to the camera (a PoseReadiness) and how the download goes.
 */
import type { Handedness, NormalizedSwing } from '@/contracts';
import type { CameraBatterEvents } from '@/input/camera/driver';
import {
  NO_PACK,
  NO_READINESS,
  type CameraBat,
  type CameraProblem,
  type CameraSession,
  type CameraSessionStatus,
  type PackStatus,
  type PoseReadiness,
} from '@/practice/ui/camera/ports';

/** A batter that records how the flow arms it. */
export interface FakeBat extends CameraBat {
  calls: string[];
  handlers: Partial<CameraBatterEvents> | null;
  enabled: boolean;
  hand: Handedness | null;
}

export interface FakeSession extends CameraSession {
  bat: FakeBat;
  /** Changes the status and tells the subscribers (a new object, as the port promises). */
  set(patch: Partial<CameraSessionStatus>): void;
  setReadiness(patch: Partial<PoseReadiness>): void;
  setPack(patch: Partial<PackStatus>): void;
  /** The person is in frame, steady and in the ready zone. */
  seen(): void;
  /** Finishes the pending `start()`: the camera is running. */
  finish(): void;
  /** Fails the pending `start()` with a problem (the status says so too). */
  fail(problem: CameraProblem): void;
  emitSwing(swing: NormalizedSwing): void;
  calls: { start: number; stop: number; permission: number; openSettings: number };
  signals: AbortSignal[];
  previews: HTMLVideoElement[];
  detached: number;
  /** What `unavailable()` says. */
  unavailableWith: CameraProblem | null;
  cached: boolean;
  bytes: number;
}

export const SEEN: PoseReadiness = {
  inFrame: true,
  shoulders: true,
  battingHand: true,
  otherHand: true,
  head: true,
  distance: 'ok',
  headroom: true,
  handsReadyZone: true,
  still: true,
  stableMs: 500,
  ready: true,
  poorLight: false,
};

export function createFakeSession(
  init: { cached?: boolean; bytes?: number; openSettings?: boolean } = {},
): FakeSession {
  let status: CameraSessionStatus = {
    stage: 'idle',
    problem: null,
    pack: init.cached ? { ...NO_PACK, state: 'cached' } : NO_PACK,
    readiness: NO_READINESS,
    lost: false,
  };
  const listeners = new Set<() => void>();
  const swingListeners = new Set<(s: NormalizedSwing) => void>();
  let pending: { resolve: () => void; reject: (e: Error) => void } | null = null;
  const emit = () => listeners.forEach((l) => l());
  const bat: FakeBat = {
    calls: [],
    handlers: null,
    enabled: false,
    hand: null,
    setHandlers(h) {
      bat.handlers = h;
      bat.calls.push(h ? 'handlers' : 'handlers:null');
    },
    setEnabled(on) {
      bat.enabled = on;
      bat.calls.push(`enabled:${on}`);
    },
    rearm() {
      bat.calls.push('rearm');
    },
    setHandedness(h) {
      bat.hand = h;
      bat.calls.push(`hand:${h}`);
    },
  };
  const fake: FakeSession = {
    bat,
    calls: { start: 0, stop: 0, permission: 0, openSettings: 0 },
    signals: [],
    previews: [],
    detached: 0,
    unavailableWith: null,
    cached: init.cached ?? false,
    bytes: init.bytes ?? 9_200_000,
    status: () => status,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    unavailable: () => fake.unavailableWith,
    packBytes: () => fake.bytes,
    packCached: () => Promise.resolve(fake.cached),
    start(signal) {
      fake.calls.start += 1;
      if (signal) {
        fake.signals.push(signal);
        signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          pending?.reject(err);
          pending = null;
        });
      }
      fake.set({ stage: 'opening', problem: null });
      return new Promise<void>((resolve, reject) => {
        pending = { resolve, reject };
      });
    },
    stop() {
      fake.calls.stop += 1;
      status = { ...status, stage: 'idle', problem: null, readiness: NO_READINESS, lost: false };
      emit();
    },
    attachPreview(video) {
      fake.previews.push(video);
      return () => {
        fake.detached += 1;
      };
    },
    onSwing(cb) {
      swingListeners.add(cb);
      return () => void swingListeners.delete(cb);
    },
    set(patch) {
      status = { ...status, ...patch };
      emit();
    },
    setReadiness(patch) {
      status = { ...status, readiness: { ...status.readiness, ...patch } };
      emit();
    },
    setPack(patch) {
      status = { ...status, pack: { ...status.pack, ...patch } };
      emit();
    },
    seen() {
      fake.set({ readiness: SEEN, lost: false });
    },
    finish() {
      fake.set({ stage: 'running', problem: null });
      pending?.resolve();
      pending = null;
    },
    fail(problem) {
      fake.set({ stage: 'failed', problem });
      pending?.reject(Object.assign(new Error(problem), { problem }));
      pending = null;
    },
    emitSwing(swing) {
      swingListeners.forEach((l) => l(swing));
    },
  };
  if (init.openSettings) {
    fake.openSettings = () => {
      fake.calls.openSettings += 1;
      return Promise.resolve();
    };
  }
  return fake;
}
