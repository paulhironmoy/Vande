/**
 * Highlight attribution from the app (POST /v1/attribution, anonymous): landing_open when a highlight landing is
 * shown, share after a highlight was shared, install once after an attributed install (the Play referrer's code,
 * kept by installReferrer.ts until it is reported). Counters per code per day on the server; nothing here identifies
 * the player or the device, and failures are silent (attribution never gets in the way).
 */
import type { AttributionEvent, SecureStore } from '@/contracts';
import { HIGHLIGHT_CODE_RE } from './shared/ids';
import type { ApiClient } from './client';

const INSTALL_CODE_KEY = 'vc.attr.install';
const INSTALL_SENT_KEY = 'vc.attr.install.sent';

export interface AttributionReporter {
  report(code: string, event: AttributionEvent): Promise<boolean>;
  /** Reports a pending attributed install once (called when the app starts). */
  flushInstall(): Promise<boolean>;
}

export function createAttributionReporter(api: Pick<ApiClient, 'call'>, store: Pick<SecureStore, 'get' | 'set'> | null): AttributionReporter {
  const opened = new Set<string>();
  const report = async (code: string, event: AttributionEvent): Promise<boolean> => {
    if (!HIGHLIGHT_CODE_RE.test(code)) return false;
    // One landing open per code per app session (re-renders and back-navigation are not new opens).
    if (event === 'landing_open') {
      if (opened.has(code)) return false;
      opened.add(code);
    }
    try {
      await api.call('POST /v1/attribution', { body: { code, event } }, { anonymous: true });
      return true;
    } catch {
      return false;
    }
  };
  return {
    report,
    async flushInstall() {
      if (!store) return false;
      try {
        const code = await store.get(INSTALL_CODE_KEY);
        if (!code || (await store.get(INSTALL_SENT_KEY)) === code) return false;
        const ok = await report(code, 'install');
        if (ok) await store.set(INSTALL_SENT_KEY, code);
        return ok;
      } catch {
        return false;
      }
    },
  };
}
