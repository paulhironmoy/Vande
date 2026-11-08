/**
 * CameraBatter: one GestureTracker (the existing one, unchanged) fed by the camera's PoseMapper. It exposes the same cues as
 * GestureSurface (swingStart, intent, state, cancel, gesture), so the Practice flow reads a camera swing exactly like a finger
 * swing, and normalizeGesture stays the only authority: this file never makes a NormalizedSwing and never touches physics.
 *
 * Arming mirrors GestureSurface's `enabled`: arm it when the delivery goes live (release), disarm when it is over. A contact
 * opens only while armed and only after the hands first move; the tracker's own rules decide everything after that. One
 * contact at a time: while a finger, mouse or pen is down on the page the camera does not open one (pointerIsDown).
 * Docs/PRACTICE_CAMERA_INPUT.md §4.
 */
import type { Footwork, GestureInput, Handedness } from '@/contracts/practice';
import { pointerIsDown } from '../pressing';
import {
  GestureTracker,
  type OneGestureState,
  type PointerKind,
  type SwingIntent,
  type TrackerScheduler,
} from '../tracker';
import { CAMERA_POINTER_ID, VIRTUAL_SURFACE } from './constants';
import { PoseMapper } from './mapper';
import type { MapperOutput, PoseFrame, PoseReadiness, TrackerCommand } from './types';

export interface CameraBatterEvents {
  /** The touch-down cue: the first rise of the hands opened a contact (at the last still frame's time). */
  onSwingStart?: (atPerfMs: number, pointer: PointerKind, footwork: Footwork) => void;
  onIntent?: (intent: SwingIntent) => void;
  onCancel?: () => void;
  onContactState?: (state: OneGestureState) => void;
  /** The one gesture of this delivery, for normalizeGesture. */
  onGesture: (input: GestureInput) => void;
  /** The pose readiness or tracking changed (CAMERA-UX's chip, the flow's pre-delivery wait). */
  onStatus?: (status: CameraBatterStatus) => void;
}

export interface CameraBatterStatus {
  readiness: PoseReadiness;
  /** No valid pose for POSE.lostMs. */
  lost: boolean;
  contactOpen: boolean;
}

export interface CameraBatterOptions {
  scheduler?: TrackerScheduler;
  sourceMirrored?: boolean;
  handedness?: Handedness;
  /** The performance clock (injectable for tests). */
  now?: () => number;
  /** True while a finger, mouse or pen is down on the page (default: src/input/pressing's pointerIsDown). */
  otherPointerDown?: () => boolean;
}

const sameReadiness = (a: PoseReadiness, b: PoseReadiness) =>
  a.inFrame === b.inFrame &&
  a.shoulders === b.shoulders &&
  a.battingHand === b.battingHand &&
  a.otherHand === b.otherHand &&
  a.head === b.head &&
  a.distance === b.distance &&
  a.headroom === b.headroom &&
  a.handsReadyZone === b.handsReadyZone &&
  a.still === b.still &&
  a.ready === b.ready &&
  a.poorLight === b.poorLight;

export class CameraBatter {
  private readonly tracker: GestureTracker;
  private readonly mapper: PoseMapper;
  private readonly events: CameraBatterEvents;
  private readonly now: () => number;
  private readonly otherPointerDown: () => boolean;
  private enabled = false;
  private lastStatus: CameraBatterStatus | null = null;

  constructor(events: CameraBatterEvents, o: CameraBatterOptions = {}) {
    this.events = events;
    this.now = o.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.otherPointerDown = o.otherPointerDown ?? pointerIsDown;
    this.mapper = new PoseMapper({ sourceMirrored: o.sourceMirrored, handedness: o.handedness });
    this.tracker = new GestureTracker(
      {
        swingStart: (t, p, f) => events.onSwingStart?.(t, p, f),
        gesture: (input) => events.onGesture(input),
        intent: (i) => events.onIntent?.(i),
        cancel: () => events.onCancel?.(),
        state: (s) => events.onContactState?.(s),
      },
      o.scheduler,
    );
    this.tracker.setSurface(VIRTUAL_SURFACE.width, VIRTUAL_SURFACE.height);
    this.tracker.setFootwork('auto');
    this.tracker.setHandedness(o.handedness ?? 'right');
    this.tracker.setPressFootwork(false);
  }

  setHandedness(h: Handedness) {
    this.mapper.setHandedness(h);
    this.tracker.setHandedness(h);
  }

  setSourceMirrored(m: boolean) {
    this.mapper.setSourceMirrored(m);
  }

  setPoorLight(on: boolean) {
    this.mapper.setPoorLight(on);
  }

  /** The readiness of the latest frame (CAMERA-UX reads it through the port). */
  getReadiness(): PoseReadiness {
    return this.mapper.getReadiness();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Arms one gesture for a live delivery (a rising edge), like GestureSurface's `enabled`. */
  setEnabled(on: boolean, atPerfMs: number = this.now()) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      this.apply(this.mapper.arm(atPerfMs));
      this.tracker.setEnabled(true);
    } else {
      this.apply(this.mapper.disarm());
      this.tracker.setEnabled(false);
    }
  }

  /** A new delivery while enabled (a changed deliveryKey). */
  rearm(atPerfMs: number = this.now()) {
    if (!this.enabled) return;
    this.apply(this.mapper.arm(atPerfMs));
    this.tracker.rearm();
  }

  /** One camera frame (capture time on the performance clock). */
  push(frame: PoseFrame): MapperOutput {
    const out = this.mapper.push(frame);
    this.handle(out);
    return out;
  }

  /** A watchdog tick when frames stop arriving: tracking is lost after POSE.lostMs without a valid pose. */
  tick(nowMs: number = this.now()): MapperOutput {
    const out = this.mapper.tick(nowMs);
    this.handle(out);
    return out;
  }

  dispose() {
    this.apply(this.mapper.disarm());
    this.tracker.dispose();
    this.enabled = false;
  }

  // ---- internals --------------------------------------------------------------------------------------------------

  private handle(out: MapperOutput) {
    // One contact at a time: a finger, mouse or pen that is down owns the delivery; a contact the camera would open now
    // is dropped (the mapper has already counted it as open, so it is cancelled at once).
    if (this.otherPointerDown() && out.commands.some((c) => c.type === 'down')) {
      this.apply(this.mapper.disarm());
      this.apply(this.mapper.arm(this.now()));
    } else {
      this.apply(out.commands);
    }
    const status: CameraBatterStatus = { readiness: out.readiness, lost: out.lost, contactOpen: out.contactOpen };
    const prev = this.lastStatus;
    if (
      !prev ||
      prev.lost !== status.lost ||
      prev.contactOpen !== status.contactOpen ||
      !sameReadiness(prev.readiness, status.readiness)
    ) {
      this.lastStatus = status;
      this.events.onStatus?.(status);
    }
  }

  private apply(commands: readonly TrackerCommand[]) {
    for (const c of commands) {
      switch (c.type) {
        case 'down':
          this.tracker.pointerDown(CAMERA_POINTER_ID, 'camera', c.sample);
          break;
        case 'move':
          this.tracker.pointerMove(CAMERA_POINTER_ID, c.samples);
          break;
        case 'up':
          this.tracker.pointerUp(CAMERA_POINTER_ID, c.sample);
          break;
        case 'cancel':
          this.tracker.pointerCancel(CAMERA_POINTER_ID);
          break;
      }
    }
  }
}
