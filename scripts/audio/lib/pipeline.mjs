/**
 * One take, from shaped samples to a shipped-format file, with every rule checked on the decoded result:
 *   1. level: scale to the target hit loudness (BS.1770 400 ms block; integrated loudness for takes of a block or
 *      more is reported too), never letting the sample peak pass PEAK_CAP;
 *   2. encode with the shipped MP3 settings (lib/media.mjs);
 *   3. decode it back (ffmpeg, as tools/process_takes.py) and check the peak, the format and the onset: the onset must
 *      sit at the pre-roll (3 ms) within 0.5 ms, as src/audio/takes.ts findOnset will find it at run time;
 *   4. if the codec lifted the peak over the cap, scale down by the overshoot and encode again (at most 4 passes).
 */
import { readFileSync, rmSync } from 'node:fs';
import { PEAK_CAP, PREROLL_MS, db, findOnset, hitLoudness, integratedLufs, round, samplePeak, undb } from './dsp.mjs';
import { decodeMono, encodeMp3, formatProblems, sha256 } from './media.mjs';

export const ONSET_TOLERANCE_MS = 0.5;

export function finishTake(seg, sr, { targetLufs, outFile, reference, peakCap = PEAK_CAP, prerollMs = PREROLL_MS }) {
  const hit = hitLoudness(seg, sr);
  const peak = samplePeak(seg);
  let gain = undb(targetLufs - hit);
  let limitedByPeak = false;
  if (peak * gain > peakCap) {
    gain = peakCap / peak;
    limitedByPeak = true;
  }
  let bytes;
  let back;
  for (let pass = 0; pass < 4; pass++) {
    const x = new Float32Array(seg.length);
    for (let i = 0; i < seg.length; i++) x[i] = seg[i] * gain;
    bytes = encodeMp3(x, sr, outFile);
    back = decodeMono(outFile, sr);
    const p = samplePeak(back);
    if (p <= peakCap) break;
    gain *= (peakCap / p) * 0.998;
    limitedByPeak = true;
  }
  const onsetMs = (findOnset(back) / sr) * 1000;
  const problems = formatProblems(bytes, reference);
  const decodedPeak = samplePeak(back);
  if (decodedPeak > peakCap) problems.push(`peak ${round(decodedPeak, 4)} over ${peakCap} after encoding`);
  if (Math.abs(onsetMs - prerollMs) > ONSET_TOLERANCE_MS) problems.push(`onset at ${round(onsetMs, 3)} ms after encoding, not ${prerollMs} ± ${ONSET_TOLERANCE_MS} ms`);
  const integrated = integratedLufs(back, sr);
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    durationMs: Math.round((back.length / sr) * 1000),
    lufs: integrated === null ? null : round(integrated),
    hitLufs: round(hitLoudness(back, sr)),
    targetLufs: round(targetLufs),
    limitedByPeak,
    gainDb: round(db(gain)),
    peakDbfs: round(db(decodedPeak)),
    onsetMs: round(onsetMs, 3),
    decodedSamples: back.length,
    problems,
  };
}

export const readBytes = (f) => readFileSync(f);
export const remove = (f) => rmSync(f, { force: true });
