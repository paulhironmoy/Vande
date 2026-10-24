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

Runtime (player-controlled) switches, all in Settings and persisted locally:

| Setting | Default | Notes |
| --- | --- | --- |
| Share anonymous results (`communitySharing`) | unset (off) | Asked once after the first official daily result; results are only submitted and statistics only requested when **on**. |
| Help improve VANDE (`analyticsOptOut`) | on when configured | Shown only when a provider is configured; Do Not Track / Global Privacy Control also disable analytics. |
| Daily reminder (`remindersEnabled`, `reminderHour`) | off | Local notifications on Android only; no server. |
| Anonymous id | generated locally | "Replace my anonymous id" in Settings; also replaced by "Delete all local data". |

Backend variables (`backend/wrangler.toml` `[vars]` / secrets): `ALLOWED_ORIGINS`, `MIN_COHORT` (25), `CONTENT_VERSIONS`
allow-list, `RATE_SALT` (secret; **required** — without it POST returns 503 unless `ALLOW_UNLIMITED_WRITES=1`),
`RATE_LIMIT_PER_MINUTE` (30), `RATE_LIMIT_READS_PER_MINUTE` (120). See `docs/BACKEND.md`.

## Emergency kill switches (no redeploy of the app needed where noted)

1. **Backend down or abusive traffic**: set `KILL=1` … not available; instead disable the Worker route in the Cloudflare
   dashboard or deploy with `MIN_COHORT=999999` to stop serving percentages. The app degrades silently (queue, then drop
   after 14 days / 10 attempts).
2. **Stop submissions from clients**: rebuild with `VITE_KILL_COMMUNITY=1` (or unset the URL) and deploy; existing
   installs keep queuing locally until they update, then drop the queue.
3. **Analytics**: rebuild with `VITE_KILL_ANALYTICS=1`, or revoke the PostHog key in PostHog (clients fail silently).
4. **Content emergency** (a daily is wrong): edit the day file, bump `contentVersion`, keep `schedule.pinned` for past
   dates so old records stay reproducible; validate with `node scripts/validate-daily.mjs`.

## Local development

```bash
npm run dev                                   # everything local; community/analytics disabled
VITE_COMMUNITY_API_URL=http://127.0.0.1:8787 npm run dev   # against `npm run dev` in backend/ (wrangler dev)
```
Copy `.env.example` to `.env.local` for persistent settings. Never commit `.env*` or `backend/.dev.vars`.
