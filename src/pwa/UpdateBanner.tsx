import { useT } from '@/i18n';
import { Button, Icon } from '@/ui';
import { applyPwaUpdate, dismissPwaUpdate, usePwaStatus } from './register';
import styles from './UpdateBanner.module.css';

/**
 * Non-blocking "new version ready" prompt. The root shell hides it while a planner or an innings is on screen
 * (`inPlay`), so it only appears between matches. Updating keeps everything saved on this device.
 */
export function UpdateBanner() {
  const { t } = useT();
  const { needRefresh, updating } = usePwaStatus();
  if (!needRefresh) return null;
  return (
    <div className={styles.banner} role="status" aria-live="polite" data-testid="update-banner">
      <span className={styles.icon} aria-hidden="true">
        <Icon name="sparkle" size={20} />
      </span>
      <div className={styles.text}>
        <strong className={styles.title}>{t('update.title')}</strong>
        <span className={styles.sub}>{t('update.body')}</span>
      </div>
      <div className={styles.actions}>
        <Button variant="ghost" size="sm" onClick={dismissPwaUpdate} disabled={updating} data-testid="update-later">
          {t('update.later')}
        </Button>
        <Button variant="primary" size="sm" onClick={() => void applyPwaUpdate()} loading={updating} data-testid="update-now">
          {updating ? t('update.updating') : t('update.now')}
        </Button>
      </div>
    </div>
  );
}

export default UpdateBanner;
