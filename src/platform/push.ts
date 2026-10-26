/**
 * PushAdapter (src/contracts/adapters.ts). Android: Firebase Cloud Messaging through the Capacitor
 * PushNotifications plugin (activation: `npm i @capacitor/push-notifications`, google-services.json, `cap sync`;
 * see docs/INFRASTRUCTURE.md). Permission is asked only after a meaningful moment (the UI decides when; never on the
 * first launch). Off unless VITE_PUSH_ENABLED=1 and the native plugin is present. Web push is not offered in v1.
 */
import type { PushAdapter } from '@/contracts';
import { nativePluginAvailable, type PluginBox } from './capacitor';

type PushMessage = Parameters<Parameters<PushAdapter['onMessage']>[0]>[0];

/** The slice of @capacitor/push-notifications this adapter uses. */
export interface PushNotificationsPlugin {
  requestPermissions(): Promise<{ receive: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' }>;
  register(): Promise<void>;
  addListener(event: 'registration', cb: (t: { value: string }) => void): Promise<{ remove(): Promise<void> }>;
  addListener(event: 'registrationError', cb: (e: { error: string }) => void): Promise<{ remove(): Promise<void> }>;
  addListener(event: 'pushNotificationReceived', cb: (n: { data?: Record<string, string> }) => void): Promise<{ remove(): Promise<void> }>;
  addListener(event: 'pushNotificationActionPerformed', cb: (a: { notification: { data?: Record<string, string> } }) => void): Promise<{ remove(): Promise<void> }>;
}

const KINDS = new Set(['opponent_joined', 'opponent_locked', 'reveal_ready', 'auto_over', 'match_expired', 'rematch', 'deadline_reminder', 'new_fixture', 'final', 'cup_complete', 'cup_cancelled']);

/** Android notification channel for match pushes (the server sends `channel_id: matches`). */
export const MATCH_CHANNEL = { id: 'matches', name: 'Matches', description: 'Locks, deadlines and reveals', importance: 4 as const, visibility: 1 as const };

function toMessage(data: Record<string, string> | undefined, tapped: boolean): PushMessage | null {
  if (!data || !KINDS.has(data.kind)) return null;
  return { kind: data.kind, data: { ...data, tapped: tapped ? '1' : '0' } };
}

export function createFcmPushAdapter(o: { enabled: boolean; plugin: () => Promise<PluginBox<PushNotificationsPlugin> | null>; timeoutMs?: number }): PushAdapter {
  // The plugin stays boxed: an async function that returned the Capacitor proxy itself would never settle (PluginBox).
  let box: PluginBox<PushNotificationsPlugin> | null | undefined;
  let loading: Promise<PluginBox<PushNotificationsPlugin> | null> | null = null;
  const get = () => (loading ??= (o.enabled ? o.plugin().catch(() => null) : Promise.resolve(null)).then((b) => (box = b)));
  if (o.enabled) void get();
  return {
    available: () => o.enabled && box !== null,
    async register() {
      const p = (await get())?.plugin;
      if (!p) return null;
      const perm = await p.requestPermissions();
      if (perm.receive !== 'granted') return null;
      return new Promise((resolve) => {
        const handles: Array<Promise<{ remove(): Promise<void> }>> = [];
        const done = (v: { token: string; platform: 'android' } | null) => {
          clearTimeout(timer);
          for (const h of handles) void h.then((x) => x.remove());
          resolve(v);
        };
        const timer = setTimeout(() => done(null), o.timeoutMs ?? 10_000);
        handles.push(p.addListener('registration', (t) => done({ token: t.value, platform: 'android' })));
        handles.push(p.addListener('registrationError', () => done(null)));
        void p.register().catch(() => done(null));
      });
    },
    onMessage(cb) {
      const handles: Array<Promise<{ remove(): Promise<void> }>> = [];
      void get().then((b) => {
        const p = b?.plugin;
        if (!p) return;
        handles.push(p.addListener('pushNotificationReceived', (n) => {
          const m = toMessage(n.data, false);
          if (m) cb(m);
        }));
        handles.push(p.addListener('pushNotificationActionPerformed', (a) => {
          const m = toMessage(a.notification.data, true);
          if (m) cb(m);
        }));
      });
      return () => {
        for (const h of handles) void h.then((x) => x.remove());
      };
    },
  };
}

/** @capacitor/push-notifications on Android, boxed (null on the web or when the native side is missing). */
export async function nativePushPlugin(): Promise<PluginBox<PushNotificationsPlugin> | null> {
  if (!nativePluginAvailable('PushNotifications')) return null;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  await PushNotifications.createChannel(MATCH_CHANNEL).catch(() => undefined);
  return { plugin: PushNotifications as unknown as PushNotificationsPlugin };
}

export function createDisabledPushAdapter(): PushAdapter {
  return { available: () => false, register: async () => null, onMessage: () => () => undefined };
}

/** For tests and local development: scripted permission and token, and emit() to simulate a push. */
export function createMockPushAdapter(token: string | null = 'mock-fcm-token-0123456789abcdef'): PushAdapter & { emit(msg: PushMessage): void; registrations: number } {
  const listeners = new Set<(m: PushMessage) => void>();
  const self = {
    registrations: 0,
    available: () => true,
    async register() {
      self.registrations++;
      return token ? { token, platform: 'android' as const } : null;
    },
    onMessage(cb: (m: PushMessage) => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit(m: PushMessage) {
      for (const l of listeners) l(m);
    },
  };
  return self;
}
