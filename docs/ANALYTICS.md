# Analytics

Status: Phase 3. Platform-owned (the dictionary itself is the root contract `src/contracts/analytics.ts`).

## Rules

* **Closed dictionary.** Only the 28 contract events can be sent; `src/analytics/events.ts` lists them at runtime and
  the compiler checks the list against the contract. Unknown names are dropped.
* **Closed property values.** Every property has a fixed vocabulary or pattern (`PROP_RULES`); anything else is
  dropped, so free text, ids, names, times, plans or results cannot reach a provider even by mistake.
* **Never sent**: hidden strategies (before or after a reveal), runs or wickets before a reveal, message or banter
  text, contacts, aliases, player or match ids, exact timestamps (events carry the hour), device identifiers, IP
  addresses (PostHog person profiles off: `$process_person_profile: false`).
* **IP addresses.** Every event carries `$geoip_disable: true`, so PostHog derives no location from it. The capture
  API still receives the connection's IP with each request and cannot be told per event not to keep it, so the
  project owner must turn on **"Discard client IP data"** in the PostHog project settings before analytics is
  enabled anywhere (a launch requirement, not optional).
* **Off by default.** Events are sent only when (1) `VITE_ANALYTICS_PROVIDER=posthog` with `VITE_POSTHOG_HOST`
  (https) and `VITE_POSTHOG_KEY`, (2) no `VITE_KILL_ANALYTICS=1`, (3) no Do-Not-Track / Global Privacy Control
  signal, and (4) the player opted in (`analytics.setConsent('granted')`). Declining has no effect on gameplay,
  rewards or features.
* **Identity.** A random id per install that changes every calendar month (`vc:analytics-id`), never the player id;
  withdrawing consent deletes it. Retention events are emitted by the device from its local first-open day, so no
  long-lived id is needed.
* **Kept on the device only, never sent**: the first-open day (`vc:first-open`, a date), which retention events
  were sent (`vc:retention-sent`) and which cup milestones were sent (`vc:cup-events`, cup ids). Deleting the app's
  local data deletes them.

## Usage

```ts
import { connectAnalytics, createAnalytics } from '@/analytics';
const analytics = createAnalytics({ base: () => ({ platform: 'android', appVersion: __APP_VERSION__, locale: 'hi' }) });
connectAnalytics(analytics, platform);               // once at boot: tapped reminders and attributed installs
analytics.setConsent('granted');                     // from the consent sheet (Experience owns the UI)
analytics.track('invite_created', { mode: 'duel', channel: 'whatsapp' });
```

`createAnalytics` itself sends the retention events (on each app open and return to the foreground) and `crash`
(window errors and unhandled promise rejections, at most three of each per session).

`track` never throws and never blocks; PostHog events are batched (10) and flushed on a timer or on `pagehide`
(`sendBeacon`).

## Events

| Event | When | Useful properties |
| --- | --- | --- |
| `tutorial_started` / `tutorial_completed` | Training starts / ends | `mode: training`, `durationBucket` |
| `first_delivery` | First ball ever bowled or faced on the device | `mode` |
| `invite_created` / `invite_opened` / `invite_accepted` | Duel or cup invite made / link opened / accepted | `mode`, `channel`, `attribution` |
| `over_locked` | An over is sealed | `mode`, `stage` |
| `innings_completed` | The player finished batting | `mode`, `durationBucket` |
| `reveal_watched` / `replay_completed` | Reveal opened / a replay played to the end | `mode`, `quality` |
| `tournament_joined` / `tournament_completed` | The cup screen first shows a cup the player is a member of (the creator too) / that cup is complete; once per cup on the device | `mode: cup`; `stage` final (played in the final) or group, on completion |
| `reminder_sent` / `reminder_opened` | A WhatsApp deadline reminder opened from the match screen / a deadline reminder push tapped (`connectAnalytics`) | `mode` duel or cup |
| `share_initiated` / `share_completed` | Share sheet opened / it reported success (the once-per-moment cap is kept by the server, `POST /v1/matches/:id/moments`, and not measured here) | `channel`, `mode` |
| `highlight_consent` | Highlight consent decided | `decision` |
| `attributed_view` / `attributed_install` | A highlight or invite link led to a view / an install (the Play install referrer at the first launch, through `connectAnalytics`) | `attribution` |
| `attributed_challenge` | "Challenge a friend" tapped on a highlight landing (it fires on the tap; the duel screen then creates the duel with the code, which the server counts as `match_completed` once played) | `attribution` |
| `rematch` | Rematch requested | `mode` |
| `retention_d1` / `retention_d7` / `retention_d30` | An app open on or after 1 / 7 / 30 days from this device's local first-open day (device-computed, once each; without consent nothing is sent or marked, so a pending one goes at the first open after opting in) | `platform` |
| `notification_opt_out` | Notifications turned off | — |
| `group_mute` | A Cricket Room muted | — |
| `crash` | A window error (`reason: error`) or an unhandled promise rejection (`reason: rejection`); never a message, stack or URL; at most three of each per session | `reason`, `platform`, `appVersion` |
| `renderer_fallback` | 3D renderer unavailable or degraded | `reason`, `quality` |

A highlight going live is not a client event: it happens on the server, which counts it in Workers Analytics Engine
(`highlight_status` published).

Property vocabularies: `mode` training/daily/duel/cup/ghost · `platform` web/pwa/android · `appVersion` semver ·
`locale` the 11 locale ids · `quality` low/standard/high/2d · `channel` share_sheet/whatsapp/copy/qr · `decision`
granted/declined/withdrawn · `stage` group/final · `durationBucket` <30s/30-60s/1-2m/2-5m/>5m · `fpsBucket`
<20/20-29/30-44/45-59/60+ · `reason` no_webgl/context_lost/low_fps/error/rejection · `attribution` 4–16 lowercase letters or
digits.

## Server-side counters (operations, not product analytics)

The Worker counts lifecycle and abuse signals in Workers Analytics Engine (`backend/src/ops/metrics.ts`): `request`,
`error`, `rate_limited`, `idempotent_replay`, `guest_created`, `guest_refused_age` (a sign-up without the 18+
confirmation), `refresh_rotated`, `refresh_reuse_revoked`,
`account_linked`, `account_deleted`, `duel_created`, `invite_accepted`, `over_locked`, `ball_revealed`,
`ball_resolved` (live/late/expired/invalid/auto/deadline/leave), `match_revealed`, `match_expired`, `auto_over`,
`auto_xi`, `index_sync_failed`, `notify_sent`, `notify_dead_letter`, `engine_error`, and for the social product
`room_post` (by kind), `room_muted`, `cup_created` (by pace), `cup_joined`, `cup_started` (by size), `cup_cancelled`,
`cup_round_revealed`, `cup_completed`, `daily_attempt`, `daily_finished`, `leaderboard_read` (by scope),
`notify_dropped` (by reason: opt_out, room_muted, room_important_only, quiet_hours, routine_cap, daily_cap) and
`notify_deferred` (by kind), and for wave C `timing_suspicious`, `top100_frozen`, `highlight_status` (by status),
`render_claimed`, `upload_resumed`, `quota_overflow`, `youtube_error` (by kind), `attribution` (by event),
`admin_action` (by action) and `media_dead_letter`, and `match_shared` (by kind), `share_moment` and
`share_moment_refused` (by moment: the server-side share cap). Labels are route patterns, error codes, scopes and kinds; never
ids. High-volume counters are sampled 1 in 10 with weight 10. Query examples: docs/INFRASTRUCTURE.md, "Operations".

## Highlight attribution (server counters, not product analytics)

`POST /v1/attribution` (anonymous) counts `landing_open`, `share` and `install` per highlight code per IST day in D1
`attribution_daily`; the server itself adds `invite_open` and `match_completed` for duels created with
`attributionCode`, and `views` (daily deltas from YouTube statistics). No person, device, address or session is
stored, only (code, day, event, count), so it needs no analytics consent and works with analytics off. The client
side is `src/net/attribution.ts` (`net.attribution.report(code, event)`: one landing open per code per app session,
an attributed install once per device, failures silent). The consented analytics events `attributed_view`,
`attributed_install` and `attributed_challenge` (the landing's challenge tap, before any duel exists) stay separate and
optional. Read the counters in the admin console
(job detail → Attribution).

## Tests

`tests/unit/platform/analytics.test.ts`: the dictionary size, value filtering, consent/kill-switch/DNT gating,
monthly id rotation and deletion on withdrawal, the PostHog batch shape (hour timestamps, no person profiles).
