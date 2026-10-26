import { useId, useMemo } from 'react';
import type { AvatarSpec, KitSpec } from '@/contracts';
import { useT } from '@/i18n';
import { avatarInner } from './avatarSvg';

export interface AvatarProps {
  avatar: AvatarSpec;
  kit?: KitSpec;
  size?: number;
  /** Accessible name (defaults to a generic "Player portrait"). */
  label?: string;
  /** Decorative when shown next to the alias. */
  decorative?: boolean;
  className?: string;
}

/**
 * Generated, original player portrait (no uploads, no likenesses). The geometry lives in avatarSvg.ts so share cards
 * and highlights draw exactly the same face.
 */
export function Avatar({ avatar, kit, size = 64, label, decorative, className }: AvatarProps) {
  const { t } = useT();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const inner = useMemo(() => avatarInner(avatar, kit, id), [avatar, kit, id]);
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : (label ?? t('a11y.avatar'))}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
