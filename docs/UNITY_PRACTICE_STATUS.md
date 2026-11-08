# Unity Practice implementation status

Last updated: 2026-11-08 (the Chase section and the result moments section below), 2026-11-03 (the wedge section); the sections after it are as of 2026-10-31.

## Chase update (2026-11-08): bridge contract v7 and the chase HUD line

Builder evidence only (`release/product-sequence/stage-3-chase/UNITY/`, `BRIDGE-V7.md`); Unity Editor on Mono, one Mac; no phone, emulator, IL2CPP or WebGL figure: **UNPROVEN**.
- **Contract 6 to 7** (TypeScript `UNITY_PRACTICE_CONTRACT_VERSION`, C# `BridgeConstants.ContractVersion`; the Java constant moves with ANDROID, request UNITY-3). One new OPTIONAL
  block, `chase` (`target`, `maxBalls`, `runsNeeded`, `ballsLeft`, `outcome`, `requiredRateX100`: integers and a closed code, no text), on `host.scene` and on the resolution of `host.result` and
  `host.replay`; never on a Coach demonstration, never in a Practice packet. Every receiver still tests the version for equality, so a stale v6 export refuses a v7 host (fail closed to the web renderer).
  `replayDigest` does not cover the block. The C# lifecycle refuses a result whose chase disagrees with the scene's (presence, target, balls); the validators refuse a block that contradicts itself or its score.
- **What a Practice packet is now**: the 28 golden packets differ from the v6 corpus by the version digit alone (28 characters in 6,028,442 bytes) and the SHA-256s that cover it
  (`proof/golden-v6-to-v7.txt`). The BridgeEquivalence recording was re-recorded with a written allow-list: of its 5,471 decisions every accept stays an accept (395), every reject keeps its exact
  reason (1,517), the 1,478 JSON answers and 2,080 session states are identical; `contractVersion~7` flips to accepted on purpose and `~6`/`simVersion~6` are new rejected cases (`proof/bridge-equivalence-v6-to-v7.txt`).
- **Fixtures** (committed growth 13,702 B + 19,096 B + 3,195 B generated C#; `practice-v3.json` unchanged in size): `tests/fixtures/unity-practice/chase-v7.json` holds RECIPES on packets the Practice fixture already has
  (insert the block, replace the score, seal) with the length and SHA-256 TypeScript recorded, plus a 39-row rule table; the C# test re-derives the packets and must reproduce the bytes.
  `chase-copy.json` is what the web prints for the chase HUD from the COPY sheet; `ProductionHudChaseCopy.Generated.cs` is generated from the same sheet.
- **HUD**: the existing conditions rail speaks the chase ("Need 14 off 9 balls" / "9.3 an over"; after the deciding ball "Target reached" / "N runs short"), in English, Hindi and Hinglish, with no rect moved
  (so nothing enters the delivery corridor) and the same text floors as the Practice copy. The wording is the web COPY sheet's, character for character on a 754-string grid. Win and loss panels: the existing dead-ball panel with the host's localized text.
- **Camera (R-9)**: a camera swing is a plain NormalizedSwing across the bridge. Unity's own `unity.pointer`/`unity.gesture` keep the four native kinds and refuse `camera` on purpose (`UnityPracticeNativePointer`).
- **Not done / UNPROVEN**: any phone, emulator, IL2CPP run or WebGL figure; the look and feel of the clips and of the venue to a human. The result moments and the venue are in the next section.

## Result moments and the venue add-on (2026-11-08, UNITY-CLIPS): UNI-07

Builder evidence only (`release/product-sequence/stage-3-chase/UNITY-CLIPS/INDEX.txt`; decisions UC-01 to UC-14); Unity Editor on Mono and Metal, one Mac; no phone, no emulator, no human result: **UNPROVEN**.
- **The four clips play in Unity** (`result_moments` pack, through the C# VMP reader): won = striker `bat_celebrate_win` + bowler `bowl_disappointed`; lost on a wicket or on balls = striker `bat_walk_off`
  + bowler `bowl_celebrate_defend`, on the live deciding ball and on its replay. The verdict is the host's `chase.outcome` (bridge v7); Unity decides nothing. Start = the physics event (the last run, the
  boundary, the stumps, the catch, the lbw decision, the dead ball) + 200/300 ms (striker, win), 250 ms (wicket), 400 ms (balls), bowler 450/400/600 ms, and never before the actor's own stroke, run (and its
  0.8 s pull-up) or follow-through is over, nor before the result arrived. 260 ms inertial hand-over at the least (longer, to 1.0 s at most, when a bone has far to turn: UC-11), one-shots holding the last frame, Reduced Motion holds the `peak`/`slump` frame (400 ms ease), the left-hander
  and the left-arm bowler are the canonical mirror at sampling, the walk-off root follows the clip's ground track (2.45 m x 0.9836) along his stance heading. Code: `ProductionResultMoments.cs` (pure),
  `ProceduralPracticeWorld.ResultMoments.cs` and small hooks in `ProceduralPracticeWorld.cs`; a Practice ball, a chase in progress and `ResultMomentsEnabled = false` draw the same frames as before (tested).
- **The bat stays in the bottom hand's character grip** (not set from the clip's bat keys, which flipped the hero's elbow; UC-02); the striker's root stays on his stance.
- **Tests**: 22 new EditMode tests for the clips (`ProductionResultMomentTests`: scheduling, hand-over, mirror, Reduced Motion, replay, the verdict on the wire, dismissals, a missed swing and a thin edge's runs, no pop) and 5 for the venue;
  the suite is 1,433 tests, 1,429 passed (1,402 + these 27) with the same 4 known stale failures (was 1,406 total), PlayMode 2 of 2, a fresh import with no Library is clean (0 errors, 0 files generated, 0 byte changes); the C# reader equals vmp.ts on `result_moments` (error 0 on 1,654 samples).
- **Pops** (the MOTION-SPEC section 9 definitions, `VandeHumansEvidence.PopScan`, every run against a control run of the same ball with no verdict, matched by role, kind, bone and frame): a wide scan of all 7 golden deliveries x
  won / lost on a wicket / lost on balls x both hands x Director on and off x Reduced Motion on and off (224 runs) first found 82 pops the control had not (a one-frame hips step when a clip begins late, a hand step after a missed swing,
  leg steps after a thin edge's runs). UC-11 to UC-13 removed them: the hand-over is as long as its furthest bone needs, the arms' memory is held through the follow-through, the hand-over source is taken again after the foot lock.
  Now 1,753 pops in the clip windows against 2,355 in the controls and none new, except one pre-existing wrist episode whose scanner label moved (the left-hander's, 100.1 degrees in the control too). lbw, bowled and caught behind: none new.
  The pops that remain are the base build's own, present in the controls (the stroke's hand flips and wrist episodes; a 35 degree step of the bowler's left leg 1.9 s after an lbw).
- **The venue** (ASSETS-VENUE's wedge FBX and atlas) is a **sideload add-on** that a default Unity export does not carry: the files sit outside any Resources folder; `VANDE_UNITY_VENUE=1` on the export
  creates and removes the ScriptableObject that makes the ring (60 wedges, levels 0/1/2, sight-screen gaps) and the stage hides its own tiers, backdrop and crowd. Measured on the Android unityLibrary export
  (Editor, final tree): default export 283,838,465 B (+314,040 B over export #1: the clips' and the loader's IL2CPP code, and any other change in the tree since); the same export carrying the venue +116,445 B and 6 files. Nothing is measured on a device, in an APK or in Play: UNPROVEN.

## Wedge update (2026-11-07): the result-arrival chain and the live batter

Builder evidence only (`release/product-sequence/stage-1-practice/wedge/humans/unity6/`, `.../humans/unity5/`); Unity Editor on Mono on one Mac; no phone, Android, IL2CPP or WebGL figure: **UNPROVEN**.
- **EditMode, latest:** 1,270 total, 1,261 passed, 4 failed (the same four stale tests: two rear-shoulder camera radius tests and two glove-spacing tests, untouched), 5 skipped.
- **The Unity share of the chain** from the packet's arrival to the accepted result went from about 92–158 ms to about 15–42 ms: the bridge's strict decode of a 310–456 K-character result is 12–20 ms (it was 80–124), off the main thread for packets of 160 K characters and more; the main thread pays about 0.2 ms to hand over and 1.2–2.3 ms to apply. Allocation per packet is about 14 times lower. The bridge's decisions are unchanged (5,471 of 5,471 recorded cases identical; fuzzing and concurrency tests in `Tests/EditMode/BridgeEquivalence/`). The synchronous path (kill-switch off, WebGL) still takes 12–20 ms on the main thread.
- **Late results:** contact is about 90 ms after a 50 ms commit; a result that arrives after it leaves the drawn ball on its pre-contact line through the bat (frozen at the end of the delivery's flight data), 0.3–0.9 m past the bat 6 frames after the commit and 1.4–4.7 m at 10 to 14 frames, and then it snaps 0.5–5.7 m (up to 8 m; a complete miss 7–11 m) in one frame. Fixed (UNITY-7): from the ball's ideal arrival at the committed swing's contact plane, or the end of the flight data, until the accept, the ball and its rings are not drawn. The accept hand-over to the physics bat is also fixed (arms at the accept at most 1.95× their cap, it was 5.72×; forearm step at most 58.6°, it was 171.6°; gloves 0.00 cm off the handle), the leave plays the `bat_leave` overlay, and the spin bowler's cap follows the hero's head. Governed strides are still procedural. The worker, the native hop and the Android validator on a phone are unmeasured.
- **The JS side of the same chain** (HOP-1; node on this Mac): the work from the resolved result to the bytes handed to the native bridge went from 21.4 ms to 5.7 ms for a result and from 20.4 ms to 1.5 ms for a replay, with the wire format, packet bytes and contract version unchanged (the golden packets re-pack byte-identically). The Android validator on a desktop JVM takes 3.8–5.9 ms warm and about 55 ms on the first call; a phone figure is unmeasured. Evidence: `release/product-sequence/stage-1-practice/wedge/humans/hop1/`.
- **The Director core in C#** (UNITY-E1; Unity Editor on Mono, Apple M1 Pro; Android, IL2CPP and phones **UNPROVEN**): the deterministic core of the face-and-life Director reproduces the web exactly on the golden fixture (5 of 5) and on a 490-plan corpus (579,963 frames, 13.9 million Int16 values, 0 steps of difference on all 24 channels; sliced bake equals one-go bake). The sampler costs 82 ns per actor per frame, a 64-step bake slice 0.032 ms, a delivery plan about 1 ms, with 0 B allocated per sample. 88 Director tests pass; EditMode 1,244 total, 1,235 passed, the same 4 stale failures, 5 skipped. Eight Runtime files (112,922 B source, 41,984 B Release IL, 14,336 B of it generated parameters); nothing references them yet, so stripping may drop them from a build. The wiring into the rig and world is UNITY-E2's. Evidence: `release/product-sequence/stage-1-practice/wedge/humans/unity-e1/`.
- **The batter's arms and the live stroke:** see `docs/PRACTICE_PRESENTATION.md`, "Unity arms and the live hand-over".

## Wedge update (2026-11-03)

Builder evidence only, from the filed reports under `release/product-sequence/stage-1-practice/wedge/`:
`unity/REPORT.md` (phase 1), `unity/phase2/REPORT.md` with addenda 1 and 2, `textures/REPORT.md`,
`sound/SOUNDKIT-REPORT.md` and `eval-assets/VERDICT.md`. Nothing here certifies parity, a device result, installed
size or reach. The counts and artifacts in the later sections are historical.

**The exports are stale.** `public/unity/Build/` (exported at about 03:21Z on 2026-11-03) and
`unity/VandePractice/Builds/{WebGL,Android}` (the Android export dates from 2026-10-31T06:55Z) predate the texture
replacement. The evaluator measured all five withdrawn OpenAI textures embedded in `public/unity/Build/VandePractice.data`
(`eval-assets/VERDICT.md` 2.3, FAIL). They may not ship. Re-export them in I1 before any build, deploy or release
evidence (the lead's actions on the verdict). Later, UNITY made a new Android export at 14:45Z for the size work
(addendum 8, below), and it is a preview; addendum 8 does not cover the WebGL export in `public/unity/`.

**EditMode, latest (2026-11-03T15:23Z, freeze 5d, build `38924bd+cf78882ed52e`; `unity/phase2/REPORT.md` addendum 9):** 725 total, 723 passed, 2 failed, 0 skipped. The 2 failures are the pre-existing hero glove-spacing tests (`AdmittedHeroBatterStance…`, 0.0236 against 0.032) on the current runtime hero. The 43 earlier failures were cleared across addenda 3–9: the golden was regenerated on the frozen physics, 21 TextMesh-era HUD tests were ported to UI Toolkit (fixing real overflows), the 200% text floors were added, the caption no longer hides controls, and two presenter defects were fixed (head over base, and the torso-stabiliser dead zone). These are builder counts; independent verification is pending.

History: **EditMode** (the repository project, through `unity.sh`): 650 total, 606 passed, 43 failed, 1 skipped, on build
`38924bd+1ab0489461cf` at 09:31Z (`textures/REPORT.md`, addendum of 09:55Z; the same counts in `unity/phase2/REPORT.md`
addendum 2). The 43 failures are pre-existing: the same tests as the phase-1 baseline (619 total, 575 passed, 43 failed,
1 skipped). None is new and none was fixed. UNITY attributes 14 of them to the stale v5-framed fixture; they wait for
the sim v3 freeze. **The suite is not green.** The latest count is 725 total, 722 passed and 3 failed, on build
`38924bd+8016bfd7f9c5`: 2 known glove-spacing tests, and 1 golden test that failed because 5d rewrote the golden
mid-run, so its re-pin waits for 5d (`unity/phase2/REPORT.md` addendum 8).

### Phase 1 (wedge items 10, 11 and 18)

- **HUD theme.** Players logged "No Theme Style Sheet set", because only the editor supplies a default theme. The player
  now loads `VandeProductionHudTheme.tss` (the default runtime theme) before the document is enabled. It costs
  +675,698 packed bytes, mostly a 431,646-byte default font.
- **Sound.** C# ports of `takes.ts` and `recordedManifest.ts`: 284 of 284 parity cases identical. The four licensed
  applause takes play in Unity, chosen deterministically, with the onset scheduled ahead by `PlayScheduled`. COH6
  (onset within 1 ms) is shown with injected clocks only; device timing is UNPROVEN. The 54 placeholder contact takes
  are byte-identical copies of the web files, flagged `IsPlaceholder` (`sound/SOUNDKIT-REPORT.md`).
- **Boards.** A C# port of `paintPracticeBoards`: 8 dark panels, with no text or logos. The navy and amber cushions are
  removed.
- **Fielders.** 21 clips ported from `clips.ts`, and line-by-line ports of `fieldingMoves` and `fieldReactions`. One
  deliberate deviation (`Latest`): the latest span carries on through a gap, so the root stays on the path.
- **Bat width.** 10.800 cm at the drawn scale (Law 5).
- **F-012, rear camera.** Measured, not changed. Out of view before contact at 915×412: mean 1.4 ms, maximum 4.8 ms
  (frustum only; occlusion by the batter is not measured). The ball at release is 1.90–3.80 px, depending on the
  viewport, and relies on the 3.5 px readability ring.
- **Risk.** On a turning pitch the spin-away automatic field puts a slip 1.6 m in front of the rear camera.
- **GoldenScreen deletion.** `Runtime/GoldenScreen/*.cs` (4 files) and its 13 passing tests were deleted at about
  03:07Z by an unidentified agent. The lead's hypothesis is a resumed Codex session; the owner has been asked. The
  files are preserved in the lead's pre-takeover snapshot and were not restored.

### Phase 2

| Item | Result |
| --- | --- |
| Rig reach | Usable reach 0.5709 m (was 0.4551); the hands stay on the grip |
| `StumpHeight` | 0.7112 m |
| Bat rotation | Up to 40 rad/s handled; no defect at the highest rate observed (36.4 rad/s) |
| Golden shape error | Fixed, 2/2. The fixture `practice-v3.json` is unchanged and is regenerated after the sim v3 freeze |
| Ball readability (T1) | Fixed: the Day sun and the dark shade (`docs/PRACTICE_PRESENTATION.md`, "Unity live surface") |
| `played_on` | `BridgeValidator.cs` accepts it, with a test |
| The jump at result acceptance | The one-frame jump is now a carry over about 3 frames, and the bat is exact at contact. Still faster than a human (risks) |
| Follow-through hold | 6.1 s → 0.6 s, then a recovery. The finished pose is then static for up to 5.3 s |
| Recovery foot step | 0.138 → 0.025 m per frame |
| Lean HUD theme | Built, then reverted: it breaks the scrollable dead-ball text in a player, 3 runs of 3. Deferred (it would save about 0.68 MB) |
| Timing bands | No C# copy of the band values, so nothing to align |

- **Parse-once decoding** (lead ruling 4). The bridge parses each number and each nested part of a result packet once
  and reuses it; the decoded result is unchanged (`Tests/EditMode/BridgeParseOnceTests.cs`). In the desktop editor
  (code optimisation Release), the runtime path per packet fell from **0.87–2.14 s to 0.11–0.35 s**. Device cost is
  UNPROVEN. The first phase-2 report put the stall at 0.73–1.38 s; addendum 1's before-and-after pair is the measured
  A/B.
- **NaN ball samples** (ruling 5): 0 of 192 results are non-finite after FIELD's fix. The largest packet is 462,945
  bytes (44.1% of the 1 MiB limit), the median 300,565.
- **The sun.** Day uses `SunKey(58, 54)`, the web's sun. LateAfternoon uses `SunKey(104, 15)` for web parity, but the
  white ball then reads below 3:1 at bounce and 5 m in 29 of 54 rows. Lead ruling: Practice plays only in Day light,
  and LateAfternoon is not offered in Practice until it passes readability (not-now register).
- **Procedural textures.** The five OpenAI-generated textures are replaced in place by original procedural textures
  from `scripts/unity-textures/generate.mjs`. No C# changed, and GUIDs and import settings are kept, except that the
  plate now imports as a compressed power-of-two texture. The evaluator reproduced all five byte for byte
  (`eval-assets/VERDICT.md` 4.1, PASS). An owner decision is open: the generator's 12 `TILE_TARGETS` colour statistics
  were measured from the withdrawn bitmaps (VERDICT 4.4).

### Addendum 8: the Unity Android preview back under 50,000,000 bytes (filed 15:10Z)

Source: `unity/phase2/REPORT.md` addendum 8 and `unity/phase2/addendum-8/`. Builder-measured; nothing certified. Build
`38924bd+21a123f7d64b`; export 14:45Z, Gradle preview 14:49Z, at a load of 6–18.

| | I1, 14:35Z | After addendum 8 |
| --- | --- | --- |
| APK | 65,133,308 bytes | **47,625,302 bytes**: under the 50,000,000 cap, but above the 45 MB warning line |
| AAB | 30,746,640 bytes | 26,858,576 bytes (preflight PASS) |
| `libil2cpp.so` (arm64-v8a) | 32,484,816 bytes | 15,123,816 bytes |
| `libunity.so` (arm64-v8a) | 17,013,488 bytes | 17,008,880 bytes |
| Generated IL2CPP C++ | 247.0 MB | 106.8 MB |

- **Settings changed, Android only.** IL2CPP code generation: OptimizeSize. Managed Stripping Level: High (Strip Engine
  Code was already on). `Assets/VandePractice/link.xml` preserves only what is reached by name: `VandeBridgeBehaviour`,
  the target of `UnitySendMessage`, plus the 18 JsonUtility DTOs and the 11 trace and wire models nested in them. A new
  `AndroidSizeSettingsTests.cs` (2 tests) pins the settings, resolves every `link.xml` type and checks the bridge's 7
  `SendMessage` targets.
- **UI Toolkit cannot shrink further.** `UIElementsModule` stays at about 37 MB of generated C++: `UIDocument` pulls in
  the UXML factory registry, which references every built-in control, and Unity has no public alternative. The HUD
  itself uses only `UIDocument`, `PanelSettings`, `Label`, `VisualElement`, `ScrollView` and one TSS, and Advanced Text
  is needed for Hindi and Bengali shaping. IL2CPP Master changed nothing and was reverted.
- **The physics modules cannot be removed.** Nothing in the runtime or editor code uses Unity physics, but in Unity
  6000.3.27f1 the built-in `com.unity.modules.uielements` package depends on `com.unity.modules.physics`. Removing it
  from `Packages/manifest.json` resolved it straight back as a UI Toolkit dependency, so the change was reverted byte for
  byte (`addendum-8/physics-modules-check.json`).
- **An optional owner click.** In the editor, Project Settings → Physics → GameObject SDK → None would keep the Physics
  module that UI Toolkit needs but drop the PhysX backend that the physics SDK setting force-includes. Its effect is
  unmeasured; it needs the owner's click in the editor, or the lead's approval of another route.
- **Preflights.** The size preflight passes. The static compatibility preflight passes with a REVIEW, because the
  Unity libraries are absent on armeabi-v7a.
- **Promoted as a preview, not a release:** `release/vande-cricket-1.0.0-1-38924bd-dirty-21a123f7d64b-PREVIEW-UNITY-…`
  APK `64bc8911…`, AAB `e088ce81…`.
- **SIZE-50, REACH-90 and the 16 KB runtime gate remain UNPROVEN.** An APK byte count is not the installed-size measure
  (`docs/ANDROID_SIZE_AND_REACH.md`).

### Open risks

- **The acceptance carry is still about 31 m/s.** On the four drive cases the hips move 0.51–0.58 m in one frame
  (UNITY's filed evidence; `release/cover-drive/p2/REPORT-r3.md` §1 gives 0.51–0.63 m across the body parts). Only P3
  anticipation, an owner decision, or a physics bound on how far the body moves between input and contact can remove
  it.
- The finished pose is static for up to 5.3 s until TRACKB supplies a post-shot idle.
- The shade is drawn halfway towards the camera, unlike the web; the evaluators should look at it.
- The cover-drive batter candidates (variants A and C) are not in Unity. The variant choice and the P2 ratings are the
  owner's.

## Status in one sentence

VANDE now has an in-progress contract-v6/simulation-v3 Unity presentation for Stage 1
Practice live surface, a provenance-bound WebGL packaging path and a direct
low-memory-to-Classic Android route. Unity remains non-selecting for release until
an exact Android candidate passes visual, lifecycle, size, reach and physical-device gates.

The source migration adds trace-v2, a host-authoritative planar batter root, a canonical
delivery-specific body frame and a planted batter crouch (root and crouch each bounded to 0.18 m), plus exact host-authored start/contact/end motion
anchors. Unity mirrors root x once, preserves z, applies the full static root and articulated
posture for the complete canonical trace, keeps both feet planted, and retains canonical arm
IK without an independent grip-driven body/neck translation. The
practice-v3 shared fixture, complete Unity run and exported artifacts are pending; all
sealed contract-v3 artifacts and pass counts below are historical and stale for this source.

The sealed engineering-preview artifact source identity is
`38924bd+05f72561424b`. Its full Unity 6000.3.27f1 EditMode suite passed
222/222. The exact Unity-inclusive preview artifacts are an APK of 43,584,653
bytes (SHA-256
`01b7c84bb555d4859d3751f9607b1ffb68f014c63c3584f44d634ec81184e43c`)
and an AAB of 21,769,253 bytes (SHA-256
`c7a190f37af829de01f84797a037fecf8350f832bb649cfe627ffeb00f236b44`).
They passed the repository's static artifact preflights and a strict API-36
ARM64 emulator acceptance against the installed APK. That run selected
`unity-native` without allowing fallback, resolved real touch, survived
HOME/resume and a process reclaim with app data preserved, completed an
uninterrupted over, and recorded no native, WebView, crash or ANR error. This is
engineering-preview emulator evidence, not physical-device or release
qualification, so these facts do not make it a release candidate.

The latest completed browser runtime evidence remains a desktop engineering
preview for the older build `38924bd+bdb1608de832`. It reached Unity `runup`
but not a completed delivery and is superseded for current-source decisions.

The screen captured during the October 27 audit was the retained Classic fallback,
not a Unity live delivery. An October 28 desktop browser smoke proves the Unity
canvas was visible and interactive during `runup` for the captured build only; it
did not play a ball or certify mobile-web feasibility. A cross-runtime clock sample could appear approximately
0.1 ms negative because of timestamp quantization; the host rejected that sample
and disposed Unity before `host.scene`. The host now tolerates and clamps only a
bounded 2 ms negative residue while still rejecting impossible samples.

## Architecture and safety boundary

- TypeScript remains authoritative for input normalization, delivery physics,
  contact, scoring, dismissals, innings, Coach facts and replay identity.
- Unity validates and presents host-issued scene, delivery, result and replay data;
  it cannot score, reroll or mutate an outcome.
- React remains the calm setup/menu shell. Unity owns the visible live Practice
  surface only when the explicit feature and qualification gates select it.
- Three.js and Classic remain active fallbacks. They are not redundant and were not
  removed.
- Unity is pinned to 6000.3.27f1 revision `672d562a42a7`.
- No commit, push, deploy, publication, purchase or destructive Git cleanup was
  performed.

## Implemented source coverage (not certified parity)

| Workstream | Current source state |
| --- | --- |
| Contract and integrity | Source uses contract v6/simulation v3/trace v2: typed/direction-checked canonical JSON, SHA-256, 1 MiB cap, bounded values, monotonic sequence and fail-closed lifecycle. Result validation requires the bounded planar batter root, canonical stance/torso/head body frame, bounded planted crouch, exact bat-motion anchors and rigid 0.86 m bat knots. V3's delivery- and replay-digest-bound dead-ball exchange remains: Unity may request `practice_ball` or `next_ball`, but TypeScript alone validates and advances the flow. |
| Clock | Five samples and explicit selection; sub-2 ms negative quantization residue clamps to zero, larger impossible delays fail. |
| Authority and replay | Full canonical scene/delivery/result/replay validation, causal identities, exact dead time and replay digest. |
| Learn and Coach | Atomic per-delivery guidance. Ordinary Learn, exact-ball Coach retries, first-run teaching and demonstrations stay in Unity; stages progressively expose landing/path/contact cues. Only the training-ball close-up retains Three.js/Classic. |
| Surface handoff | Unity keeps one stable live canvas for its entire runtime. Contract-v6 demonstrations reuse its production world, regular batter, bowler, stable rear-shoulder camera, lighting, profile and HUD; input is inert and score/last-ball identity do not change. Only close-up uses the separate retained-renderer canvas. A disconnected Unity canvas fails closed if asked to become visible. |
| Batting input | The bat now answers an intentional post-release drag immediately with a bounded local preview, then reconciles to the canonical TypeScript bat trace. Real mode derives forward/auto/back intent from the shot's existing press origin; Learn and Play stay automatic. No delivery-time control or extra HUD target was added. |
| Batter motion | Forward, back, across, down-track and balanced presentation poses; host-authoritative result footwork, static root/posture and exact start/contact/end anchors drive live and replay motion; provisional-to-canonical blend is 80 ms. Corpus-selected both-mirror reach proxies are wired as a fail-closed test gate but remain pending the regenerated shared fixture and execution. |
| Bowling motion | Distinct pace/spin roles, run-ups, release and follow-through. Fourteen pace/spin variations add bounded cadence, gather and wrist read cues without using target line/length; release hand remains aligned to the authoritative first flight sample. |
| Cricket world | Textured pitch/outfield, creases, boundary, sight screens, stadium, deterministic two-tier crowd, 11-player field and named-fielder consequence state. Source now adds an inward sky dome, restrained haze/fog, tri-light ambient response, quality-gated soft shadows, floodlights and stadium depth props. |
| Props | Law-scale bat, stumps and bails plus a seam/shine ball with distinct rough/polished and new/worn material response. Ball orientation now follows host-authoritative pre/post-bounce spin, upright-seam correction and absolute trace time; wicket response occurs only from an authoritative stumps event. |
| HUD | Compact score and six-ball state, conditions, persistent field PIP/setup information, pause, captions, outcomes and quiet-mode behavior. At dead ball it can present the host-localized reason, recommendation, one dominant action and one optional quiet secondary while retaining the final world pose. |
| Feedback | Event-causal crowd response, visual effects, haptics and captions. Authoritative leave, defensive block and LBW outcomes survive live/replay ordering, and each new delivery clears prior crowd emotion. Physical events are handedness-mirrored and spatial while the crowd remains broad; Standard/High use restrained environmental reverb and Lite avoids it. Audio clips remain synthesized engineering fallbacks, not authentic recordings. |
| Android host | Same-Activity UaaL overlay, lifecycle forwarding, memory/ABI fail-closed routing and contract-v6 / Practice-sim-v3 packet validation. The native layer remains visible at an accepted dead ball; a guarded Unity action is required because speculative WebView-over-`SurfaceView` composition is not portable. |
| Export provenance | Schema-2 WebGL manifest binds the repository build identity, canonical Unity-source digest and runtime-file hashes; its packaging verifier rejects stale, altered, linked, undeclared or path-escaping inputs and mismatched publication mirrors. The schema-3 Android receipt seals all regular files under `Assets`, `Packages`, `ProjectSettings` and the complete generated export, including executable flags; Gradle verifies it, compiles from an isolated copy, then revalidates the canonical tree. This is packaging consistency, not a signed attestation or browser runtime-byte attestation. |
| Low-memory route | Native `low_memory_device` admission constructs Classic directly, without constructing Unity or Three.js and without fabricating or caching a renderer benchmark. The route remains latched for the active host. |
| Android evidence identity | Evidence builds embed the frozen repository build ID. The harness verifies that identity from the installed bundle before gameplay, records the native availability result and distinguishes native Unity from an explicitly allowed retained fallback. Written admission ordering remains static-source evidence, not proof of physical native-library load order. |

The presentation is materially beyond the original integration proxy, but its
players remain code-built procedural rigs. There are no production FBX/GLB models,
mocap clips, skin/cloth/gear PBR sets or authentic cricket recordings. The live HUD
also uses legacy `TextMesh` typography. Those are real art-quality gaps; installing
Unity alone cannot make them photorealistic.

## Captured automated evidence

These results distinguish current-source checks from older bounded browser
evidence. The Android row is strict emulator evidence only; no row substitutes
for physical-device, distribution or human-player evidence. Counts in the rows
below are from the evidence cycle of the sealed artifact `38924bd+05f72561424b`
unless a row says Current; this table does not re-measure them. Rows that say Current for Unity (EditMode tests) or Android
(APK, AAB, emulator) were measured on earlier trees and were not re-run at `f68b207`: they are **UNPROVEN** at that commit.

| Check | Result |
| --- | --- |
| Focused contract/platform/clock/coordinator/stage suite | 9 files, 61 tests passed. |
| Sealed artifact source identity | `38924bd+05f72561424b`. |
| Full TypeScript unit suite | At the sealed artifact: 178 files, 1,709 tests passed, expected jsdom canvas diagnostics only; that count is historical. **Current, measured 2026-11-08** at commit `f68b207` by `npx vitest run --maxWorkers=2` on Node 22.23.4 (the independent repository review, item C2): 286 files and 2,735 tests; 2,728 passed, 2 failed, 5 skipped. The failures are `tests/unit/physics/shot.test.ts:158`, "cuts the short wide ball", a named physics limitation (owner PHYS) that stays unskipped, and the Director size budget in `tests/unit/render3d/director/cost.test.ts`, re-based in `6738bbe` (details in [TEST_REPORT.md](TEST_REPORT.md)). Source: `release/product-sequence/stage-1-practice/wedge/repo/REVIEW/REPO-REVIEW.md`. A TypeScript test count says nothing about Unity or Android. |
| TypeScript typecheck and production web/PWA build | Passed. |
| Archived bridge-v2 TypeScript/Unity golden corpus | 7 cases passed against the superseded 5,636,972-byte practice-v2 fixture; SHA-256 `68987e258e4771d7a0d3c62f12b13ed6795eb34810862e702f110edec81fb7fe`. This does not certify bridge-v6/sim-v3/trace-v2. |
| Current bridge-v6/sim-v3/trace-v2 golden corpus | **PENDING** supported regeneration after two fresh 7,560-case reach passes and independent SHA verification. The preserved v5 fixture is not claimed as v6 evidence. |
| Unity 6000.3.27f1 full EditMode compile/run | 222 tests passed, 0 failed or skipped on the current source. |
| Unity source in the captured evidence cycle | Compiled and executed by the full Unity Test Runner, then included in a successful fresh WebGL export. `git diff --check`, TypeScript typecheck, the flagged production web/PWA build and shared goldens passed for that cycle. |
| Web surface lifecycle regression | 15 focused platform/native-flow tests pass, including stable Unity canvas identity across first-run teaching, repeated demonstration/close-up handoffs and fail-closed detached-canvas visibility. |
| WebGL export gate | A fresh export is accepted only when its schema-2 manifest matches the frozen repository build ID and Unity-source digest, all declared runtime hashes match, and `Builds/WebGL`, `public/unity` and the preview publication are byte-equivalent. The generated manifest is the exact artifact record. |
| Live desktop browser smoke | Passed on a fresh origin for build `38924bd+bdb1608de832`: admission `engineering-preview-unqualified`, renderer `unity-webgl`, connected 1366×768 canvas, opacity `1`, pointer input enabled, 3D stage and `runup`, with no captured console error. The smoke stopped at run-up; it did not complete a ball, an over or a lifecycle cycle. |
| Android JDK 21 host tests + instrumentation compile, Unity disabled | `BUILD SUCCESSFUL`; 175 tasks; contract-v2 validator and device-side tests compile. Instrumentation was not executed. |
| Current Unity-inclusive Android preview | APK 43,584,653 bytes, SHA-256 `01b7c84bb555d4859d3751f9607b1ffb68f014c63c3584f44d634ec81184e43c`; AAB 21,769,253 bytes, SHA-256 `c7a190f37af829de01f84797a037fecf8350f832bb649cfe627ffeb00f236b44`. Static preflights passed. The exact installed APK passed strict API-36 ARM64 emulator acceptance at valid host loads 13.16/17.53: build identity matched; native Unity was selected with fallback forbidden; real touch saved exactly one ball; HOME/resume and fresh-process reclaim preserved state; an uninterrupted six-ball over completed; native errors, WebView errors, crashes and ANRs were zero. Evidence: `release/practice-android/38924bd-05f72561424b-unity-preview-release-fresh/android-exact-preview-release.json`. Admission remained `engineering-preview-unqualified` (`benchmark_unavailable`), and no physical-device result is claimed. |
| Dead-code audit | Removed about 143 unused C# lines plus earlier superseded HUD/ball/feedback proxy files; repo-wide reference scan and `git diff --check` are clean. |

Generated WebGL and Android directories are not accepted merely because they exist.
Run their provenance gates against the frozen source identity and retain the exact
manifest, artifact hashes and command output with each evidence candidate.

The strict emulator record conservatively marks its static source-order field as
not applying to the installed identity because these status documents were edited
after the APK was sealed, changing the whole-working-tree build ID before the
harness began. The installed DOM and evidence surface both independently matched
the embedded `38924bd+05f72561424b` identity, and the post-seal changes were
documentation-only. The run therefore proves the installed behavior listed above;
it does not turn static written admission order into runtime load-order proof.

## Android distribution envelope

The binding goals remain:

- no more than **50,000,000 bytes** fresh installed through the first playable ball;
- at least **90.0%** India-weighted working Android-phone reach.

The current measured Unity-inclusive preview APK is 43,584,653 bytes and its AAB
is 21,769,253 bytes. Both passed the repository's artifact-size and static
compatibility preflights, including the available native-library alignment checks.
Those byte counts are not the binding installed-size measurement. Strict emulator
runtime acceptance of the exact APK passed, but Play-generated split inspection,
full installed-footprint measurement through the first playable ball,
merged-manifest review, native-library/16 KB physical-runtime closure and combined
WebView-plus-Unity memory evidence are still required. SIZE-50 and REACH-90 remain
**UNPROVEN**.

The native host rejects Unity before class loading on low-memory/currently
constrained/3 GB-or-less/unknown-memory phones and non-ARM64 or unknown-ABI
processes. Those phones retain the complete Three.js/Classic path; runtime routing
is protection, not reach proof.

## Still unproven

- Independent visual comparison of the fresh Unity live delivery against the
  retained Three.js baseline and target competitor references.
- Physical Android initialize → scene → delivery → gesture → result → replay →
  unload, including repeated lifecycle, interruption and WebView-liveness evidence.
- Real-device input-to-visible latency, frame pacing, context loss, memory, thermal,
  battery and audio-focus results.
- Native Android touch history/coalescing. The current Unity legacy touch path samples
  the newest point once per rendered frame, so the locked F-003 sparse-cadence power
  deviation remains open until event-history capture and physical-device evidence land.
- The 50 MB installed and 90% India-weighted reach gates.
- Professional realistic characters, faces, cloth/gear materials, mocap-quality
  secondary motion, authentic recorded cricket audio and independent art review.
- Rookie/expert human testing. No 9.5 player-experience, “10×,” or “90% real
  cricket” claim is supported without those players and devices.

No production character/equipment/stadium asset pack, production animation or
motion-capture set, or authentic recorded cricket-audio library has been integrated.
No physical-device study or human-player study has been run.

## Resume order

1. Run the physical-device and Play-distribution gates for exact preview build
   `38924bd+05f72561424b`; the completed strict emulator acceptance remains
   engineering evidence only.
2. Compare the fresh live Unity surface against the retained browser renderer and
   competitor references on representative hardware.
3. Replace procedural close-up humans and synthesized audio with provenance-complete
   professional assets, then obtain independent visual/listening and rookie/expert
   evidence.

Until those steps pass, keep Unity opt-in and retain Three.js/Classic.
