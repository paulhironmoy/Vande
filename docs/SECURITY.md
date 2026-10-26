# Security

Status: wave C (Top 100, highlights, render service, admin console) plus the security fix wave that followed the
independent review (consent races, deletion completeness, session revocation, separate anonymous budgets, activity
jitter, alias scripts). "Built" means implemented in this repository and covered by the tests named in brackets
(`backend/test/*.test.ts`, `tests/unit/net|platform|admin/*`, `render-service/test/*`). "Planned" is designed but
belongs to a later wave. Nothing is deployed.

## Principles

* **Server-authoritative.** Clients send plans and inputs; the Worker and the match's Durable Object compute every
  result with the injected engine. No client value is ever trusted as an outcome.
* **Sealed until the reveal.** Nothing an opponent could use (plan, gesture, intent, execution, salt, seed, runs,
  wickets, exact times) leaves the match object before both innings are done or the deadline passes.
* **Fail closed.** A missing or malformed secret disables exactly the routes that need it (503); the API never runs
  without rate-limit salt in production.
* **Least privilege and least data.** No email, phone, real name, contacts or location; ids are random; addresses
  are used only in memory to derive salted rate-limit keys.

## Threat model

| Threat | What an attacker wants | Controls | Status |
| --- | --- | --- | --- |
| **Strategy disclosure before the reveal** | The opponent's over, or the seed (with the open engine, a seed lets you pre-compute the best shot) | Plans and salts AES-GCM encrypted at rest with a per-match HKDF key; AAD binds each ciphertext to match, seat and commit hash; the seed is encrypted the same way and only its SHA-256 is fixed at creation; views carry flags and commit hashes only; deliveries are revealed one at a time; engine outputs are copied field by field (`publicDelivery`, `publicFeedback`), so a sealed field cannot leak even if the engine attached one; non-participants get 404 | Built [sealing, authz] |
| **Forged scores** | Claim runs, a win or a ranking without playing | Results computed only in the match object from the committed plan, validated inputs and the server seed; clients never send outcomes; ball tokens are HMAC-signed and single use; inputs validated by the engine (timing bounds, trace plausibility) and by the server (a claimed `clientElapsedMs` may not exceed the time since the reveal) | Built [batting] |
| **Replay tampering** | Edit a revealed replay (share card, highlight) | Every commit is signed (ECDSA P-256, key id, public keys at `GET /v1/keys`) over `matchId\|player\|hash\|engine`; revealed logs include plans and salts so anyone can recompute hashes; `engine.verifyMatchLog` re-runs a log (on every reveal with `VERIFY_REVEALS=1`, and on every highlight before it is rendered); commit hashes are also written to the audit log at lock time; replays are archived to R2 at the reveal and official highlights render only from that server-held log | Built [sealing, highlights] |
| **Automated grinding** | Farm wins or Top 100 position with scripts | Per-account and per-network limits, daily duel cap, engine trace-plausibility checks (robotic gestures refused), late answers and missed balls (shown, then settled as leaves: expired, invalid or at the deadline) counted per innings and the engine's `timingAudit` (≥ 5 taps within ±3 ms of perfect) flagged per innings in `match_results` (a flag, never a block); both are hard eligibility rules of `rankTop100` (src/engine/ranking.ts), which also counts only the best three of the first five eligible matches a day and at most two per opponent | Built [integrity, top100] |
| **Multiple-account abuse** | Many guests to self-play or flood | Guest sign-ups capped per network per minute and per day (anonymous routes count IPv6 by /56, `ANON_IPV6_PREFIX`, so rotating the thousands of /64s one rented server holds gains nothing), a separate anonymous global ceiling, Auto Over/Auto XI results flagged (`commit.auto`) and ineligible for ratings and the Top 100; the ranking discounts results against opponents who clearly did not try (effort floor and each opponent's long-term effort baseline, kept per account by a D1 trigger) | Built [ratelimit, deadlines, top100]; linked identities for prizes planned |
| **Daily Six pre-computation** | Know the day's overs before batting | Overs come from `dailyChallenge(day, serverSalt)` with a salt derived from `DAILY_SALT_KEY` that never leaves the Worker (logs carry only the engine's one-way commit salt); each attempt has a fresh secret seed; the three over commits are published when the day opens (`DailyView.overCommits`) and match every replay | Built [daily, realEngine] |
| **Invitation token guessing** | Join someone else's duel | 74-character tokens: 38-byte payload with a 128-bit random nonce + 128-bit HMAC (key from `TOKEN_KEYS`); the match also stores and compares the nonce; tokens expire with the lock deadline; forged, mistyped and unknown tokens get one identical 404; invite lookups limited to 60 per network (IPv6 /56) per minute and by the anonymous global ceiling; rematch invites are reserved for the previous opponent | Built [invites, hardening] |
| **Tournament manipulation** | Stall a cup, pick opponents, fix results, learn results early | Fixtures generated by the server (circle method) at the start; seats and conditions fixed per round; every step on alarms (and re-applied on every request), so neither the creator nor any player can stall a cup; Auto Over / Auto XI for joined players who miss deadlines; all fixtures of a round reveal together at the published reveal time; late play after a deadline is refused (410/409) and never changes standings; joining closes at the start; members only; lock progress is a count that moves only after the activity jitter, and a member sees other members' fixtures only as scheduled, in progress or revealed (never which pair locked or batted, or when) | Built [cups, visibility] |
| **Room abuse and spoilers** | Harass, spam, leak results in a Cricket Room | Members only (404 otherwise); system posts have a closed set of primitive payload keys per kind, scorecards only after the reveal; members post predefined banter (rate limited), free text off by default and moderated when enabled; reactions from a fixed set; block hides a player's posts; reports name the post id; room writes need an active account; a deleted player's alias leaves every card that named them (by player id, never by alias text) and the room title, and a highlight card naming them is taken down | Built [rooms, deletion] |
| **Activity-time leaks** | Infer when someone locked or played | **Activity jitter** (`ACTIVITY_JITTER_S`, 60–600 s, chosen at random per event with crypto randomness): a lock or a finished innings becomes visible to the opponent (`locked`, `battingDone`, `opponentCommit`, the phase), the cup's counts, the room's "both locked" card and the D1 match list only that long after it happened, and the "opponent locked" push is held back by the same delay. A player learns at once only what their own action completes: the second locker bats at once (their lock completed the pair), the first only once the opponent's lock is visible to them, and until then `next` is refused exactly as before a lock, so neither the phase nor the batting API is an oracle; exact lock and completion times stay inside the match object (strictly ordered, so exactly one player completes each pair) and a finished innings never becomes visible before the lock it follows. **Duel reveal slots**: when both innings are done a duel reveals for both at the next whole slot (`DUEL_REVEAL_SLOT_S`, 300 s) at least 60 s later, shown as `deadlines.revealAt`, and the reveal, its pushes and the room's scorecard come then, so the first finisher's "reveal ready" no longer tells when the second innings ended; the second finisher sees the countdown at once, the first once the opponent's finished innings is visible to them (or simply at the slot); cups keep their fixed reveal times; a player's match-list row (and its place in the list, ordered by `updated_ms`) is rewritten only when that player's own view changes; deadline events (Auto Over, Auto XI) are public at once because their time is; the room's deadline card follows the visible flags; hour-resolution timestamps everywhere. The local harness and dev server run with the jitter and the slot off (`ACTIVITY_JITTER_S=0`, `DUEL_REVEAL_SLOT_S=0`) | Built [visibility, queues, rooms, cups] |
| **Leaderboard privacy and padding** | See private groups, fake rankings | College/company boards require membership of that group (403); totals are real counts; entries carry public refs only; scores only from server-revealed Daily Six attempts (best of three per IST day) with at most one late answer or missed ball | Built [daily, integrity] |
| **Offensive aliases** | Abuse others through names | Server-side moderation (`src/net/shared/alias.ts`): English, Hindi (Devanagari) and Hinglish roots, folding of case, accents, look-alike Cyrillic/Greek letters and non-decomposing Latin letters, digits as letters, separators and repeated letters; whole-word rules for short or ambiguous roots to avoid blocking real names (Gandhi, Nazim, Ashit, Kamini, Nigam, "Chakka" for a six); an alias spelled out letter by letter ("B C", "M.C.") reads as the word it spells; letters only from the scripts the app ships (Latin with Latin-1, Latin Extended-A and the accented letters of Latin Extended Additional; Devanagari, Bengali, Gurmukhi, Gujarati, Tamil, Telugu, Kannada, Malayalam) and one script per word, so Armenian, Cherokee, IPA, phonetic small capitals and other look-alike blocks are refused outright; impersonation (game, staff, cricket bodies, platforms) and contact details (7+ digits, links, messaging/payment handles) refused; rejections audited by reason; group names and room messages checked the same way; reports and blocks recorded | Built [alias, aliasBypass, profile]; offensive words in the non-Devanagari Indic scripts rely on reports in v1 |
| **YouTube credential theft** | Post to the official channel | OAuth client secret and the channel's refresh token exist only as Worker secrets (`YT_*`), used server-side to mint short-lived access tokens; nothing YouTube-related is in the app, the admin console or the render service, and a test scans the client sources and any built bundle for secret names and upload endpoints; uploads only of server-rendered event logs; runbook in YOUTUBE_OPERATIONS.md | Built [bundleSecrets, highlights] |
| **Publication without consent** | Publish someone's match, or a cheat's | Jobs only for frozen Top 100 best matches; every participant must grant (18+ confirmed, from a live session) within 48 h, any decline or silence means no video; automatic checks (the display names the video draws, `HighlightRenderInput.aliases`, through the alias filter; `verifyMatchLog`, timing flag, late answers, Auto sides, duplicates) before rendering, then a human review of the MP4; withdrawal or account deletion cancels or removes; the consent trail is append-only. Races cannot publish: a withdrawal or removal is recorded first (`withdraw_pending`) and a lost compare-and-swap re-reads the job; the upload session starts only by compare-and-swap on a job still due with nothing pending; the uploader re-checks the flag and the latest consent rows after storing the session, before every chunk, and before publishing and announcing; the video id is recorded before the status, so a late withdrawal removes it and nothing is announced; an admin "Remove" during an upload records the removal and stops the upload instead of re-queueing it; nothing can schedule, retry or re-render a job with a removal pending; the sweeper removes any uploading or live job whose consent is no longer complete | Built [highlights, consentRace] |
| **Render service abuse** | Feed the Worker a forged video, replay its calls, or use the renderer to reach other hosts | Every render request is HMAC-signed (`RENDER_KEYS`, HKDF purpose key) over method, path, timestamp (±5 min), a single-use nonce (stored, replays refused) and the body's SHA-256; the MP4 is streamed into R2 with that SHA-256 so R2 itself refuses a different body; only a job under a valid lease accepts a video; the renderer serves the page from loopback and aborts every other request; its client refuses redirects, validates every claim (the job id format, the input's job, exactly `/v1/internal/render/jobs/<id>/video` as the upload path) and never builds a URL off the Worker's origin, and job ids are checked again before they name a file | Built [highlights, render-service] |
| **SSRF through the adapter** | Make the Worker send data to an attacker's URL | Upload session URIs are accepted only on `https://www.googleapis.com/upload/youtube/v3/videos?…upload_id=…` (checked when YouTube returns them and before every use) and are stored encrypted (AES-GCM, AAD bound to the job); outbound calls go to fixed Google endpoints only; the Cloudflare Access key URL is built from a validated team domain | Built [highlights] |
| **Malicious media uploads** | Get user media onto the official channel or into the app | There is no upload endpoint; avatars and kits are generated from seeds and a fixed palette (no URLs accepted); exports are generated by the server; official videos are rendered from validated structured data only | Built (no upload surface) [profile] |
| **Admin-console access** | Approve, remove or publish videos, read data | `/v1/admin/*` needs a Cloudflare Access JWT that the Worker verifies itself (RS256 against the team's keys, issuer, audience `CF_ACCESS_AUD`, expiry); outside production a ≥ 32-character `ADMIN_TOKEN` (refused in production); no admin power in player tokens; every route answers 401 otherwise (tested route by route); every action audited with the Access identity; cross-site requests are refused by the Origin allow-list; the MP4 preview is a 10-minute HMAC-signed link (plus the Access token in production); the console inserts all data as text (no HTML); a removal is recorded before it is queued and cannot be undone by scheduling or retrying | Built [admin, consentRace, tests/unit/admin] |
| **Stolen or shared device** | Keep using someone's account from a phone they lost or lent | `POST /v1/auth/logout` revokes this device's refresh family; `POST /v1/auth/revoke-others` revokes every other family of the account and answers how many; recovery through Google (or a passkey) on a new device revokes every other family; sensitive routes (highlight consent and withdrawal, profile edits such as the alias, account deletion, linking, export, revoking other devices) check that the access token's family is still live, so a revoked device is refused at once instead of when its 15-minute access token expires | Built [sessionRevocation] |
| **Floods and budget exhaustion** | Deny service to every player by spending the global budget | Two global budgets: anonymous traffic (sign-up, invite lookups, public pages, the render API before its signature is checked) and every failed sign-in spend `RL_GLOBAL_ANON` (D1 fallback `RATE_ANON_GLOBAL_*`), checked first; signed-in traffic spends `RL_GLOBAL`, checked only after the bearer token (or the admin's Access JWT) was verified and after the per-player limit, so anonymous floods and forged tokens are shed first and never use up what signed-in players need; anonymous routes count IPv6 by /56 | Built [ratelimit, hardening]; the zone WAF rule is a launch item |
| **Dependency compromise** | Run code in the Worker or app | The Worker adds no runtime dependency (WebCrypto only); the client adds none (uses existing `idb`, Capacitor plugins); exact versions pinned in the root lockfile; Google Identity Services is loaded only on the link tap; production dependencies have no `npm audit` finding; CI should add `npm audit --omit=dev` and a secret scan | Built (no new deps); scans to add in CI |

## Authentication and sessions

* **Guest first**: `POST /v1/auth/guest` needs only a locale. The account has an internal id (`u…`, the token subject)
  and a different public player id (`p…`).
* **Access tokens**: `at1.<kid>.<payload>.<HMAC>` (HKDF purpose key from `TOKEN_KEYS`), 15 minutes, verified
  statelessly; tampering, other deployments' keys and expiry are refused [auth].
* **Refresh tokens**: `rt1.<family>.<256-bit secret>`, only SHA-256 stored [auth], rotated on every use with a
  compare-and-swap on the generation. A rotated token presented again within 2 minutes gets 409 "refreshed
  elsewhere" (racing tabs); later it revokes the whole family (theft signal, audited) [auth]. Garbage for a known
  family is refused without revoking anything. A lost refresh response is replayed through the Idempotency-Key, whose
  stored response is encrypted [auth, net/session]. The client serialises refreshes across tabs with Web Locks and
  re-reads its store first [net/session].
* **Sign-out and revocation**: `POST /v1/auth/logout` revokes this device's family (idempotent); `POST
  /v1/auth/revoke-others` revokes every other family of the account and answers `{ revoked }`; recovery through a
  linked identity revokes every other family (a lost or stolen phone keeps nothing); refresh-token reuse revokes the
  family. Sensitive routes (highlight consent and withdrawal, `PATCH /v1/me`, `DELETE /v1/me`, export, linking,
  revoke-others) also check that the access token's family is live (`sessions.revoked`), so they refuse a revoked device
  at once; other routes rely on the 15-minute access-token expiry [sessionRevocation].
* **Account deletion**: deletes every family; every match object, Daily Six attempt object, cup and room forgets the
  account immediately; write routes answer 401 for a deleted account (`requireAccount`), so an unexpired access token
  writes nothing [deletion].
* **Google linking/recovery**: RS256 ID tokens verified against Google's JWKS (cached by max-age, at most one refetch
  a minute for unknown key ids), issuer, audience (`GOOGLE_CLIENT_IDS`), expiry, issue time; only
  HMAC(`IDENTITY_PEPPER`, `google:` + sub) is stored; one Google account per player; linking needs a live session;
  recovery signs every other device out; off until configured [auth, sessionRevocation].
* **Passkeys**: adapter interface with a mock (`backend/src/auth/passkey.ts`). Activation: a WebAuthn verifier with
  RP id = web host, origins = web origin and `android:apk-key-hash:<release cert hash>`, attestation none, user
  verification required, challenges stored per session (5 minutes), then `PASSKEYS_ENABLED=1` [auth].

## Sealing and batting protocol (summary)

1. Creation: 128-bit seed (encrypted at rest), SHA-256 commitment, invite nonce.
2. Lock: engine validation → canonical plan → 128-bit salt → engine commit hash → P-256 signature over
   `matchId|player|hash|engine` → plan+salt encrypted (AAD `matchId|seat|hash`). A locked over never changes; the same
   plan replays its commit, another plan is `already_locked`.
3. Batting (once the batter knows both overs are sealed: their own lock came second, or the opponent's became visible
   to them, see "Activity-time leaks"): `next` reveals one delivery
   with `bt1.<kid>.<{m,p,b,t,r}>.<HMAC>`; asking again within 20 s returns the same ball (the clock keeps running);
   after that an unanswered ball becomes a leave when the batter moves on.
   `shot` checks the token's MAC, match and seat, that it is the outstanding ball, the engine's input validation and
   the elapsed time; it returns `{ ball, timing, contact }` only. Answers made in time but delivered within 10 minutes
   count (flagged late); later ones are refused and the ball is a leave. Duplicates replay the first answer; three
   invalid answers settle the ball as a leave.
4. Reveal: both innings done (or the batting deadline, after Auto XI), at the duel's reveal slot or the cup round's
   fixed time: hashes re-checked against the decrypted plans, the engine builds the log, optionally verifies it, the log is stored gzip-compressed and only then
   readable by the two players, then archived to R2. When a player deletes the account the log names them "Deleted
   player" and the R2 copy is archived again.

## Platform controls

* **Rate limits** [ratelimit, hardening]: per network (salted SHA-256 of IPv4 /32, or of IPv6 /64 on signed-in
  routes and /56 on anonymous ones; `cf-connecting-ip` only, never `x-forwarded-for`), per account, and two global
  ceilings: anonymous traffic and failed sign-ins (`RL_GLOBAL_ANON`, checked first) and signed-in traffic (`RL_GLOBAL`,
  checked after authentication), so anonymous floods are shed first; Workers Rate Limiting bindings in production, D1
  buckets as the fallback (also when a binding throws); daily caps on guest sign-ups (per anonymous network), duels and
  group joins.
* **Idempotency** [idempotency]: required on every mutation; replays only the same request (route, params, body,
  account); different body → 409; in-progress duplicates → 409 with `retry-after`; abandoned claims are taken over
  after a minute.
* **Input limits**: 4 KB bodies (48 KB for a sealed over, 8 KB for a shot), JSON only, unknown profile fields refused,
  structural checks before anything reaches the engine [router, sealing].
* **CORS**: allow-listed origins only, no credentials, explicit methods and headers [router].
* **Headers**: API responses: `cache-control: no-store`, `nosniff`, `referrer-policy: no-referrer`,
  `x-frame-options: DENY`. Web app (`public/_headers`, applied by hosts that read it): `X-Frame-Options: DENY`, a
  `Content-Security-Policy` header with `frame-ancestors 'none'; base-uri 'self'; object-src 'none'` (framing cannot be
  set from the meta CSP), HSTS, `nosniff`, a Permissions-Policy, and `no-store` plus `noindex` for `admin.html`. A host
  that ignores `_headers` (GitHub Pages) applies none of them and shares its origin with the account's other sites, so
  a dedicated origin is a launch blocker.
* **Logging**: route patterns, never concrete paths (invite tokens), addresses, tokens, ids or aliases [router];
  invocation logs off; free-text error messages are scrubbed of token-like strings.
* **Audit log** (D1, 180 days): account created/linked/recovered/deleted, export, refresh reuse, sign-out, other
  devices revoked (with the count), alias rejected,
  group created/joined, duel created, invite accepted, over locked (with hash), Auto Over/Auto XI, reveal (with seed
  commitment), expiry, reports, blocks, admin actions (with the operator's Access identity). Player actors are
  pseudonymous (`sha256("audit:" + uid)`, 16 hex).
* **Highlights**: consent records and moderation decisions are append-only D1 rows (YOUTUBE_OPERATIONS.md); a pending
  withdrawal or removal is the job's `withdraw_pending` (1 a participant, 2 an admin); public landing data
  (`GET /v1/h/:code`) exists only for published or unlisted videos; the room's highlight card is taken down when the
  video is removed; attribution counters are per code per day and never identify anyone.
* **Pushes**: FCM messages carry a kind and ids; the collapse key is the dedupe key without the recipient's internal
  account id [hardening].
* **Client storage**: tokens in `SecureStore`: encrypted IndexedDB with a non-extractable key on the web, and in the
  Android app the `VandeSecureStorage` plugin (AES-256-GCM with a non-exportable Android Keystore key, registered in
  `MainActivity`); the outbox stores only requests the player made.

## Open items

1. **Daily Six over sharing: decided (root, wave C), accepted.** The overs cannot be computed in advance (one secret
   server salt from `DAILY_SALT_KEY`, which also keeps the engine's three-day pitch rotation), but a finished attempt's
   replay shows the over it faced and over A, B or C is the same for everyone that day, so an early player can tell
   others what is coming. This is accepted as part of the social game, like sharing a puzzle answer: Daily Six boards
   are friendly, the Daily Top 100 never uses Daily Six, share cards stay spoiler-free, the next attempt is always a
   different over, and the fresh secret seed of every attempt keeps outcomes unpredictable.
2. **Late window as thinking time**: a client can claim a small `clientElapsedMs` for an answer it actually took
   minutes to choose (inside `BALL_LATE_MS`). Late answers are counted per innings with the missed balls (a ball shown,
   then settled as a safe leave: expired, three invalid answers, or waiting at the batting deadline, so closing the
   app on a dangerous delivery is not free); more than one in either innings makes a match ineligible for the Top 100
   (`TOP100.maxLateAnswers`) and keeps a Daily Six attempt off the boards (`MAX_IRREGULAR_BALLS`).
3. **Web XSS** would let page script use the session (not export the key): root adds a strict CSP (no inline script;
   `connect-src` the API and, only when enabled, PostHog; `script-src` adds `https://accounts.google.com` only if
   Google linking is on).
4. **Global ceilings are per Cloudflare location** with bindings; the zone WAF rule and billing alerts are in
   LAUNCH_BLOCKERS. Anonymous IPv6 counts by /56 (`ANON_IPV6_PREFIX`): /48 is stricter but would group large mobile
   carrier pools, /64 is the old behaviour.
5. **Not built yet**: the passkey verifier. The real YouTube adapter and the render service are built but have never
   talked to Google or run Chromium here (no network, no Playwright in this wave); `RealYouTube` is exercised only by
   type checks until credentials exist. The Android plugins are compiled by root's Gradle runs.
6. **Dependency scan**: production dependencies have no `npm audit` finding; `npm audit` reports 3 moderate
   advisories, all in development tooling (`uuid` through `xcode` through `@capacitor/cli`), none in the app or the
   Worker bundle.
7. **Activity jitter delays the first locker's batting** by up to 10 minutes after the second lock (they bat once the
   opponent's lock is visible to them; the second locker bats at once), and a duel's reveal waits for its slot (1–6
   minutes after the second innings): the price of not telling when anyone played; windows are 1 hour or more.
8. **Finished replays stay as played**: `HighlightRenderInput.aliases` carries the moderated display names the video
   draws; the replay log inside the input keeps the match-time aliases (it is the verified record), so the renderer
   must draw `aliases`, never `log.players[].alias`.
