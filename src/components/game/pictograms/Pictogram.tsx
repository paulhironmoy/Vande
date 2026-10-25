import type { OptionVisual } from '@/engine/types';

export interface PictogramProps {
  visual: OptionVisual;
  /** 'card' on answer cards; 'mini' beside answers in the reveal. */
  size?: 'card' | 'mini';
}

/** A composed, neutral pictogram (actor + action + object). Decorative: always aria-hidden. */
export function Pictogram({ visual, size = 'card' }: PictogramProps) {
  void visual;
  void size;
  return null;
}
