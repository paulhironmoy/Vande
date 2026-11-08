export type Role = 'bowler' | 'striker';

/** The fixed-meaning targets an actor can look at (the ball and the ground are handled by the Director itself). */
export type AimTarget = 'opponent' | 'hand';

/**
 * Everything the Director needs to know about one actor in one script. Times are scene ms (the script clock, never
 * the wall clock). `null` means the thing does not exist or is not known yet: a live pre-result script has no
 * contact, outcome or dead time, and the plan built from it must agree with the plan built later up to the first time
 * one of them matters (the causality tests).
 *
 * Directions are degrees in the actor's role frame: the world axes, yaw measured from the direction down the pitch
 * towards the opponent (+ to the actor's left), pitch from the horizon (+ down), roll about the line of sight (+ to the
 * right shoulder). A direction is the line of sight, azimuth and elevation, never an Euler triple of a bone: the overlay
 * the Director returns is the rotation that turns the head's line of sight from (yaw, pitch) to (yaw + overlay yaw,
 * pitch + overlay pitch), plus the roll, and P2 converts it to the neck and head bones through their parents.
 *
 * The callbacks are called from `prepare` only, off the frame path: `clipHead` once per trace frame (the one that may
 * cost: forward kinematics of the posed clip, cacheable per bowler action and release), `aim` and `visibleBall` at most
 * once per 1/240 s of script. They must not allocate: they write into `out`.
 */
export interface DirectorAnchors {
  role: Role;
  /** The actor's look seed: the person traits (breath rate, blink rate, sway size) are constant for the over. */
  person: string;
  /** `deliveryTakeKey(...)` of the delivery, or an idle key between balls: draws are identical on replay. */
  key: string;
  /** The trace covers [start, end] (scene ms). */
  start: number;
  end: number;
  /** The bowler's delivery-stride start (before the back foot lands). Unused by the striker. */
  gather: number | null;
  /** The ball leaves the hand. `null`: between balls (no delivery, no task window). */
  release: number | null;
  /** The striker's own swing input (his own action, not an outcome). Consumed by the expression mixer (P3). */
  swing: number | null;
  /** Bat, pad or body contact. */
  contact: number | null;
  /** The striker's visual task ends: contact, or the ball passing. `null`: contact, else release + 1100 ms. */
  taskEnd: number | null;
  /** The physics has confirmed the outcome (boundary, stumps, catch, decision). Reactions start no sooner than +180 ms. */
  outcomeAt: number | null;
  /** Dead ball. */
  dead: number | null;
  /** The striker's stroke or leave ends (his body life resumes 800 ms later). `null`: not known, life stays off. */
  strokeEnd: number | null;
  /** Runs completed by this ball (exertion after the outcome). */
  runs: number;
  /**
   * P3: how the crowd reads the outcome once the physics has confirmed it ('six', 'four', 'runs', 'dot', 'leave', 'close_call',
   * 'wicket'; emotion.ts EmotionOutcome). It matters from `outcomeAt` + a seeded 180 to 380 ms and not before (the reaction:
   * where the eyes go, the posture, a head shake, a breath out, the face). Absent or `null`: no reaction.
   */
  outcome?: string | null;
  /**
   * The bowler's run-up starts (P2, lead ruling 2026-11-07): his life channels (sway, breath lift, fidgets) are off for
   * the whole run-up, from here to release + 150 ms, while the head and gaze stay on. Absent or `null`: off from the
   * gather only (P1). The striker ignores it.
   */
  runStart?: number | null;
  /**
   * The bowler's follow-through ends and his walk back begins (P2): his eyes go back to the idle dwell (the opponent, the
   * ground) instead of holding the ground look to the end of the script. Absent or `null`: they hold it (P1).
   */
  followEnd?: number | null;
  /**
   * P2: the script this plan serves loops (a between-balls scene wraps at `end`) and `sampleWrapped` cross-fades the last
   * `seamMs` of it into the `seamMs` before `start` (so `start` is `-seamMs` and the plan has a pre-roll). No blink falls
   * across the seam. Absent or `null`: not a loop.
   */
  seamMs?: number | null;
  /**
   * What the head channels hold. 'overlay' (P1, the default): degrees to add to `clipHead` so the head ends where the
   * Director wants it, limited to the neck's range. 'space' (P2): the head-in-space target itself, unlimited by the clip
   * and unscaled by Reduced Motion, and the gaze channels hold the raw gaze (eyes: `eyesFor`); `clipHead` is not called.
   * The stage then closes the loop on the head it actually drew (`applyHead`): the humans hook turns the striker's trunk
   * and neck after any overlay, so only the final pose says where the head points.
   */
  headMode?: 'overlay' | 'space';
  reducedMotion: boolean;
  /** The actor's head height on screen (CSS px) at the start; sets the default detail level. */
  headPx: number;
  /**
   * Direction to the ball as drawn at scene ms t (in the hand before release); false while it is not visible.
   *
   * `aheadMs` (P3, lead ruling 4 after P1; absent or 0: none): the direction, from the actor's eye at `tMs + aheadMs`, to the
   * ball's position moved on by `aheadMs` at the constant velocity it had at `tMs` (position and velocity only, measured
   * from the ball as drawn at `tMs` and a few ms before; never the plan, the bounce, the result or anything later than
   * `tMs`). The Director asks for it with the pursuit lag, so the gaze at time t aims at where the ball it saw at
   * t - lag has got to by t, which is what a batter's visuomotor prediction does; the information is still a lag old.
   */
  visibleBall(tMs: number, out: Float64Array, aheadMs?: number): boolean;
  /** Direction to the opponent's head, or to the bowling hand (striker only). */
  aim(target: AimTarget, tMs: number, out: Float64Array): boolean;
  /** The clip's own head, as posed before the Director: [yaw, pitch] of its line of sight and [roll] about it, at scene ms t. */
  clipHead(tMs: number, out: Float64Array): void;
}

/** What the plan holds besides the trace: the events and the few draws, all a function of the key and the anchors. */
export interface DirectorEvents {
  /** Gaze fixations: [t0 ms, target, mode (0 saccade, 1 pursuit), lag ms, blink-with-shift flag] per event. */
  fix: Float32Array;
  /** Blinks: [t0 ms, close ms, hold ms, open ms, depth, left-right skew ms] per event. */
  blink: Float32Array;
  /** Microsaccades: [t0 ms, dx deg, dy deg] per event. */
  micro: Float32Array;
  /** Fidgets (P3): [t0 ms, kind, duration ms, a, b, c, direction, spare] per event; see FIDGET in plan.ts. */
  fidget: Float32Array;
  /** The reaction to the outcome (P3), none or one event: [t0 ms, valence, strength, rise ms, hold ms, decay ms, shake deg, shake Hz, head pitch deg, exhale, relief weight, concentration weight]. */
  react: Float32Array;
  /** Per-ball draws (see DRAW in plan.ts). */
  draw: Float32Array;
  /** Person amplitudes (see AMP in plan.ts). */
  amp: Float32Array;
}

/** 0 head overlay and life only, 1 plus eyes and lids, 2 plus expressions (by the head's size on screen). */
export type Detail = 0 | 1 | 2;

export interface DirectorPlan extends DirectorEvents {
  role: Role;
  /** The ball's key (person and delivery). */
  key: number;
  /** Baked in: switching Reduced Motion needs a new `prepare`. */
  reducedMotion: boolean;
  /** Time of frame 0 (scene ms), frames per second and frame count of `trace`. */
  t0: number;
  hz: number;
  n: number;
  /** CHANNELS Int16 values per frame (channels.ts SCALE gives the unit of each). */
  trace: Int16Array;
  detail: Detail;
}
