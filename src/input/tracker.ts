/**
 * Gesture tracker: the state machine behind GestureSurface, free of the DOM so it can be tested with exact timestamps
 * (and replayed by simulate.ts). One gesture per arming (one per delivery):
 *
 *   armed press      pointer-down → the touch-down cue at once, at the press's own timestamp (swingStart): the
 *                    stroke starts there (presentation moves the bat from it; owner decision 2026-11-04), then
 *                      - lifted without moving within TAP_HOLD_MS → a tap: a defence timed from the press → gesture
 *                      - movement beyond the threshold, at any time → an attack timed from the swipe's own start
 *                        (swipeStart: when its movement left the circle where the finger rested, after any rest),
 *                        read until it lifts or READ_MAX_MS after that start (the first sample past it, or
 *                        LATE_SAMPLE_WAIT_MS later at the latest) → gesture
 *                      - still unmoved after TAP_HOLD_MS: a finger waiting in anticipation ('waiting', so the
 *                        touch-down stroke checks back). Lifting it is not a shot ('intentional_leave'); a later swipe
 *                        is an attack as above.
 *   resting finger   a pointer already down when the tracker is armed: its first intentional movement is a swipe as
 *                    above (and the ready cue comes with it); lifting it is not a shot
 *   footwork         a key chosen this delivery (W, S, the side letters), else — once it is switched on with
 *                    setPressFootwork — where the press landed (high in the batting area forward, low back, the middle
 *                    automatic), else the on-screen default
 *   keyboard         Space, Enter or keypad 5 → a defence at the key's timestamp; an arrow → an attack that way (a
 *                    second arrow within KEYBOARD.chordMs makes a diagonal; keypad 1–9 give the eight directions at
 *                    once); Shift held lofts it; W (twice quickly: down the track), S and the side letters choose
 *                    footwork
 *
 * Every decision is made from the events' own timestamps, so a decision made late (a frame-batched sample, a busy main
 * thread) is the same decision, and a swing's timing is always an event's own (interpolated) time. Samples live only
 * until the gesture is emitted.
 *
 * Plain TypeScript with no parameter properties or enums, so Node's type stripping can load it (examiner scripts).
 */
import type { Footwork, GestureInput, GestureSample, Handedness, SwingKind } from '@/contracts/practice';
import {
  DEPARTURE,
  DOWN_TRACK_DOUBLE_MS,
  KEYBOARD,
  LATE_SAMPLE_WAIT_MS,
  ONE_CONTACT,
  ONSET_GAP,
  ONSET_SPEED_PX_PER_MS,
  PRESS_FOOTWORK,
  READ_MAX_MS,
  TAP_HOLD_MS,
} from './constants';
import {
  crossingIndex,
  moveThreshold,
  powerOf,
  readOneContact,
  screenBearing,
  swipeStart,
  type KeyStroke,
  type OneContactRead,
  type SwipeStart,
  type TrackedInput,
} from './normalize';

export type PointerKind = GestureInput['pointer'];

/** What kind of swing the player has committed to, as soon as the tracker knows (before the read is complete). */
export interface SwingIntent {
  kind: SwingKind;
  /** The swing's timing (performance.now() ms): the press for a defence, the swipe's own start for an attack, the key. */
  atPerfMs: number;
  /** When the finger landed (the ready cue); the same as atPerfMs for a key or a finger that was already down. */
  pressAtPerfMs: number;
  pointer: PointerKind;
  /** Attack: the bearing on screen so far (0 = up, + = right); the finished read may differ a little. */
  screenBearingDeg: number | null;
  /** Keyboard attack with Shift (a swipe's loft is known only when its read is complete). */
  loft: boolean;
  /** The footwork this swing will carry. */
  footwork: Footwork;
}

/**
 * The externally observable phases of the one-pointer control. `waiting`: an armed press stayed unmoved past
 * TAP_HOLD_MS, so it is no longer a tap and not a shot; presentation checks the touch-down stroke back. Its `atPerfMs`
 * is always the tap window's end (press + TAP_HOLD_MS), however the tracker learned it.
 */
export type OneGesturePhase =
  'ready' | 'waiting' | 'loading' | 'tracking' | 'committing' | 'released' | 'intentional_leave' | 'cancelled';

/**
 * A presentation-safe view of the canonical state machine. Values are player intent only: no ball-aware correction,
 * named shot, aim assist or outcome is introduced here.
 */
export interface OneGestureState {
  phase: OneGesturePhase;
  atPerfMs: number;
  pressAtPerfMs: number;
  timingAtPerfMs: number | null;
  pointer: PointerKind;
  pullbackDepth: number;
  pullbackIntent: number;
  lateralAdjustment: number;
  aggression: number;
  elevationIntent: number;
  forwardBearingDeg: number | null;
  forwardVelocity: number;
  pathPower: number;
  committed: boolean;
}

export interface TrackerEvents {
  /**
   * The touch-down cue: a finger landed (or a key went down, or a finger already resting began to move), at that event's
   * own timestamp, with the footwork known at that moment. Fired synchronously, before anything else. The stroke starts
   * here: a tap is timed from it (its committed defence has exactly this atPerfMs, so presentation never retimes it); a
   * swipe from its own start (SwingIntent.atPerfMs), which is this moment or later. A press that outlives the tap
   * window unmoved publishes `waiting`; a pullback publishes `loading`.
   */
  swingStart(atPerfMs: number, pointer: PointerKind, footwork: Footwork): void;
  /** The complete gesture, for normalizeGesture. */
  gesture(input: GestureInput): void;
  /** Optional: defence or attack, with its timing, as soon as it is known. */
  intent?(intent: SwingIntent): void;
  /** Abort an uncommitted pointer cue/intent. Never emitted for a completed shot or an unrelated resting pointer. */
  cancel?(): void;
  /** Optional live/terminal one-contact state for presentation and deterministic evidence. */
  state?(state: OneGestureState): void;
}

export interface TrackerScheduler {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
}

const defaultScheduler: TrackerScheduler = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

type Mode = 'resting' | 'pressing' | 'loading' | 'swiping' | 'committing' | 'spent';

interface Active {
  id: number;
  kind: PointerKind;
  samples: GestureSample[];
  mode: Mode;
  /** An armed press: when it landed. Null for a finger that was already down when the delivery was armed. */
  pressT: number | null;
  /** Swiping: where and when the swipe started (recomputed as samples arrive). */
  start: SwipeStart | null;
  /** Swiping: when the read ends at the latest (the start + READ_MAX_MS). */
  capMs: number;
  /** Last canonical one-contact read (retained after early emission so pointer-up can close it). */
  contact: OneContactRead | null;
  /** A pullback reversal commits immediately and cannot be undone by pointer cancellation. */
  irreversible: boolean;
  /** An armed press that outlived the tap window unmoved: `waiting` has been published for it. */
  waited: boolean;
}

interface Chord {
  t0: number;
  codes: string[];
  dirs: Array<readonly [number, number]>;
  loft: boolean;
}

export type KeyResult = 'swing' | 'footwork' | 'ignored';

/** Screen directions (x right, y down) of the shot keys. */
const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};
const KEYPAD: Readonly<Record<string, readonly [number, number]>> = {
  Numpad8: [0, -1],
  Numpad9: [1, -1],
  Numpad6: [1, 0],
  Numpad3: [1, 1],
  Numpad2: [0, 1],
  Numpad1: [-1, 1],
  Numpad4: [-1, 0],
  Numpad7: [-1, -1],
};
const DEFEND_KEYS = new Set(['Space', 'Enter', 'NumpadEnter', 'Numpad5']);
const SHIFT_KEYS = new Set(['ShiftLeft', 'ShiftRight']);

/** True for the keys that play a shot (defence or attack). */
export function isShotKey(code: string): boolean {
  return DEFEND_KEYS.has(code) || code in ARROWS || code in KEYPAD;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export class GestureTracker {
  private readonly events: TrackerEvents;
  private readonly sched: TrackerScheduler;
  private armed = false;
  private enabled = false;
  private active: Active | null = null;
  private chord: Chord | null = null;
  private timer: unknown = null;
  private timerAt = Number.NaN;
  private surface = { width: 1, height: 1 };
  private footworkDefault: Footwork = 'auto';
  private footworkKey: Footwork | null = null;
  private footworkPress: Footwork | null = null;
  private footworkContact: Footwork | null = null;
  private pressFootwork = false;
  private lastForwardMs = Number.NEGATIVE_INFINITY;
  private handedness: Handedness = 'right';
  private lastState: OneGestureState | null = null;

  constructor(events: TrackerEvents, sched: TrackerScheduler = defaultScheduler) {
    this.events = events;
    this.sched = sched;
  }

  setSurface(width: number, height: number) {
    if (width > 0 && height > 0) this.surface = { width, height };
  }
  setFootwork(f: Footwork) {
    this.footworkDefault = f;
  }
  setHandedness(h: Handedness) {
    this.handedness = h;
  }
  /** Footwork by where the press lands (PRESS_FOOTWORK). Off by default: rookies keep automatic footwork. */
  setPressFootwork(on: boolean) {
    this.pressFootwork = on;
  }
  isArmed(): boolean {
    return this.armed;
  }
  /** Last live or terminal state; null before the first contact of an arming. */
  getContactState(): OneGestureState | null {
    return this.lastState ? { ...this.lastState } : null;
  }

  /** Enables or disables input. A rising edge arms one gesture; a pointer already down becomes a resting finger. */
  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this.arm();
    else this.disarm();
  }

  /** Arms a fresh gesture for a new delivery (while enabled). */
  rearm() {
    if (this.enabled) this.arm();
  }

  private arm() {
    this.clearTimer();
    this.chord = null;
    this.armed = true;
    this.footworkKey = null;
    this.footworkPress = null;
    this.footworkContact = null;
    this.lastForwardMs = Number.NEGATIVE_INFINITY;
    this.lastState = null;
    this.rest();
  }

  private disarm() {
    this.clearTimer();
    this.chord = null;
    this.armed = false;
    this.rest();
  }

  /** A pointer that is down becomes a resting finger: only its movement from here on can start a swing. */
  private rest() {
    const a = this.active;
    if (!a) return;
    a.mode = 'resting';
    a.pressT = null;
    a.start = null;
    a.contact = null;
    a.irreversible = false;
    a.waited = false;
    a.samples = a.samples.length ? [a.samples[a.samples.length - 1]] : [];
  }

  pointerDown(id: number, kind: PointerKind, sample: GestureSample) {
    if (this.active) return;
    // Disarmed, spent, or a key shot already under way: a finger that lands now only rests.
    if (!this.armed || this.chord) {
      this.active = {
        id,
        kind,
        samples: [sample],
        mode: 'resting',
        pressT: null,
        start: null,
        capMs: Number.POSITIVE_INFINITY,
        contact: null,
        irreversible: false,
        waited: false,
      };
      return;
    }
    const a: Active = {
      id,
      kind,
      samples: [sample],
      mode: 'pressing',
      pressT: sample.t,
      start: null,
      capMs: Number.POSITIVE_INFINITY,
      contact: null,
      irreversible: false,
      waited: false,
    };
    this.active = a;
    this.notePress(sample);
    this.events.swingStart(sample.t, kind, this.footwork());
    this.publish(this.stateFrom('ready', kind, sample.t, sample.t, null));
    // A finger that stays perfectly still may send no samples: tell presentation the tap window closed anyway, once any
    // lift stamped inside it would have arrived. Presentation only; the tap/hold decision stays with the samples' time.
    this.schedule(sample.t + TAP_HOLD_MS + LATE_SAMPLE_WAIT_MS, () => {
      if (this.active === a && a.mode === 'pressing' && this.armed) this.publishWaiting(a);
    });
  }

  pointerMove(id: number, samples: readonly GestureSample[]) {
    const a = this.active;
    if (!a || a.id !== id || a.mode === 'spent') return;
    for (const s of samples) this.push(a, s);
    this.advance(a, false);
  }

  pointerUp(id: number, sample: GestureSample | null) {
    const a = this.active;
    if (!a || a.id !== id) return;
    if (a.mode === 'resting' && a.waited && this.armed) {
      // A press that waited past the tap window and never swiped: not a shot, and the delivery stays armed. Said
      // explicitly, whether or not a sample arrived after the window (the same at every cadence). Its tap-window timer
      // went when it became a resting finger; a key chord's timer may be running and is left alone.
      this.publish(
        this.stateFrom(
          'intentional_leave',
          a.kind,
          sample?.t ?? a.samples.at(-1)?.t ?? this.sched.now(),
          a.pressT ?? this.sched.now(),
          null,
        ),
      );
    } else if (a.mode !== 'spent' && a.mode !== 'resting') {
      if (sample) this.push(a, sample);
      this.advance(a, true);
      // Lifted without moving: a tap if it was quick; a finger that waited longer was not a shot.
      if (a.mode === 'pressing' && a.pressT !== null && a.samples[a.samples.length - 1].t <= a.pressT + TAP_HOLD_MS)
        this.emitTap(a);
      else if (a.mode === 'pressing') {
        // Compatibility: a long stationary wait is still non-consuming, but is now explicit to presentation.
        this.clearTimer();
        this.publishWaiting(a);
        this.publish(
          this.stateFrom(
            'intentional_leave',
            a.kind,
            sample?.t ?? a.samples.at(-1)?.t ?? this.sched.now(),
            a.pressT ?? this.sched.now(),
            null,
          ),
        );
      } else if (a.mode === 'loading') {
        if (a.contact?.phase === 'loading') {
          // Compatibility for the established full-circle control: a one-way, immediately released downward stroke
          // is still a behind-square legacy flick. A held/tracked backlift is unambiguously the new control.
          a.mode = 'pressing';
          a.contact = null;
          if (this.beginSwipe(a, a.samples)) this.emit(a);
        } else {
          // Pulling back, holding/adjusting, then choosing not to reverse is a deliberate leave, not a weak shot.
          this.clearTimer();
          this.armed = false;
          this.publishContact('intentional_leave', a, a.contact, sample?.t ?? a.samples.at(-1)?.t ?? this.sched.now());
        }
      }
    }
    if (a.mode === 'spent') this.publishContact('released', a, a.contact, sample?.t ?? this.sched.now(), true);
    // A resting finger that lifts is not a shot; a released one has nothing more to say.
    if (this.active === a) this.active = null;
  }

  pointerCancel(id: number) {
    const a = this.active;
    if (!a || a.id !== id) return;
    if (a.irreversible) {
      // Reversal into the forward stroke is the commitment boundary. A browser cancellation may close it but cannot
      // erase it or permit a different second shot.
      if (a.mode === 'committing') this.finish(a, a.samples);
      this.publishContact('cancelled', a, a.contact, a.samples.at(-1)?.t ?? this.sched.now(), true);
      this.active = null;
      this.footworkPress = null;
      return;
    }
    // Before forward commitment, browser interruption aborts the cue and leaves this delivery armed.
    const pendingCue = a.mode !== 'spent' && (a.pressT !== null || a.mode === 'swiping');
    // A swipe's read cap, or a press's tap-window notice: neither outlives the contact. (A resting finger holds no timer;
    // a key chord's may be running then and is left alone.)
    if (a.mode === 'swiping' || a.mode === 'pressing' || a.mode === 'loading') this.clearTimer();
    this.active = null;
    this.footworkPress = null;
    // A lateral refinement belongs to this contact, just like its press band. If the browser cancels before the
    // irreversible forward stroke, the retry must derive footwork from its own contact. Keyboard footwork is
    // delivery-scoped and deliberately remains selected.
    this.footworkContact = null;
    if (pendingCue) {
      this.publishContact('cancelled', a, a.contact, a.samples.at(-1)?.t ?? this.sched.now());
      this.events.cancel?.();
    }
  }

  /** A key press (event.code, event.timeStamp, event.repeat, Shift held). */
  key(code: string, t: number, repeat = false, mods: { shift?: boolean } = {}): KeyResult {
    if (!this.enabled) return 'ignored';
    if (DEFEND_KEYS.has(code)) {
      if (repeat) return this.armed || this.chord ? 'swing' : 'ignored';
      if (!this.keyCanSwing()) return 'ignored';
      this.startKeySwing(t);
      this.events.intent?.({
        kind: 'defend',
        atPerfMs: t,
        pressAtPerfMs: t,
        pointer: 'keyboard',
        screenBearingDeg: null,
        loft: false,
        footwork: this.footwork(),
      });
      this.emitKey({ kind: 'defend', screenBearingDeg: 0, loft: false }, t);
      return 'swing';
    }
    const dir = ARROWS[code] ?? KEYPAD[code];
    if (dir) {
      if (repeat) return this.armed || this.chord ? 'swing' : 'ignored';
      const c = this.chord;
      if (c) {
        // The second key of a diagonal (a repeat of the same key changes nothing).
        if (!c.codes.includes(code)) {
          c.codes.push(code);
          c.dirs.push(dir);
        }
        if (mods.shift) c.loft = true;
        this.closeChord();
        return 'swing';
      }
      if (!this.keyCanSwing()) return 'ignored';
      this.startKeySwing(t);
      const chord: Chord = { t0: t, codes: [code], dirs: [dir], loft: mods.shift === true };
      this.chord = chord;
      this.events.intent?.({
        kind: 'attack',
        atPerfMs: t,
        pressAtPerfMs: t,
        pointer: 'keyboard',
        screenBearingDeg: screenBearing(dir[0], dir[1]),
        loft: chord.loft,
        footwork: this.footwork(),
      });
      // A keypad key is already one of the eight directions; an arrow waits briefly for a second arrow.
      if (code in KEYPAD) this.closeChord();
      else this.schedule(t + KEYBOARD.chordMs, () => this.closeChord());
      return 'swing';
    }
    if (SHIFT_KEYS.has(code)) {
      if (this.chord) this.chord.loft = true;
      return 'ignored';
    }
    if (repeat) return 'ignored';
    const offKey = this.handedness === 'left' ? 'KeyA' : 'KeyD';
    const legKey = this.handedness === 'left' ? 'KeyD' : 'KeyA';
    if (code === 'KeyW') {
      this.footworkKey =
        this.footworkKey === 'forward' && t - this.lastForwardMs <= DOWN_TRACK_DOUBLE_MS ? 'down_track' : 'forward';
      this.lastForwardMs = t;
      return 'footwork';
    }
    if (code === 'KeyS') {
      this.footworkKey = 'back';
      return 'footwork';
    }
    if (code === offKey) {
      this.footworkKey = 'across';
      return 'footwork';
    }
    if (code === legKey) {
      this.footworkKey = 'auto';
      return 'footwork';
    }
    return 'ignored';
  }

  /** Footwork the next gesture will carry: a key chosen this delivery, else where the press landed, else the default. */
  footwork(): Footwork {
    return this.footworkKey ?? this.footworkContact ?? this.footworkPress ?? this.footworkDefault;
  }

  /** The footwork a press at height `y` on the surface asks for (PRESS_FOOTWORK), whether or not it is switched on. */
  footworkAt(y: number): Footwork {
    const v = this.surface.height > 0 ? y / this.surface.height : 0.5;
    return v < PRESS_FOOTWORK.forwardAbove ? 'forward' : v > PRESS_FOOTWORK.backBelow ? 'back' : 'auto';
  }

  dispose() {
    this.clearTimer();
    this.active = null;
    this.chord = null;
    this.armed = false;
    this.enabled = false;
  }

  // ---- internals ------------------------------------------------------------------------------------------------

  private stateFrom(
    phase: OneGesturePhase,
    pointer: PointerKind,
    atPerfMs: number,
    pressAtPerfMs: number,
    timingAtPerfMs: number | null,
    patch: Partial<OneGestureState> = {},
  ): OneGestureState {
    return {
      phase,
      atPerfMs,
      pressAtPerfMs,
      timingAtPerfMs,
      pointer,
      pullbackDepth: 0,
      pullbackIntent: 0,
      lateralAdjustment: 0,
      aggression: 0,
      elevationIntent: 0,
      forwardBearingDeg: null,
      forwardVelocity: 0,
      pathPower: 0,
      committed: false,
      ...patch,
    };
  }

  private publishContact(
    phase: OneGesturePhase,
    a: Active,
    contact: OneContactRead | null,
    atPerfMs: number,
    committed = false,
  ) {
    const prior = this.lastState?.pointer === a.kind ? this.lastState : null;
    const c = contact;
    this.publish(
      this.stateFrom(
        phase,
        a.kind,
        atPerfMs,
        a.pressT ?? c?.pressMs ?? prior?.pressAtPerfMs ?? atPerfMs,
        c?.commitMs ?? prior?.timingAtPerfMs ?? null,
        {
          pullbackDepth: c?.pullbackDepth ?? prior?.pullbackDepth ?? 0,
          pullbackIntent: c?.pullbackIntent ?? prior?.pullbackIntent ?? 0,
          lateralAdjustment: c?.lateralAdjustment ?? prior?.lateralAdjustment ?? 0,
          aggression: c?.aggression ?? prior?.aggression ?? 0,
          elevationIntent: c?.elevationIntent ?? prior?.elevationIntent ?? 0,
          forwardBearingDeg: c?.forwardBearingDeg ?? prior?.forwardBearingDeg ?? null,
          forwardVelocity: c?.forwardVelocity ?? prior?.forwardVelocity ?? 0,
          pathPower: c?.committed ? powerOf(c.forwardVelocity) : prior?.committed ? prior.pathPower : 0,
          committed: committed || c?.committed === true || prior?.committed === true,
        },
      ),
    );
  }

  /** The tap window closed on an unmoved press: not a shot (yet); the touch-down stroke checks back. Once per press. */
  private publishWaiting(a: Active) {
    if (a.waited || a.pressT === null) return;
    a.waited = true;
    this.publish(this.stateFrom('waiting', a.kind, a.pressT + TAP_HOLD_MS, a.pressT, null));
  }

  private publish(state: OneGestureState) {
    this.lastState = state;
    this.events.state?.({ ...state });
  }

  private push(a: Active, s: GestureSample) {
    const last = a.samples[a.samples.length - 1];
    if (!last || s.t >= last.t) a.samples.push(s);
  }

  private advance(a: Active, lifted: boolean) {
    if (a.mode === 'resting') {
      this.advanceResting(a);
      return;
    }
    if (a.mode === 'pressing' || a.mode === 'loading' || a.mode === 'committing') {
      const contact = readOneContact({
        pointer: a.kind,
        samples: a.samples,
        surface: this.surface,
        footwork: this.footwork(),
      });
      if (contact) {
        a.contact = contact;
        if (contact.phase === 'loading' || contact.phase === 'tracking') {
          a.mode = 'loading';
          if (this.pressFootwork && Math.abs(contact.lateralAdjustment) >= ONE_CONTACT.lateralFootwork)
            this.footworkContact = 'across';
          this.publishContact(contact.phase, a, contact, a.samples.at(-1)?.t ?? contact.pressMs);
          return;
        }
        if (contact.committed && contact.commitMs !== null) {
          const firstCommit = a.mode !== 'committing';
          a.mode = 'committing';
          a.irreversible = true;
          if (firstCommit) {
            this.events.intent?.({
              kind: 'attack',
              atPerfMs: contact.commitMs,
              pressAtPerfMs: a.pressT ?? contact.pressMs,
              pointer: a.kind,
              screenBearingDeg: contact.forwardBearingDeg,
              loft: contact.elevationIntent > 0,
              footwork: this.footwork(),
            });
          }
          this.publishContact('committing', a, contact, contact.commitMs);
          // Release only closes the contact. The authoritative swing is emitted as soon as the stable 40 ms read is
          // present, or with the evidence available when an already-committed short flick is released.
          if (contact.forwardReadMs >= ONE_CONTACT.forwardReadMs || lifted) this.finish(a, a.samples);
          return;
        }
      }
    }
    const thr = moveThreshold(this.surface);
    if (a.mode === 'pressing') {
      if (crossingIndex(a.samples, thr) >= 0) this.beginSwipe(a, a.samples);
      else {
        // Unmoved past TAP_HOLD_MS (by its samples' own time): a finger waiting in anticipation.
        if (!lifted && a.pressT !== null && a.samples[a.samples.length - 1].t > a.pressT + TAP_HOLD_MS) {
          a.mode = 'resting';
          a.samples = a.samples.slice(-1);
          this.clearTimer();
          this.publishWaiting(a);
        }
        return;
      }
    }
    if (a.mode !== 'swiping') return;
    // The start (and so the read's end) can sharpen as samples arrive.
    a.start = swipeStart(a.samples, thr) ?? a.start;
    if (a.start) a.capMs = a.start.atMs + READ_MAX_MS;
    if (lifted || a.samples[a.samples.length - 1].t >= a.capMs) this.emit(a);
    else this.scheduleCap(a);
  }

  /** The press (or resting finger) has moved beyond the threshold: an attack, timed from its own start. */
  private beginSwipe(a: Active, samples: GestureSample[]): boolean {
    const thr = moveThreshold(this.surface);
    const start = swipeStart(samples, thr);
    if (!start) return false;
    a.mode = 'swiping';
    a.samples = samples;
    a.start = start;
    a.capMs = start.atMs + READ_MAX_MS;
    if (a.pressT === null) {
      // A finger that was already down: its swing is its first cue.
      this.notePress(start.rest);
      this.events.swingStart(start.atMs, a.kind, this.footwork());
    }
    const z = samples[samples.length - 1];
    this.events.intent?.({
      kind: 'attack',
      atPerfMs: start.atMs,
      pressAtPerfMs: a.pressT ?? start.atMs,
      pointer: a.kind,
      screenBearingDeg: screenBearing(z.x - start.rest.x, z.y - start.rest.y),
      loft: false,
      footwork: this.footwork(),
    });
    this.publish(
      this.stateFrom('committing', a.kind, start.atMs, a.pressT ?? start.atMs, start.atMs, {
        forwardBearingDeg: screenBearing(z.x - start.rest.x, z.y - start.rest.y),
      }),
    );
    this.scheduleCap(a);
    return true;
  }

  /** Emits a swipe still on the glass LATE_SAMPLE_WAIT_MS after its read should have closed, if no sample did it first. */
  private scheduleCap(a: Active) {
    const at = a.capMs + LATE_SAMPLE_WAIT_MS;
    if (this.timer !== null && this.timerAt === at) return;
    this.schedule(at, () => {
      if (this.active === a && a.mode === 'swiping') this.emit(a);
    });
  }

  /**
   * A finger waiting on the glass (down before the delivery was armed, or a press held past TAP_HOLD_MS): its swing
   * begins with a run of intentional movement (at least ONSET_SPEED_PX_PER_MS, or any real displacement across a
   * silence) that moves beyond the threshold from where it rested. Slow drift only moves the rest point.
   */
  private advanceResting(a: Active) {
    if (!this.armed || this.chord) {
      a.samples = a.samples.slice(-1);
      return;
    }
    const s = a.samples;
    if (s.length < 2) return;
    const end = s.length - 1;
    let o = end;
    while (o > 0) {
      const p = s[o - 1];
      const q = s[o];
      const dt = q.t - p.t;
      const d = dist(p, q);
      const gap = dt > ONSET_GAP.ms;
      // The same rule as swipeStart, so the tracker and the read agree on where the swipe began.
      const moving = dt <= 0 ? d > 0 : gap ? d > DEPARTURE.restPx : d / dt >= ONSET_SPEED_PX_PER_MS;
      if (!moving) break;
      o--;
      if (gap) break;
    }
    if (o === end) {
      // Still: keep only the newest position as the rest for the next movement.
      a.samples = [s[end]];
      return;
    }
    if (dist(s[end], s[o]) <= moveThreshold(this.surface)) return;
    this.beginSwipe(a, s.slice(o));
    if (a.mode === 'swiping' && a.samples[a.samples.length - 1].t >= a.capMs) this.emit(a);
  }

  private emitTap(a: Active) {
    if (!this.armed || a.pressT === null) return;
    this.events.intent?.({
      kind: 'defend',
      atPerfMs: a.pressT,
      pressAtPerfMs: a.pressT,
      pointer: a.kind,
      screenBearingDeg: null,
      loft: false,
      footwork: this.footwork(),
    });
    this.publish(this.stateFrom('committing', a.kind, a.pressT, a.pressT, a.pressT, { committed: true }));
    this.finish(a, a.samples);
  }

  private emit(a: Active) {
    if (!this.armed) return;
    this.finish(a, a.samples);
  }

  private finish(a: Active, samples: GestureSample[]) {
    this.clearTimer();
    this.armed = false;
    const input: GestureInput = { pointer: a.kind, samples, surface: { ...this.surface }, footwork: this.footwork() };
    a.mode = 'spent';
    a.samples = [];
    a.start = null;
    this.events.gesture(input);
  }

  private keyCanSwing(): boolean {
    return this.armed && !this.chord && (!this.active || this.active.mode === 'resting');
  }

  private startKeySwing(t: number) {
    this.events.swingStart(t, 'keyboard', this.footwork());
    this.publish(this.stateFrom('ready', 'keyboard', t, t, null));
  }

  /** Where the swing's press landed, for footwork by position (when it is switched on). */
  private notePress(at: { y: number }) {
    const f = this.footworkAt(at.y);
    // The middle band leaves the footwork as it was (automatic, or the on-screen choice).
    this.footworkPress = this.pressFootwork && f !== 'auto' ? f : null;
  }

  private closeChord() {
    const c = this.chord;
    if (!c) return;
    this.chord = null;
    let x = 0;
    let y = 0;
    for (const [dx, dy] of c.dirs) {
      x += dx;
      y += dy;
    }
    // Opposite arrows cancel: the first one counts.
    if (Math.hypot(x, y) < 1e-9) [x, y] = c.dirs[0];
    this.emitKey({ kind: 'attack', screenBearingDeg: screenBearing(x, y), loft: c.loft }, c.t0);
  }

  private emitKey(key: KeyStroke, t: number) {
    this.clearTimer();
    this.armed = false;
    const committing = this.stateFrom('committing', 'keyboard', t, t, t, {
      forwardBearingDeg: key.kind === 'attack' ? key.screenBearingDeg : null,
      aggression: key.kind === 'attack' ? (key.loft ? KEYBOARD.loftPower : KEYBOARD.power) : 0,
      elevationIntent: key.kind === 'attack' && key.loft ? KEYBOARD.loftElevation : 0,
      pathPower: key.kind === 'attack' ? (key.loft ? KEYBOARD.loftPower : KEYBOARD.power) : 0,
      committed: true,
    });
    this.publish(committing);
    const input: TrackedInput = {
      pointer: 'keyboard',
      samples: [{ t, x: this.surface.width / 2, y: this.surface.height / 2 }],
      surface: { ...this.surface },
      footwork: this.footwork(),
      key,
    };
    this.events.gesture(input);
    this.publish({ ...committing, phase: 'released' });
  }

  private schedule(atMs: number, fn: () => void) {
    this.clearTimer();
    this.timerAt = atMs;
    this.timer = this.sched.setTimer(
      () => {
        this.timer = null;
        this.timerAt = Number.NaN;
        fn();
      },
      Math.max(0, atMs - this.sched.now()),
    );
  }

  private clearTimer() {
    if (this.timer !== null) this.sched.clearTimer(this.timer);
    this.timer = null;
    this.timerAt = Number.NaN;
  }
}
