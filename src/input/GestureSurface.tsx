/**
 * The batting gesture surface: pointer capture across the LOWER part of the landscape screen (so the finger never
 * covers the delivery), plus the batting keys while enabled (docs/PRACTICE_INPUT.md). Every sample uses its event's
 * own high-resolution timestamp (coalesced pointer events included), never a frame time.
 *
 * Three cues, in order:
 *   onSwingStart  the touch-down cue: a finger landed (or a key went down, or a finger already resting began to move),
 *                 at the event's own timestamp, called synchronously from the event handler before anything else, so
 *                 the stage starts the bat's stroke in the very next frame (owner decision 2026-11-04, CTL1: the bat
 *                 starts moving at touch-down, the shot commits on lift)
 *   onIntent      defence or attack, as soon as it is known, with the swing's timing (atPerfMs): the press for a
 *                 defence (a tap, lifted within TAP_HOLD_MS), the swipe's own start for an attack (after any rest)
 *   onGesture     the complete gesture, for normalizeGesture: a tap at the lift, a swipe when it lifts or READ_MAX_MS
 *                 after it started, a key at once (an arrow after KEYBOARD.chordMs at most)
 * A finger held still longer than TAP_HOLD_MS is waiting: lifting it is not a shot, and its swipe is timed from its own
 * start. Timings are always events' own timestamps, so deciding later never moves them. Samples are never kept after
 * the gesture is emitted.
 *
 * Enable it at release (when PracticeStage.bowl resolves); a finger already down then is a resting finger whose first
 * intentional movement starts the swing. One gesture per enable: toggle `enabled` or change `deliveryKey`.
 */
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import type { Footwork, GestureInput, Handedness } from '@/contracts/practice';
import { coalesced, eventTime, pointerKind, sampleIn } from './pointer';
import { GestureTracker, type OneGestureState, type PointerKind, type SwingIntent } from './tracker';

export interface GestureSurfaceProps {
  /** Accept one gesture (arm it at release). */
  enabled: boolean;
  /** The gesture, as soon as it can be normalized. */
  onGesture: (input: GestureInput) => void;
  /** The touch-down cue (the stroke starts): the press, a key, or a resting finger's first movement, at the event's own timestamp. */
  onSwingStart?: (atPerfMs: number, pointer: PointerKind, footwork: Footwork) => void;
  /** Defence or attack, with the swing's timing, as soon as the tracker knows (before the gesture is complete). */
  onIntent?: (intent: SwingIntent) => void;
  /** Clear provisional presentation after browser interruption; never cancels an already emitted shot. */
  onCancel?: () => void;
  /** Canonical ready/loading/tracking/committing/terminal state of the one-contact control. */
  onContactState?: (state: OneGestureState) => void;
  /** Manual footwork from an on-screen control (default automatic); W, S and the side letters override it for one delivery. */
  footwork?: Footwork;
  /**
   * Footwork by where the press lands: high in the batting area steps forward, low goes back, the middle keeps the
   * footwork as it is (PRESS_FOOTWORK). Off by default, so a rookie keeps automatic footwork until it is introduced.
   */
  pressFootwork?: boolean;
  /** Which way is off side for the keyboard's footwork letters. Default right-handed. */
  handedness?: Handedness;
  /** Changing it re-arms the surface for a new delivery while enabled. */
  deliveryKey?: string | number;
  /** Listen to the keyboard while enabled (default true). */
  keyboard?: boolean;
  /** Share of the parent's height the surface covers, measured up from the bottom (default 0.46). */
  heightFraction?: number;
  /** Accessible name (translated by the caller). */
  label?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function editable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}

export function GestureSurface(props: GestureSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const tracker = useMemo(
    () =>
      new GestureTracker({
        swingStart: (t, p, f) => latest.current.onSwingStart?.(t, p, f),
        gesture: (input) => latest.current.onGesture(input),
        intent: (i) => latest.current.onIntent?.(i),
        cancel: () => latest.current.onCancel?.(),
        state: (state) => latest.current.onContactState?.(state),
      }),
    [],
  );
  const measureRef = useRef<() => void>(() => undefined);

  useEffect(() => tracker.setFootwork(props.footwork ?? 'auto'), [tracker, props.footwork]);
  useEffect(() => tracker.setHandedness(props.handedness ?? 'right'), [tracker, props.handedness]);
  useEffect(() => tracker.setPressFootwork(props.pressFootwork === true), [tracker, props.pressFootwork]);
  useEffect(() => {
    // Measure as the delivery is armed, so a press never has to wait for layout.
    if (props.enabled) measureRef.current();
    tracker.setEnabled(props.enabled);
  }, [tracker, props.enabled]);
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    tracker.rearm();
  }, [tracker, props.deliveryKey]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let rect = el.getBoundingClientRect();
    const measure = () => {
      rect = el.getBoundingClientRect();
      tracker.setSurface(rect.width, rect.height);
    };
    measureRef.current = measure;
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    // One rectangle per press: every sample of a gesture is measured from the same origin.
    const pressRect = new Map<number, { left: number; top: number }>();
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const r = { left: rect.left, top: rect.top };
      pressRect.set(e.pointerId, r);
      // The swing starts first: nothing (capture, default handling) stands between the press and the bat.
      tracker.pointerDown(e.pointerId, pointerKind(e), sampleIn(e, r));
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture is an optimisation: the surface still sees its own events */
      }
      // No emulated mouse events, text selection or focus changes from a batting touch.
      if (e.pointerType !== 'mouse') e.preventDefault();
    };
    const origin = (id: number) => pressRect.get(id) ?? rect;
    const move = (e: PointerEvent) => {
      const r = origin(e.pointerId);
      tracker.pointerMove(
        e.pointerId,
        coalesced(e).map((c) => sampleIn(c, r)),
      );
    };
    const up = (e: PointerEvent) => {
      tracker.pointerUp(e.pointerId, sampleIn(e, origin(e.pointerId)));
      pressRect.delete(e.pointerId);
      try {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };
    const cancel = (e: PointerEvent) => {
      tracker.pointerCancel(e.pointerId);
      pressRect.delete(e.pointerId);
    };
    const key = (e: KeyboardEvent) => {
      if (latest.current.keyboard === false || e.ctrlKey || e.metaKey || e.altKey || editable(e.target)) return;
      const r = tracker.key(e.code, eventTime(e), e.repeat, { shift: e.shiftKey });
      if (r !== 'ignored') e.preventDefault();
    };
    // A right click (or a long press, or Ctrl-click on a Mac) must not open the browser's menu over a delivery: the menu
    // would take the pointer from the stroke. Between balls the surface leaves the browser's own behaviour alone.
    const menu = (e: Event) => {
      if (latest.current.enabled) e.preventDefault();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('contextmenu', menu);
    window.addEventListener('keydown', key, true);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('contextmenu', menu);
      window.removeEventListener('keydown', key, true);
      ro?.disconnect();
      measureRef.current = () => undefined;
      tracker.dispose();
    };
  }, [tracker]);

  const frac = Math.min(1, Math.max(0.2, props.heightFraction ?? 0.46));
  const style: CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: `${frac * 100}%`,
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none',
    WebkitTapHighlightColor: 'transparent',
    cursor: props.enabled ? 'crosshair' : 'default',
    ...props.style,
  };
  return (
    <div
      ref={ref}
      role="application"
      aria-label={props.label}
      data-armed={props.enabled ? 'true' : 'false'}
      className={props.className}
      style={style}
    >
      {props.children}
    </div>
  );
}
