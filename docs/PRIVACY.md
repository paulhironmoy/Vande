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
| Lite dares and replies (links) | only when you tap send | your device's share sheet | none. A dare link holds the game seed, the moves up to the dared question, your points on it and the midnight deadline; a reply link also holds the friend's points, best-move flag, twist result, a random 6-character code that tells two friends' replies apart, and (verified dares only) a signature | — | you choose whom to send it to |
| Lite friend points, twists and bests (`vande:lite-awards`, `vande:lite-twists`, `vande:lite-best`, `vande:lite-best-insight`, older `vande:lite-helper`; the current run in session storage `vande:lite-run`) | while you play Lite | your device only (local storage) | none | until you delete them | Settings → Delete all local data removes every `vande:lite-*` key (local and session storage); clearing the site's or app's data does too |
| Verified dare attempt: the dare (game seed, moves up to the dared question, dared step, deadline), a per-dare device key, your reply code, your answer (clue scans + chosen option), your app's points / best-move / move-kind result, later your twist answer | only in builds with verified dares **and** after you turn on **Share anonymous results**, when you answer a friend's dare and when you send the result back | Cloudflare Worker + D1 (`docs/BACKEND.md`) | `sha256(installation id + dare)`: different for every dare, cannot be reversed or linked across dares; the installation id itself is never sent | 7 days, then deleted | turn the setting off; nothing is sent then and dares stay fully playable |
| Today's dare goal: number of graded dare answers and how many found the best move | same as above, updated when a dare answer is graded, and only for answers the server replayed and checked itself (at most 3 a day from one network address) | Cloudflare D1 (counts only, one row per day) | none | 180 days | — |
| Local reminders | only if you enable them | your device's notification system | none | — | Settings → Reminders |

Never collected: name, email, phone, contacts, precise location, advertising identifiers, device fingerprints, free text,
decision text, raw IP addresses beyond the transient processing Cloudflare performs to deliver a request (rate-limit
keys are salted hashes kept for 24 hours).

## Offline by design

After the first visit the game is cached and plays without a connection. Community submissions made offline wait in a
local queue and are sent later only if sharing is still on. Fonts and all assets are bundled.

## Verified dares (Lite)

Off unless a build enables them and you switch on **Share anonymous results**. When both are true, answering a
friend's dare sends the dare and your answer (game moves, never anything about you) together with a key made on your
device as `sha256(installation id + dare)`. That key is different for every dare, so the server cannot connect your
attempts on different dares, and your installation id never leaves your device. The server picks and checks the twist
question, signs your reply so your friend's app can trust it without asking the server, and adds your answer to a
daily count ("Today X% of dare answers found the best move", shown only from at least 25 answers, and counting only
answers the server replayed and checked itself, so in the default setup it is never shown). Attempts are deleted
after 7 days; the daily counts hold no identifiers. Your IP address reaches Cloudflare for the duration of each
request, like any web request, and is used only to make salted rate-limit keys: per-minute keys, and one per-day key
that stops a single network from adding more than 3 answers a day to the daily count. Each key is a one-way hash, never
the address, and is deleted by the daily cleanup once it is more than 24 hours old. Reading the daily count sends only
the date. If anything fails, dares work exactly as before on your device.

The twist questions and their answers also ship inside the app so dares work offline; verified dares therefore prove
that a twist was answered once on one device, not that nobody looked the answer up.

## Analytics properties for Lite

Only in builds configured for analytics (see `docs/ANALYTICS.md`), and never with identifiers or free text: whether a
twist was answered right (`lite_twist_answered: right`), how a reply was sent and whether the trade-results experiment
was on (`lite_reply_sent: shareMethod, tradeResults`), whether an opened reply earned points or hit a cap
(`lite_reply_opened: awarded, capped`), and four counts on `lite_completed` (`visualQuestions`, `visualBest`,
`textQuestions`, `textBest`) that check whether pictures change how often players find the best move.

## Android

The app requests only the network permission the WebView needs. Automatic backup is off. Share images are written to the
app's cache folder for the share sheet; clear it from system settings any time. Data-safety form summary: no data shared
with third parties; optional app-interaction data (analytics) and optional anonymous gameplay results, both user-controlled.

## Content

Scenarios, characters, institutions and events are fictional. Rights moments are educational content, not legal advice.

## Changes

If this policy changes, the new version ships with the app and is dated below.

*Last updated: 2026-10-24 (verified dares, Lite local stores and Lite analytics properties added before any of them can
be enabled) · Contact: open an issue at https://github.com/paulhironmoy/Vande/issues*

## Community comparison requests

When a build is configured with a community API **and** you have switched on "Share anonymous results", the app also
requests the day's aggregate statistics (`GET /v1/daily/<date>/stats`). That request carries only the date and the
content version; like any web request, your IP address reaches Cloudflare for the duration of the request and is not
stored by VANDE. If sharing is off, no statistics are requested and no results are sent. Everything still works offline:
your results are kept on your device and queued submissions are sent later (or dropped after 14 days or 10 failed tries).

Because server rows cannot be linked to you, deleting all local data and playing the same day again is counted again as
a new anonymous result; community counts may therefore include such repeats.

## Android permissions (reminders)

The optional daily reminder uses local notifications only. The Android app declares `POST_NOTIFICATIONS`,
`SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED` and `WAKE_LOCK` for that purpose; nothing is sent to any server,
and the reminder is off until you turn it on in Settings. Play Data safety: no data collected by default; optional
anonymous results and optional analytics (when enabled in a build) are described above.
