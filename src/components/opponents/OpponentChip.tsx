import type { OpponentId } from '@/engine/types';
import { OPPONENTS } from '@/engine';
import { SIMPLE_OPPONENTS, useSimple } from '@/app/simple';
import styles from './OpponentChip.module.css';
import { SignalGlyph } from './SignalGlyph';
import { OPPONENT_TONE } from './tones';

export function OpponentChip({ id, size = 'md', animated = false }: { id: OpponentId; size?: 'md' | 'lg'; animated?: boolean }) {
  const meta = OPPONENTS[id];
  const simple = useSimple();
  if (!meta) return null;
  return (
    <span className={[styles.chip, size === 'lg' ? styles.lg : ''].join(' ')} style={{ ['--glyph' as string]: OPPONENT_TONE[id] }}>
      <SignalGlyph kind={meta.signal} size={size === 'lg' ? 24 : 20} animated={animated} title="" />
      {simple ? (
        <span className={styles.simpleName}>
          {SIMPLE_OPPONENTS[id].nickname}
          <small>{meta.name}</small>
        </span>
      ) : (
        meta.name
      )}
    </span>
  );
}
