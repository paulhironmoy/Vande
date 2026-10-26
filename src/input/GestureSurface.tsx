/**
 * The batting gesture surface: pointer capture across the LOWER part of the landscape screen (so the finger never
 * covers the delivery), plus Space / Enter and WASD / arrow keys while enabled. Every sample uses its event's own
 * high-resolution timestamp (coalesced pointer events included), never a frame time. The swing start is reported the
 * moment the press lands (onSwingStart → PracticeStage.beginSwing), and the gesture as soon as it can be normalized
 * (onGesture → normalizeGesture → physics): a tap at TAP_DECIDE_MS or when lifted, a flick after READ_WINDOW_MS of
 * movement. Nothing waits for pointer-up, and samples are never kept after the gesture is emitted.
 *
 * Enable it at release (when PracticeStage.bowl resolves); a finger already down then is a resting finger whose
 * first intentional movement starts the swing. One gesture per enable: toggle `enabled` or change `deliveryKey`.
 */
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import type { Footwork, GestureInput, Handedness } from '@/contracts/practice';
import { coalesced, eventTime, pointerKind, sampleIn } from './pointer';
import { GestureTracker, type PointerKind } from './tracker';

export interface GestureSurfaceProps {
  /** Accept one gesture (arm it at release). */
  enabled: boolean;
  /** The gesture, as soon as it can be normalized. */
  onGesture: (input: GestureInput) => void;
  /** The swing began (pointer-down, a resting finger's first movement, or a key), on the performance.now() clock. */
  onSwingStart?: (atPerfMs: number, pointer: PointerKind) => void;
  /** Manual footwork from an on-screen control (default automatic); WASD / arrows override it for one delivery. */
  footwork?: Footwork;
  /** Which arrow means "across" (towards the off side) for the keyboard footwork. Default right-handed. */
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
        swingStart: (t, p) => latest.current.onSwingStart?.(t, p),
        gesture: (input) => latest.current.onGesture(input),
      }),
    [],
  );

  useEffect(() => tracker.setFootwork(props.footwork ?? 'auto'), [tracker, props.footwork]);
  useEffect(() => tracker.setHandedness(props.handedness ?? 'right'), [tracker, props.handedness]);
  useEffect(() => tracker.setEnabled(props.enabled), [tracker, props.enabled]);
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
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    const sample = (e: PointerEvent) => sampleIn(e, rect);
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      measure();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture is an optimisation: the surface still sees its own events */
      }
      // No emulated mouse events, text selection or focus changes from a batting touch.
      if (e.pointerType !== 'mouse') e.preventDefault();
      tracker.pointerDown(e.pointerId, pointerKind(e), sample(e));
    };
    const move = (e: PointerEvent) => tracker.pointerMove(e.pointerId, coalesced(e).map(sample));
    const up = (e: PointerEvent) => {
      tracker.pointerUp(e.pointerId, sample(e));
      try {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };
    const cancel = (e: PointerEvent) => tracker.pointerCancel(e.pointerId);
    const key = (e: KeyboardEvent) => {
      if (latest.current.keyboard === false || e.ctrlKey || e.metaKey || e.altKey || editable(e.target)) return;
      const r = tracker.key(e.code, eventTime(e), e.repeat);
      if (r !== 'ignored') e.preventDefault();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      ro?.disconnect();
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
    <div ref={ref} role="application" aria-label={props.label} data-armed={props.enabled ? 'true' : 'false'} className={props.className} style={style}>
      {props.children}
    </div>
  );
}
