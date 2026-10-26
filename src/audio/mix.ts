/**
 * One mix for the app and the highlight soundtrack: the action (bat, pads, stumps, roars, drums, chimes) on its own
 * compressed bus, over a crowd bed that sits a fixed distance below it so no cue is ever buried, then a makeup gain
 * and a true-peak-safe limiter. The highlight measures and normalises its render exactly (src/audio/loudness.ts:
 * about -14 LUFS integrated, at most -1 dBTP); the live graph uses the same shape with the gains measured on that
 * render, because a live mix cannot be measured ahead of time.
 */
export const MIX = {
  /** Action bus compressor: evens the hits out so they carry without the limiter flattening them. */
  action: { threshold: -22, knee: 6, ratio: 3, attack: 0.004, release: 0.18 },
  /** The crowd bed sits this many LU under the action (integrated). */
  bedBelowLu: 8,
  /** Final limiter of the live graph (the highlight is limited offline instead). */
  limiter: { threshold: -2.5, knee: 0, ratio: 20, attack: 0.001, release: 0.12 },
  /**
   * Live graph gains, taken from a full duel's highlight render (the same voices, bed automation and action
   * compressor; scripts/perf/highlight.mjs prints them as bedGainDb and gainDb): the bed level that puts it 8 LU
   * under the action (+9.9 dB) and the makeup that brings the mix to about -14 LUFS (+7.2 dB). Re-measure after
   * changing a voice or the bed.
   */
  liveBedGain: 3.1,
  liveMakeupDb: 7.2,
  /** Master level when Sound is on. */
  master: 1,
} as const;

type CompressorSettings = (typeof MIX)['action'] | (typeof MIX)['limiter'];

export function applyCompressor(node: DynamicsCompressorNode, s: CompressorSettings): DynamicsCompressorNode {
  node.threshold.value = s.threshold;
  node.knee.value = s.knee;
  node.ratio.value = s.ratio;
  node.attack.value = s.attack;
  node.release.value = s.release;
  return node;
}
