/**
 * Recorded takes, the pure part (no Web Audio; import-safe anywhere, and simple to port to Unity's C#).
 *
 *   deliveryTakeKey   the delivery record's identity: its seed and its over and ball index (stable on the exact-ball retry)
 *   takeIndex         which take a sound plays: FNV-1a 32 of `${deliveryKey}|${sound}|${occurrence}`, modulo the takes
 *   takeUnit          the same hash as a number in [0, 1) (deterministic variation, e.g. a reaction's playback rate)
 *   findOnset         the transient's first sample: the first |x| at or above ONSET_RATIO of the buffer's peak
 *   alignedStart      where to start a buffer so its onset is heard exactly at `when` (and as close as possible when late)
 *
 * Nothing here reads a clock or a random source: the same delivery record always picks the same takes, on every run and
 * every renderer. The player's own contact decides which kind of sound plays; the take within the kind follows the ball.
 */

/** A transient starts at the first sample at or above this fraction of the peak (-20 dB). */
export const ONSET_RATIO = 0.1;

/** The key every take choice of one delivery hashes: identical for the exact-ball retry of the same record. */
export function deliveryTakeKey(
  ctx: { seed?: string | null; overIndex?: number | null; ballIndex?: number | null } | null | undefined,
): string {
  if (!ctx || typeof ctx.seed !== 'string' || ctx.seed === '') return 'unseeded';
  const o = typeof ctx.overIndex === 'number' && Number.isFinite(ctx.overIndex) ? String(ctx.overIndex) : '-';
  const b = typeof ctx.ballIndex === 'number' && Number.isFinite(ctx.ballIndex) ? String(ctx.ballIndex) : '-';
  return `${ctx.seed}#${o}.${b}`;
}

/** FNV-1a, 32 bits, over the UTF-16 code units of `s` (the same in C#: uint, unchecked multiply by 16777619). */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The take (0 … count − 1) for the `occurrence`-th use of `sound` in the delivery `deliveryKey`. */
export function takeIndex(deliveryKey: string, sound: string, occurrence: number, count: number): number {
  if (!(count > 1)) return 0;
  return fnv1a32(`${deliveryKey}|${sound}|${occurrence}`) % Math.floor(count);
}

/** A deterministic number in [0, 1) for the same inputs. */
export function takeUnit(deliveryKey: string, sound: string, occurrence: number): number {
  return fnv1a32(`${deliveryKey}|${sound}|${occurrence}|u`) / 4294967296;
}

/** The index of the first sample whose magnitude reaches `ratio` of the peak (0 for silence). */
export function findOnset(data: ArrayLike<number>, ratio: number = ONSET_RATIO): number {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
  }
  if (peak <= 0) return 0;
  const thr = peak * ratio;
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) >= thr) return i;
  return 0;
}

/**
 * Start a buffer whose onset is at `onsetS` (buffer seconds) so the onset is heard at context time `when`, keeping up
 * to `prerollS` of the material before it. When that start is already past (`now`), the buffer starts now and skips
 * ahead by the same amount, so the onset still lands at `when`.
 */
export function alignedStart(
  when: number,
  onsetS: number,
  prerollS: number,
  now: number,
  rate = 1,
): { start: number; offset: number } {
  const r = rate > 0 ? rate : 1;
  const pre = Math.max(0, Math.min(onsetS, prerollS));
  let start = when - pre / r;
  let offset = onsetS - pre;
  if (start < now) {
    offset += (now - start) * r;
    start = now;
  }
  return { start, offset };
}
