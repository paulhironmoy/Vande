/**
 * Analytics entry point. The lead provides this no-op placeholder; the analytics package replaces the
 * internals with the configured adapter while keeping these exports stable.
 */
import type { AnalyticsEvent, AnalyticsProps } from './types';

export * from './types';

export function track(_event: AnalyticsEvent, _props?: AnalyticsProps): void {
  /* no-op until an adapter is configured */
}

export function setAnalyticsEnabled(_enabled: boolean): void {
  /* no-op */
}

export function analyticsStatus(): { configured: boolean; enabled: boolean; provider: 'none' | 'posthog' } {
  return { configured: false, enabled: false, provider: 'none' };
}
