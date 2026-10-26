/** Analytics types for the adapters (the dictionary itself is the root contract in src/contracts/analytics.ts). */
import type { AnalyticsEventName, AnalyticsProps } from '@/contracts';

export { ANALYTICS_PROP_KEYS } from '@/contracts';
export type { AnalyticsProps } from '@/contracts';
export type AnalyticsEvent = AnalyticsEventName;

export interface AnalyticsAdapter {
  /** Never throws. */
  track(event: AnalyticsEvent, props?: AnalyticsProps): void;
  flush?(): Promise<void>;
}
