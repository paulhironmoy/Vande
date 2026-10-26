# Privacy and consent

Status: wave C (Daily Top 100 and consented highlights) plus the security fix wave (deletion completeness, a complete
export, session revocation). Platform-owned. Describes what the implemented backend and client store, why, for how long, and how
players see, export and delete it. Not legal advice: the launch needs a review against India's Digital Personal
Data Protection Act 2023 and its Rules, and Google Play's Data safety and Families policies (see "Open items").

## What the game never collects

No phone number (no SMS sign-in), no email address, no real name, no contacts or address book, no GPS or precise
location, no photos or uploads, no advertising id, no free-text chat by default, no IP address stored by the service.
Only when product analytics are configured and the player opted in does a processor see the device's address: PostHog
receives it with each event (see "Processors"); every event asks it not to geolocate the address, and the owner must
turn on PostHog's "Discard client IP data" setting before analytics are enabled.

## What is stored, where, and for how long

| Data | Where | Why | Retention |
| --- | --- | --- | --- |
| Account: random internal id, random public player id, alias, generated avatar seed, kit colours, locale, optional coarse city (fixed list), 18+ confirmation (required to create the account), unlocks (deliveries earned in official matches), badges, rating, creation day, and the end of a moderator's suspension from social features (if any) | D1 `accounts` | Play, show the player to friends | Until the player deletes the account; then a scrubbed tombstone for 30 days |
| Sessions: SHA-256 of the refresh secret, generation, hour created | D1 `sessions` | Stay signed in | Until signed out (`POST /v1/auth/logout`), revoked from another device (`POST /v1/auth/revoke-others`) or by recovery on a new device, or 365 days of inactivity; revoked ones go a day later; deleted with the account |
| Linked sign-in: HMAC of the Google subject or passkey credential id (never email or name) | D1 `identities` | Recover the account on a new device | Until unlinked or the account is deleted |
| Private groups: name typed by the creator, invite code, membership | D1 `groups`, `group_members` | College/company leaderboards visible to members only | Membership deleted with the account |
| Match list: the player's own redacted view of each match | D1 `match_players` | Home screen | 400 days |
| Match: both players' public refs, commit hashes (hour of locking), encrypted plans and seed, batting inputs (shot, zone, tap time, swipe trace), the revealed replay, and when each lock and finished innings became visible to the opponent (activity jitter) | Durable Object storage | Fair, verifiable results and replays | Life of the replay; account deletion replaces the player with "Deleted player" everywhere (also inside the revealed replay and its R2 archive) |
| Push device tokens | D1 `push_tokens`, AES-GCM encrypted | Notifications the player turned on | Until the provider rejects them, a newer device replaces them (max 5), or the account is deleted |
| Match results: the two internal account ids, runs and wickets, winner, late and auto counts, timing-audit flags, ratings before the match and their change, the engine's per-player performance (tactical efficiency, clutch, execution) | D1 `match_results` | Ratings, friends leaderboard, Daily Top 100 | 400 days; account ids scrubbed on deletion (a seat whose account was deleted before the reveal is written as `x:deleted`, and friends are recorded only between active accounts) |
| Rating, rated-match count and long-term effort (a moving average of tactical efficiency) | D1 `accounts` | Fair matchmaking signals and the Top 100's anti-tanking baseline | With the account |
| Daily Top 100: rank, alias at the cutoff, score, the counted match ids and score components | D1 `top100_entries` | The public daily leaderboard and the permanent badge | Kept (public history); the alias becomes "Deleted player" on deletion |
| Highlight jobs: the match, both participants' public ids, aliases and avatar seeds as shown, ranks, title, description, visibility, status, a pending withdrawal or removal, the YouTube video id | D1 `highlight_jobs` | Making the official Short, only with consent | 400 days after the job closes; longer while the video is live; after an account deletion the player's seat, alias, title and description say "Deleted player" |
| Consent records: decision, 18+ confirmation, the approved title and visibility, reason (timeout, withdrawal, deletion), time | D1 `highlight_consents` (append-only) | Proof that nothing is published without consent | With the job; after an account deletion the record keeps a tombstone id instead of the player and its approved title is rewritten without the alias |
| Rendered highlight videos (MP4) | R2 `tmp/highlights/` | Review and upload | 72 h after a confirmed upload or once the job closes |
| Archived replays of duels and cup matches | R2 `logs/` | Highlights, audits, replays that outlive the match object | Kept; account deletion archives the anonymised replay again, so a deleted player appears as "Deleted player" there too; an archived replay is public only while its highlight is consented and live, or through a shared match link (below) |
| Shared match links: a keyed code per revealed match, the match id, its kind and the two internal account ids | D1 `shared_matches` | A player chose to share a revealed duel or cup match (`https://<web>/s/<code>`) | Kept while the match is; the page shows each player's current alias and becomes "Deleted player" (also inside the replay it serves) once that player deletes their account, whose id is then scrubbed |
| Short invite codes: a random 10-character code, the signed invite token it stands for, its expiry | D1 `invite_codes` | Short invite links (`https://<web>/i/<code>`); no person is stored | Deleted by the nightly cleanup once expired |
| The share cap: which moment (invitation, reminder, final) of which match or cup the player opened a share for, and when | D1 `share_moments` | Each moment is shared at most once per player, also across devices | 90 days; deleted with the account; in the export |
| Attribution counters: highlight code, IST day, event (landing open, share, install, invite open, completed match, views), count | D1 `attribution_daily` | Measuring what highlights bring, without tracking people | 400 days |
| Friends: pairs of accounts that finished a match together | D1 `friends` | Friends leaderboard | Until either account is deleted |
| Cup membership | D1 `cup_players`; the cup's Durable Object (members, fixtures, standings) | Group Cups | Cup object for the life of the cup; deleted players become "Deleted player" |
| Cricket Room: members, posts (system events, banter, free text only if enabled), reactions, mute/notify settings | Room Durable Object; settings mirrored in D1 `room_settings` | Rooms | Last 200 posts per room; a deleted player becomes "Deleted player" as a member, as an author and in every card that named them (and in a duel room's title); a highlight card goes when its video is removed |
| Daily Six: attempts used and the ids of the attempt objects, best score per day (with a snapshot of alias, avatar seed and city for the board), streak | D1 `daily_attempts`, `daily_scores`, `daily_players`; each attempt's Durable Object (its replay) | Daily Six and leaderboards | Attempt rows 32 days, attempt objects 30 days after their reveal, scores 90 days, streak until deletion; board rows are written only for active accounts |
| Notification preferences: on/off, quiet hours | D1 `notify_prefs` | Respecting the player's choice | Until changed or deletion |
| Idempotency records (encrypted stored responses) | D1 `idempotency` | Safe retries | 24 hours |
| Rate-limit buckets: salted hashes of a network or account | D1 `rate_buckets` (fallback only) | Abuse protection | ≤ 2 days |
| Audit log: pseudonymous actor hash, action, match/group id, small non-personal details; moderators' actions on reports with the moderator's Cloudflare Access identity and their notes | D1 `audit_log` | Security investigations, accountability for moderation | 180 days |
| Reports: an opaque reference to the reporter (nobody, moderators included, can turn it back into a player), the reported player or post, the reason, the status and how a moderator closed it; blocks | D1 `reports`, `blocks` | Safety: the moderation queue in the admin console (dismiss, a generated safe name, a suspension from social features, taking a post down) | Reports kept as the moderation record; the reports a player filed are in their export; blocks deleted with the account |
| Exports | R2 | The player's copy of their data | 24 hours |
| Logs | Workers Logs | Operations | Provider retention (3–7 days); route patterns, status and timings only, no ids, tokens, aliases or addresses |
| Counters | Analytics Engine | Capacity and abuse monitoring | Provider retention; route patterns and error codes only |

Times shown to other players are hour-resolution at most (commit hours); deadlines are public rules. A lock or a
finished innings reaches the opponent, the cup and the room only after a random delay of one to ten minutes (the
activity jitter), and a duel reveals for both players at the next five-minute slot at least a minute after both
innings end, so nobody learns when someone played. A player learns at once only what their own action completes (the
second to lock can bat at once; the second to finish sees the reveal countdown at once). The match object keeps the
exact server times it needs (the ball clock, the order of the two locks and innings); they never leave it.

On the device: the session (encrypted IndexedDB on the web, the Android Keystore plugin in the app), queued requests
(the outbox), a pending invite or highlight code from the install referrer (read once; the code is reported once as
an attributed install, then kept only as "already reported"), the analytics consent choice and, only with consent, a
random analytics id that changes every month; the first-open day, which retention events and which cup milestones
were sent (`vc:first-open`, `vc:retention-sent`, `vc:cup-events`: dates and cup ids, never sent themselves); the
answer of the age screen (`vc:age`: only "adult" or "under", never the date of birth); and the share ledger
(`vc:share-ledger`: which match or cup ids had their invitation, reminder or final message shared, never any text,
contact or recipient; a cache of the server's share cap).

## Consent

* **Product analytics: opt-in.** Off unless a provider is configured, the player says yes, and the browser sends no
  Do-Not-Track / Global Privacy Control signal. Declining changes nothing in the game. Details: docs/ANALYTICS.md.
* **Push notifications**: asked only after a meaningful moment (never on first launch), Android's own permission
  dialog; messages contain ids (match, cup, job) and a kind only, never the account id, and the visible text comes
  from the app's translations. Players can turn
  them off entirely or set quiet hours (`/v1/push/settings`), mute a room or limit it to important events; the server
  caps pushes per day and never pushes routine events during quiet hours.
* **Leaderboards**: national and city boards show alias, generated avatar and score; college and company boards are
  visible to members of that private group only; the city is the coarse one the player chose (never GPS) and is
  optional.
* **Highlight publication: explicit, per video, from every participant.** After the 00:00 IST cutoff each Top 100
  player whose best match was chosen is asked (push "top100") to review the exact cut in the app, with both aliases,
  the title, the description and the visibility. Publication needs "granted" from every participant, each with the
  18+ confirmation (`adultConfirmed`) and a visibility choice (the stricter one wins: unlisted over public). Any
  decline, or no answer within 48 hours, means no video. Players appear only under their chosen alias and generated
  avatar; titles and descriptions come from fixed templates over aliases (never a real name). The Top 100 badge is
  permanent whether or not a video is made.
* **Withdrawal at any time** (`POST /v1/highlights/:jobId/withdraw`, or deleting the account): the withdrawal is
  recorded first, so no step running at that moment can publish afterwards; before the upload the job is cancelled
  and the rendered video deleted at once; during the upload it stops at its next check (no video), and a video that
  already exists is deleted from YouTube, normally within minutes and at most within 24 hours, and is never announced
  (YOUTUBE_OPERATIONS.md, "Consent"). A sweep every 15 minutes removes any uploading or live video whose consent is no
  longer complete. Deciding or withdrawing needs a device that is still signed in.
* **Public highlight pages** (`https://<web>/h/<code>`) show the title, both aliases, avatars and ranks and the replay,
  and exist only while the video is published or unlisted with consent.
* **Sharing**: only through the system share sheet or a wa.me link the player taps; nothing is sent automatically and
  no contacts are read. Each player shares each moment of a match or cup at most once (the invitation, one reminder
  before its deadline, and the final reveal or its highlight), so friends are not spammed. The server keeps that cap
  (`share_moments`: the player, the match or cup id, the moment and when it was first opened; never any text, contact
  or recipient), so clearing the app's data or another device does not reset it; offline, the device's own ledger
  decides.
* **Shared match pages** (`https://<web>/s/<code>`): a participant may share a revealed match; the page shows the
  conditions, both players' current aliases and the replay, and names a player who deleted their account "Deleted
  player".

## Rights: access, export, correction, deletion

* **See and correct**: `GET /v1/me`, `PATCH /v1/me` (alias, avatar, kit, locale, city; from a device that is still
  signed in). The 18+ confirmation given at sign-up cannot be switched off (VANDE Cricket is for players aged 18 and
  over): a player who meant otherwise deletes the account.
* **Sign out**: `POST /v1/auth/logout` ends this device's session; `POST /v1/auth/revoke-others` ends every other
  device's (recovery on a new device does the same).
* **Export**: `POST /v1/me/export` writes a JSON file to R2 and returns a signed link valid for 24 hours. It holds the
  profile and groups; signed-in devices by hour and push devices by platform; the player's match views; for every
  revealed duel and cup match the player's seat, the score, the result, the rating before the match and its change,
  the integrity counts (late answers, missed balls, Auto Over or Auto XI, the timing-audit flag) and the engine's
  performance figures used by the Top 100 (`matchResults`, never the opponent's internal id); Daily Six best scores,
  attempts per day and the streak; notification settings and per-room settings; cup memberships; friends (public id,
  alias, since); blocks; reports the player filed; the share cap's records (`shareMoments`: match or cup id, moment,
  hour); Top 100 entries; highlight jobs and the player's consent records.
  Revealed replays are available in the app per match. [backend/test/profile.test.ts, deletion.test.ts]
* **Delete**: `DELETE /v1/me` (from a device that is still signed in) immediately: every match and every Daily Six
  attempt object of the last 32 days the player is in forgets them (the seat becomes "Deleted player", including the
  revealed replay and its archived copy in R2; a match in progress continues for the opponent with Auto Over / Auto XI;
  an attempt in progress finishes at the reset without reaching any board); every cup and Cricket Room replaces them
  (as a member, as an author, in every card that named them and in a duel room's title; highlight cards that named them
  go); sessions, linked identities, push tokens, group memberships, blocks, exports, match-list rows, friends, cup
  memberships, Daily Six attempts, scores and streak, notification preferences, room settings, the share cap's records
  and idempotency records are deleted, and the account ids in match results are scrubbed; every highlight consent is withdrawn (open jobs
  cancelled, live videos removed) and every highlight title, description and approved title is rewritten with "Deleted
  player"; the player's Top 100 entries, highlight jobs and consent records keep only a tombstone id; the account row
  is scrubbed and purged after 30 days. Write routes refuse the deleted account at once, so an unexpired access token
  recreates nothing. Objects that cannot be reached at that moment are retried from the maintenance queue. The
  remaining match data (plans and inputs of a deleted seat) is no longer linked to any identifier.
  [backend/test/profile.test.ts, deletion.test.ts]

## Processors

| Processor | Data | When |
| --- | --- | --- |
| Cloudflare (Workers, Durable Objects, D1, R2, Queues, Analytics Engine, Logs) | Everything above | Always (once deployed) |
| Google Firebase Cloud Messaging | Device token, notification kind and ids (match, cup, job; never the account id) | Only for players who enabled notifications |
| Google Identity | The ID token the player chose to send | Only when linking or recovering with Google |
| PostHog | The closed analytics events, and the device's IP address with each request (GeoIP lookups are switched off per event; "Discard client IP data" must be on in the project) | Only when configured and consented |
| Google YouTube (Data API) | The rendered Short of a consented highlight: aliases, avatars, the match as played, title and description | Only after every participant consented and an admin approved; deleted on withdrawal |
| Google Cloud Run (render job) | The highlight's render input (the replay with aliases and avatar seeds) while rendering | Only for consented, checked highlights; nothing is stored there after the job |

## Open items (for the root agent's LAUNCH_BLOCKERS.md)

1. Legal review for DPDP: notice text, consent records, a grievance contact, and the age policy. Conservative
   default until then: VANDE Cricket is 18+ (the Act treats under-18s as children who need verifiable parental
   consent). A neutral age screen asks once at first run and keeps only its outcome on the device; the server refuses
   a sign-up without the confirmation (`adultConfirmed`, 403 otherwise) and records it on the account; it cannot be
   switched off later. The game also collects no contact data, keeps analytics opt-in and ads off, and gates highlights
   to 18+.
2. Choose the D1 primary region and Durable Object location (Asia-Pacific hint set) and record it in the notice.
3. Play Console Data safety form from the table above; privacy policy URL.
4. Report review: built (the admin console's report queue, every action audited). Still open: the moderation policy
   and response times, and how long closed reports are kept.
5. YouTube: the channel's own privacy policy and the uploads' "altered or synthetic content" disclosure (the Shorts are
   rendered animations of real matches between consenting players; decide with legal whether the disclosure applies).
6. Before analytics are enabled: turn on PostHog's "Discard client IP data" project setting (the capture API cannot
   stop the address reaching PostHog; events already ask it not to geolocate).
