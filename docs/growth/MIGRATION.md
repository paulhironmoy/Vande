# Migration: from the bowling-plan Sealed Six to the physics Sealed Over

> **Stage 4–6, not active: paths in this document refer to code that is not built.** The owner's product sequence
> keeps these stages closed; see [VANDE-PRODUCT-SEQUENCE.md](../VANDE-PRODUCT-SEQUENCE.md) and the
> [docs index](../README.md).

> **Status: Stage 4–6 design, not authorized for build.** Building waits for the stage gates in
> `docs/VANDE-PRODUCT-SEQUENCE.md`. The owner decided on 2026-10-26 that the Sealed Six is retired through a
> feature-flagged migration in Stage 4. Its code and tests stay until then; the Stage 1 launch already hides its entry
> behind a build flag.

## 1. What each module becomes

The rule is **reuse, adapt, or retire only after proof** (§4).

### Client engine (`src/engine`)

| Module | Fate | Notes |
| --- | --- | --- |
| `src/engine/v1/**`: probability engine, innings, plans, traces, verify, daily, policies, tables | **Retire** | No physics path uses it |
| `src/engine/index.ts`, `registry.ts` | Retire; **pattern reused** | `src/sim/registry.ts` maps a sim version to a physics bundle, as `ENGINES` maps engine versions |
| `src/engine/prng.ts`, `sha256.ts` | **Keep** (frozen primitives) | Move to `src/core/` with re-export shims. Used by physics (`delivery.ts`), Practice (`overs.ts`), audio and render3d. |
| `src/engine/canonical.ts` | **Keep `canonicalJson`** (move to `src/core/`) | Plan helpers retire |
| `src/engine/ranking.ts` (Elo, Top 100) | Retire (owner decision O7) | Friend challenges need no rating. Top 100 is replaced by opt-in boards and publishing in Stage 6. |
| `src/engine/advice.ts`, `training.ts`, `auto.ts` | Retire | The planner, the tutorial and Auto Over/Auto XI. DNP replaces auto play. |
| `src/engine/fieldDisplay.ts` | **Adapt** | Into `src/render3d/core/ground.ts`, its only consumer |
| `src/engine/sim/**` | Retire | Replaced by `scripts/sim-bench.mjs` and the Today's Over setter |

### Contracts (`src/contracts`)

| Module | Fate | Notes |
| --- | --- | --- |
| `cricket.ts`, `engine.ts` | Retire | First move `FieldZone`, `AvatarSpec` and `PitchId` (if still used) into `practice.ts` or `social.ts` |
| `api.ts` (v1) | **Shrink** | Keep auth, profile, push, report, blocks and keys. Duel, match, cup, room, daily, top100 and v1 highlight routes retire. |
| `social.ts` | Keep the profile and locale types | `MatchView`, `CupView`, `RoomView` and `DailyView` retire |
| `highlights.ts` | **Adapt** | `HighlightRenderInput.log` becomes physics records under a pinned sim. The consent and moderation types stay. |

### Physics and rendering

| Module | Fate | Notes |
| --- | --- | --- |
| `src/physics/matchPath.ts` (`flightFromPath`), `aim.ts` (`aimShot`) | Retire with the old reveal | Their consumers are the outcome-first choreography only |
| `src/render3d/core/engineBridge.ts`, `choreo.ts` | Retire | The Practice replay path (records re-simulated) replaces them |
| `src/highlight/**`, `render.html` | **Adapt** | The deterministic frame composer is reused for clips on the device and for opt-in publishing |

### Screens and social UI

| Module | Fate | Notes |
| --- | --- | --- |
| `src/screens/{planner,batting,match,reveal,daily,ghosts,training,local,shared,duel,invite,replay,stage}` | Retire | New screens under `src/growth/**` |
| `src/screens/home` | Replace | Home v2: the primary action (`growth.home_v2`) |
| `src/screens/onboarding` | **Adapt** | Age screen and alias, at the first ranked play |
| `src/social/**`: cups, rooms, leaderboards, top100, highlights | Retire, or adapt in Stage 6 | Profile and settings parts are kept |

### Client networking and platform

| Module | Fate | Notes |
| --- | --- | --- |
| `src/net/batting.ts`, `practice.ts` (late play) | Retire | |
| `src/net/client.ts`, `outbox.ts`, `session.ts`, `idb.ts`, `connectivity.ts` | **Reuse** | `routes.ts` gains v2 |
| `src/platform/deepLinks.ts`, `installReferrer.ts`, `shareMoments.ts`, `share.ts`, `push.ts` | **Adapt** | New paths `/o/`, `/g/`, `/b/` and `/t`; referrer `vc_o`, `vc_g`, `vc_b`; new texts; moments |
| `src/analytics/**` | **Extend** | `ANALYTICS.md` |

### Backend

| Module | Fate | Notes |
| --- | --- | --- |
| `backend/src/match/matchDO.ts`, `state.ts`, `shape.ts`, `protocol.ts`, `routes.ts` | Retire `MatchDO`; **reuse its patterns** in the new `backend/src/over/` | Op queue, batched writes, object idempotency, ball tokens, jitter, reveal slot |
| `backend/src/match/inviteCodes.ts`, `moments.ts`, `share.ts` | **Reuse or adapt** | Codes for `/o/`, the share cap with the `reveal` moment |
| `backend/src/cup/**` | **Adapt** into `TournamentDO` (Stage 6) | `schedule.ts` presets and the alarm structure |
| `backend/src/room/**` (Cricket Rooms) | Retire (O7) | Not part of the growth brief; it would add clutter |
| `backend/src/daily/**` | **Adapt** into Today's Over (Stage 5) | The salt mechanism becomes definition sealing, and the histogram-rank boards are reused |
| `backend/src/top100/**` | Retire (O7) | |
| `backend/src/highlights/**`, `render-service/` | **Keep**, off | Opt-in publishing programme in Stage 6 |
| `backend/src/ops/**` | **Reuse and extend** | Timezone quiet hours, kinds, digests, metrics |
| `backend/src/security`, `guards`, `auth`, `profile` | **Reuse** | Deletion and export extended (`BACKEND.md` §5) |
| `backend/src/engines.ts` | Replace | Sim registry injection |
| `backend/migrations/0001–0008` | Keep the files | New `0009+`. Retired tables (`match_results`, `daily_*`, `top100_*`, `room_settings`) are dropped in a later migration only after §4. |

### Tests

| Module | Fate |
| --- | --- |
| `tests/unit/engine/**`, the `flow-*` and `social-*` e2e suites | Retire **together with** the code they test, never before |

## 2. Feature flags

Server-provided by `GET /v2/config`, with built-in client defaults. The Worker reads `wrangler.toml` vars. Every
`growth.*` flag is **off** until its stage opens.

| Flag | Stage | Default today | Gates |
| --- | --- | --- | --- |
| `legacy.sealed_six` | — | off on the launch (Stage 1 decision); code kept | Old duel, planner, batting and reveal screens; `/v1` match routes |
| `legacy.daily_six`, `legacy.cups`, `legacy.rooms`, `legacy.top100`, `legacy.youtube` | — | off | The matching old features |
| `growth.sealed_over` | 4 | off | Challenges, attempts, links, reveal, rematch |
| `growth.rivalries`, `growth.series` | 4 | off | Rivalry views and best-of series |
| `growth.home_v2` | 4 | off | The primary-action home |
| `growth.todays_over`, `growth.rhythm`, `growth.coach_ball` | 5 | off | The daily features |
| `growth.notifications_v2` | 5–6 | off | Pushes (none in Stage 4) |
| `growth.tournaments`, `growth.clips` | 6 | off | Groups, playable highlights |
| `growth.publishing` | 6 | off | Opt-in YouTube programme (also needs `legacy.youtube`) |
| `growth.anon_counters` | 4+ | off until O4 | `POST /v2/m` |

## 3. Data migration

- **Server: none.** Nothing is deployed: migrations 0001–0008 were never applied, no Durable Object exists, and there are no production accounts.
  - Because `MatchDO`, `CupDO` and `RoomDO` were never deployed, root can simply drop them from the wrangler `[[migrations]]` tags before the first deploy. No `deleted_classes` step is needed.
- **Client: Practice data is untouched.** That covers the innings, form, mastery, calibration, settings and local metrics, whose versions belong to Practice.
- **Old Sealed Six local data** exists only for visitors of the GitHub Pages preview: Training and Ghosts progress, an outbox, and the share ledger.
  - It is removed by a one-time cleanup when `legacy.sealed_six` is removed.
  - The share ledger key is reused for the new moments.
  - A release note says so; there is no conversion.

## 4. Deleting code: only after it is proven unused

A module may be deleted only when **all** of these hold:
1. Its flag has been off in **one shipped release build** (web and Android).
2. An import scan (`rg "from '@/engine"` and similar) shows **no remaining importer** outside the code being deleted.
3. `npm run typecheck:all`, every unit and render suite and the Practice e2e suite pass **after** the deletion. Tests are removed only together with the code they cover.
4. The bundle-size check shows the drop, and nothing else changed.
5. The owner approves the deletion list in the decision log (`docs/VANDE-PRODUCT-SEQUENCE.md` §8).

**Order:**
1. legacy screens and routes;
2. backend v1 match, cup, room, daily and top100 routes and objects;
3. `src/engine` (after `prng`, `sha256` and `canonical` have moved);
4. `physics/matchPath.ts`, `aim.ts`, `render3d/core/choreo.ts` and `engineBridge.ts`;
5. the `cricket.ts` and `engine.ts` contracts;
6. the docs (`GAME_RULES.md` stays in git history).

## 5. How the app keeps working throughout

- **Practice is never touched by growth work.** It stays offline-first, with no account and no network.
- **v2 is built beside v1** under new paths (`backend/src/over/`, `src/growth/`, `/v2`). Each flag turns on only once its stage gate passes.
- **Kill switches:** any `growth.*` flag can be turned off server-side; `VITE_KILL_ONLINE=1` removes networked play. Practice continues in both cases.
- **Version safety:** every challenge is pinned to its sim version (`CONTRACTS.md` §9), so a physics update never changes a challenge in progress.
