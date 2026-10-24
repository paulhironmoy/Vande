import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANALYTICS_PROP_KEYS, type AnalyticsAdapter, type AnalyticsEvent } from '@/analytics/types';
import { __setAnalyticsAdapterForTests, analyticsStatus, configureAnalytics, sanitizeProps, setAnalyticsEnabled, track, privacySignalBlocks } from '@/analytics';
import { createPostHogAdapter } from '@/analytics/posthog';

const EVENTS: AnalyticsEvent[] = ['app_opened', 'daily_entry_viewed', 'daily_started', 'first_choice_reached', 'daily_completed', 'official_result_viewed', 'daily_shared', 'challenge_opened', 'challenge_started', 'challenge_completed', 'calendar_viewed', 'passport_viewed', 'reminder_enabled', 'reminder_disabled', 'subsequent_day_return'];

describe('analytics', () => {
  afterEach(() => {
    __setAnalyticsAdapterForTests(null);
    vi.unstubAllGlobals();
  });

  it('is a no-op when no provider is configured', async () => {
    await configureAnalytics({ installId: 'install-A', appVersion: '1.0.0', platform: 'web', optOut: false });
    expect(analyticsStatus()).toEqual({ configured: false, enabled: false, provider: 'none' });
    expect(() => track('app_opened')).not.toThrow();
  });

  it('honours opt-out and Do-Not-Track even when an adapter is present', () => {
    const calls: unknown[] = [];
    const adapter: AnalyticsAdapter = { track: (e, p) => calls.push([e, p]) };
    __setAnalyticsAdapterForTests(adapter, { configured: true, optOut: true });
    track('daily_started', { dailyId: '2026-10-26' });
    expect(calls).toHaveLength(0);
    setAnalyticsEnabled(true);
    track('daily_started', { dailyId: '2026-10-26' });
    expect(calls).toHaveLength(1);
    expect(privacySignalBlocks({ doNotTrack: '1' } as unknown as Navigator)).toBe(true);
    expect(privacySignalBlocks({ globalPrivacyControl: true })).toBe(true);
    expect(privacySignalBlocks({ doNotTrack: '0' } as unknown as Navigator)).toBe(false);
  });

  it('only ever sends dictionary keys with short primitive values', () => {
    const sent: Record<string, unknown>[] = [];
    __setAnalyticsAdapterForTests({ track: (_e, p) => sent.push(p as Record<string, unknown>) }, { configured: true, optOut: false });
    for (const event of EVENTS) {
      track(event, { dailyId: '2026-10-26', elapsedBucket: '10-30s', official: true, ...({ decisionText: 'Meet the student council', when: new Date().toISOString(), nested: { a: 1 } } as object) });
    }
    expect(sent).toHaveLength(EVENTS.length);
    for (const props of sent) {
      for (const key of Object.keys(props)) expect(ANALYTICS_PROP_KEYS as readonly string[]).toContain(key);
      for (const value of Object.values(props)) {
        expect(['string', 'number', 'boolean']).toContain(typeof value);
        if (typeof value === 'string') {
          expect(value.length).toBeLessThanOrEqual(32);
          expect(value).not.toMatch(/T\d{2}:\d{2}:\d{2}/);
        }
      }
      expect(JSON.stringify(props)).not.toContain('student');
    }
    expect(sanitizeProps(undefined)).toEqual({});
  });

  it('posts batches to PostHog over HTTP and never throws when the network fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    const adapter = createPostHogAdapter({ host: 'https://eu.i.posthog.com/', key: 'phc_test', distinctId: 'abc', batchSize: 2, flushMs: 10_000, fetchImpl: fetchMock as unknown as typeof fetch, now: () => new Date('2026-10-26T09:41:12Z') });
    adapter.track('app_opened', { appVersion: '1.0.0' });
    expect(adapter.queueSize()).toBe(1);
    adapter.track('daily_started', { dailyId: '2026-10-26' });
    await adapter.flush?.();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://eu.i.posthog.com/batch/');
    const body = JSON.parse(String(init.body)) as { api_key: string; batch: { event: string; distinct_id: string; timestamp: string; properties: Record<string, unknown> }[] };
    expect(body.api_key).toBe('phc_test');
    expect(body.batch).toHaveLength(2);
    expect(body.batch[0].distinct_id).toBe('abc');
    expect(body.batch[0].timestamp).toBe('2026-10-26T09:00:00.000Z');
    expect(body.batch[0].properties.$process_person_profile).toBe(false);
    expect(JSON.stringify(body)).not.toContain('09:41');
  });
});
