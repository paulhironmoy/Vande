/**
 * The Practice stage's default sink: src/audio's Practice sink (docs/AUDIO.md). It plays the delivery's sound and
 * haptics, captions the essential cues, and owns the session's one emotion machine, which the 3D crowd follows through
 * emotionNow(). Owner: audio. This file keeps the stage's import path.
 */
import { currentGraph } from '@/audio/engine';

export { createPracticeSink as createPracticeAudio, type PracticeSoundscape as PracticeAudio } from '@/audio';

/**
 * How far ahead of its moment the stage hands a sound to the sink (COH6). The sink schedules it on the audio clock to
 * be heard at that moment (src/audio/timingLog.ts perfToCtx), which works only if the call comes at least one output
 * latency early: a call at the moment is heard that latency late (+31 to +37 ms in headless Chromium, 2026-11-03).
 * The lead is the delay the live context reports for a sound started now, plus a margin for a render quantum and
 * timer jitter; never less than `minMs` (a context that reports nothing) and never more than `maxMs`.
 */
export const SOUND_LEAD = { marginMs: 12, minMs: 50, maxMs: 400 } as const;

/** The lead (ms) for the live audio context now; SOUND_LEAD.minMs when there is none. */
export function soundLeadMs(): number {
  const ctx = currentGraph()?.ctx ?? null;
  let latencyMs = 0;
  if (ctx) {
    try {
      latencyMs = ((ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0)) * 1000;
      const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
      if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.performanceTime > 0) {
        // When a sound started at currentTime is heard, from now.
        latencyMs = Math.max(latencyMs, ts.performanceTime + (ctx.currentTime - ts.contextTime) * 1000 - performance.now());
      }
    } catch {
      /* a context that cannot report keeps the floor */
    }
  }
  const ms = (Number.isFinite(latencyMs) ? latencyMs : 0) + SOUND_LEAD.marginMs;
  return Math.min(SOUND_LEAD.maxMs, Math.max(SOUND_LEAD.minMs, ms));
}
