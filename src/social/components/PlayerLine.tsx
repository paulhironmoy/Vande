import type { ReactNode } from 'react';
import type { PlayerRef } from '@/contracts';
import { Avatar } from '@/ui';
import s from './social.module.css';

/** Avatar and alias (aliases are player-chosen; long ones wrap, never truncate the only copy). */
export function PlayerLine({ player, meta, size = 40, trailing }: { player: PlayerRef | null; meta?: ReactNode; size?: number; trailing?: ReactNode }) {
  return (
    <div className={s.player}>
      {player && <Avatar avatar={player.avatar} kit={player.kit} size={size} decorative />}
      <div className={s.playerText}>
        <span className={s.alias}>{player?.alias ?? '—'}</span>
        {meta && <span className={s.meta}>{meta}</span>}
      </div>
      {trailing}
    </div>
  );
}
