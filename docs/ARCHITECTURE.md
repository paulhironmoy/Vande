# VANDE Cricket — Architecture

Status: living document. Root-owned; workstreams update their own sections.

## Product shape

The active product is offline **Practice**: launch → Random Over or Predefined Over. The retained Three/Classic
surfaces remain first-person; the Unity engineering path uses the owner's 2026-10-28 stable rear-shoulder camera
directive so the full batter and bowler are visible without changing TypeScript authority. Stage 0 restores the
integrated baseline; Stage 1 validates Practice quality. Later stages remain closed under
`docs/VANDE-PRODUCT-SEQUENCE.md`, `docs/VANDE-EXPERIENCE-CONSTITUTION.md` and
`docs/prompts/VANDE-INTERFACE-ASSET-CONSTITUTION.md`.

The preserved legacy product is asynchronous social cricket. Its **Sealed Six** is two one-over innings: each player seals a six-ball
bowling plan, bats against the opponent's sealed over whenever convenient, and both innings are revealed together as a
cinematic match. Modes: Training (offline), Daily Six, Friend Duel, Group Cup (3–10 players), Practice Ghosts (offline).

## Runtime layout

```
Android (Capacitor WebView) ─┐
Web / installable PWA ───────┼─► React app (src/) ──► src/net (API client, outbox, sync) ──► Cloudflare Worker (backend/)
                             │        │                                                     ├─ MatchDO  (one per match or Daily Six attempt: seal, bat, reveal)
                             │        ├─► src/render3d (Three.js MatchRenderer, 2D fallback) ├─ CupDO    (one per Group Cup: fixtures, standings, alarms)
                             │        └─► src/engine (deterministic rules, shared)            ├─ RoomDO   (one per Cricket Room: posts, reactions, banter)
                             │                                                               ├─ D1       (accounts, groups, leaderboards, Daily Six, Top 100, jobs, consents, audit)
                             │                                                               ├─ R2       (archived replays, temporary videos, exports)
                             │                                                               ├─ Queues   (vande-notify, vande-maint, vande-media, each with a dead-letter queue)
                             │                                                               └─ Cron     (Top 100 cutoff 00:00 IST, consent sweep, cleanup)
render-service/ (Cloud Run job) ◄── media queue: headless Chromium drives render.html (src/highlight) frame by frame → FFmpeg → Worker → R2
YouTube (MockYouTube in local and test runs; RealYouTube with server-only OAuth secrets) ◄── media queue, after consent and approval
FCM (off until the Firebase credentials are configured) ◄── notify queue
admin.html + src/admin (Cloudflare Access) ──► /v1/admin/* (highlight review, reports, quota, dead letters)
```

The engine (`src/engine`) is pure TypeScript with no DOM or Node APIs. The same code runs in the browser (Training,
Ghosts, presentation), in the Worker (authoritative results) and in the render service (via the built renderer page).

## Practice (offline batting, 2026-10-25; Unity camera amended 2026-10-28)

Physics-first and fully on the device: gesture → `NormalizedSwing` (src/input) → virtual bat → swept bat–ball
collision → ball trajectory → fielding → runs or wicket (src/physics) → presentation and replay (src/render3d), with
the one-wicket, ten-over innings in src/practice/game and the screens in src/practice/ui. A normal start (the app opened
at `/`) opens Practice directly (`src/App.tsx`); existing legacy deep links remain supported. Contract:
`src/contracts/practice.ts`. Brief: `docs/prompts/VANDE-PRACTICE-PROMPT.md`. Docs: `docs/PRACTICE.md` (product,
flows, tiers, Android, privacy, accessibility, device test plan), `docs/PRACTICE_PHYSICS.md`, `docs/PRACTICE_RULES.md`,
`docs/PRACTICE_PRESENTATION.md`.

| Path | Contents |
| --- | --- |
| `src/physics/geometry.ts`, `constants.ts` | The one source of cricket geometry (Laws 4, 6–8; kept tiny because the app shell's field map uses it) and of physics constants and timing windows (`TIMING_BANDS`, the label bands; `BAT_TIMING_CALIBRATION`, the bat's own frozen calibration; `BAT_TRAVEL_MS`, pace and spin ranges, pitches; see `docs/PRACTICE_PHYSICS.md`, "Timing bands") |
| `src/physics/{vec,ball,probe,delivery,shot,bat,batMaterial,batGeometry,admissibility,collision,impact,contact,lbw,timing}.ts` | Deterministic vector maths; the 1 ms RK4 ball integrator (drag, Magnus, swing, seam, bounce, turn, outfield roll); allocation-free probes; deliveries and shot geometry; the virtual bat, its one face-material source, exact solid geometry and body/reach admission; swept collision and contact; LBW (Law 36); assistance bands |
| `src/physics/{field,fielding,running,scoring,resolve}.ts` | Field layouts, fielding, automatic running, and the one scoring and dismissal pipeline (`resolveDelivery`) |
| `src/physics/{matchPath,aim}.ts` | The multiplayer reveal's balls through the same physics: `flightFromPath` (the server's `BallPath` and `releaseToContactMs`, fitted exactly) and `aimShot` (outcome-first shots) |
| `src/practice/game/**` | Random, guided and built overs; the innings state machine (`inningsReducer`); replay (`DeliveryRecord` → identical `DeliveryResult`); coaching facts |
| `src/practice/coach/**` | Deterministic diagnosis, robust recommendations, demonstrations and exact-delivery retry analysis; uses the same physics as play |
| `src/practice/worker/**`, `src/practice/ui/flow/offThread.ts` | The work thread (2026-11-03): the live ball's `resolveDelivery` and the coach's reading off the main thread, with identical results and a main-thread fallback (below) |
| `src/practice/ui/**`, `src/practice/store/**` | Practice home, setup, live HUD, result/coach and summaries; flow controller; local persistence with in-flight protection (no save-scumming) |
| `src/practice/ui/design/**` | Practice tokens, responsive primitives and focus/touch-target behavior shared by every Practice screen |
| `src/perf/**` | The one device benchmark and quality classifier (Full ≥ 55 fps, Assisted 45–54, Below < 45 or software), the per-version cache and the in-session monitor; the match renderer's `auto` quality uses it too |
| `src/input/**` | The one input model: `PointerTrace`/`eventTime` (event timestamps, coalesced moves) used by Practice's GestureSurface and the match's batting, release meter and aim pad; `normalizeGesture`; calibration |
| `src/render3d/**` | The one renderer: one `StageScene` and bat mesh for the match and Practice, one camera director, one 2D painter (`TopDownPainter`) for the match fallback and Classic Practice; `core/trajectory.ts` is a thin adapter over the physics |
| `src/render3d/core/motion/director/**` | The face-and-life Director for the bowler and the batter (LIFE-1..3): keys and draws (`seeds.ts`), the plan (`plan.ts`), the bake to a 24-channel Int16 trace at 60 Hz (`bake.ts`), the O(1) reader (`director.ts`) and the stage binding (`stage/`: `runtime.ts` plans per script kind, hand-over, seam and laps; `pose.ts` the life pass on the pose and the head pass on the finished bones; `face.ts` the hand-over records). Owned with `tests/unit/render3d/director/**`; the shared glue is `practice/script.ts` (anchors), `three/ThreePracticeStage.ts` (hooks, spare-time work, head size), `three/players.ts` (lid, gaze and expression uniforms, the neck and head rate limiter) and `three/stageScene.ts` (the head pass call). `params.json` is frozen for the Unity port by `tests/unit/render3d/director/fixtures/golden.json`; the port contract is `UNITY-PORT.md` (to be moved into `docs/`) |
| `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Director/**` | The C# port of the Director core (UNITY-E1, contract director/3): keys and draws, noise, channels, plan, the resumable 240 Hz bake and the O(1) sampler, with `DirectorParams.Generated.cs` generated from `params.json` by `scripts/director-unity-params.mjs`. No UnityEngine. Tests in `Tests/EditMode/Director` with vendored params, golden and bowler-clip-head, guarded by `tests/unit/render3d/director/unityVendored.test.ts`. The contract is `docs/DIRECTOR-UNITY-PORT.md` |
| `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Director/Stage/**` and `Runtime/Presentation/ProceduralPracticeWorld.Director.cs` | The Unity stage binding of the Director (UNITY-E2, 2026-11-07): `DirectorStageRuntime` (the web's `stage/runtime.ts`: anchors, plans per script kind, hand-over, seam, laps, effort), `DirectorLife` (life channels set on each rig, applied inside the rig's pose), `DirectorHeadPass` (neck and head turn, rate limiter, world guard, hold), `StageSpecs`, `StageDirectorWorld` and `DirectorStageGeometry`. One owner's files. `ProceduralPracticeWorld.cs` (partial: `ConfigureScene`, `BeginDelivery`, `AcceptResult`, a `Tick` wrapper) and `ProductionCharacterRig.cs` (`DirectedLife`, `PoseSerial`, `TryGetVisibleHeadBones`, `ApplyDirectedLifeToDrivers`, `FollowHeadPassWithCap`) carry the hooks. Tests `Tests/EditMode/Director/{DirectorHeadPassTests, DirectorStageRuntimeTests, DirectorLifeRigTests, StageAllocationScan}.cs` and `Tests/EditMode/DirectorWorldTests.cs`; evidence probes `Editor/Evidence/VandeHumansEvidence.Director.cs`. The binding as built is `docs/DIRECTOR-UNITY-PORT.md` section 13 |
| `src/render3d/practice/ballLook.ts`, `src/render3d/three/ball.ts` | Shared ball-readability contract and seam/hemisphere mesh; equal minimum apparent size in 3D and Classic |
| `src/perf/tiers.ts` | Premium, Balanced and Classic presentation profiles; tier does not change delivery physics or scoring |

### The work thread (2026-11-03)

Source: `release/product-sequence/stage-1-practice/wedge/worker/REPORT.md`. Every result is builder-measured on a
desktop; nothing is certified, and the browser evidence predates PHYS's 08:52Z band recalibration.

The live ball's `resolveDelivery` and the coach's reading run in one worker. The results are identical, byte for byte,
on both threads.

| Path | Contents |
| --- | --- |
| `src/practice/worker/protocol.ts` | The messages and `WORK_PROTOCOL` |
| `src/practice/worker/work.ts` | The shared work: `resolveBall` (exactly the flow's old call, key for key), `readRecord` (the coach's reading) and `guideKey` |
| `src/practice/worker/host.ts` | The worker side, `createWorkHost`: `prepare` holds the ball, `resolve` resolves it, and `yieldTo` holds every coach simulation while a ball is live |
| `src/practice/worker/practice.worker.ts` | The entry; it binds the same functions as `ports.ts` |
| `src/practice/ui/flow/offThread.ts` | The client, `createOffThread`, wired through `ports.ts` (`createWork`), `context.ts`, `PracticeRoute.tsx` and `PracticeApp.tsx` |

- **Prepare, then resolve.** The ball goes to the worker before the run-up; only the swing crosses at the gesture. A
  swing uses the worker only once the worker has acknowledged this ball (`ready()`); otherwise it is computed on the
  main thread.
- **Handshake.** The build id and the simulation version must match.
- **Bounds.** Hello 15 s, resolve 2 s, read 60 s.
- **Fallbacks.** Each computes the identical result on the main thread: no `Worker`; the spawn throws; a worker from
  another build or protocol; an `error` or `messageerror` event; not ready in time; a timeout; a worker-side exception.
- **Live-ball priority.** Inside the worker the reading yields after every simulation, and a live ball pauses it at the
  next simulation boundary.
- **Leave or pause mid-computation.** If Practice is left or the app goes away while the worker computes, `resolveNow`
  computes and commits synchronously, as the old one-frame call did, so a leave can never replace a swing that was
  made. A process killed outright during the computation makes the ball a leave on restart, as a kill just before the
  swing already did.
- **The reading.** The analysis, the tip, the form sample and the demonstration are computed on the worker from the
  dead ball (`INSIGHT_OFFTHREAD_AFTER_DEAD_MS` = 0, `state.ts`). The consequence is still drawn first. The main-thread
  fallback is the earlier path: `INSIGHT_AFTER_DEAD_MS` 1000, `INSIGHT_SLICE_MS` 8 and `yieldToRendering`.
  Demonstrations are kept (`keepGuide`, `guideFor`), so "Watch demonstration" and Coach Mode attempts no longer
  simulate on the main thread. The first-run demonstration reads on the worker, with Skip live meanwhile.
- **Re-use.** A result the worker computed is named in the reading request, not sent back, while the worker still keeps
  it (the last 4).
- **Format.** Vite's `?worker` builds a classic iife worker in production, so it runs wherever the ES2022 main bundle
  runs, with no module-worker requirement. The service worker precaches it, and the CSP already allows
  `worker-src 'self'`. No vite, PWA or CSP change was needed.
- **Purity.** The worker relies on `resolveDelivery` keeping no call-history state. PHYS confirms none: no random
  numbers or clocks; module state is only scratch buffers filled before every read, plus the lazy `strokeTables` cache
  of a pure function of constants (`physics/phase3/REPORT.md`, requests).
- **Results** (builder-measured; M1 Pro, headless Chromium):
  - equality: 540/540 deliveries and 12 readings identical through the real worker host (unit tests), and 520/520 in
    the browser;
  - main-thread physics calls during the live ball fell from 6 to 0 on every tier, and the longest live frame gap from
    32–54 ms to 18–21 ms;
  - the result is in hand before physical contact on every hooked ball, the tightest margin being 8.4 ms;
  - the tip after the dead ball is faster on 29 of 30 balls (median 0.47 of the old time).
- **Open risks.** A real swipe is handed over up to `READ_MAX_MS` (140 ms) after it starts, so a heavy stroke can finish
  after physical contact on either thread; only hooked swings were measured. CPU contention on a 4-core phone, and the
  memory of one more JavaScript isolate plus up to 4 kept results of about 300–400 KB each, are UNPROVEN on the
  low-memory cohort. The size cost is in `docs/ANDROID_SIZE_AND_REACH.md`.

### Unity Practice transition (2026-10-26)

The new Unity brief supersedes the old decision to keep the live Practice surface exclusively in Three.js, but it
does not authorize deleting that working path. The Phase 1 spike will add an opt-in, full-screen UnityPlayer/UaaL
host layered inside the existing Capacitor `BridgeActivity`, launched by a narrow plugin. Keeping that Activity
resumed is necessary while TypeScript remains the per-ball authority; a dedicated Unity Activity would pause the
WebView and is therefore only a later fallback if an instrumented lifecycle spike or an authority migration proves
it safe. React remains the product shell; Three.js and Classic
remain the web implementation and Android fallback until Unity passes parity, lifecycle, performance, provenance,
physical-device and player gates. Unity must unload and return to Capacitor; it must not quit the shared process.

The architecture spike chooses the existing TypeScript simulation as the first authoritative boundary. The mature
`src/input`, `src/physics`, `src/practice/game` and Coach implementations normalize input, resolve contact, fielding,
score and wickets exactly once. Unity owns the live world, animation, camera, HUD, PIP, audio, haptics and replay
presentation and consumes canonical physical traces/results. A Unity result is never independently rerolled or
rescored. This differs from the brief's preferred C#-physics split because replacing the existing deterministic
engine immediately would create a second truth and invalidate Coach/replay; the decision must be revisited only with
cross-runtime goldens and an explicit simulation-version migration.

At dead ball, contract v6 keeps the accepted final Unity world pose visible and input-inert. The host can send bounded
localized reason/recommendation copy plus one primary and one optional secondary action, all bound to the exact
delivery and replay digest. Unity may request `practice_ball` or `next_ball`, but TypeScript revalidates the request
and remains the only authority that opens Coach Mode or advances the innings. This avoids relying on non-portable
WebView-over-`SurfaceView` composition on Android while the React result remains the web presentation and Android
accessibility mirror.

Contract v6 also keeps every Coach demonstration on that same live Unity runtime. The host supplies the exact source
delivery plus the TypeScript-resolved recommended result; Unity plays the normal run-up and canonical response with
input inert, without scoring or replacing the last real delivery/replay identity. A correlated cancel ends only the
presentation, so first-run Skip can proceed directly to the live ball. The retained renderer is used only for the
still-unsupported training-ball close-up.

The Unity live camera is a stable rear-shoulder batter view by explicit owner direction. It must show the embodied
batter, bat and equipment while preserving an unobstructed bowler/release corridor; the standing-up keeper is hidden
from this camera only. Field/PIP state, physics, scoring and replay remain authoritative and unchanged. The retained
Three/Classic paths keep their existing first-person contract until an explicit parity decision changes them.

The bridge is versioned separately from the simulation. Every envelope carries contract and simulation versions,
build/session/message identity and a monotonic sequence. Payloads are checksummed, duplicate-safe and fail closed to
the retained renderer on a version, integrity, timeout or lifecycle error. Unity may launch only before TypeScript
marks a ball in flight, because existing interruption protection truthfully resolves a backgrounded live ball as a
leave. The first slice carries canonical packets inline with a 1 MiB body ceiling (archived bridge-v2 authoritative
goldens measured about 275–369 KiB; bridge-v6 / Practice-sim-v3 size is pending its regenerated fixture). On
2026-11-03 UNITY measured 192 sim-v3 result packets: the largest 462,945 bytes (44.1% of the ceiling), the median
300,565 bytes (builder-measured; `release/product-sequence/stage-1-practice/wedge/unity/phase2/REPORT.md` addendum 1).
The golden fixture is regenerated after the sim v3 freeze. App-private
file transport remains disabled unless physical profiling proves it necessary.

Decode and threading (UNITY-6, 2026-11-07; builder-measured in the Unity Editor on Mono, no phone). A packet of at least 160,000 characters (results and replays, 280,000 to 456,000) is decoded on one worker thread (`Runtime/Bridge/BackgroundPacketDecoder.cs`): the outer split, the SHA-256, one scan into an immutable node table, schema validation and the replay digest, all pure managed code that touches no Unity API. Everything after the decode (sequence, duplicate and lifecycle guards, acknowledgements, the adapter and the world) runs on the main thread, in arrival order, from `VandeBridgeBehaviour.Update` (execution order −500), through one FIFO that nothing overtakes; every `Report*` call is a barrier that flushes it, and teardown drops pending packets. WebGL has no threads and decodes synchronously, and `BridgeConstants.BackgroundDecodeEnabled` is the kill-switch. The decisions of the bridge are pinned by a recording of 5,471 cases of the previous implementation (`Tests/EditMode/BridgeEquivalence/`): any change to the bridge must reproduce them or change them with a written reason. A result's main-thread cost went from 155–265 ms to about 1.5–2.5 ms, and the wall time from receipt to acceptance is 13–20 ms. The contract stays v6. A stroke-first split of the result packet (v7) is a candidate only (`release/product-sequence/stage-1-practice/wedge/humans/unity6/design-stroke-first.txt`).

Unity 6000.3.27f1 (revision `672d562a42a7`) is pinned by `ProjectVersion.txt`; that Editor and Android Build Support
are installed on the shared machine. Patch releases use materially different Gradle/AGP toolchains, so the Unity
export is included only behind `-PvandeUnity=1`; the normal Capacitor build stays unchanged when no verified export
exists. Installation and successful engineering exports do not certify an Android round trip, WebGL parity or any
physical-device gate.

**One implementation per concern (the redundant-code addendum).** Delivery physics, collision, input, scoring and
dismissal (Practice), the camera director, the benchmark and classifier, the PRNG (`src/engine/prng.ts`) and the
cricket constants each exist once. Retained on purpose, each with its active consumer:

| Retained | Why | Active consumer |
| --- | --- | --- |
| The Sealed Six outcome model, its innings machine, `MatchEventLog` and plan generators (`src/engine`, v1) | Server-authoritative multiplayer: results, deadlines, ranking and replays of existing matches must stay byte-identical; Practice is a different product (real-time physics batting) | backend Worker, Training, Ghosts, Daily Six, reveals, highlights |
| The engine's camera shot list (`src/engine/v1/cues.ts`) | Part of the deterministic match log that highlight rendering replays; the renderer's director executes it | `src/render3d/core/camera.ts` via `choreo.ts` |
| `seededRandom` in `src/ui/avatar/traits.ts` | Its output defines every existing player's generated avatar; moving it to the engine PRNG would change them | `Avatar`, `avatarSvg` |
| Outcome-first choreography (`src/render3d/core/choreo.ts`) | The server decided the result; the choreography stages it, but every ball movement in it is physics (`flightFromPath`, `aimShot`) | reveals, replays, highlights |

## Source ownership (exclusive; route shared files through the root agent)

| Path | Owner | Contents |
| --- | --- | --- |
| `src/contracts/**` | root | Shared types: domain, API, social, highlights, renderer, adapters, analytics |
| `src/app/**`, `src/App.tsx`, `src/main.tsx` | root | App shell, routing, root store (settings, toasts, connectivity), providers |
| `vite.config.ts`, `capacitor.config.ts`, `android/**`, `package.json` | root | Build, PWA manifest, Android packaging (agents may `npm install --save-exact` their own new deps, one at a time) |
| `src/engine/**`, `tests/unit/engine/**`, `scripts/simulate*.mjs` | gameplay | Rules engine, outcome model, validation, ghosts, simulation |
| `docs/GAME_RULES.md` | gameplay (root approves rule changes) | Frozen rules and tactical explanations |
| `src/i18n/engine/**` | gameplay | Engine copy: commentary, explanations, ghosts, guide, advice (11 locales) |
| `src/social/**`, `src/i18n/social/**`, `tests/unit/social/**`, `tests/e2e/social-*.spec.ts` | platform | Group Cup, Cricket Room, leaderboards, Top 100, highlight consent and landing, profile |
| `src/render3d/**` except `practice/{audio,feedback}.ts`, `tests/unit/render3d/**` | presentation | Stage core, shared ball readability, camera, Classic and 3D; art helpers (players, props, stadium, firstPerson) coordinated within this owner |
| `src/audio/**`, `src/render3d/practice/{audio,feedback}.ts`, `tests/unit/audio/**` | audio | Sound, haptics, captions, causal emotional feedback and Practice sink |
| `src/input/**`, `tests/unit/input/**` | input | Timestamp normalization, gesture tracker, calibration and input-to-physics integration checks |
| `src/physics/**`, `src/practice/game/**`, `tests/unit/physics/**`, `tests/unit/practice/game/**`, `scripts/practice-*.mjs` | physics | Deterministic deliveries, contact, fielding, innings and statistical validation |
| `src/practice/coach/**`, `tests/unit/practice/coach/**` | coach | Same-engine analysis, robust shot selection and exact retry |
| `src/practice/{ui,store}/**`, `tests/unit/practice/{ui,store}/**` | practice UX | Screens, design primitives, flow integration, persistence, local form and tester instrumentation |
| `src/practice/worker/**`, `src/practice/ui/flow/offThread.ts`, `tests/unit/practice/ui/offthread-*.test.ts`, `tests/unit/practice/ui/flow-offthread.test.ts`, `tests/unit/practice/ui/workerHarness.ts` | practice UX (work thread; assigned 2026-11-03) | The work thread: protocol, host, client and fallbacks. Calls physics and coach only through their public functions; changes to either owner's signatures go through the root agent |
| `src/perf/**`, `scripts/perf/**`, `tests/unit/perf/**`, `tests/e2e/{perf,a11y}-*.spec.ts` | performance/accessibility | Device classification, tiers and independent runtime/accessibility measurements |
| `src/screens/**`, `src/ui/**`, `src/styles/**`, `src/i18n/**` (except `src/i18n/engine/**` and `src/i18n/social/**`) | experience | Legacy journeys, shared UI, copy and locales; Practice copy coordinated with Practice UX |
| `tests/unit/ui/**`, `tests/e2e/ux-*.spec.ts` | experience | Shared component and legacy journey tests |
| `docs/VISUAL_SYSTEM.md` | experience | Design system, renderer decision record |
| `src/highlight/**`, `render.html` | experience | Highlight composer (`HighlightRenderHost` in `src/contracts/highlights.ts`): the 1080×1920 Short cut the render service records and the in-app consent preview plays |
| `public/brand/**`, `public/icons/**`, `public/og/**`, `android/app/src/main/res/mipmap-*/**`, `android/app/src/main/res/drawable*/splash.png` | experience | Brand marks, app icons, splash screens, social cards (generated images; the rest of `android/**` stays root) |
| `src/net/**`, `src/platform/**`, `src/analytics/**`, `src/admin/**`, `admin.html` | platform | API client, outbox/sync, session, adapters (push, share, deep links, install referrer, secure storage, identity, ads, billing), analytics, admin console |
| `backend/**`, `render-service/**`, `tests/unit/net/**`, `tests/unit/platform/**` | platform | Worker, Durable Objects, D1 migrations, queues, YouTube/FCM/render adapters, render job |
| `docs/SECURITY.md`, `docs/PRIVACY_AND_CONSENT.md`, `docs/ANALYTICS.md`, `docs/INFRASTRUCTURE.md`, `docs/COST_MODEL.md`, `docs/YOUTUBE_OPERATIONS.md` | platform | |
| `scripts/build-android.sh`, `scripts/android-*.sh|mjs`, `scripts/check-bundle-size.mjs`, `scripts/generate-notices.mjs`, `scripts/scan-secrets.mjs`, `privacy.html`, `delete-account.html`, `public/_headers`, `public/third-party-notices.txt` | root | Release tooling, legal pages, notices |
| `tests/e2e/flow-*.spec.ts`, `docs/TEST_REPORT.md`, `docs/ANDROID_RELEASE.md`, `docs/STORE_LISTING.md`, `docs/LAUNCH_BLOCKERS.md`, `README.md`, `docs/decisions/REBUILD_DECISIONS.md`, this file | root | Cross-workstream tests, release, docs |
| `unity/VandePractice/Assets/VandePractice/Runtime/Bridge/**`, `unity/VandePractice/{Packages,ProjectSettings}/**` | Unity foundation | Unity project, protocol endpoint, lifecycle host, build configuration and EditMode tests; root reviews shared-boundary changes |
| `unity/VandePractice/Assets/VandePractice/Runtime/Trace/**` | Unity physics adapter | Canonical trace playback, coordinate conversion and deterministic presentation checks; no second scoring authority |
| `unity/VandePractice/Assets/VandePractice/Presentation/**` | Unity presentation | Batter Eye, characters, equipment, field, stadium, animation and visual feedback |
| `unity/VandePractice/Assets/VandePractice/Audio/**` | Unity audio | Physics-event audio, crowd, captions and haptics; every source requires provenance |
| `unity/VandePractice/Assets/VandePractice/UI/**` | Unity UX | Quiet live HUD, setup rail, PIP, Coach and accessible runtime presentation |
| `unity/VandePractice/Assets/VandePractice/Tests/**` | Unity QA | EditMode/PlayMode contract, lifecycle, replay, causality and performance tests; `Tests/EditMode/BridgeEquivalence/` pins the bridge's decisions on 5,471 recorded cases of the pre-UNITY-6 implementation |

Rules for every agent: never commit, push, deploy or run destructive git commands; never run two Playwright runs or
two Gradle builds at once (Playwright wipes `test-results/`; rebuilding `dist/` under a running preview breaks it);
announce any contract change to the root agent instead of editing `src/contracts`.

**Takeover (owner decision, 2026-11-03; `docs/prompts/VANDE-PRACTICE-WEDGE-PROMPT.md` §10).** Claude agents took over
Codex's in-flight files: physics, flow, Unity and the bridge. Codex had been idle on them. The rows above name
workstream roles and are unchanged; inside the wedge each track keeps exclusive files, and shared files still go
through the lead (wedge prompt §8.2). The new `src/practice/worker/**` has no row yet: the lead assigns it.

## Key decisions (details in decisions/REBUILD_DECISIONS.md)

- **App id** `in.vande.cricket` (the old `in.vande.republic` was never published). Branch `cricket-rebuild`.
- **Renderer**: chosen by a measured spike (Three.js vs Babylon.js); see `docs/VISUAL_SYSTEM.md`. PixiJS is removed.
- **Server-authoritative sealing**: plans are canonicalised, salted, SHA-256-committed and signed when locked, stored
  encrypted (AES-GCM) in the MatchDO, and revealed with their salt. Each delivery is revealed to the batter only when
  bowled, with a signed single-use ball token; runs and wickets stay sealed until the reveal.
- **Determinism**: `src/engine` is versioned (`ENGINE_VERSION`); every match stores its seed and engine version; replays
  are verified with the engine version that produced them.
- **Guest-first auth**: guest accounts, short-lived HMAC access tokens, rotating refresh tokens in secure storage;
  Google sign-in and passkeys link accounts (adapters, disabled until configured). No SMS.
- **Cost**: no always-on servers. Workers Paid + D1 + R2 + Queues + a Cloud Run render job; target ~$25/month,
  ceiling $100/month (see `docs/COST_MODEL.md`).
