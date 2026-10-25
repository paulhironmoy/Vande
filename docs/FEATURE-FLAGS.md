# Feature flags, environment variables and kill switches

All network features are **off** unless configured at build time. A plain `npm run build` produces a fully local,
zero-cost app: no community submissions, no statistics requests, no analytics.

| Variable (build time, Vite) | Default | Effect |
| --- | --- | --- |
| `VITE_COMMUNITY_API_URL` | empty | Base URL of the anonymous results API (Cloudflare Worker). Empty = community features disabled: no requests, honest "not enabled" copy. |
| `VITE_KILL_COMMUNITY` | unset | `1` disables submissions and statistics even when the URL is set (emergency switch). |
| `VITE_ANALYTICS_PROVIDER` | `none` | `posthog` enables the HTTP analytics adapter (requires host + key). |
| `VITE_POSTHOG_HOST` / `VITE_POSTHOG_KEY` | empty | PostHog ingestion host and public write-only project key. |
| `VITE_KILL_ANALYTICS` | unset | `1` disables analytics even when configured. |
| `VITE_REMINDERS` | `on` | `off` hides the reminder feature entirely. |
| `VITE_LITE_TRADE_RESULTS` | unset (off) | Experiment: `1` makes "who won" on a Lite dare unlock only after the friend sends their result back. Their own score and the full reveal always show at once. Measure with `lite_reply_sent` (`tradeResults`). |
| `VITE_LITE_VERIFIED_DARES` | unset (off) | `1` turns on verified dares: the community API draws and grades the friend's twist and signs the reply (`docs/BACKEND.md`). Takes effect only with `VITE_COMMUNITY_API_URL`, at least one valid public key (`VITE_DARE_PUBLIC_KEYS` or `VITE_DARE_PUBLIC_KEY`) and `VITE_KILL_COMMUNITY` unset, and only for players who switched on **Share anonymous results**. |
| `VITE_DARE_PUBLIC_KEYS` | empty | P-256 public keys (uncompressed points, `04` + 128 hex each, separated by commas or spaces) that check verified-dare signatures offline. Public. Each signature names its key by id, so during a rotation the build lists the old and the new key (`docs/ROLLBACK.md`). Malformed entries are ignored and duplicates dropped. |
| `VITE_DARE_PUBLIC_KEY` | empty | One public key, as printed by `node scripts/lite-dare-keys.mjs`; merged with `VITE_DARE_PUBLIC_KEYS`. A malformed value counts as missing (with no valid key, verified dares stay off). |

Runtime (player-controlled) switches, all in Settings and persisted locally:

| Setting | Default | Notes |
| --- | --- | --- |
| Share anonymous results (`communitySharing`) | unset (off) | Asked once after the first official daily result; results are only submitted and statistics only requested when **on**. |
| Help improve VANDE (`analyticsOptOut`) | on when configured | Shown only when a provider is configured; Do Not Track / Global Privacy Control also disable analytics. |
| Daily reminder (`remindersEnabled`, `reminderHour`) | off | Local notifications on Android only; no server. |
| Anonymous id | generated locally | "Replace my anonymous id" in Settings; also replaced by "Delete all local data". |

Backend variables (`backend/wrangler.toml` `[vars]`, secrets and bindings; see `docs/BACKEND.md`):

| Variable | Default | Effect |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | the Pages origin, `https://localhost`, `capacitor://localhost` | Browser origins allowed by CORS |
| `MIN_COHORT` | 25 | Results needed before percentages show |
| `CONTENT_VERSIONS` | empty | Allow-list of daily content versions; empty accepts any well-formed one |
| `RATE_SALT` | secret, **required** | Salt for the rate-limit keys; without it POST answers 503 |
| `ALLOW_UNLIMITED_WRITES` | unset | `1` accepts writes without a salt, for local development only (warns once per isolate) |
| `RATE_LIMIT_PER_MINUTE` | 30 | Result submissions per network (IPv4 address or IPv6 /64) per minute, D1 fallback |
| `RATE_LIMIT_READS_PER_MINUTE` | 120 | Uncached stats and goal reads per network per minute, D1 fallback |
| `RATE_LIMIT_DARES_PER_MINUTE` | 60 | Verified-dare start + grade per network per minute, D1 fallback |
| `RATE_LIMIT_GLOBAL_WRITES_PER_MINUTE` | 1200 | All POSTs together (key `all-writes`): the ceiling address rotation cannot pass, D1 fallback |
| `RATE_LIMIT_GLOBAL_READS_PER_MINUTE` | 2400 | All uncached reads together (key `all-reads`), D1 fallback |
| `RL_WRITE`, `RL_READ`, `RL_DARE`, `RL_GLOBAL` | bindings in `[[ratelimits]]` (30, 120, 60 and 1,200 a minute) | Workers Rate Limiting bindings: the production limiter, with no D1 writes; their own limits apply per Cloudflare location. Without one, the matching D1 fallback above applies |
| `CLEANUP_MAX_QUERIES` | 45 | D1 statements one daily cleanup may run (2,000 rows each). Raise it on Workers Paid as traffic grows (`docs/COST.md`) |
| `DARE_SIGNING_KEY` | secret, **required** for verified dares | P-256 private JWK; without it (or if unusable) the dare endpoints answer 503 |
| `KILL_LITE_DARES` | `0` | `1` switches the dare endpoints off (503) |
| `LITE_VERIFY_REPLAY` | `0` | `1` replays each dare before signing (marker `v`; needs Workers Paid); `0` signs `t` |
| `LITE_GOAL_PER_ADDRESS_PER_DAY` | 3 | Replay-verified answers one network can add to the daily goal; `0` turns the goal off |
| `[observability]` | `enabled = false`, `invocation_logs = false` | Workers Logs off, because they would keep per-request records. Turning them on is a privacy change: update `docs/PRIVACY.md` first (`docs/BACKEND.md`, "Logs and observability") |

## Emergency kill switches (no redeploy of the app needed where noted)

1. **Backend down or abusive traffic**: set `KILL=1` … not available; instead disable the Worker route in the Cloudflare
   dashboard or deploy with `MIN_COHORT=999999` to stop serving percentages. The app degrades silently (queue, then drop
   after 14 days / 10 attempts).
2. **Stop submissions from clients**: rebuild with `VITE_KILL_COMMUNITY=1` (or unset the URL) and deploy; existing
   installs keep queuing locally until they update, then drop the queue.
3. **Analytics**: rebuild with `VITE_KILL_ANALYTICS=1`, or revoke the PostHog key in PostHog (clients fail silently).
4. **Verified dares**: set `KILL_LITE_DARES = "1"` and redeploy the Worker, or delete the `DARE_SIGNING_KEY` secret
   (no redeploy): start and grade answer 503 and apps fall back to local twists and unsigned replies at once. To stop
   clients asking at all, rebuild without `VITE_LITE_VERIFIED_DARES`.
5. **Content emergency** (a daily is wrong): edit the day file, bump `contentVersion`, keep `schedule.pinned` for past
   dates so old records stay reproducible; validate with `node scripts/validate-daily.mjs`.

## Local development

```bash
npm run dev                                   # everything local; community/analytics disabled
VITE_COMMUNITY_API_URL=http://127.0.0.1:8787 npm run dev   # against `npm run dev` in backend/ (wrangler dev)
```
Copy `.env.example` to `.env.local` for persistent settings. Never commit `.env*` or `backend/.dev.vars`.
