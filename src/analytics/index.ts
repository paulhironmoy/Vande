/**
 * Analytics facade. Off unless all of these hold: a provider is configured (VITE_ANALYTICS_PROVIDER=posthog with
 * VITE_POSTHOG_HOST and VITE_POSTHOG_KEY), no kill switch (VITE_KILL_ANALYTICS=1), no Do-Not-Track / Global Privacy
 * Control signal, and the player opted in (setConsent('granted')). Declining changes nothing else in the game.
 *
 * Only the closed dictionary passes (events.ts); properties are filtered to closed vocabularies (privacy.ts); times
 * are rounded to the hour; the distinct id is a random per-install id that rotates every calendar month and is never
 * the player id. Retention (D1/D7/D30) is reported by the device itself from its local first-open day (kept on the
 * device only), once each, on an app open on or after that day. Crashes are counted as `crash` with only
 * `reason: 'error' | 'rejection'` (a window error or an unhandled promise rejection): never a message, a stack or a
 * URL, and at most three of each per session.
 */
import type { AnalyticsEventName, AnalyticsProps } from '@/contracts';
import { noopAdapter } from './adapter';
import { isAnalyticsEvent } from './events';
import { createPostHogAdapter } from './posthog';
import { monthKey, privacySignalBlocks, sanitizeProps } from './privacy';
import type { AnalyticsAdapter } from './types';

export type Consent = 'granted' | 'denied' | 'unset';

export interface AnalyticsConfig {
  provider: 'none' | 'posthog';
  host: string;
  key: string;
  killed: boolean;
}

export function readAnalyticsConfig(env: Record<string, unknown> = import.meta.env as Record<string, unknown>): AnalyticsConfig {
  return {
    provider: env.VITE_ANALYTICS_PROVIDER === 'posthog' ? 'posthog' : 'none',
    host: String(env.VITE_POSTHOG_HOST ?? ''),
    key: String(env.VITE_POSTHOG_KEY ?? ''),
    killed: String(env.VITE_KILL_ANALYTICS ?? '') === '1',
  };
}

export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const CONSENT_KEY = 'vc:analytics-consent';
const ID_KEY = 'vc:analytics-id';
/** The device's local first-open day (YYYY-MM-DD); never sent, only compared. */
export const FIRST_OPEN_KEY = 'vc:first-open';
/** Which retention events this device has sent. */
const RETENTION_KEY = 'vc:retention-sent';
const RETENTION: ReadonlyArray<readonly [number, AnalyticsEventName]> = [
  [1, 'retention_d1'],
  [7, 'retention_d7'],
  [30, 'retention_d30'],
];
/** At most this many `crash` events of each kind per session (a crash loop never floods anything). */
const MAX_CRASHES = 3;

/** The device-local calendar day. */
function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface AnalyticsOptions {
  config?: AnalyticsConfig;
  storage?: KeyStore | null;
  privacyBlocked?: () => boolean;
  now?: () => Date;
  /** Builds the provider adapter (tests inject a recorder). */
  adapterFactory?: (config: AnalyticsConfig, distinctId: string) => AnalyticsAdapter;
  /** Properties added to every event (platform, appVersion, locale), sanitised like the rest. */
  base?: () => AnalyticsProps;
  /** Where window errors and unhandled rejections are heard, for `crash` (default: window; null: off). */
  errorTarget?: EventTarget | null;
  /** Where the app coming back to the foreground is heard, to check retention again (default: document; null: off). */
  visibilityTarget?: (EventTarget & { visibilityState?: string }) | null;
}

export interface Analytics {
  track(event: AnalyticsEventName, props?: AnalyticsProps): void;
  setConsent(consent: 'granted' | 'denied'): void;
  consent(): Consent;
  /** Whether events would be sent right now. */
  active(): boolean;
  flush(): Promise<void>;
}

function safeStorage(): KeyStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function createAnalytics(o: AnalyticsOptions = {}): Analytics {
  const config = o.config ?? readAnalyticsConfig();
  const storage = o.storage === undefined ? safeStorage() : o.storage;
  const blocked = o.privacyBlocked ?? (() => privacySignalBlocks());
  const now = o.now ?? (() => new Date());
  const configured = config.provider === 'posthog' && /^https:\/\//.test(config.host) && config.key.length > 0 && !config.killed;
  let adapter: AnalyticsAdapter | null = null;
  let adapterMonth = '';

  const read = (k: string) => {
    try {
      return storage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  };
  const write = (k: string, v: string | null) => {
    try {
      if (v === null) storage?.removeItem(k);
      else storage?.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  };
  const consent = (): Consent => {
    const c = read(CONSENT_KEY);
    return c === 'granted' || c === 'denied' ? c : 'unset';
  };
  const active = () => configured && consent() === 'granted' && !blocked();

  function current(): AnalyticsAdapter {
    const month = monthKey(now());
    if (adapter && adapterMonth === month) return adapter;
    let id = read(ID_KEY);
    if (!id || !id.startsWith(`${month}:`)) {
      id = `${month}:${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)}`;
      write(ID_KEY, id);
    }
    const distinctId = id.slice(month.length + 1);
    adapter = (o.adapterFactory ?? ((c, d) => createPostHogAdapter({ host: c.host, key: c.key, distinctId: d, now })))(config, distinctId);
    adapterMonth = month;
    return adapter;
  }

  const track = (event: AnalyticsEventName, props?: AnalyticsProps) => {
    try {
      if (!active() || !isAnalyticsEvent(event)) return;
      current().track(event, sanitizeProps({ ...(o.base?.() ?? {}), ...props }) as AnalyticsProps);
    } catch {
      /* analytics never breaks the game */
    }
  };

  /** D1, D7 and D30 once each, on an open on or after that many days from this device's first open (consent first). */
  const checkRetention = () => {
    try {
      const today = localDay(now());
      const first = read(FIRST_OPEN_KEY);
      if (!first || !/^\d{4}-\d{2}-\d{2}$/.test(first)) {
        write(FIRST_OPEN_KEY, today);
        return;
      }
      // Without consent nothing is sent and nothing is marked: an event is sent at the first open after opting in.
      if (!active()) return;
      const sent = new Set((read(RETENTION_KEY) ?? '').split(',').filter(Boolean));
      const days = daysBetween(first, today);
      for (const [n, event] of RETENTION) {
        if (days < n || sent.has(event)) continue;
        track(event);
        sent.add(event);
      }
      write(RETENTION_KEY, [...sent].join(','));
    } catch {
      /* analytics never breaks the game */
    }
  };

  const crashes = { error: 0, rejection: 0 };
  const crashed = (reason: 'error' | 'rejection') => () => {
    if (crashes[reason]++ < MAX_CRASHES) track('crash', { reason });
  };
  const errors = o.errorTarget === undefined ? (typeof window !== 'undefined' ? window : null) : o.errorTarget;
  errors?.addEventListener('error', crashed('error'));
  errors?.addEventListener('unhandledrejection', crashed('rejection'));
  const visibility = o.visibilityTarget === undefined ? (typeof document !== 'undefined' ? document : null) : o.visibilityTarget;
  visibility?.addEventListener('visibilitychange', () => {
    if (visibility.visibilityState === undefined || visibility.visibilityState === 'visible') checkRetention();
  });
  checkRetention();

  return {
    track,
    setConsent(c) {
      write(CONSENT_KEY, c);
      if (c === 'denied') {
        write(ID_KEY, null);
        adapter = null;
      } else checkRetention();
    },
    consent,
    active,
    async flush() {
      await (adapter ?? noopAdapter).flush?.();
    },
  };
}

export { ANALYTICS_EVENTS, isAnalyticsEvent, PROP_RULES } from './events';
export { connectAnalytics } from './connect';
export type { AnalyticsSources } from './connect';
export { sanitizeProps, privacySignalBlocks, coarseTimestamp } from './privacy';
export type { AnalyticsAdapter } from './types';
