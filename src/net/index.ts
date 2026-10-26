/**
 * src/net: the app's connection to the VANDE Cricket API. `createNet()` wires the typed client, the session (tokens
 * in the platform SecureStore), the durable outbox (IndexedDB), batting and connectivity tracking into the root
 * store's `setOnline`. Without an API URL (offline-only builds) `createNet` returns null and every local mode works.
 */
import type { LocaleId, SecureStore } from '@/contracts';
import { BattingClient } from './batting';
import { createApiClient, type ApiClient, type FetchLike } from './client';
import { capacitorResume, startConnectivity, type Connectivity } from './connectivity';
import { idbKeyValue, type KeyValue } from './idb';
import { Outbox, idbOutboxStorage, type OutboxStorage } from './outbox';
import { readNetConfig, type NetConfig } from './config';
import { SessionManager, type Locks } from './session';
import type { RouteKey } from './routes';
import { createAttributionReporter, type AttributionReporter } from './attribution';
import { isApiClientError } from './errors';
import { setMomentClaimer } from '@/platform/shareMoments';

export interface Net {
  config: NetConfig;
  api: ApiClient;
  session: SessionManager;
  outbox: Outbox;
  batting: BattingClient;
  connectivity: Connectivity;
  /** Highlight attribution (landing opens, shares, the attributed install). */
  attribution: AttributionReporter;
  /**
   * Signs this device out: the server ends this session first, then the device forgets it together with every request
   * still queued for the account (none may replay under a later guest account). Throws when the server cannot be
   * reached, and then forgets nothing, so the caller can say so and the player stays signed in. A session the server
   * had already ended is simply forgotten. Without a session nothing is sent (no account is created to sign out of).
   */
  signOut(): Promise<void>;
  /** Signs out every other device of this account; this one stays signed in. Resolves with how many were signed out. */
  revokeOthers(): Promise<number>;
  dispose(): void;
}

export interface NetOptions {
  secureStore: SecureStore;
  setOnline: (online: boolean) => void;
  locale: () => LocaleId;
  config?: NetConfig;
  fetch?: FetchLike;
  outboxStorage?: OutboxStorage;
  kv?: KeyValue;
  locks?: Locks;
  now?: () => number;
  /**
   * Whether this player confirmed on the age screen that they are 18 or over (VANDE Cricket is 18+). When it returns
   * false (or is absent) no account is created: neither session.ensure() nor the sign-up implied by a signed-in call
   * sends anything; both fail with AgeNotConfirmedError. An existing or recovered session is unaffected.
   */
  adultConfirmed?: () => boolean;
  /** Test hooks for connectivity. */
  connectivity?: Partial<Parameters<typeof startConnectivity>[0]>;
}

export function createNet(o: NetOptions): Net | null {
  const config = o.config ?? readNetConfig();
  if (!config.apiUrl) return null;
  let connectivity: Connectivity | null = null;
  const report = (ok: boolean) => connectivity?.report(ok);
  const anonymous = createApiClient({ baseUrl: config.apiUrl, fetch: o.fetch, timeoutMs: config.timeoutMs, clientId: config.clientId, onNetworkResult: report });
  const session = new SessionManager({ store: o.secureStore, api: anonymous, locale: o.locale, now: o.now, locks: o.locks, adultConfirmed: o.adultConfirmed });
  const api = createApiClient({
    baseUrl: config.apiUrl,
    fetch: o.fetch,
    timeoutMs: config.timeoutMs,
    clientId: config.clientId,
    onNetworkResult: report,
    accessToken: async () => {
      await session.ensure();
      return session.accessToken();
    },
    onUnauthorized: () => session.refresh().catch(() => false),
  });
  const outbox = new Outbox({
    storage: o.outboxStorage ?? idbOutboxStorage(),
    now: o.now,
    send: (e) => api.call(e.route as RouteKey, { params: e.params as never, body: e.body as never }, { idempotencyKey: e.id }),
  });
  // Only the hooks a caller actually set replace the defaults (an undefined one never overwrites them).
  const hooks = Object.fromEntries(Object.entries(o.connectivity ?? {}).filter(([, v]) => v !== undefined)) as Partial<Parameters<typeof startConnectivity>[0]>;
  connectivity = startConnectivity({
    setOnline: o.setOnline,
    onOnline: () => void outbox.flush(),
    onResume: () => void outbox.flush(),
    appResume: capacitorResume,
    ...hooks,
  });
  outbox.start();
  const batting = new BattingClient(api, outbox, o.kv ?? idbKeyValue());
  const attribution = createAttributionReporter(anonymous, o.secureStore);
  void attribution.flushInstall();
  // The share cap lives on the server: shareMoment asks here just before a share opens. Never signs anyone up just
  // to ask; without a session, offline or on any error the answer is null and this device's ledger decides.
  const unclaim = setMomentClaimer(async (id, moment) => {
    if (!(await session.current())) return null;
    try {
      return (await api.call('POST /v1/matches/:id/moments', { params: { id }, body: { moment } }, { timeoutMs: 2_500 })).allowed === true;
    } catch {
      return null;
    }
  });
  return {
    config,
    api,
    session,
    outbox,
    batting,
    connectivity,
    attribution,
    async signOut() {
      if (await session.current()) {
        try {
          await api.call('POST /v1/auth/logout');
        } catch (e) {
          if (!(isApiClientError(e) && e.code === 'unauthorized')) throw e;
        }
      }
      await outbox.clear();
      await session.clear('signed_out');
    },
    async revokeOthers() {
      return (await api.call('POST /v1/auth/revoke-others')).revoked;
    },
    dispose() {
      outbox.stop();
      connectivity?.stop();
      unclaim();
    },
  };
}

export { AgeNotConfirmedError, ApiClientError, isAgeNotConfirmed, isApiClientError } from './errors';
export { createApiClient } from './client';
export type { ApiClient, CallArgs, CallOptions } from './client';
export { Outbox, backoffDelay, memoryOutboxStorage, idbOutboxStorage } from './outbox';
export type { OutboxEntry, OutboxResult, SubmitResult } from './outbox';
export { SessionManager, defaultLocks } from './session';
export { BattingClient, matchLane } from './batting';
export type { ShotOutcome } from './batting';
export { readNetConfig, LOCAL_API_URL } from './config';
export type { NetConfig } from './config';
export { startConnectivity } from './connectivity';
export { memoryKeyValue, idbKeyValue } from './idb';
export type { KeyValue } from './idb';
export type { RouteKey } from './routes';
export { practiceAgainst } from './practice';
export { createAttributionReporter } from './attribution';
export type { AttributionReporter } from './attribution';
export { roomIdFor } from './shared/ids';
