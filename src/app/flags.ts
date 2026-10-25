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
 *   VITE_LITE_TRADE_RESULTS    '1' turns on the Lite trade-results experiment (default off): a friend who answers a
 *                              dare still sees their own score and the full reveal at once, but "who won" against
 *                              the sender unlocks only after they send their result back
 *   VITE_LITE_VERIFIED_DARES   '1' turns on verified dares (default off). Takes effect only with the community API
 *                              configured, VITE_DARE_PUBLIC_KEY set and the community kill switch off; players must
 *                              also have opted in to community sharing (checked by src/community/liteDares.ts)
 *   VITE_DARE_PUBLIC_KEY       P-256 public key that checks verified-dare signatures offline: the uncompressed point
 *                              as 130 hex characters (04…), printed by scripts/lite-dare-keys.mjs. Public, not secret
 *   VITE_DARE_PUBLIC_KEYS      More public keys (comma or space separated), e.g. old and new during a key rotation;
 *                              every signature names its key by id, so all listed keys are accepted
 */
const env = import.meta.env as Record<string, string | undefined>;

function on(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'on';
}

const communityApiUrl = (env.VITE_COMMUNITY_API_URL ?? '').replace(/\/+$/, '');
const communityEnabled = Boolean(env.VITE_COMMUNITY_API_URL) && !on(env.VITE_KILL_COMMUNITY);
const publicKeysOf = (raw: string | undefined) =>
  (raw ?? '')
    .split(/[\s,]+/)
    .map((k) => k.trim().toLowerCase())
    .filter((k) => /^04[0-9a-f]{128}$/.test(k));
const darePublicKeys: readonly string[] = [...new Set([...publicKeysOf(env.VITE_DARE_PUBLIC_KEY), ...publicKeysOf(env.VITE_DARE_PUBLIC_KEYS)])];
const darePublicKey = darePublicKeys[0] ?? '';

export const flags = {
  communityApiUrl,
  communityEnabled,
  analyticsProvider: (env.VITE_ANALYTICS_PROVIDER ?? 'none') as 'none' | 'posthog',
  analyticsConfigured: env.VITE_ANALYTICS_PROVIDER === 'posthog' && Boolean(env.VITE_POSTHOG_KEY) && Boolean(env.VITE_POSTHOG_HOST) && !on(env.VITE_KILL_ANALYTICS),
  posthogHost: (env.VITE_POSTHOG_HOST ?? '').replace(/\/+$/, ''),
  posthogKey: env.VITE_POSTHOG_KEY ?? '',
  remindersEnabled: env.VITE_REMINDERS !== 'off',
  /** Lite experiment, off by default: "who won" on a dare unlocks after the friend sends their result back. */
  liteTradeResults: on(env.VITE_LITE_TRADE_RESULTS),
  /** Every accepted verified-dares public key (uncompressed P-256 points, lowercase hex); malformed ones are dropped. */
  darePublicKeys,
  /** The first accepted public key, or '' when none (kept for callers that only need "is a key configured"). */
  darePublicKey,
  /**
   * Verified dares are on for this build: community API configured, kill switch off, VITE_LITE_VERIFIED_DARES on and
   * a well-formed public key. Players must still opt in to community sharing (verifiedDaresEnabled in liteDares.ts).
   */
  liteVerifiedDares: communityEnabled && Boolean(communityApiUrl) && on(env.VITE_LITE_VERIFIED_DARES) && darePublicKeys.length > 0,
  /** Minimum accepted official results before community percentages are shown (mirrors the backend default). */
  communityMinCohort: 25,
} as const;

export type Flags = typeof flags;
