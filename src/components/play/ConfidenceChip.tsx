import type { ConfidenceState } from '@/engine/types';
import { CONFIDENCE_ICON, CONFIDENCE_LABEL, PlayIcon } from './icons';
import { SIMPLE_STATES } from '@/app/simple';
import styles from './ConfidenceChip.module.css';

export function ConfidenceChip({ state, size = 'md', className, simple }: { state: ConfidenceState; size?: 'sm' | 'md'; className?: string; simple?: boolean }) {
  return (
    <span className={[styles.chip, size === 'sm' ? styles.sm : '', className ?? ''].filter(Boolean).join(' ')} data-state={state}>
      <PlayIcon name={CONFIDENCE_ICON[state]} size={size === 'sm' ? 13 : 15} />
      <span>{simple ? SIMPLE_STATES[state].label : CONFIDENCE_LABEL[state]}</span>
    </span>
  );
}

export const CONFIDENCE_DESCRIPTION: Record<ConfidenceState, string> = {
  verified: 'Confirmed by an official or institutional record.',
  corroborated: 'Supported by at least one independent source.',
  unverified: 'Nothing confirms or contradicts this yet.',
  manipulated: 'Shows signs of fabrication or editing.',
  unknown: 'Cannot be confirmed or denied with what is available.',
};
