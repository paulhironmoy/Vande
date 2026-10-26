# VANDE Cricket API

Cloudflare Worker (versioned `/v1` JSON API), Durable Objects per match (`MatchDO`: duels, cup fixtures, Daily Six
attempts), per Group Cup (`CupDO`) and per Cricket Room (`RoomDO`), D1 for accounts, groups, match lists, results,
friends, ratings, Daily Six scores and leaderboards, the frozen Daily Top 100, highlight jobs with their consent and
moderation records, attribution counters, notification preferences, idempotency, rate-limit fallback and audit, R2 for
exports, archived replays and temporary highlight videos, Queues for notifications, maintenance and highlight uploads
(with dead-letter queues), Workers Rate Limiting, Analytics Engine counters and three cron triggers. **Nothing here is
deployed**; `wrangler.toml` is deployment-ready. Operations: `docs/INFRASTRUCTURE.md`. Threat model:
`docs/SECURITY.md`. Highlights: `docs/YOUTUBE_OPERATIONS.md`. Data and consent: `docs/PRIVACY_AND_CONSENT.md`. Costs: `docs/COST_MODEL.md`.

## Layout

| Path | What |
| --- | --- |
| `src/index.ts` | Production entry: wires the real `@/engine` into `createWorker` and exports `MatchDO` |
| `src/app.ts` | Request pipeline and the route table (every `ApiRoutes` key, checked at compile time) |
| `src/engines.ts` | Engine injection: a registry by `ENGINE_VERSION`; matches always use the version they started with |
| `src/match/` | `MatchDO` (sealing, one-ball batting, deadlines and reminders, reveal with the timing audit, ratings, earned deliveries (unlocks) and the R2 archive, rematch; duel, cup-fixture and Daily Six modes), views, input checks, Worker routes, short invite codes (`inviteCodes.ts`), shared match links (`share.ts`) and the share cap (`moments.ts`) |
| `src/cup/` | `CupDO` (gathering, start or cancel, round robin, round reveals, standings, final, badge), schedule rules, routes |
| `src/room/` | `RoomDO` (members-only room: spoiler-safe auto-posts, reactions, banter, settings), routes |
| `src/daily/` | Daily Six routes (server salt, published over commits), the Daily Six setter, leaderboards (histogram ranks) |
| `src/top100/` | The 00:00 IST Top 100 cutoff (`rankTop100`, badges, jobs) and `GET /v1/top100/:day` |
| `src/highlights/` | Highlight jobs, consent, moderation, the signed render API, the YouTube adapter (mock and real), quota, the resumable uploader, the public landing and attribution, the sweeper |
| `src/admin/` | Admin console API (`/v1/admin/*`: highlight jobs, quota, dead letters, and the report queue in `reports.ts`) and Cloudflare Access JWT verification |
| `src/auth/` | Guest sign-up, refresh rotation with reuse detection, Google ID-token verifier (JWKS), passkey adapter |
| `src/profile/` | Profile, groups, push registration, reports and blocks, export and deletion workflows |
| `src/security/` | Encodings, HKDF purpose keys, AES-GCM envelopes, HMAC tokens, P-256 commit signatures, fail-closed secrets |
| `src/guards/` | Per-network / per-player / global rate limits (bindings, D1 fallback) and D1 idempotency |
| `src/ops/` | Audit log, metrics, queue consumers with the notification policy (opt-out, room settings, quiet hours, caps), FCM sender (mock by default), notification settings routes, cron cleanup |
| `migrations/` | D1 schema (`0001_cricket_core.sql`, `0002_social.sql`, `0003_top100_highlights.sql`, `0004_missed_balls.sql`, `0005_attempt_ids.sql`, `0006_shared_matches.sql`, `0007_invite_codes_share_moments.sql`, `0008_moderation.sql`) |
| `local/` | In-process backend (in-memory DO, R2, Queues, rate limiter; SQLite D1), dev server, dev-secret generator |
| `test/` | Fake engine and the test suites (auth, authz, sealing, batting, deadlines, invites and short codes, idempotency, rate limits, profile, queues, cups, rooms, daily and leaderboards, notifications, integrity, Top 100, highlights, YouTube (the real adapter against a stubbed Google), moderation, the share cap, admin, cost, real engine) |

## Commands (from the repository root)

```bash
npx vitest run backend                     # Worker tests (in-process, fake engine; realEngine.test.ts uses @/engine)
npx tsc -p backend/tsconfig.json --noEmit  # Worker typecheck
node backend/local/serve.mjs               # local API on http://127.0.0.1:8787 (in memory; --engine real|fake|auto, --web-origin <url>)
VITE_API_LOCAL=1 npm run dev               # the app against the local API
```

`wrangler dev --local` also works with `backend/.dev.vars` from `node backend/local/dev-secrets.mjs`; see
`docs/INFRASTRUCTURE.md` for that and for the production activation steps.
