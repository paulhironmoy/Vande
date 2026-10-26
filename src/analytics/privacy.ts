import { ANALYTICS_PROP_KEYS, type AnalyticsProps } from './types';
import { PROP_RULES } from './events';

export const MAX_VALUE_LENGTH = 32;

/** True when the browser asks not to be tracked (Do Not Track or Global Privacy Control). */
export function privacySignalBlocks(nav: Partial<Navigator> & { globalPrivacyControl?: boolean } = typeof navigator !== 'undefined' ? navigator : {}): boolean {
  const dnt = (nav as { doNotTrack?: string | null }).doNotTrack ?? (typeof window !== 'undefined' ? (window as Window & { doNotTrack?: string }).doNotTrack : undefined);
  if (dnt === '1' || dnt === 'yes') return true;
  if (nav.globalPrivacyControl === true) return true;
  return false;
}

/**
 * Keeps only dictionary keys whose values match their closed vocabulary or pattern (PROP_RULES); everything else is
 * dropped, so free text, ids, times or hidden-strategy fields can never reach a provider. Never throws.
 */
export function sanitizeProps(props: AnalyticsProps | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props || typeof props !== 'object') return out;
  for (const key of ANALYTICS_PROP_KEYS) {
    const value = (props as Record<string, unknown>)[key];
    if (typeof value !== 'string' || value.length > MAX_VALUE_LENGTH) continue;
    const rule = PROP_RULES[key];
    if (Array.isArray(rule) ? rule.includes(value) : (rule as RegExp).test(value)) out[key] = value;
  }
  return out;
}

/** Coarse UTC timestamp: the hour, never minutes or seconds. */
export function coarseTimestamp(now = new Date()): string {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

export function monthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
