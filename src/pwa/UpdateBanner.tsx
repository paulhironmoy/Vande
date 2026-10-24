import { useEffect, useState } from 'react';
import { applyPwaUpdate, dismissPwaUpdate, usePwaStatus } from './register';
import styles from './UpdateBanner.module.css';

function isPlayPath(): boolean {
  if (typeof location === 'undefined') return false;
  const path = location.pathname.replace(/\/+$/, '');
  return path.endsWith('/play');
}

/**
 * Non-blocking "new version ready" prompt. Never shown during gameplay (/play) — it re-checks the
 * path every few seconds and on history navigation so it appears once the player leaves the map.
 */
export function UpdateBanner() {
  const { needRefresh, updating } = usePwaStatus();
  const [onPlay, setOnPlay] = useState<boolean>(() => isPlayPath());

  useEffect(() => {
    if (!needRefresh) return;
    const check = () => setOnPlay(isPlayPath());
    check();
    const id = window.setInterval(check, 3000);
    window.addEventListener('popstate', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('popstate', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [needRefresh]);

  if (!needRefresh || onPlay) return null;

  return (
    <div className={styles.banner} role="status" aria-live="polite" data-testid="update-banner">
      <div className={styles.text}>
        <strong className={styles.title}>A new version is ready</strong>
        <span className={styles.sub}>Your progress is saved on this device and stays intact.</span>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={dismissPwaUpdate} disabled={updating}>
          Later
        </button>
        <button type="button" className={styles.primary} onClick={() => void applyPwaUpdate()} disabled={updating}>
          {updating ? 'Updating…' : 'Update'}
        </button>
      </div>
    </div>
  );
}

export default UpdateBanner;
