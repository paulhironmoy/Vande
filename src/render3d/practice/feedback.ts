/**
 * Contact and delivery feedback, keyed to the physics' simulation timestamps. Each SimEvent becomes one scene event
 * (scene ms, world position) that the visual effects, the sound and the haptics all read, so they land on the same
 * moment. The contact itself also gets one distinct "feel" each for sweet spot, middle, edge, pad, miss, bowled,
 * catch and boundary (src/audio plays it: practice/audio.ts).
 */
import type { ContactKind, ContactReport, DeliveryResult, SimEvent, SwingKind, SwingTiming, Vec3 } from '@/contracts/practice';
import { BALL_R } from '@/physics/geometry';
import type { SceneEvent, SceneEventKind } from '../core/choreo';
import { ballAt, simToScene, toWorld } from './frame';
import type { ContactFeel } from './types';

export interface FeedbackCue {
  /** Scene ms. */
  t: number;
  /** Visual and sound cue for the existing effects and src/audio's match voices (null: feel only). */
  scene: SceneEvent | null;
  /** The batter's contact feel, when this is the moment that decides it, with the contact it came from (src/audio picks the exact signature: a top edge, a mistimed middle). */
  feel: { kind: ContactFeel; intensity: number; contact?: ContactKind; timing?: SwingTiming } | null;
}

/** Intensity of a middled contact by its timing (perfect is the sweet spot). */
function middleIntensity(c: ContactReport): number {
  return c.timing === 'perfect' ? 1 : c.timing === 'solid' ? 0.82 : 0.62;
}

/**
 * The feel of the bat's contact (null for a leave or a body blow, which have their own events). A defended middle is a
 * block (F-022): the dead bat's damped thud, never the attacking sweet spot's crack and its 'double' haptic.
 */
export function contactFeel(c: ContactReport, swing?: SwingKind | null): { kind: ContactFeel; intensity: number } | null {
  switch (c.kind) {
    case 'middle':
      if (swing === 'defend') return { kind: 'block', intensity: middleIntensity(c) };
      return c.timing === 'perfect' ? { kind: 'sweet', intensity: 1 } : { kind: 'middle', intensity: middleIntensity(c) };
    case 'inside_edge':
    case 'outside_edge':
    case 'top_edge':
    case 'leading_edge':
      return { kind: 'edge', intensity: c.kind === 'outside_edge' || c.kind === 'top_edge' ? 0.55 : 0.7 };
    case 'miss':
      return { kind: 'miss', intensity: 0.6 };
    default:
      return null;
  }
}

/** The drawn ball is at a bounce point when its centre is within one ball radius of it (a real bounce: within 5 mm). */
const BOUNCE_REACH_M = BALL_R;

/**
 * Whether the presented ball makes this bounce (COH4). Nothing touched it first (bat, edge, pad or body), and the ball
 * drawn on the result's own samples is at the bounce point at the bounce time. A ball met on the full still carries
 * the unimpeded flight's bounce in the physics result, after the contact and where the ball never goes: that one is
 * never sounded, marked or spun.
 */
export function presentedBounce(result: DeliveryResult, bounce: { t: number; p: Vec3 }): boolean {
  for (const e of result.events) {
    if (e.t < bounce.t && (e.kind === 'pad' || (e.kind === 'contact' && e.contact !== 'miss' && e.contact !== 'leave'))) return false;
  }
  const at = ballAt(result.ball, bounce.t);
  return at !== null && Math.hypot(at.x - bounce.p.x, at.y - bounce.p.y, at.z - bounce.p.z) <= BOUNCE_REACH_M;
}

/**
 * Feedback cues for a result, in time order (scene ms on the delivery's timebase). `releaseScene` is the release's
 * scene time; `mirror` mirrors positions for a left-hander.
 */
export function feedbackCues(result: DeliveryResult, releaseScene: number, mirror: boolean): FeedbackCue[] {
  const tb = { releaseScene };
  const out: FeedbackCue[] = [];
  const at = (e: { p: { x: number; y: number; z: number } }) => toWorld(e.p, mirror);
  const push = (e: SimEvent, kind: SceneEventKind | null, intensity: number, feel: FeedbackCue['feel'] = null, p = 'p' in e ? at(e as { p: { x: number; y: number; z: number } }) : undefined) => {
    out.push({ t: simToScene(tb, e.t), scene: kind ? { t: simToScene(tb, e.t), kind, intensity, at: p } : null, feel });
  };
  let missDone = false;
  for (const e of result.events) {
    switch (e.kind) {
      case 'release':
        push(e, 'release', Math.min(1.1, result.flight.release.speedKph / 150));
        break;
      case 'bounce':
        // Only a bounce the drawn ball makes (never one after the bat met it on the full).
        if (presentedBounce(result, e)) push(e, 'bounce', 0.6);
        break;
      case 'contact': {
        const base = contactFeel({ ...result.contact, kind: e.contact }, result.swing?.kind);
        const feel = base ? { ...base, contact: e.contact, timing: result.contact.timing } : null;
        if (e.contact === 'middle') push(e, 'bat', middleIntensity(result.contact), feel);
        else if (e.contact === 'pad' || e.contact === 'body') push(e, 'pad', 0.55, { kind: 'pad', intensity: 0.55, contact: e.contact });
        else if (e.contact === 'miss' || e.contact === 'leave') {
          if (e.contact === 'miss') {
            push(e, null, 0, feel);
            missDone = true;
          }
        } else push(e, 'edge', feel?.intensity ?? 0.6, feel);
        break;
      }
      case 'pad':
        push(e, 'pad', 0.6, { kind: 'pad', intensity: 0.6, contact: 'pad' });
        break;
      case 'stumps':
        push(e, 'stumps', 1, { kind: 'bowled', intensity: 1 });
        push(e, 'bails', 1);
        break;
      case 'keeper_take':
        push(e, 'gloves', 0.6);
        break;
      case 'catch':
        push(e, 'catch', 1, { kind: 'catch', intensity: 1 });
        break;
      case 'field':
        push(e, 'fielded', 0.5);
        break;
      case 'throw':
        push(e, 'throw', 0.5);
        break;
      case 'boundary':
        push(e, e.runs === 6 ? 'six' : 'boundary', 1, { kind: e.runs === 6 ? 'six' : 'four', intensity: 1 });
        break;
      case 'ball_bounce':
      case 'run':
      case 'dead':
        break;
    }
  }
  // A swing that missed with no contact event of its own: the miss is felt at the closest approach.
  if (!missDone && result.contact.kind === 'miss' && result.contact.t !== null) {
    const t = simToScene(tb, result.contact.t);
    out.push({ t, scene: null, feel: { kind: 'miss', intensity: 0.6 } });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Scene events alone (for the effects layer and the 2D stage). */
export function sceneEventsOf(cues: readonly FeedbackCue[]): SceneEvent[] {
  return cues.flatMap((c) => (c.scene ? [c.scene] : []));
}
