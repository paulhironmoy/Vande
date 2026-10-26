/**
 * PostHog over its public HTTP capture API (no SDK, no autocapture, no session replay, no cookies).
 * Events are batched (≤ 10) and flushed on a short timer or on pagehide with sendBeacon.
 *
 * IP addresses: events go from the device, so PostHog's servers see its address. Every event asks PostHog not to
 * look it up (`$geoip_disable`), and no person profile is made; storing no address at all needs the project setting
 * "Discard client IP data", which the owner must turn on before analytics are enabled (docs/PRIVACY_AND_CONSENT.md).
 * The capture API has no per-event switch that stops the address being received.
 */
import type { AnalyticsAdapter, AnalyticsEvent } from './types';
import { coarseTimestamp } from './privacy';

export interface PostHogOptions {
  host: string;
  key: string;
  distinctId: string;
  batchSize?: number;
  flushMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface QueuedEvent {
  event: AnalyticsEvent;
  properties: Record<string, string | number | boolean>;
  timestamp: string;
}

export function createPostHogAdapter(opts: PostHogOptions): AnalyticsAdapter & { queueSize(): number } {
  const batchSize = opts.batchSize ?? 10;
  const flushMs = opts.flushMs ?? 4000;
  const queue: QueuedEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const endpoint = `${opts.host.replace(/\/+$/, '')}/batch/`;

  function payload(events: QueuedEvent[]): string {
    return JSON.stringify({
      api_key: opts.key,
      batch: events.map((e) => ({
        event: e.event,
        distinct_id: opts.distinctId,
        timestamp: e.timestamp,
        properties: { ...e.properties, $lib: 'vande', $process_person_profile: false, $geoip_disable: true },
      })),
    });
  }

  async function send(events: QueuedEvent[], beacon = false): Promise<void> {
    if (events.length === 0) return;
    const body = payload(events);
    try {
      if (beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
        return;
      }
      const f = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
      if (!f) return;
      await f(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true });
    } catch {
      /* analytics must never surface errors */
    }
  }

  async function flush(beacon = false): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    const events = queue.splice(0, queue.length);
    await send(events, beacon);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      void flush(true);
    });
  }

  return {
    track(event, props) {
      try {
        queue.push({ event, properties: { ...(props as Record<string, string | number | boolean>) }, timestamp: coarseTimestamp(opts.now?.() ?? new Date()) });
        if (queue.length >= batchSize) void flush();
        else if (!timer) timer = setTimeout(() => void flush(), flushMs);
      } catch {
        /* ignore */
      }
    },
    flush: () => flush(false),
    queueSize: () => queue.length,
  };
}
