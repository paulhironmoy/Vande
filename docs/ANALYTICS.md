# Analytics — event dictionary and privacy rules

Analytics are **off by default** and stay off unless a build sets `VITE_ANALYTICS_PROVIDER=posthog`,
`VITE_POSTHOG_HOST` and `VITE_POSTHOG_KEY`. Even then: the player can opt out (Settings → Help improve VANDE), a
Do-Not-Track or Global Privacy Control signal disables it, `VITE_KILL_ANALYTICS=1` disables it at build time, and a
failing network never affects play. No SDK is loaded; events go to PostHog's HTTP `/batch/` endpoint (≤ 10 per batch,
`sendBeacon` on page hide). No autocapture, no session replay, no cookies, no person profiles
(`$process_person_profile: false`).

## Identity

`distinct_id` = first 32 hex of `sha256(installId + ':' + YYYY-MM)` — the random installation id hashed with the
current month, so it rotates monthly. That is enough for Day-1/Day-7 retention within a month and prevents long-term
tracking. "Reset anonymous id" in Settings changes it immediately.

## Events

| Event | When | Extra properties |
| --- | --- | --- |
| `app_opened` | app shell mounted | `returnGap` |
| `daily_entry_viewed` | Home/Daily entry rendered with today's state | `dailyId` |
| `daily_started` | player leaves the cold open | `dailyId`, `official` |
| `first_choice_reached` | first decision answered | `dailyId`, `elapsedBucket` |
| `daily_completed` | daily chapter ended | `dailyId`, `official`, `elapsedBucket`, `state` |
| `official_result_viewed` | result screen shown for an official attempt | `dailyId` |
| `daily_shared` | share sheet action succeeded | `dailyId`, `official`, `shareMethod` |
| `challenge_opened` | challenge screen decoded a code | `dailyId` |
| `challenge_started` | challenge accepted | `dailyId` |
| `challenge_completed` | challenge run finished | `dailyId`, `official` |
| `calendar_viewed` / `passport_viewed` | screens opened | — |
| `reminder_enabled` / `reminder_disabled` | setting toggled | — |
| `subsequent_day_return` | first open on a later day than the previous session | `returnGap` |

Common properties on every event: `appVersion`, `platform` (`web` / `pwa` / `android`), `mode` (`simple` / `full`),
`contentVersion` when relevant. Timestamps are rounded to the hour. The full closed list lives in
`src/analytics/types.ts`; `sanitizeProps` drops anything else and truncates strings to 32 characters.

## Never sent

Decision or option text, free text, names, emails, precise timestamps, location, device fingerprints, IP-derived data,
advertising identifiers, cross-site identifiers.

## Retention

PostHog retains events per its plan (free tier: 1 year). Keep the project's data retention at the minimum the
dashboards need (90 days is sufficient for the metrics in `docs/DAILY-DESIGN.md`).

## Replacing the provider

Implement `AnalyticsAdapter` (`src/analytics/types.ts`) and select it in `configureAnalytics` (`src/analytics/index.ts`).
A self-hosted collector only needs an HTTP endpoint that accepts the same batch shape.

## Metrics derived from these events (post-launch, never hard-coded)

Reach-first-choice rate = `first_choice_reached` / `daily_entry_viewed`; median time to first choice from
`elapsedBucket`; completion rate = `daily_completed(completed)` / `daily_started`; D1/D7 retention from
`subsequent_day_return` with `returnGap`; share rate = `daily_shared` / `daily_completed`; challenge funnel from the
three challenge events; Simple vs Full completion by `mode`.

## Event timing notes

* `first_choice_reached` fires when the first decision becomes visible (the player can act), with `elapsedBucket`
  measured from `daily_started`.
* `daily_completed` carries `elapsedBucket` measured from `daily_started` and `state: 'completed'`.
* `platform` is `android` in the Capacitor app, `pwa` when the web app runs in standalone display mode, otherwise `web`.
* Rotating the anonymous id in Settings reconfigures analytics immediately; the distinct id changes at once.

## Lite (gamified Chapter 1) events

| Event | When | Properties |
| --- | --- | --- |
| `lite_completed` | A Lite run reaches its result card | `mode`, `elapsedBucket`, `state: 'completed'` |
| `lite_shared` | The player shares a Lite challenge | `shareMethod` |
| `lite_challenge_opened` | A `/lite/<code>` challenge link is opened | none |

Lite challenge codes (`L1-…`) contain only a seed, a points total and a star count; no identifiers.
