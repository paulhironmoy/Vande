# YouTube operations: Daily Top 100 highlights

Platform-owned. Built and tested locally against the mock YouTube adapter; **nothing is deployed, rendered for real,
uploaded or published**, and no Google Cloud or YouTube account has been touched. The YouTube quota and the API
compliance audit are **launch dependencies** (see "Quota" and "OAuth setup").

Principles: a video is rendered only from a verified replay (the event log, never a screen recording or user media),
on trusted infrastructure, and published only with every participant's explicit consent. Players appear under their
chosen aliases and generated avatars, never a real name. The Top 100 badge is permanent whatever happens to the video.

## Pipeline

| Step | When | What | Code |
| --- | --- | --- | --- |
| Ratings | every duel and cup reveal | Elo update (`updateRatings`), performance, late counts, timing flags into `match_results` | `match/matchDO.ts`, trigger in `0003` |
| Cutoff | 00:00 IST (retried every 15 min) | `rankTop100` for the IST day that ended, frozen in one transaction; `youtube_top100` badges; one job per best match; push `top100` | `top100/cutoff.ts` |
| Consent | 48 h after the cutoff | participants review the exact cut (`GET /v1/highlights/:jobId/preview`) and grant or decline | `highlights/consent.ts` |
| Automatic checks | when the last participant grants | alias filter on the display names the video draws (`HighlightRenderInput.aliases`), `verifyMatchLog`, eligibility (timing flag, late answers, Auto sides), duplicates | `highlights/moderation.ts` |
| Render | as soon as queued | Cloud Run job claims, renders 1080×1920 at 30 fps, streams the MP4 to R2, completes | `render-service/`, `highlights/render.ts` |
| Review | after the render | an admin watches the MP4 and approves or rejects with notes (`HIGHLIGHT_AUTO_APPROVE=1` skips this) | `admin/routes.ts`, `admin.html` |
| Upload | when approved and quota allows | resumable upload to the official channel; overflow to the next Pacific quota day | `highlights/uploader.ts` |
| Publish | upload complete, and both consents still "granted" with nothing pending | `highlight` post in the match's Cricket Room (taken down again when the video is removed), push `highlight_published`, share moment, public landing | `highlights/pipeline.ts`, `public.ts` |
| Reconcile consent | every 15 min | any `uploading`, `published` or `unlisted` job whose removal is pending or whose latest consent from either participant is not "granted" is marked and removed | `highlights/sweeper.ts` |
| Clean up | 72 h after a confirmed upload | temporary MP4 deleted; the replay log stays | `highlights/sweeper.ts` |
| Views | daily | `videos.list` statistics (1 unit per 50 videos) into the job and attribution counters | `highlights/sweeper.ts` |

### Statuses (`HighlightStatus`)

| Status | Meaning | Next |
| --- | --- | --- |
| `pending_consent` | waiting for every participant (48 h) | `queued_render`, `rejected` (checks), `consent_declined` |
| `consent_declined` | a decline, a withdrawal before the upload, no answer in time, or an account deletion | final (badge kept) |
| `queued_render` | consented and checked; waiting for the render job | `rendering` |
| `rendering` | claimed by the render job (lease 20 min) | `pending_moderation`, `render_failed` |
| `render_failed` | a render attempt failed or its lease expired; retried after 5, 10 min | `rendering`, `dead_letter` |
| `pending_moderation` | rendered; waiting for an admin | `approved`, `rejected` |
| `rejected` | an automatic check or an admin said no | final |
| `approved` | approved; being scheduled | `scheduled` |
| `scheduled` | queued for upload, now or on a later quota day | `uploading`, `consent_declined` |
| `awaiting_channel` | production without the channel's OAuth secrets: held, with no room card and no push (nothing is uploaded, published or announced) | `scheduled` once the secrets exist (the sweeper), `consent_declined` |
| `uploading` | a resumable session exists; bytes are moving | `published`, `upload_failed`, `dead_letter`, `consent_declined` (withdrawn mid-upload, no video), `removed` (an admin removal mid-upload, or a video that finished as it was withdrawn) |
| `upload_failed` | YouTube refused permanently (or credentials failed); waits for an admin | `scheduled` (retry) |
| `published` | live on the channel (public or unlisted, as consented) | `unlisted`, `removed` |
| `unlisted` | unlisted by an admin after publication | `removed` |
| `removal_failed` | a removal (withdrawal, deletion, takedown) whose retries were exhausted: the video may still be on the channel; the room card is already down, the landing is gone, `highlight_removal_failed` is counted (alert) and it is listed first in Dead letters | `removed` (the sweeper retries every hour; or Remove) |
| `removed` | deleted from YouTube (withdrawal, deletion, takedown) | final |
| `dead_letter` | retries exhausted (render 3 attempts; upload 6 deliveries) | admin retry (never while a withdrawal or removal is pending: an upload dead letter with one pending closes as `consent_declined` or `removed`) |

`withdraw_pending` on the job records a removal intent before anything acts on it: 1 a participant withdrew (or
deleted the account), 2 an admin removed the video. While it is set nothing schedules, retries or re-renders the
job, an upload session cannot start, and a finished upload is never published or announced.

## Consent

* Every participant of the match must grant: "granted" needs `adultConfirmed: true` (18 or older) and a visibility;
  the stricter visibility wins (unlisted over public). What they approve is the title, the description, the aliases,
  the visibility and the cut itself: the preview returns the same `HighlightRenderInput` the renderer uses, and the
  experience workstream composes it on the device with the same deterministic composer, so the preview is the video.
* Any decline means no video. No answer within 48 h of the cutoff is recorded as a declined consent with reason
  `timeout`. The `youtube_top100` badge stays in every case.
* Deciding and withdrawing need a device that is still signed in (a revoked or signed-out device is refused at once).
* Withdrawal is possible at any time (`POST /v1/highlights/:jobId/withdraw`), also through deleting the account. The
  withdrawal is recorded first (the consent row and `withdraw_pending`), then acted on; if the job moved meanwhile
  (the uploader started its session), the step is re-read and applied to what the job is now, so no race can publish:
  before the upload the job is cancelled and the rendered MP4 deleted at once; during the upload the uploader stops at
  its next check (it re-checks after storing its session and before every chunk), and a video that finished at that
  moment is recorded, never published or announced, and deleted; after publication the video is deleted through the
  API and its room card taken down. Every 15 minutes the sweeper also removes any uploading or live video whose
  consent is no longer complete for both participants.
  **Removal SLA**: started immediately, normally done within minutes; at most 24 hours (queue retries up to an hour
  apart; a removal may use the quota headroom). A removal that still fails becomes `removal_failed`: an alert
  (`highlight_removal_failed`), first in the dead-letter view, retried by the sweeper every hour; an operator deletes
  the video in YouTube Studio within the same 24 hours if the retries do not.
* `highlight_consents` is append-only: who decided what, with the approved title and visibility, the 18+ flag, the
  reason (timeout, withdrawal, account deletion) and the time. It is the audit trail shown in the admin console.

## Moderation

Automatic, before any render cost (`highlight_moderation`, reviewer `auto`):

1. **Alias**: the display names the video draws (`HighlightRenderInput.aliases`, the same strings as the title) and
   the cup name pass the alias and group-name filters again. The renderer draws those names, never the match-time
   aliases inside the replay log.
2. **Anti-cheat**: the archived replay passes `engine.verifyMatchLog` with its own engine version; no timing-audit
   flag and at most one late answer in either innings (ranking's `matchEligibility`); no Auto Over or Auto XI side.
3. **Duplicate**: no other live or in-progress highlight of the same match, and none of the same two players within
   the previous 7 days (the earlier one wins); a match is never published twice.

Human, after the render (reviewer `admin`, with the reviewer's Access identity): watch the MP4 in full (signed link,
10 minutes), check that the aliases, title and description are what the participants approved, that nothing on
screen could identify a real person, and that the cut matches the replay. Approve or reject with notes.

## Rendering

The render service (`render-service/`, Node 22, Playwright Chromium headless with SwiftShader WebGL, ffmpeg) runs as a
Cloud Run job (deployment: docs/INFRASTRUCTURE.md). Per job it serves the built `dist/render.html` from loopback,
opens it at 1080×1920 (device scale 1), calls `window.__vcHighlight.load(input)` (30–60 s, 30 fps), then for frame
i = 0 … n−1 calls `frame(i × 1000 / 30)` and captures the frame over CDP (`Page.captureScreenshot`, JPEG q92 by
default), piping the images into ffmpeg (`libx264`, `yuv420p`, high profile, CRF 20, `+faststart`, silent unless the
page exposes its own generated audio). It uploads the MP4 to the Worker (stored in R2, SHA-256 checked by R2) and
completes the job; a failure is reported and retried by the Worker (5 and 10 minutes later, then `dead_letter`). Every
request to the Worker is signed (HMAC with the `RENDER_KEYS` entry, timestamp, single-use nonce, body hash); the page
can reach nothing but the loopback server.

A 45 s Short is 1,350 frames; on 4 vCPU a frame costs roughly 60–120 ms (WebGL in SwiftShader, capture, encode), so
one highlight takes about 2–3 minutes and 100 highlights about 4–5 vCPU-hours a day (docs/COST_MODEL.md).

## Upload

* **Never twice**: a job with a video id is done; the session URI is stored (encrypted) before the first byte, and a
  new session is created only when YouTube says the old one is gone (no video is created from an unfinished
  session). After a crash the next attempt asks YouTube how many bytes it has and resumes from there in 8 MiB
  chunks read from R2 by range.
* **Never after a withdrawal or removal**: the session is stored only by compare-and-swap on a job still due for
  upload with nothing pending (otherwise no byte is sent and the empty session expires); the uploader re-checks
  `withdraw_pending` and the latest consent rows after storing the session, before every chunk, and before it
  publishes and announces; a finished video's id is recorded before its status, so whatever arrives late can still
  remove it.
* **Retries**: transient errors (network, 5xx, 429, rate limits) are retried by the queue with backoff (1, 2, 4 …
  minutes, at most an hour); after 6 deliveries the message reaches `vande-media-dlq` and the job is `dead_letter`.
  Permanent refusals and credential failures set `upload_failed` with the reason in `last_error`.
* **Visibility** at upload is the consented one; `selfDeclaredMadeForKids: false`; category `YT_CATEGORY_ID`
  (20, Gaming); title ≤ 100 characters ending "#Shorts".

## Quota

The YouTube Data API allowance is per Google Cloud project per day (default 10,000 units), reset at midnight
Pacific time (07:00 or 08:00 UTC, 12:30 or 13:30 IST). Costs: `videos.insert` 1,600 units (`YT_UNITS_PER_UPLOAD`),
`videos.update` (privacy) 50, `videos.delete` 50, `videos.list` 1 per call of up to 50 ids.

* Uploads may use only the quota minus the headroom (`YT_HEADROOM`, at least 20 %), so removals, privacy changes and
  statistics always have room: `usable = floor(YT_DAILY_QUOTA × (1 − YT_HEADROOM))`, uploads per quota day =
  `floor(usable / YT_UNITS_PER_UPLOAD)`. Reservations are atomic in D1 (`yt_quota`), per Pacific day.
* With the default 10,000 units: usable 8,000 → **5 uploads a day**. An upload that does not fit is scheduled for
  the next quota day (spread over its first hour); a `quotaExceeded` answer from YouTube marks the day full.
* **For 100 highlights a day**: 100 × 1,600 = 160,000 units for uploads, which must be at most 80 % of the quota →
  at least **200,000 units a day**; with statistics (≤ 3 units), privacy changes and removals (≈ 10 × 50 at worst),
  request **250,000 units a day**.

**Requesting the quota extension** (owner, before launch; expect several weeks):

1. Pass the YouTube API Services compliance audit for the project: until it passes, videos uploaded through the API
   by a project created after July 2020 are locked to private (they cannot be published publicly).
2. Apply through the "YouTube API Services – Audit and Quota Extension Form" with: the project number, the channel,
   the use case (official highlight Shorts of a game's players, rendered by the service itself, uploaded only with
   every participant's consent), the expected volume (100 uploads a day, 250,000 units), the privacy policy and terms
   URLs, how data is handled (no YouTube user data is collected; only our own channel's videos and their view counts),
   and a screencast of the consent flow and the admin console.
3. Until it is granted: keep `YT_DAILY_QUOTA` at the granted value; the overflow queue grows by about 95 videos a
   day, so approve only the highest ranks in the admin console (the rest stay `pending_moderation` and can be
   rejected with a note) rather than letting a backlog build.

## OAuth setup (owner, once)

1. Google Cloud project → enable "YouTube Data API v3".
2. OAuth consent screen (External, production; publishing status reviewed) with the scope
   `https://www.googleapis.com/auth/youtube.force-ssl` (upload, privacy change, delete, statistics).
3. OAuth client (type "Web application"); keep the client id and secret in the password manager.
4. On a trusted machine, as the channel owner (or a Brand Account manager of the official channel), run the
   authorization once with `access_type=offline&prompt=consent` (for example the OAuth 2.0 Playground with "Use your
   own OAuth credentials") and copy the refresh token. Never commit it, never paste it into a ticket or chat.
5. `npx wrangler@4 secret put YT_CLIENT_ID`, `… YT_CLIENT_SECRET`, `… YT_REFRESH_TOKEN`. With all three set the
   Worker uses `RealYouTube`. Without them, production uses no adapter at all: due jobs wait as `awaiting_channel`
   (no room card, no push, never announced) and the sweeper schedules them once the secrets exist; the mock is for
   local and test runs only (`ENVIRONMENT` other than `production`). The refresh token exists only as a Worker secret:
   never in the repository, the app, the admin console or the render service.

## Runbooks

**Credential theft or rotation (YouTube)**: revoke the refresh token at once (Google Account → Security → Third-party
access, or `curl -d token=<token> https://oauth2.googleapis.com/revoke`); in YouTube Studio check recent uploads and
remove anything not in the admin console; reset the OAuth client secret (Cloud console → Credentials); generate a new
refresh token (OAuth setup step 4) and `wrangler secret put` the new secret and token. Uploads in progress fail with
`auth` → `upload_failed`; retry them from the admin console once the new secrets are in place.

**Credential theft or rotation (render key, admin access)**: prepend a new entry to `RENDER_KEYS`
(`r2:<base64url>,r1:…`), update the Cloud Run secret `RENDER_KEY` to the new entry, run a job, then remove the old
entry. Requests signed with a removed key are refused (401). Review the Cloudflare Access policy and its logs; remove
operators who left.

**Upload rejected**: open the job in the admin console (`last_error`: `youtube_permanent`, `youtube_auth`,
`video_missing`). `youtube_auth`: rotate or fix the credentials, then Retry upload. `youtube_permanent`: usually
metadata (title length, characters), a file YouTube cannot process, a channel restriction or an unaudited project
(private only): fix the cause, then Retry render (new file) or Retry upload. If YouTube rejects the content itself,
Reject the job with a note.

**Consent withdrawn**: automatic (and reconciled by the sweeper every 15 minutes). Check the job reaches
`consent_declined` (before upload, or stopped mid-upload) or `removed` (after) in the admin console; if it shows as
`removal_failed` in Dead letters (the hourly retries have not managed yet), delete the video in YouTube Studio, then
use Remove (which queues the removal again and records it; a video already gone counts as removed). Confirm to the
player through support within the SLA.

**Takedown** (copyright claim, legal request, abuse report, a participant's request outside the app): Remove the
video from the admin console (or Unlist first while investigating), with notes; the job, its consent trail and the
replay log are kept as the record. Remove records the removal before it is queued: a job still uploading is stopped
(never queued for upload again) and ends `removed`; Schedule, Retry upload and Retry render refuse it from then on
(409). A player who asks for removal is a withdrawal: use their in-app withdrawal or
Remove on their behalf.

**Quota exhausted**: nothing to do in a hurry: uploads overflow to the next quota day and removals keep the headroom.
Check the admin console's Quota view (used, uploads, scheduled per quota day) and, if a backlog grows, approve fewer
or request more quota.

**Render failures**: `render_failed` retries by itself; `dead_letter` after 3 attempts. Check the Cloud Run job logs
(`render_failed` lines carry the reason), fix (for example a `render.html` regression), then Retry render.
