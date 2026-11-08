/**
 * Reads one pose frame: which landmarks are usable, where the hands are, how big the player is in the picture. Pure.
 * Only the shoulders, elbows and wrists (and the nose, for the framing check) are read; the picture itself never reaches here.
 */
import type { Handedness } from '@/contracts/practice';
import { POSE } from './constants';
import { LANDMARK_STRIDE, LM, type DistanceState, type PoseFrame } from './types';

export interface ObserveOptions {
  /** True when the frame the model saw was already mirrored (a selfie-flipped feed); the worker's raw frames are not. */
  sourceMirrored: boolean;
  handedness: Handedness;
}

/** What one frame says, in pixels of the picture (before any scaling to the body). */
export interface Observation {
  /** The shoulders and at least one hand are usable. */
  valid: boolean;
  /** Shoulder width in px (this frame) and as a share of the picture width. */
  shoulderPx: number;
  shoulderFrac: number;
  distance: DistanceState;
  /** Middle of the shoulders, px. */
  shoulderMidX: number;
  shoulderMidY: number;
  /** The hand point (visibility-weighted mean of the usable wrists), px; NaN when there is none. */
  handX: number;
  handY: number;
  /** The batting hand (the player's right for a right-hander) and the other hand are usable. */
  battingHand: boolean;
  otherHand: boolean;
  /** The nose is visible, and its height above the picture's top edge in px. */
  head: boolean;
  noseY: number;
  /** The shoulders are in the picture (both visible); `valid` also needs a hand and a sane size. */
  shoulders: boolean;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A landmark's weight: 0 below the minimum visibility, 1 from the full visibility, linear between. */
export function visibilityWeight(visibility: number): number {
  if (!(visibility > POSE.minVisibility)) return 0;
  return clamp01((visibility - POSE.minVisibility) / (POSE.fullVisibility - POSE.minVisibility));
}

const at = (lm: ArrayLike<number>, i: number, k: number) => lm[i * LANDMARK_STRIDE + k];

const INVALID: Observation = {
  valid: false,
  shoulderPx: 0,
  shoulderFrac: 0,
  distance: 'unknown',
  shoulderMidX: 0,
  shoulderMidY: 0,
  handX: Number.NaN,
  handY: Number.NaN,
  battingHand: false,
  otherHand: false,
  head: false,
  noseY: 0,
  shoulders: false,
};

export function observe(frame: PoseFrame, o: ObserveOptions): Observation {
  const lm = frame.landmarks;
  if (!lm || lm.length < (LM.rightWrist + 1) * LANDMARK_STRIDE || !(frame.width > 0) || !(frame.height > 0))
    return INVALID;
  const W = frame.width;
  const H = frame.height;
  const vL = at(lm, LM.leftShoulder, 3);
  const vR = at(lm, LM.rightShoulder, 3);
  const shoulders = vL >= POSE.minVisibility && vR >= POSE.minVisibility;
  const head = at(lm, LM.nose, 3) >= POSE.minVisibility;
  const noseY = at(lm, LM.nose, 1) * H;
  if (!shoulders) return { ...INVALID, head, noseY };
  const xL = at(lm, LM.leftShoulder, 0) * W;
  const yL = at(lm, LM.leftShoulder, 1) * H;
  const xR = at(lm, LM.rightShoulder, 0) * W;
  const yR = at(lm, LM.rightShoulder, 1) * H;
  const shoulderPx = Math.hypot(xL - xR, yL - yR);
  const shoulderFrac = shoulderPx / W;
  const distance: DistanceState =
    shoulderFrac < POSE.shoulderFrac.min ? 'too_far' : shoulderFrac > POSE.shoulderFrac.max ? 'too_close' : 'ok';
  const shoulderMidX = (xL + xR) / 2;
  const shoulderMidY = (yL + yR) / 2;

  // The player's right shoulder is the one on the image's left in a raw frame (a front camera sees the player like a person
  // facing it) and on the image's right in a mirrored one. The model labels by picture layout, so the side is found from
  // the positions, and each wrist is paired with the shoulder of the same label.
  const rightIsLabelled12 = o.sourceMirrored ? xR > xL : xR < xL;
  const rightWrist = rightIsLabelled12 ? LM.rightWrist : LM.leftWrist;
  const leftWrist = rightIsLabelled12 ? LM.leftWrist : LM.rightWrist;

  const weightOf = (wrist: number): number => {
    const shoulderIdx = wrist === LM.rightWrist ? LM.rightShoulder : LM.leftShoulder;
    const w = visibilityWeight(at(lm, wrist, 3));
    if (w === 0) return 0;
    const dx = at(lm, wrist, 0) * W - at(lm, shoulderIdx, 0) * W;
    const dy = at(lm, wrist, 1) * H - at(lm, shoulderIdx, 1) * H;
    // A wrist farther from its own shoulder than an arm can reach is an outlier, not a hand.
    return Math.hypot(dx, dy) <= POSE.reachU * shoulderPx ? w : 0;
  };
  const wRight = weightOf(rightWrist);
  const wLeft = weightOf(leftWrist);
  const batting = o.handedness === 'right' ? wRight : wLeft;
  const other = o.handedness === 'right' ? wLeft : wRight;
  const total = wRight + wLeft;
  if (total <= 0)
    return { ...INVALID, shoulders, shoulderPx, shoulderFrac, distance, shoulderMidX, shoulderMidY, head, noseY };
  const handX = (wRight * at(lm, rightWrist, 0) * W + wLeft * at(lm, leftWrist, 0) * W) / total;
  const handY = (wRight * at(lm, rightWrist, 1) * H + wLeft * at(lm, leftWrist, 1) * H) / total;
  return {
    valid: distance === 'ok',
    shoulderPx,
    shoulderFrac,
    distance,
    shoulderMidX,
    shoulderMidY,
    handX,
    handY,
    battingHand: batting > 0,
    otherHand: other > 0,
    head,
    noseY,
    shoulders,
  };
}
