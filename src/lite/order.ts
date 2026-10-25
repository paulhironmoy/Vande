/**
 * Display order for a question's answers. In the authored content the best move is often listed first, so "always
 * tap the first card" would win. The order is shuffled with a seed made from the run seed and the question id: every
 * player of the same game (friend challenges and dares replay the same seed) sees the same order, but the position
 * of the best move carries no information. Indexes are content indexes, so scoring and replay tokens never change.
 */
import { createRng, hashString, rngFloat } from '@/engine/prng';

export function displayOrder(seed: number, questionId: string, n: number): number[] {
  let rng = createRng(hashString(`${seed >>> 0}:${questionId}:order`));
  const out = Array.from({ length: Math.max(0, n) }, (_, i) => i);
  for (let i = out.length - 1; i > 0; i--) {
    const r = rngFloat(rng);
    rng = r.next;
    const j = Math.floor(r.value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
