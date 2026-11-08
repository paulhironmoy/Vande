/**
 * The Director's channels: what `sample` writes each frame. Angles are degrees in the actor's role frame (the world
 * axes turned so that +z is down the pitch towards the opponent): yaw + turns left, pitch + looks down (leans
 * forward), roll + tilts to the right shoulder; the same signs as the skeleton comment in core/skeleton.ts, so an
 * overlay adds to a bone's Euler angles directly (P2 maps it through the parents' orientations).
 */
export const CH = {
  /** Head overlay (deg): added to the clip's head so that the head ends where the Director wants it (neck 35%, head 65%). */
  headYaw: 0,
  headPitch: 1,
  headRoll: 2,
  /** Eyes in the head (deg). Shader: iris offset. */
  eyeYawL: 3,
  eyePitchL: 4,
  eyeYawR: 5,
  eyePitchR: 6,
  /** Lids: 0 open ... 1 closed, one per eye (shader uniforms). */
  blinkL: 7,
  blinkR: 8,
  /** Upper lid follows vertical gaze: + lowers it (-1 .. 1). */
  lidFollow: 9,
  /** The gaze actually achieved in the role frame (clip head + overlay + eye); for tools and tests. */
  gazeYaw: 10,
  gazePitch: 11,
  /** Life, in physical units, already scaled by the quiet windows and zero in Reduced Motion. */
  breath: 12, // chest swing (deg), + = inhale (the rise is faster than the fall); 0.9 .. 1.5 zero-to-peak at rest, up to twice that with exertion; P2: chest back, shoulders up
  swayX: 13, // root shift across the pitch (mm), + to the actor's left; rms 1.2 .. 4 mm
  swayZ: 14, // root shift along the pitch (mm), + towards the opponent
  swayRoll: 15, // hips roll (deg), + to the right; rms 0.4 .. 1.3 deg
  exertion: 16, // 0 .. 1.5, unitless: the level that raises breath rate (x1 + 1.6 e) and depth (x1 + e); not gated by the quiet windows
  /** The five expression weights (P3, zero in P1): concentration, effort, frustration, relief, celebration. */
  xConcentration: 17,
  xEffort: 18,
  xFrustration: 19,
  xRelief: 20,
  xCelebration: 21,
  /**
   * P3: the trunk's posture, degrees, + lifts the chest (extends the spine back), - lets the shoulders drop (rounds it forward):
   * a fidget's settle and a reaction's lift or slump. Zero in Reduced Motion and in the quiet windows.
   */
  posture: 22,
  /** P3: the trunk's twist about the vertical, degrees, + turns the upper body to the left (spine 40%, chest 60%): a shoulder roll, a stance adjust. Same gating. */
  twist: 23,
} as const;

export const CHANNELS = 24;

/** Units per Int16 step for each channel (range = 32767 steps). */
export const SCALE: Float64Array = Float64Array.from([
  1 / 512,
  1 / 512,
  1 / 512, // head overlay: +-64 deg
  1 / 512,
  1 / 512,
  1 / 512,
  1 / 512, // eyes: +-64 deg
  1 / 16384,
  1 / 16384,
  1 / 16384, // lids: +-2
  1 / 128,
  1 / 128, // gaze: +-256 deg
  1 / 4096,
  1 / 1024,
  1 / 1024,
  1 / 4096,
  1 / 8192, // breath deg, sway mm, sway mm, roll deg, exertion
  1 / 16384,
  1 / 16384,
  1 / 16384,
  1 / 16384,
  1 / 16384, // expressions
  1 / 4096,
  1 / 4096, // posture deg, twist deg
]);

export const createOut = (): Float32Array => new Float32Array(CHANNELS);
