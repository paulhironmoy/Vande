/**
 * The device-tier rules (docs/PRACTICE.md, "Quality tiers"), as named constants so every consumer (Practice, the
 * match renderer's automatic quality) reads the same numbers. Frame rates are presented frames per second measured
 * from real frame intervals; latencies are milliseconds.
 */

/** Full Batter View needs at least this average frame rate over the benchmark… */
export const PERF_FULL_AVG_FPS = 55;
/** …and no sustained fall (any one-second window) below this. */
export const PERF_FULL_SUSTAINED_FPS = 50;
/** Below this sustained (average) frame rate the device is under the cutoff: no first-person express bowling. */
export const PERF_CUTOFF_FPS = 45;
/** The window a "sustained" frame rate is measured over. */
export const PERF_WINDOW_MS = 1000;
/** A frame interval longer than this is a spike (a visible hitch: the ball would jump). */
export const PERF_SPIKE_MS = 50;
/** Full Batter View tolerates at most this many spikes in one benchmark run. */
export const PERF_MAX_SPIKES_FULL = 2;
/** Event-to-frame response above this (ms) is too slow for Full Batter View. */
export const PERF_INPUT_FULL_MS = 50;
/** Event-to-frame response above this (ms) is severe: below the cutoff. */
export const PERF_INPUT_SEVERE_MS = 100;
/** This many WebGL context losses (in a benchmark or a session) is "repeated": below the cutoff. One is Assisted. */
export const PERF_REPEATED_CONTEXT_LOSSES = 2;
/** Shader compilation slower than this is noted in the reasons (informational; it is a one-off cost). */
export const PERF_SLOW_SHADER_MS = 1500;
/** Extra timing tolerance (ms) in the Assisted tier: slight, and recorded with every delivery so replays stay exact. */
export const PERF_ASSISTED_TOLERANCE_MS = 12;
/** Extra timing tolerance (ms) in Classic (2D) practice below the cutoff. */
export const PERF_CLASSIC_TOLERANCE_MS = 20;
/** Frames at the start of a benchmark run ignored as warm-up (first uploads after the shaders compiled). */
export const PERF_WARMUP_FRAMES = 3;
