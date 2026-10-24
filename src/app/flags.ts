/**
 * Feature flags and kill switches. Everything network-related is OFF unless configured at build time,
 * so a plain `npm run build` produces a fully local, zero-cost app.
 *
 * Build-time (Vite) variables — see .env.example:
 *   VITE_COMMUNITY_API_URL     Base URL of the anonymous results API (empty = disabled)
 *   VITE_ANALYTICS_PROVIDER    'none' (default) | 'posthog'
 *   VITE_POSTHOG_HOST          e.g. https://eu.i.posthog.com
 *   VITE_POSTHOG_KEY           Project API key (public, write-only)
 *   VITE_KILL_COMMUNITY        '1' disables submissions and stats even if the URL is set
 *   VITE_KILL_ANALYTICS        '1' disables analytics even if configured
 *   VITE_REMINDERS             'off' hides the reminder feature (default on)
 */
const env = import.meta.env as Record<string, string | undefined>;

function on(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'on';
}

export const flags = {
  communityApiUrl: (env.VITE_COMMUNITY_API_URL ?? '').replace(/\/+$/, ''),
  communityEnabled: Boolean(env.VITE_COMMUNITY_API_URL) && !on(env.VITE_KILL_COMMUNITY),
  analyticsProvider: (env.VITE_ANALYTICS_PROVIDER ?? 'none') as 'none' | 'posthog',
  analyticsConfigured: env.VITE_ANALYTICS_PROVIDER === 'posthog' && Boolean(env.VITE_POSTHOG_KEY) && Boolean(env.VITE_POSTHOG_HOST) && !on(env.VITE_KILL_ANALYTICS),
  posthogHost: (env.VITE_POSTHOG_HOST ?? '').replace(/\/+$/, ''),
  posthogKey: env.VITE_POSTHOG_KEY ?? '',
  remindersEnabled: env.VITE_REMINDERS !== 'off',
  /** Minimum accepted official results before community percentages are shown (mirrors the backend default). */
  communityMinCohort: 25,
} as const;

export type Flags = typeof flags;
