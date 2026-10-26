import { describe, expect, it } from 'vitest';
import { ANALYTICS_EVENTS, connectAnalytics, createAnalytics, sanitizeProps, type KeyStore } from '@/analytics';
import { createMockPushAdapter } from '@/platform/push';
import type { AnalyticsAdapter } from '@/analytics/types';
import { createPostHogAdapter } from '@/analytics/posthog';

function memoryStorage(): KeyStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const CONFIG = { provider: 'posthog' as const, host: 'https://eu.i.posthog.com', key: 'phc_test', killed: false };

function recorder() {
  const events: Array<{ event: string; props: unknown; id: string }> = [];
  const factory = (_c: unknown, id: string): AnalyticsAdapter => ({ track: (event, props) => void events.push({ event, props, id }) });
  return { events, factory };
}

describe('analytics dictionary and privacy', () => {
  it('has exactly the contract’s events', () => {
    // 28 game events + 9 Practice events.
    expect(ANALYTICS_EVENTS).toHaveLength(37);
    expect(ANALYTICS_EVENTS).toContain('practice_first_delivery');
    // Publication happens on the server only (Workers Analytics Engine counts it): never a client event.
    expect(ANALYTICS_EVENTS).not.toContain('youtube_published' as never);
    expect(ANALYTICS_EVENTS).toContain('renderer_fallback');
  });

  it('keeps only closed-vocabulary values', () => {
    expect(
      sanitizeProps({
        mode: 'duel',
        channel: 'whatsapp',
        appVersion: '1.2.3',
        attribution: 'wa7x',
        locale: 'hi-Latn',
        // everything below must be dropped
        reason: 'my email is a@b.c' as never,
        quality: 'ultra' as never,
        durationBucket: '37s' as never,
        attributionX: 'x',
        alias: 'Swift Tiger',
        plan: { balls: [] },
        matchId: 'mabc',
      } as never),
    ).toEqual({ mode: 'duel', channel: 'whatsapp', appVersion: '1.2.3', attribution: 'wa7x', locale: 'hi-Latn' });
    expect(sanitizeProps(undefined)).toEqual({});
  });
});

describe('analytics consent', () => {
  it('sends nothing until configured, consented and not blocked by DNT/GPC', () => {
    const r = recorder();
    const storage = memoryStorage();
    const off = createAnalytics({ config: { ...CONFIG, provider: 'none' }, storage, privacyBlocked: () => false, adapterFactory: r.factory });
    off.setConsent('granted');
    off.track('tutorial_started');
    const unset = createAnalytics({ config: CONFIG, storage: memoryStorage(), privacyBlocked: () => false, adapterFactory: r.factory });
    unset.track('tutorial_started');
    expect(unset.consent()).toBe('unset');
    const dnt = createAnalytics({ config: CONFIG, storage, privacyBlocked: () => true, adapterFactory: r.factory });
    dnt.track('tutorial_started');
    const killed = createAnalytics({ config: { ...CONFIG, killed: true }, storage, privacyBlocked: () => false, adapterFactory: r.factory });
    killed.track('tutorial_started');
    expect(r.events).toEqual([]);
  });

  it('tracks only dictionary events with a monthly random id, and forgets the id when consent is withdrawn', () => {
    const r = recorder();
    const storage = memoryStorage();
    let now = new Date('2026-10-26T10:00:00Z');
    const a = createAnalytics({ config: CONFIG, storage, privacyBlocked: () => false, adapterFactory: r.factory, now: () => now, base: () => ({ platform: 'android', appVersion: '1.0.0' }) });
    a.setConsent('granted');
    a.track('invite_created', { channel: 'whatsapp' });
    a.track('not_an_event' as never);
    now = new Date('2026-11-02T10:00:00Z');
    a.track('reveal_watched', { mode: 'duel' });
    expect(r.events.map((e) => e.event)).toEqual(['invite_created', 'reveal_watched']);
    expect(r.events[0].props).toEqual({ platform: 'android', appVersion: '1.0.0', channel: 'whatsapp' });
    expect(r.events[0].id).not.toBe(r.events[1].id);
    expect(r.events[0].id).toMatch(/^[0-9a-f-]{36}$/);
    a.setConsent('denied');
    expect(storage.data.has('vc:analytics-id')).toBe(false);
    a.track('rematch');
    expect(r.events).toHaveLength(2);
  });

  it('posts batches to PostHog without person profiles and with hour-resolution times', async () => {
    const bodies: string[] = [];
    const ph = createPostHogAdapter({ host: 'https://eu.i.posthog.com', key: 'phc_test', distinctId: 'd1', batchSize: 2, fetchImpl: (async (_u: string, init: RequestInit) => void bodies.push(String(init.body))) as unknown as typeof fetch, now: () => new Date('2026-10-26T10:47:13Z') });
    ph.track('share_initiated', { channel: 'copy' });
    ph.track('share_completed', { channel: 'copy' });
    await ph.flush?.();
    const payload = JSON.parse(bodies[0]);
    expect(payload.batch).toHaveLength(2);
    expect(payload.batch[0]).toMatchObject({ event: 'share_initiated', distinct_id: 'd1', timestamp: '2026-10-26T10:00:00.000Z', properties: { $process_person_profile: false } });
  });
});

describe('retention and crashes (sent by the device itself)', () => {
  const day = (iso: string) => new Date(`${iso}T10:00:00`);

  it('D1, D7 and D30 once each, counted from this device’s own first-open day, and only with consent', () => {
    const r = recorder();
    const storage = memoryStorage();
    let now = day('2026-10-26');
    const open = () => createAnalytics({ config: CONFIG, storage, privacyBlocked: () => false, adapterFactory: r.factory, now: () => now, errorTarget: null, visibilityTarget: null });
    // First open: only the local day is kept (never sent).
    open().setConsent('granted');
    expect(storage.data.get('vc:first-open')).toBe('2026-10-26');
    expect(r.events).toEqual([]);
    now = day('2026-10-27');
    open();
    now = day('2026-10-27');
    open();
    expect(r.events.map((e) => e.event)).toEqual(['retention_d1']);
    // Back on day 9: D7 (on or after day 7), once.
    now = day('2026-11-04');
    open();
    open();
    expect(r.events.map((e) => e.event)).toEqual(['retention_d1', 'retention_d7']);
    // Consent withdrawn: nothing is sent or marked; given again, the pending D30 goes at the next open.
    open().setConsent('denied');
    now = day('2026-11-30');
    open();
    expect(r.events).toHaveLength(2);
    open().setConsent('granted');
    expect(r.events.map((e) => e.event)).toEqual(['retention_d1', 'retention_d7', 'retention_d30']);
    expect(r.events.every((e) => JSON.stringify(e.props) === '{}')).toBe(true);
  });

  it('a crash is only its kind: never a message, a stack or a URL, and at most three of each per session', () => {
    const r = recorder();
    const storage = memoryStorage();
    storage.setItem('vc:analytics-consent', 'granted');
    const target = new EventTarget();
    createAnalytics({ config: CONFIG, storage, privacyBlocked: () => false, adapterFactory: r.factory, errorTarget: target, visibilityTarget: null, base: () => ({ platform: 'web', appVersion: '1.0.0' }) });
    for (let i = 0; i < 5; i++) target.dispatchEvent(Object.assign(new Event('error'), { message: 'TypeError: secret at https://x.example/?token=abc', filename: 'https://x.example/app.js' }));
    target.dispatchEvent(new Event('unhandledrejection'));
    expect(r.events.map((e) => [e.event, e.props])).toEqual([
      ['crash', { platform: 'web', appVersion: '1.0.0', reason: 'error' }],
      ['crash', { platform: 'web', appVersion: '1.0.0', reason: 'error' }],
      ['crash', { platform: 'web', appVersion: '1.0.0', reason: 'error' }],
      ['crash', { platform: 'web', appVersion: '1.0.0', reason: 'rejection' }],
    ]);
    expect(JSON.stringify(r.events)).not.toMatch(/secret|token|x\.example/);
  });
});

describe('events only the app shell sees', () => {
  it('a tapped deadline reminder and an attributed install, and nothing else', () => {
    const tracked: Array<[string, unknown]> = [];
    const push = createMockPushAdapter();
    let install: ((code: string) => void) | null = null;
    const off = connectAnalytics({ track: (e, p) => void tracked.push([e, p]) }, { push, onAttributedInstall: (cb) => ((install = cb), () => (install = null)) });
    push.emit({ kind: 'deadline_reminder', data: { tapped: '1', matchId: 'm1' } });
    push.emit({ kind: 'deadline_reminder', data: { tapped: '1', matchId: 'm2', cupId: 'c1' } });
    // Received in the foreground (not opened), and other kinds: nothing.
    push.emit({ kind: 'deadline_reminder', data: { tapped: '0', matchId: 'm3' } });
    push.emit({ kind: 'reveal_ready', data: { tapped: '1', matchId: 'm4' } });
    (install as ((code: string) => void) | null)?.('k7q2m9xa');
    expect(tracked).toEqual([
      ['reminder_opened', { mode: 'duel' }],
      ['reminder_opened', { mode: 'cup' }],
      ['attributed_install', { attribution: 'k7q2m9xa' }],
    ]);
    off();
    push.emit({ kind: 'deadline_reminder', data: { tapped: '1', matchId: 'm5' } });
    expect(tracked).toHaveLength(3);
    expect(install).toBeNull();
  });
});
