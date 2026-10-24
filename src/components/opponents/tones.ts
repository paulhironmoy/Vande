import type { OpponentId } from '@/engine/types';

/** Accent hue per opponent — used only for small glyphs and rings, never as large fills. */
export const OPPONENT_TONE: Record<OpponentId, string> = {
  exploiter: '#f0a24a',
  provocateur: '#e0405a',
  disinfo: '#c084fc',
  sabotage: '#ff7a45',
  overreaction: '#a9e4ff',
};
