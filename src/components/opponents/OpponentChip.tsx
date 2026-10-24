import type { OpponentId } from '@/engine/types';
import { OPPONENTS } from '@/engine';
import styles from './OpponentChip.module.css';
import { SignalGlyph } from './SignalGlyph';
import { OPPONENT_TONE } from './tones';

export function OpponentChip({ id, size = 'md', animated = false }: { id: OpponentId; size?: 'md' | 'lg'; animated?: boolean }) {
  const meta = OPPONENTS[id];
  if (!meta) return null;
  return (
    <span className={[styles.chip, size === 'lg' ? styles.lg : ''].join(' ')} style={{ ['--glyph' as string]: OPPONENT_TONE[id] }}>
      <SignalGlyph kind={meta.signal} size={size === 'lg' ? 24 : 20} animated={animated} title="" />
      {meta.name}
    </span>
  );
}
