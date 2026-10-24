/**
 * Analytics entry point. Off unless a provider is configured at build time, the player has not opted out,
 * and the browser sends no Do-Not-Track / Global Privacy Control signal. Only dictionary events and keys are sent.
 */
import { flags } from '@/app/flags';
import { noopAdapter } from './adapter';
import { createPostHogAdapter } from './posthog';
import { monthKey, privacySignalBlocks, sanitizeProps } from './privacy';
import type { AnalyticsAdapter, AnalyticsEvent, AnalyticsProps } from './types';

export * from './types';
export { privacySignalBlocks, sanitizeProps } from './privacy';

interface AnalyticsContext {
  appVersion?: string;
  platform?: AnalyticsProps['platform'];
  mode?: AnalyticsProps['mode'];
}

let adapter: AnalyticsAdapter = noopAdapter;
let configured = false;
let enabled = false;
let optedOut = false;
let context: AnalyticsContext = {};
let provider: 'none' | 'posthog' = 'none';

function recompute(): void {
  enabled = configured && !optedOut && !privacySignalBlocks();
}

/** Called once by the app shell with the anonymous install id and build info. Safe to call again. */
export async function configureAnalytics(input: { installId: string; appVersion: string; platform: AnalyticsProps['platform']; optOut: boolean; mode?: AnalyticsProps['mode'] }): Promise<void> {
  context = { appVersion: input.appVersion, platform: input.platform, mode: input.mode };
  optedOut = input.optOut;
  configured = false;
  provider = 'none';
  adapter = noopAdapter;
  try {
    if (flags.analyticsConfigured && flags.analyticsProvider === 'posthog') {
      const { sha256Hex } = await import('@/community/hash');
      const distinctId = (await sha256Hex(`${input.installId}:${monthKey()}`)).slice(0, 32);
      adapter = createPostHogAdapter({ host: flags.posthogHost, key: flags.posthogKey, distinctId });
      configured = true;
      provider = 'posthog';
    }
  } catch {
    adapter = noopAdapter;
    configured = false;
  }
  recompute();
}

/** Updates the context sent with every event (e.g. when the play style changes). */
export function setAnalyticsContext(patch: AnalyticsContext): void {
  context = { ...context, ...patch };
}

export function setAnalyticsEnabled(value: boolean): void {
  optedOut = !value;
  recompute();
}

export function analyticsStatus(): { configured: boolean; enabled: boolean; provider: 'none' | 'posthog' } {
  return { configured, enabled, provider };
}

/** Records an event. Never throws; a no-op unless analytics are configured, enabled and allowed. */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (!enabled) return;
  try {
    adapter.track(event, sanitizeProps({ ...context, ...props }) as AnalyticsProps);
  } catch {
    /* ignore */
  }
}

export async function flushAnalytics(): Promise<void> {
  try {
    await adapter.flush?.();
  } catch {
    /* ignore */
  }
}

/** Test hook: replaces the adapter and forces the configured/enabled state. */
export function __setAnalyticsAdapterForTests(next: AnalyticsAdapter | null, state?: { configured?: boolean; optOut?: boolean }): void {
  adapter = next ?? noopAdapter;
  configured = state?.configured ?? Boolean(next);
  optedOut = state?.optOut ?? false;
  provider = next ? 'posthog' : 'none';
  recompute();
}
