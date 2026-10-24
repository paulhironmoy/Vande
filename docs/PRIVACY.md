# VANDE — Privacy

**Short version: everything about your game stays on your device. Two optional features — anonymous community
results and product analytics — are off until you (or a build) turn them on, and neither carries anything that
identifies you.**

VANDE: Republic Under Pressure is an independent game, not affiliated with, endorsed by or connected to the Government of
India, any political party or any public institution.

## Data flow

| What | When | Where it goes | Identifier | Retention | Your control |
| --- | --- | --- | --- | --- | --- |
| Progress, results, history, bests, Republic condition, daily records (official and practice), Civic Passport, settings | always | your device only (IndexedDB / app storage) | none | until you delete | Settings → export / delete |
| Random installation id | created on first use | your device only | — | until reset or delete | Settings → Reset anonymous id |
| Official daily result: day id, content version, score, outcome, strategy letters, play style, app version, platform, per-day one-way code | only after you turn on **Share anonymous results**, after each official completion | Cloudflare Worker + D1 (`docs/BACKEND.md`) | `sha256(installation id + day)[0..32]` — differs every day, cannot be reversed | 180 days raw; aggregates recomputed, not stored | turn the setting off; delete all data clears the queue (server rows cannot be linked to you, so they cannot be deleted on request) |
| Analytics events (`docs/ANALYTICS.md`) | only in builds configured for analytics, unless you opt out or send Do-Not-Track / GPC | PostHog (HTTP, no SDK, no cookies) | monthly-rotating hash of the installation id | provider setting (≤ 1 year; recommended 90 days) | Settings → Help improve VANDE |
| Share cards and challenge links | only when you share | your device's share sheet | none (a daily link holds the date and, optionally, your score and pattern) | — | you choose what to share |
| Local reminders | only if you enable them | your device's notification system | none | — | Settings → Reminders |

Never collected: name, email, phone, contacts, precise location, advertising identifiers, device fingerprints, free text,
decision text, raw IP addresses beyond the transient processing Cloudflare performs to deliver a request (rate-limit
keys are salted hashes kept for 24 hours).

## Offline by design

After the first visit the game is cached and plays without a connection. Community submissions made offline wait in a
local queue and are sent later only if sharing is still on. Fonts and all assets are bundled.

## Android

The app requests only the network permission the WebView needs. Automatic backup is off. Share images are written to the
app's cache folder for the share sheet; clear it from system settings any time. Data-safety form summary: no data shared
with third parties; optional app-interaction data (analytics) and optional anonymous gameplay results, both user-controlled.

## Content

Scenarios, characters, institutions and events are fictional. Rights moments are educational content, not legal advice.

## Changes

If this policy changes, the new version ships with the app and is dated below.

*Last updated: 2026-10-24 · Contact: open an issue at https://github.com/paulhironmoy/Vande/issues*

## Community comparison requests

When a build is configured with a community API **and** you have switched on "Share anonymous results", the app also
requests the day's aggregate statistics (`GET /v1/daily/<date>/stats`). That request carries only the date and the
content version; like any web request, your IP address reaches Cloudflare for the duration of the request and is not
stored by VANDE. If sharing is off, no statistics are requested and no results are sent. Everything still works offline:
your results are kept on your device and queued submissions are sent later (or dropped after 14 days or 10 failed tries).

## Android permissions (reminders)

The optional daily reminder uses local notifications only. The Android app declares `POST_NOTIFICATIONS`,
`SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED` and `WAKE_LOCK` for that purpose; nothing is sent to any server,
and the reminder is off until you turn it on in Settings. Play Data safety: no data collected by default; optional
anonymous results and optional analytics (when enabled in a build) are described above.
