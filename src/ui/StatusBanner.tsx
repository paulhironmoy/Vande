import { useT } from '@/i18n';
import { Icon } from './Icon';
import s from './StatusBanner.module.css';

export interface StatusBannerProps {
  status: 'online' | 'offline' | 'reconnecting';
}

/** Connectivity strip. Renders nothing when online. Text and icon, never colour alone. */
export function StatusBanner({ status }: StatusBannerProps) {
  const { t } = useT();
  if (status === 'online') return null;
  const offline = status === 'offline';
  return (
    <div className={s.banner} data-status={status} role="status" aria-live="polite">
      <Icon name={offline ? 'offline' : 'refresh'} size={18} className={offline ? undefined : s.spin} />
      <span className={s.text}>
        <strong>{t(offline ? 'state.offline.title' : 'state.reconnecting.title')}</strong>
        <span className={s.sub}>{t(offline ? 'state.offline.body' : 'state.reconnecting.body')}</span>
      </span>
    </div>
  );
}
