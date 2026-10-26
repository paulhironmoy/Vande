# Infrastructure

Status: wave C (Daily Top 100, consented highlight Shorts, render service, admin console, attribution) on top of the
social product (Group Cups, Cricket Rooms, Daily Six, leaderboards, notifications). Platform-owned. Everything below is
built and tested locally; **nothing is deployed**, nothing was published or uploaded, and no Cloudflare, Google,
YouTube or Firebase account has been touched. Commands marked *activation* are for the
owner to run once accounts exist.

## Components

| Piece | Where | Purpose |
| --- | --- | --- |
| Worker `vande-cricket-api` | `backend/src` | Versioned `/v1` JSON API: auth, profiles, groups, duels, invites, push registration, exports |
| Durable Object `MatchDO` | `backend/src/match/matchDO.ts` | One per match (duel, cup fixture or Daily Six attempt): sealing, one-ball batting, deadlines and reminders (alarms), the activity jitter and the duel reveal slot (alarms), reveal, rematch |
| Durable Object `CupDO` | `backend/src/cup/cupDO.ts` | One per Group Cup: gathering, automatic start or cancellation, round-robin rounds, round reveals, standings, final, badge |
| Durable Object `RoomDO` | `backend/src/room/roomDO.ts` | One per Cricket Room (every duel and every cup): spoiler-safe auto-posts, reactions, banter, settings |
| D1 `vande-cricket` | `backend/migrations` (0001–0008) | Accounts (with Elo rating, unlocks and a moderator's suspension end), sessions, linked identities, groups, match lists, idempotency, rate-limit fallback, push tokens, exports, audit log, reports (with the moderation outcome), blocks; match results (with ratings, performance, late and missed-ball counts, timing-audit flags), friends, cup membership, Daily Six attempts/scores/streaks with a trigger-kept score histogram, notification preferences, room settings; frozen Top 100 days and entries, highlight jobs, consent and moderation records, attribution counters, YouTube quota, internal request nonces; shared match links; short invite codes and the share cap |
| R2 `vande-cricket-files` | binding `FILES` | `exports/` data exports (24 h); `logs/` archived replays of every duel and cup match (kept); `tmp/highlights/` rendered MP4s (deleted 72 h after a confirmed upload) |
| Queues | `vande-notify`, `vande-maint`, `vande-media` (+ `-dlq` each) | Push notifications; account-deletion follow-ups; highlight uploads, removals and privacy changes |
| Rate Limiting | `RL_NET`, `RL_AUTH`, `RL_INVITE`, `RL_PLAYER`, `RL_GLOBAL`, `RL_GLOBAL_ANON` | Per network (IPv4 /32; IPv6 /64 on signed-in routes, /56 on anonymous ones), per account, and two global ceilings: anonymous traffic and failed sign-ins (`RL_GLOBAL_ANON`, checked first) and signed-in traffic (`RL_GLOBAL`, checked after authentication) |
| Analytics Engine | dataset `vande_cricket_metrics` | Counters (route patterns, error codes, lifecycle events; never ids) |
| Cron | `17 21 * * *`, `30 18 * * *`, `*/15 * * * *` | Retention cleanup (02:47 IST); the Daily Top 100 cutoff (00:00 IST); the highlight sweeper (consent timeouts, consent reconciliation, render leases, due uploads, temporary videos, view counts, cutoff retry). Daily Six resets by date, not by cron |
| FCM (adapter) | `backend/src/ops/push.ts` | Android push; dropped until `FCM_SERVICE_ACCOUNT` is set; `MockPushSender` in tests |
| YouTube (adapter) | `backend/src/highlights/youtube.ts` | `RealYouTube` only with the OAuth secrets; in production without them no adapter (jobs wait as `awaiting_channel`, never announced); `MockYouTube` in development and tests (the whole pipeline runs against it) |
| Render job | `render-service/` | Cloud Run job: headless Chromium (SwiftShader WebGL) renders `render.html` frame by frame, ffmpeg encodes the Short; talks only to the Worker |
| Admin console | `admin.html`, `src/admin/` | Highlights moderation and operations behind Cloudflare Access (`/v1/admin/*`) |

The engine (`src/engine`) is bundled into the Worker through the `@/` alias and injected (`backend/src/engines.ts`);
each match is played and revealed with the engine version it was created with.

## Social product behaviour

**Friend Duel timing** (`MatchDO`): a player learns at once what their own action completes and learns about the
opponent's actions only after the **activity jitter** (`ACTIVITY_JITTER_S`, a random 60–600 s per event). A lock or a
finished innings reaches the opponent (their view's `locked`, `battingDone`, `opponentCommit` and phase, their match
list row), the cup's counts and the room's "both locked" card only that long after it happened, and the "opponent
locked" push is held back by the same delay. The second player to lock bats at once (their lock completed the pair);
the first bats once the second lock is visible to them, and `next` answers `not_your_turn` until then, exactly as
before a lock. When both innings are done a duel reveals for both players at the next whole **reveal slot**
(`DUEL_REVEAL_SLOT_S`, 300 s) at least 60 s later, shown as `deadlines.revealAt`; the reveal, its pushes and the
room's scorecard come at that moment. The second finisher sees `awaiting_reveal` with the countdown at once; the first
sees the countdown once the opponent's finished innings is visible to them, or simply gets the reveal at the slot.
Exact lock and completion times stay inside the match object. Deadline events (Auto Over, Auto XI) are public at
once. Cup fixtures keep their fixed reveal times. The local harness and dev server run with both off
(`ACTIVITY_JITTER_S=0`, `DUEL_REVEAL_SLOT_S=0`): duels reveal at once and batting starts right after both locks.

**Group Cup** (`CupDO`, 3–10 players; `POST /v1/cups`, `GET /v1/cups/:id`, cup invites through `/v1/invites/:token`):

| Pace | Gathering | Each round | Rounds (n players) |
| --- | --- | --- | --- |
| `sprint` | 1 h | lock 1 h, bat 1 h, reveal when batting closes | n − 1 (even n) or n (odd n, one bye each) |
| `daily` | 12 h | lock 12 h, bat 12 h | same |
| `weekend` | 24 h | lock 6 h, bat 6 h | same |

The start time is fixed at creation (gathering rounded up to the minute) and is also the invite's expiry. At the start
the cup begins with whoever joined (minimum 3, otherwise `cancelled` with reason `fewer_than_three_players`); the
schedule is then fixed: round r opens at start + (r − 1) × (lock + bat). Rounds are a circle-method round robin with
seats balanced. When a round opens the cup creates one MatchDO per fixture (both seats known, the round's conditions,
the cup's room). Players lock and bat inside the windows; a joined player who misses the lock deadline gets an Auto
Over, missed batting is finished by Auto XI, so no fixture and no round ever waits for anyone, the creator included.
All fixtures of a round reveal together at the round's reveal time; the cup then reads every result, updates
standings (win 2, tie 1, net run rate = (runs for − runs against) / matches, since every innings is one full over),
form (last five) and movement since the previous reveal, and posts the scorecards and the table. After the last group
round the top two play the final (`stage: 'final'`, its own lock/bat/reveal windows); a tied final goes to the better
group-stage finisher. The winner gets the `cup_winner` badge and is `CupView.winner` once the final is revealed (null
before that and for a cancelled cup). Late play after a deadline is refused officially (410 /
409) and is practice only, client-side against the revealed over (`src/net/practice.ts`). A member sees their own
fixture's progress (with the opponent's side after the activity jitter, as in a duel) and every other fixture only as
`scheduled`, `planning` (in progress) or `revealed`; the round's lock count moves only after the jitter.

**Cricket Room** (`RoomDO`, one per duel `r` + match id suffix and per cup `r` + cup id suffix; members only): system
posts for invite, fixtures, lock counts ("4 of 6 locked", one post per round updated in place, hour timestamps;
only locks players made, never an Auto Over), deadline reminders, plain "Auto Over stepped in for X" / "Auto XI batted
for X" cards (deadline posts with phase `auto_over` / `auto_xi`), reveal availability, scorecards (only after the
reveal), standings, achievements, rematch challenges (who asked, the new duel and the duel they came from). Members react (six reactions), post predefined banter (12 per hour), and free text only with
`ROOM_FREE_TEXT=1` (moderated by the alias filters). Mute and notify level (`all` / `important` / `none`) per member,
mirrored to D1 for the notification consumer. Posts by blocked players are hidden from the blocker. Last 200 posts.

**Rematch and shared matches**: one rematch offer per revealed duel, whoever asks first; asking again (either player)
returns the same offer until it expires (its lock deadline), then a new one replaces it. `MatchView.rematch` carries
it for both players (`fromMe` for the asker; the opponent accepts through its invitation) and both players' match lists
are re-synced so the opponent finds it on the home screen. `POST /v1/matches/:id/share` gives a participant of a
revealed match its one public code (a keyed HMAC of the match id, `https://<web>/s/<code>`, D1 `shared_matches`);
`GET /v1/s/:code` serves the conditions, each player's current alias ("Deleted player" after an account deletion) and
the replay rewritten with those names (per-network limits, cached five minutes).

**Daily Six** (`GET /v1/daily`, `POST /v1/daily/attempts`, attempts' `next` / `shot` / `result`): the IST day resets at
00:00 IST; three attempts per player per day against `engine.dailyChallenge(day, serverSalt).overs[0..2]`, the same for
everyone. `serverSalt` = HMAC(`DAILY_SALT_KEY`, "daily-salt|1") never leaves the Worker, so the overs cannot be
computed from the open engine in the app bundle (one salt across days keeps the engine's secret three-day pitch
rotation; the engine keys each day by day + salt). `DailyView.overCommits` publishes the three over commits when the
day opens (hashes only, from the engine's `dailyCommits`); each attempt's view shows its over's commit before batting
and its replay (`engine.buildDailyLog`, verified by `verifyMatchLog`) reveals that over with its one-way commit salt,
so anyone can check the over was fixed in advance. Every attempt gets a fresh secret seed (only its SHA-256
commitment is shown before the reveal). An attempt in progress is resumed, not restarted; each attempt is a MatchDO in
`daily` mode (only the player bats, six balls and no Super Ball: the attempt ends and is revealed at the innings'
`mainDone`; the score is `engine.dailyScore`); an attempt still open at the reset is finished with leaves. Best of
three per day; a finished attempt on consecutive days builds the streak. An attempt with more than one late answer or
missed ball (shown, then settled as a leave: expired, three invalid answers, or waiting at the reset) still uses the
attempt and keeps the streak but is never written to `daily_scores`, so it is on no board and is not the day's best
(metric `daily_uncounted`; the Top 100 applies the same limit per innings).

**Leaderboards** (`GET /v1/leaderboards/:scope?day=&groupId=`): national, city (the player's city), college and
company (members of that private group only), friends (players you finished a duel or cup match with); the last 30
IST days; ties share a rank; `total` is the real count; ranks for national and city come from the score histogram.

**Notifications** (notify queue → FCM adapter): global opt-out and quiet hours (`GET`/`POST /v1/push/settings`), room
mute / notify level, routine vs important kinds (important: reveal ready, deadline reminder, final, cup complete,
cup cancelled), daily caps (4 routine, 8 total per IST day, counted once per message), quiet hours (routine dropped,
important held until they end), one deadline reminder per player per match, "opponent locked" delayed by the activity
jitter (the moment the lock becomes visible), "reveal ready" for a duel at its reveal slot, so neither tells when.
Collapse keys never carry the account id. WhatsApp/share texts for exactly three moments per match or cup (invite, optional reminder,
final reveal, or its published highlight) in `src/platform/shareMoments.ts`, opened only on tap.

## Daily Top 100 and highlights

Operations, statuses, quota and runbooks: [YOUTUBE_OPERATIONS.md](YOUTUBE_OPERATIONS.md).

* **Ratings** after every duel and cup reveal: the MatchDO reads both ratings, applies `updateRatings`
  (`src/engine/ranking.ts`; never for Auto sides, practice or daily play) and writes the changes into the result row;
  a D1 trigger applies them exactly once (a retried write is a no-op) and keeps each player's long-term effort (EMA of
  tactical efficiency), the anti-tanking baseline of the ranking. The row also stores the engine's `matchPerformance`
  of both players, the late-answer and missed-ball counts per innings (missed: a ball shown, then settled as a leave
  because it expired, had three invalid answers or was waiting at the batting deadline) and the timing-audit flags
  (`timingAudit` at the reveal).
* **Cutoff** (00:00 IST cron, retried by the sweeper): ranks the IST day that ended with `rankTop100` (best three of
  the first five eligible matches; late answers plus missed balls, passed as `lateAnswers`, and timing flags are hard
  rules; a match without the engine's performance for both sides is left out for both players and counted as
  `top100_missing_performance`, never scored as 0), freezes it in one D1 transaction
  that starts with the day row (a second or concurrent run aborts), awards the permanent `youtube_top100` badge and
  creates one highlight job per best match (both participants when both qualified), then pushes `top100`.
  `GET /v1/top100/:day` serves frozen days only; today answers 409 `sealed` with `x-decided-at`. An entry carries
  `highlightCode` (its public landing) only while its best match's highlight is live: every participant consented,
  published or unlisted, and nobody is withdrawing it.
* **Consent → moderation → render → approval → upload**: `GET /v1/highlights/:jobId/preview` returns the exact
  `HighlightRenderInput`; every participant must grant (18+, visibility; unlisted beats public) within 48 h; automatic
  checks (alias filter, `verifyMatchLog`, no timing flag, late answers plus missed balls within the limit, no duplicate of the match or
  pair within 7 days) run before any render; the render service claims the job, streams the MP4 into R2 and
  completes it; an admin approves the rendered cut (or `HIGHLIGHT_AUTO_APPROVE=1`); `vande-media` uploads it resumably
  within the YouTube quota (overflow to the next Pacific quota day), posts a `highlight` card to the match's Cricket
  Room and pushes `highlight_published`. Withdrawal cancels before the upload and removes after it.
* **Public**: `GET /v1/h/:code` and `/v1/h/:code/replay` (published or unlisted only), `POST /v1/attribution`
  (landing_open, share, install; invite opens and completed duels of `POST /v1/duels { attributionCode }` are counted
  by the server). Links: `https://<web>/h/<code>` (also `vandecricket://h/<code>`, Play referrer `vc_h=<code>`).

## Local development

All from the repository root. Node 22.13+ (for `node:sqlite`); the repo's CI uses Node 22.

```bash
# Tests (in-process Worker with in-memory DO/R2/Queues and SQLite D1; no network, no Cloudflare)
npx vitest run backend tests/unit/net tests/unit/platform tests/unit/admin
npx vitest run --config render-service/vitest.config.ts       # render service units (no browser, no ffmpeg)
npx vitest run backend/test/cost.test.ts --silent=false      # prints measured D1 rows / DO keys per operation

# Typechecks
npx tsc -p backend/tsconfig.json --noEmit
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p render-service/tsconfig.json --noEmit

# Local API on http://127.0.0.1:8787 (real engine when it works, else the platform's fake engine)
node backend/local/serve.mjs                    # --engine real | fake | auto, --port 8787, --host 127.0.0.1,
                                                # --web-origin http://localhost:4174 (env LOCAL_WEB_ORIGIN)
curl -X POST 'http://127.0.0.1:8787/__dev/advance?ms=90000000'   # local only: move the clock to test deadlines

# The app against the local API
VITE_API_LOCAL=1 npm run dev                    # or VITE_API_URL=http://127.0.0.1:8787
```

The local server keeps everything in memory (a restart starts empty), generates fresh development secrets on
start (including `RENDER_KEYS` and an `ADMIN_TOKEN`, printed nowhere: read them from `backend/local/harness.ts`
`secrets` when embedding), allows the Vite dev and preview origins plus `https://localhost`, `capacitor://localhost`
and the `--web-origin` (which is also `PUBLIC_WEB_ORIGIN`, so invite and highlight links point at the app under test),
and drives Durable Object alarms and queues with timers. It runs with the activity jitter and the duel reveal slot
off (`ACTIVITY_JITTER_S=0`, `DUEL_REVEAL_SLOT_S=0`; so do `.dev.vars` from `dev-secrets.mjs`, and backend tests that
check the timing set both), so batting starts right after both locks and duels reveal at once. YouTube is the mock. End-to-end tests can start it as a
Playwright `webServer` (`command: 'node backend/local/serve.mjs --engine real --web-origin http://localhost:4174'`,
`url: 'http://127.0.0.1:8787/v1/health'`: no auth, no rate limit, 200 once the server listens) or embed the
harness directly: `createLocalBackend({ engine, helpers })` from `backend/local/harness.ts` returns `fetch`, a manual
`clock`, `advance(ms)` (fires due alarms), `drainQueues()`, `scheduled(cron)`, the mock `youtube` and the in-memory
bindings to inspect. The admin console runs with `npm run dev` at `/admin.html` (Connection: API origin
`http://127.0.0.1:8787` and the harness `ADMIN_TOKEN`).

### `wrangler dev` (Cloudflare's local runtime)

Runs the real Worker in workerd/miniflare with local D1, DO, R2 and Queues. It needs wrangler 4.36 or later and
makes no remote changes when run with `--local`:

```bash
node backend/local/dev-secrets.mjs > backend/.dev.vars       # gitignored; development values only
cd backend
npx wrangler@4 d1 migrations apply vande-cricket --local
npx wrangler@4 dev --local --port 8787
```

`npx wrangler@4 deploy --dry-run --outdir .wrangler/dry-run` bundles the Worker locally (uploads nothing) to check
the bundle before a first deployment.

## Configuration

### Worker variables (`backend/wrangler.toml` `[vars]`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `ENVIRONMENT` | `production` | Anything else allows `ALLOW_UNLIMITED_WRITES=1` (local only) |
| `ALLOWED_ORIGINS` | web origin, `https://localhost`, `capacitor://localhost` | Browser origins allowed by CORS |
| `PUBLIC_WEB_ORIGIN` | `https://vande.cricket` | Base of invite links `…/i/<code>` (a 10-character code; older links carry the signed token) |
| `PUBLIC_API_ORIGIN` | `https://api.vande.cricket` | Base of export download links |
| `GOOGLE_CLIENT_IDS` | empty (off) | Accepted Google OAuth audiences: web and Android client ids |
| `PASSKEYS_ENABLED` | `0` | Passkey linking/recovery (needs a verifier, docs/SECURITY.md) |
| `DO_LOCATION_HINT` | `apac` | Where new match objects are created |
| `DUEL_LOCK_HOURS` / `DUEL_BAT_HOURS` | 24 / 24 | Friend Duel lock window (also the invite expiry) and batting window |
| `BALL_LIVE_MS` / `BALL_LATE_MS` | 20000 / 600000 | Answer window of a revealed ball; how long a queued (offline) answer is still accepted |
| `ACTIVITY_JITTER_S` | `60-600` | Seconds (a range, or `0` for off) after which a lock or a finished innings reaches the opponent, the cup and the room, and the "opponent locked" push arrives; random per event |
| `DUEL_REVEAL_SLOT_S` | `300` | A duel reveals at the next whole slot at least 60 s after both innings end (`0`: at once); cups keep fixed times |
| `RATE_ANON_GLOBAL_WRITES_PER_MINUTE` / `RATE_ANON_GLOBAL_READS_PER_MINUTE` | 1000 / 2000 | D1-fallback global ceilings for anonymous traffic and failed sign-ins (the `RL_GLOBAL_ANON` binding applies its own) |
| `ANON_IPV6_PREFIX` | `56` | IPv6 prefix counted as one network on anonymous routes (`48` stricter, `64` looser); signed-in routes use /64 |
| `RATE_*`, `GUESTS_PER_NETWORK_PER_DAY`, `DUELS_PER_PLAYER_PER_DAY`, `GROUP_JOINS_PER_PLAYER_PER_DAY` | see file | D1-fallback rate limits and daily caps |
| `CLEANUP_MAX_QUERIES` | 200 | D1 statements one cleanup run may use |
| `VERIFY_REVEALS` | `0` | `1` re-verifies every replay with the engine before publishing it |
| `RETIRED_SIGNING_KEYS` | empty | Public keys of rotated-out commit-signing keys (still published) |
| `ROOM_FREE_TEXT` | `0` | `1` allows short moderated free text in Cricket Rooms (default: predefined banter only) |
| `NOTIFY_ROUTINE_PER_DAY` / `NOTIFY_MAX_PER_DAY` | 4 / 8 | Push caps per player per IST day (routine; all) |
| `NOTIFY_QUIET_HOURS` | `22:00-08:00` | Default quiet hours (IST): routine pushes dropped, important ones held until the end |
| `HIGHLIGHT_AUTO_APPROVE` | `0` | `1` skips the human approval of rendered highlights (the automatic checks still run) |
| `YT_DAILY_QUOTA` / `YT_UNITS_PER_UPLOAD` / `YT_HEADROOM` | 10000 / 1600 / 0.2 | YouTube Data API units per Pacific day, per upload, and the share uploads may never use (≥ 0.2) |
| `YT_CATEGORY_ID` | `20` | Category of the Shorts (Gaming) |
| `ARCHIVE_DAILY_LOGS` | `0` | `1` also archives Daily Six replays to R2 (duel and cup replays always are) |
| `ADMIN_ORIGIN` | `https://admin.vande.cricket` | Origin of the admin console (CORS for `/v1/admin/*` only) |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | empty | Cloudflare Access team domain and the admin application's audience tag (the Worker verifies `Cf-Access-Jwt-Assertion`) |

### Secrets (`wrangler secret put <NAME>`; never in files)

| Secret | Format | Used for | Generate |
| --- | --- | --- | --- |
| `RATE_SALT` | ≥ 16 chars | Salting rate-limit keys | `openssl rand -base64 24` |
| `TOKEN_KEYS` | `kid:base64url(32+ bytes)[,…]` | HMAC for access, ball, invite and export tokens (HKDF per purpose) | `echo "k1:$(openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '=')"` |
| `DATA_KEYS` | same | AES-GCM at rest: sealed plans, match seeds, push tokens, stored responses (HKDF per purpose and match) | same |
| `SIGNING_KEY` | P-256 private JWK | Commit signatures `matchId\|player\|hash\|engine` | `node backend/local/dev-secrets.mjs` prints one (copy the JSON) |
| `IDENTITY_PEPPER` | ≥ 32 chars, never rotated | HMAC of linked Google/passkey subjects; highlight codes | `openssl rand -base64 32` |
| `DAILY_SALT_KEY` | ≥ 32 chars | Daily Six server salt (the overs); rotate only at a reset | `openssl rand -base64 32` |
| `RENDER_KEYS` | `kid:base64url(32+ bytes)[,…]` | Render service request signing (the same entry is the Cloud Run secret `RENDER_KEY`) | as `TOKEN_KEYS` |
| `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN` | OAuth client and the channel's refresh token | YouTube uploads (without them production holds highlight jobs as `awaiting_channel`; the mock is for development only) | YOUTUBE_OPERATIONS.md, "OAuth setup" |
| `FCM_SERVICE_ACCOUNT` | Firebase service-account JSON | Push (optional) | Firebase console → Service accounts |
| `ADMIN_TOKEN` | ≥ 32 chars | Local and development admin access only (refused in production) | `openssl rand -base64 32` |

Every route fails closed with `503 unavailable` when a secret it needs is missing or malformed, and logs one warning
naming the secret (never its value). Rotation: prepend a new `kid:` entry to `TOKEN_KEYS`/`DATA_KEYS`, deploy, remove
the old entry after the longest-lived thing it protects has expired (tokens: 1 day after the refresh grace; data:
never while sealed plans or encrypted push tokens use it). Commit-signing key rotation: put the new `SIGNING_KEY`,
add the old public key to `RETIRED_SIGNING_KEYS`.

### App build variables

| Variable | Meaning |
| --- | --- |
| `VITE_API_URL` | API base (https only; `http://127.0.0.1`/`localhost` allowed). Empty = offline-only build |
| `VITE_API_LOCAL=1` | Shortcut for the local server `http://127.0.0.1:8787` |
| `VITE_KILL_ONLINE=1` | Kill switch: offline-only even with a URL |
| `VITE_PUBLIC_WEB_ORIGIN` | Origin of invite links, for deep-link parsing |
| `VITE_PUSH_ENABLED=1` | FCM push through the native plugin |
| `VITE_GOOGLE_CLIENT_ID` | Google linking (web client id) |
| `VITE_PASSKEYS=1` | Passkeys (also needs the server side) |
| `VITE_ANALYTICS_PROVIDER`, `VITE_POSTHOG_HOST`, `VITE_POSTHOG_KEY`, `VITE_KILL_ANALYTICS` | docs/ANALYTICS.md |

## Production activation (owner, once accounts exist)

```bash
npx wrangler@4 login                                          # interactive, once
cd backend
npx wrangler@4 d1 create vande-cricket                        # paste database_id into wrangler.toml
npx wrangler@4 d1 migrations apply vande-cricket --remote   # 0001–0008, in order (0004 missed balls, 0005 daily_attempts.ids, 0006 shared match links, 0007 invite codes and the share cap, 0008 the report queue and suspensions); Durable Object migrations v1/v2 apply on deploy
npx wrangler@4 r2 bucket create vande-cricket-files
npx wrangler@4 r2 bucket lifecycle add vande-cricket-files exports-2d exports/ --expire-days 2
npx wrangler@4 r2 bucket lifecycle add vande-cricket-files tmp-videos-14d tmp/highlights/ --expire-days 14   # backstop
for q in vande-notify vande-notify-dlq vande-maint vande-maint-dlq vande-media vande-media-dlq; do npx wrangler@4 queues create "$q"; done
for s in RATE_SALT TOKEN_KEYS DATA_KEYS SIGNING_KEY IDENTITY_PEPPER DAILY_SALT_KEY RENDER_KEYS; do npx wrangler@4 secret put "$s"; done
# set routes = [{ pattern = "api.<domain>", custom_domain = true }] and the real origins in wrangler.toml
# the six [[ratelimits]] bindings (RL_NET, RL_AUTH, RL_INVITE, RL_PLAYER, RL_GLOBAL, RL_GLOBAL_ANON; namespace ids
# 7401–7406, unique in the account) are created by the deploy itself
npx wrangler@4 deploy
curl https://api.<domain>/v1/health && curl https://api.<domain>/v1/keys
```

Then: build the app with `VITE_API_URL=https://api.<domain>` and `VITE_PUBLIC_WEB_ORIGIN=https://<domain>`; deploy the
admin console and the render job (below); add the
billing notifications at $25, $50 and $100 (docs/COST_MODEL.md); add one WAF rate-limiting rule on the zone (path
starts with `/v1/`, per IP; WAF does not apply to workers.dev); consider `head_sampling_rate = 0.2` for logs once
traffic grows. Rollback: `npx wrangler@4 rollback`. Optional later: `GOOGLE_CLIENT_IDS`, `FCM_SERVICE_ACCOUNT`, the
YouTube secrets (YOUTUBE_OPERATIONS.md).

**Admin console**: a hostname such as `admin.<domain>` behind a Cloudflare Access application (allow the operators'
identities only; session 8 h). Serve the built `admin.html` and its assets there (any static host on that hostname)
and route `admin.<domain>/v1/admin/*` to the Worker (`routes` in wrangler.toml), so the console calls the API on its
own origin; set `ADMIN_ORIGIN`, `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` (Access → application → Overview →
"Application Audience (AUD) Tag"). The Worker verifies every request's Access JWT itself; never set `ADMIN_TOKEN` in
production (it is refused there anyway).

**Render job** (Google Cloud Run job, region near the Worker's users, e.g. `asia-south1`):

```bash
npm run build                                                  # dist/ must contain render.html (experience)
docker build -f render-service/Dockerfile -t <region>-docker.pkg.dev/<project>/vande/render:<version> .
docker push <region>-docker.pkg.dev/<project>/vande/render:<version>
printf '%s' "<the RENDER_KEYS entry>" | gcloud secrets create vande-render-key --data-file=-
gcloud run jobs create vande-render --image <…>/render:<version> --region <region> --cpu 4 --memory 4Gi \
  --task-timeout 3600 --max-retries 0 --set-env-vars WORKER_URL=https://api.<domain> \
  --set-secrets RENDER_KEY=vande-render-key:latest
gcloud scheduler jobs create http vande-render-tick --schedule '*/15 * * * *' --time-zone UTC \
  --uri https://run.googleapis.com/v2/projects/<project>/locations/<region>/jobs/vande-render:run \
  --http-method POST --oauth-service-account-email <scheduler-sa>
```

Each execution renders until no job is waiting (`MAX_JOBS`, `TIME_BUDGET_MS`); an execution that finds nothing exits
after a few seconds (≈ $1–2 a month of idle starts at every 15 minutes). Egress: only `WORKER_URL` (use a
VPC connector with a firewall allowing only the Worker's hostname if the project requires it); the page itself is
served from loopback and may fetch nothing else.

## Android integration

Built by platform (code only; root runs every Gradle build):

* `android/app/src/main/java/in/vande/cricket/plugins/InstallReferrerPlugin.java` (`VandeInstallReferrer`): Play
  Install Referrer → `{ referrer }` once; `src/platform/installReferrer.ts` turns `vc_invite=<token>&vc_a=<code>` into a
  pending invite (3 s timeout), and the web invite page links to `playStoreUrl(...)`.
* `SecureStoragePlugin.java` (`VandeSecureStorage`): AES-256-GCM with a non-exportable Android Keystore key, values in
  private SharedPreferences (written with `commit()`), the value name as associated data; the manifest already has
  `android:allowBackup="false"`. No deprecated `security-crypto` dependency.
* `GoogleSignInPlugin.java` (`VandeGoogleSignIn`): Credential Manager `GetSignInWithGoogleOption(<web client id>)` →
  `{ idToken }` or null; the server verifies the token.
* `@capacitor/push-notifications@8.1.3` installed (exact); `src/platform/push.ts` uses it natively and creates the
  `matches` channel.
* `android/app/build.gradle`: `com.android.installreferrer:installreferrer:2.2`,
  `androidx.credentials:credentials:1.3.0`, `androidx.credentials:credentials-play-services-auth:1.3.0`,
  `com.google.android.libraries.identity.googleid:googleid:1.1.1`.
* `AndroidManifest.xml`: `android.permission.POST_NOTIFICATIONS` (asked only after a meaningful moment) and
  `com.google.firebase.messaging.default_notification_channel_id = matches`.

Done by root: `MainActivity` registers the three plugins before `super.onCreate`; `notif_<kind>_title` and
`notif_<kind>_body` for the 11 match and cup kinds in `values/` and every `values-<locale>/`; App Links cover
`<base>/i/`, `/m/`, `/c/` and `/h/` through the manifest placeholder `appLinksBasePath` (default `/Vande`,
`-PappLinksBasePath=` for a domain root).

Root to do:

* `npx cap sync android` (adds the push plugin's native code), `google-services.json` from the Firebase project.
* Two more notification kinds of wave C: `notif_top100_title` / `_body` ("You made today's Top 100: review your
  highlight") and `notif_highlight_published_title` / `_body`, in `values/` and each `values-<locale>/`.
* App Links: `https://<appLinksHost>/.well-known/assetlinks.json` with `in.vande.cricket` and the release SHA-256; the
  web base (`PUBLIC_WEB_ORIGIN`, e.g. `https://host/Vande`) must equal `appLinksHost` + `appLinksBasePath`.
  `src/platform/deepLinks.ts` accepts web origins with a base path and parses `/i/`, `/m/`, `/c/` and `/h/` links.

## Operations

* **Logs**: one JSON line per request (`evt: request`, request id, route pattern, status, error code, ms) plus
  warnings (`config`, `engine_error`, `index_sync_failed`, `dead_letter`). Invocation logs are off (URLs carry
  invite tokens). Clients can send `x-request-id` to correlate.
* **Metrics** (Analytics Engine; high-volume counters sampled 1 in 10 with weight 10): `SELECT blob1 AS metric,
  blob2, blob3, SUM(_sample_interval * double1) FROM vande_cricket_metrics WHERE timestamp > NOW() - INTERVAL '1' DAY
  GROUP BY metric, blob2, blob3`. Watch: `error` by code, `rate_limited` (by scope: `global-anon` is the anonymous
  ceiling shedding traffic, `global` the signed-in one), `refresh_reuse_revoked`, `session_signed_out`,
  `sessions_revoked` (others / recovery), `engine_error`, `index_sync_failed`, `notify_dead_letter`, `auto_over`,
  `auto_xi`, `timing_suspicious`, `top100_frozen`, `highlight_status` by status (`reconciled`: live or uploading jobs the
  sweeper removed because consent was incomplete; `awaiting_channel`: production without the channel's secrets),
  `youtube_error` by kind, `quota_overflow`, `media_dead_letter`, `highlight_removal_failed` (alert on any: a video
  that should be gone may still be up), `admin_action`, `guest_refused_age`, `share_moment_refused`.
* **Dead letters**: notify and maint DLQ consumers count and log, then acknowledge (messages carry ids only). A burst
  of `notify_dead_letter` means FCM credentials or quota trouble. `vande-media-dlq` marks the job `dead_letter`
  (uploads) or `removal_failed` (removals: the `highlight_removal_failed` metric and error log, the room card taken
  down at once, and a retry by the sweeper every hour until the video is gone). The admin console's Dead letters view
  lists `removal_failed` first, then `awaiting_channel`, `dead_letter`, `upload_failed` and `render_failed`.
* **Backups and recovery**: D1 Time Travel keeps 30 days on Workers Paid:
  `npx wrangler@4 d1 time-travel restore vande-cricket --timestamp <ISO>` (test on a copy first). Durable Object
  storage has no point-in-time restore; a lost match object loses that match only. Revealed duel and cup replays are
  archived to R2 (`logs/<matchId>.json.gz`) at the reveal. Secrets: keep an offline copy of `DATA_KEYS`,
  `SIGNING_KEY`, `IDENTITY_PEPPER` and `DAILY_SALT_KEY` in the owner's password manager; losing `DATA_KEYS` makes
  sealed plans and stored upload sessions unreadable.
* **Kill switches**: `VITE_KILL_ONLINE=1` (client), removing a route on the custom domain, or unsetting `RATE_SALT`
  (the API then refuses everything with 503).

## Retention

| Data | Kept | Removed by |
| --- | --- | --- |
| Rate-limit buckets (D1 fallback, daily caps) | ≤ 2 days | nightly cleanup |
| Idempotency records | 24 h | nightly cleanup |
| Refresh-token families | 365 days of inactivity; revoked ones 1 day | nightly cleanup |
| Exports | 24 h (R2 lifecycle 2 days as a backstop) | nightly cleanup + lifecycle rule |
| Audit log | 180 days | nightly cleanup |
| Deleted-account tombstones | 30 days | nightly cleanup |
| Match list rows | 400 days | nightly cleanup |
| Match results (Top 100 inputs, late and auto counts) | 400 days | nightly cleanup; scrubbed on account deletion |
| Friends (finished a match together) | until either account is deleted | account deletion |
| Daily Six attempt rows (attempts used, the attempt in progress, every attempt object's id) | 32 days (an attempt object keeps its replay 30 days after its reveal; account deletion finds the objects through these rows) | nightly cleanup |
| Daily Six scores and score histogram | 90 days (boards readable for 30) | nightly cleanup |
| Streaks, notification preferences, room settings | until the account is deleted | account deletion |
| Cricket Room posts | the last 200 per room (Durable Object) | rolling; deleted players become "Deleted player" |
| Match objects (plans, inputs, replay) | for the life of the replay | account deletion anonymises the player |
| Archived replays (R2 `logs/`) | kept (event logs are the audit record) | account deletion anonymises the match object; highlight replays are public only while consented |
| Top 100 days and entries | kept (public history) | aliases become "Deleted player" on account deletion |
| Highlight jobs, consent and moderation records | 400 days after the job closes, longer while its video is live | consent records keep a tombstone id after account deletion (proof of consent) |
| Temporary highlight MP4s (R2 `tmp/highlights/`) | 72 h after a confirmed upload or after the job closes | sweeper; R2 lifecycle 14 days as a backstop |
| Attribution counters (per code per day) | 400 days | nightly cleanup |
| YouTube quota rows, internal nonces | 60 days, 1 day | nightly cleanup |
