import type { ConfidenceState, EvidenceVerb } from '@/engine/types';
import type { BuzzKind, CueName } from '@/components/play/cues';

/** Picks a restrained sound/haptic pair for an evidence action outcome. */
export function cueFor(verb: EvidenceVerb, before?: ConfidenceState, after?: ConfidenceState): [CueName, BuzzKind | undefined] {
  if (after && after !== before) {
    if (after === 'manipulated') return ['warning', 'warning'];
    if (after === 'verified' || after === 'corroborated') return ['verify', 'light'];
  }
  if (verb === 'preserve') return ['confirm', 'light'];
  return ['tick', undefined];
}
