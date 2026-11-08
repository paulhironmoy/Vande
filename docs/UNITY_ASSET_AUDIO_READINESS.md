# Unity asset and audio readiness

Status: sourcing, production and acceptance contract. This document records requirements and blockers; it does not
claim that an asset, recording, device or human gate has passed.

## 1. Non-negotiable truth labels

At the time this document was created:

- VANDE's visible cricket world is generated procedurally by code in `src/render3d/**`;
- VANDE's Practice effects and crowd are synthesized by code in `src/audio/**`;
- those sources are original project work and useful for behavior, proportions and development fallback;
- they are **non-final for the requested production Unity experience**;
- no authentic recorded cricket transient or production source character model was found in the repository;
- no physical-device visual/audio acceptance or human blind-listening result may be inferred from automated tests.

Do not relabel synthesized audio as recorded, sampled or authentic. Do not relabel procedural player geometry as a
final human asset. If either is visible or audible on a candidate path, identify it plainly in that candidate's
evidence and classify the path as an engineering slice until independently accepted.

## 2. Sources that may be reused

### Behavioral and visual references

The following are useful specifications, not drop-in Unity production assets:

- `src/render3d/three/ball.ts` and `src/render3d/practice/ballLook.ts`: size, seam, shine, scuff and readability rules;
- `src/render3d/three/props.ts`: legal-scale bat, stumps and bails references;
- `src/render3d/three/players.ts`, `firstPerson.ts` and `core/clips.ts`: current skeleton, pose and timing behavior;
- `src/render3d/three/stadium.ts`: pitch, outfield, boundary, sight-screen, lighting and crowd layout intent;
- `src/render3d/core/camera.ts`: Batter Eye and gaze rules;
- `src/practice/ui/components/{MiniRadar,FieldMap}.tsx`: canonical field visualization behavior;
- `public/brand/**`, `public/icons/**` and `public/og/**`: project brand material, subject to the experience owner and
  Unity import verification.

Recreating a rule in Unity does not transfer acceptance. The Unity output requires its own provenance, memory,
performance and physical-device evidence.

### Audio and haptic behavior

The following are reusable behavioral contracts:

- `src/audio/practice.ts`: Practice event sink;
- `src/audio/engine.ts`: priorities, buses, ducking and quiet-state behavior;
- `src/audio/settings.ts`: independent control semantics;
- `src/audio/captions.ts`: essential-cue captions;
- `src/audio/feel.ts` and `src/audio/haptics.ts`: proportional haptic intent;
- `src/audio/timingLog.ts`: causal timing evidence;
- `src/audio/bank.ts`, `voices.ts`, `fxVoices.ts`, `crowdVoices.ts` and `crowdBed.ts`: **non-final synthesized
  waveforms** that may serve only as development fallback/reference for the authentic target.

Unity must preserve event causality, priority, settings, captions and deterministic selection without pretending the
current synthesized waveforms are authentic recordings.

## 3. Status vocabulary

Use one of these values in `release/unity-practice/ASSET-AUDIO-INVENTORY.md`:

| Status | Meaning |
| --- | --- |
| `REFERENCE_ONLY` | Useful specification or fallback; forbidden on an accepted production path unless separately promoted |
| `REQUIRED_MISSING` | The slice cannot meet its stated target until this item exists |
| `QUARANTINED` | File exists but rights, identity, integrity or source is unresolved; it must not enter a build |
| `IN_PRODUCTION` | Source and rights are known, but processing or validation is incomplete |
| `CANDIDATE` | Build-ready with documented rights; independent visual/listening and device gates remain |
| `ACCEPTED` | Independent evidence for the exact shipped version satisfies all applicable gates |
| `REJECTED` | Failed rights, quality, performance, coherence or accessibility acceptance |

`ACCEPTED` is version-specific. Modification, recompression, retargeting, material replacement or material mix change
returns the affected entry to `CANDIDATE` until the relevant evidence is rerun.

## 4. Minimum final art for the one-delivery slice

Only what the camera can see or what the outcome can expose is required initially, but everything visible must be
intentional and final-quality:

| Asset group | Minimum slice contents | Acceptance concern |
| --- | --- | --- |
| Bowler | One original fictional adult, clear face, hair, skin, original kit and shoes; mobile LODs; complete pace run-up, gather, release and follow-through | Anatomy, planted feet, hand-connected release, no real-player likeness or marks |
| Batter | One original fictional right-handed adult, clear face where visible, original kit, helmet/grille, gloves, pads, guards and shoes; mobile LODs | Correct stance, grip, weight transfer, no clipping, no foot sliding |
| Rig | Consistent human skeleton, hands/fingers, face/eyes where visible, IK targets and documented scale | Retarget provenance, joint limits and contact alignment |
| Batting motion | Ready, backlift, defensive, grounded, lofted, leave, miss and recovery needed by exposed input outcomes | Smooth blending; rendered bat agrees with physical bat |
| Ball | Law-scale cricket ball with raised seam, distinct maintained/rough sides, scuff response and physical rotation | READ2/READ3 and COH3 at all tiers |
| Bat | Law-compliant proportions, grip, willow grain, edges, toe and restrained wear | ART1/ART3, hand grip and collision alignment |
| Wicket | Three legal-scale stumps and separate physical bails | Stump/bail contacts and wicket animation |
| Pitch | One balanced 20.12 m by 3.05 m strip, legal creases, surface detail tied to balanced-pitch physics | ART1/ART8 and bounce readability |
| Field | Outfield, boundary, one canonical field preset and every fielder that an exposed trajectory can involve | PIP/live IDs match; no teleporting; correct named positions |
| Keeper | Original equipped keeper and glove/catch behavior if nick/catch or keeper collection is exposed | Physical glove event agrees with audio and result |
| Ground | Sight screens, restrained stadium structure, lighting and enough crowd treatment to make the field credible | Never harms ball contrast; crowd does not animate before outcome |

Use the topology, LOD, texture and memory ceilings already specified in `docs/ASSET_REGISTER.md` unless a measured ADR
supersedes them. Production import must use controlled scale, axis, materials, texture compression, animation culling,
shader variants and loading. No network fetch, first-use shader compilation or asset load may occur during a delivery.

The slice must not use unauthorized real-player likenesses, real team kits, sponsor marks, scraped models, ripped game
assets, copyrighted broadcast imagery or an asset whose commercial modification/distribution rights are unclear.

## 5. Minimum authentic recordings

The one-delivery slice needs a small rights-safe library, not a broad imitation of broadcast coverage.

### Physical core

- bowler run-up footsteps and release effort where used;
- ball on the balanced pitch, with enough variants to avoid immediate repetition;
- bat middle;
- defensive/mistimed bat contact if exposed;
- outside edge/thin nick;
- miss/swish;
- pad/protective-equipment contact;
- wicket components: ball-to-stump, stump resonance, bail separation and bail landing;
- wicketkeeper glove if collection or catch is exposed;
- fielder catch/pickup/throw and boundary cushion only when those outcomes are exposed.

The core transient for pitch, bat, edge, pad, glove and wicket must originate in an authentic original recording session
or a licence that explicitly permits this use. Procedural resonance, filtering and environment may enhance it but may
not substitute for it.

### Environment and emotion

- a rights-safe stadium bed with no intelligible copyrighted announcement or broadcast content;
- restrained reactions for dot/leave, run, four, six, close call and wicket only when the slice exposes them;
- optional original player effort, call and appeal recordings with performer releases.

Commentary, licensed music and victory stingers are not required for the one-delivery slice. The contact must remain
clear without them.

### Variation and selection

Common impacts require several genuinely distinct takes. Use deterministic seeded or round-robin selection, restrained
gain/filter/pitch variation and repetition prevention. Do not turn one middle sample into every contact category or
make every middle sound like a six. Selection must use authoritative physical facts such as surface, velocities,
contact point/normal, sweet-spot distance, edge thickness and spin—not the scoreboard label.

## 6. Recording-session minimum

For an original session, preserve enough source evidence for another person to establish rights and reproduce the
processing decision:

- UTC date, country/location category and session owner;
- recordist, performers and rights-holder identities in a protected rights file;
- signed performer/location releases where a recognizable voice, person or private location is captured;
- equipment chain, microphone position, sample rate/bit depth and room/environment description;
- cricket equipment and surface used, including bat/ball/pad/glove/stump details;
- take sheet with take ID, action, speed/contact category and known contamination;
- untouched master checksum plus edited derivative checksums;
- edit chain, denoise/EQ/dynamics/normalization changes and exported format;
- explicit confirmation that no broadcast, crowd PA, music or unlicensed voice is embedded;
- commercial grant covering worldwide distribution, modification, promotion, platforms and the intended term;
- attribution obligation and the exact credit text, or `none`.

Personal details and signed releases must not be committed to a public repository. Store a redacted rights reference or
document ID in the inventory and keep the protected original in the approved rights location.

## 7. Provenance record

Every imported asset and audio derivative requires these fields before it may be `CANDIDATE`:

| Field | Required content |
| --- | --- |
| Asset ID | Stable unique identifier used in the scene/event bank |
| Kind and purpose | Model, texture, animation, recording, derivative or brand asset; exact player-facing use |
| Creator/source | Human creator, original session or vendor; source URL only when applicable |
| Creation/acquisition date | UTC date |
| Rights owner | Party that can grant the licence |
| Licence | Exact licence name/version or signed agreement ID |
| Rights scope | Commercial use, modification, redistribution in compiled game, platforms, territory and term |
| Likeness/voice/location release | Required agreement ID or `not applicable`, with reason |
| Trademarks/embedded works | Review result for marks, music, signage, broadcast material and third-party textures |
| Attribution | Exact required text and placement, or `none` |
| Source checksum | Hash of untouched source/master |
| Derivative checksum | Hash of exact imported/exported file |
| Modifications | Retopo, retarget, edit, cleanup, processing and tool/version |
| Repository path | Exact Unity/source path or approved external protected location |
| Technical budget | Triangles, materials, textures, memory/load cost, duration/format as applicable |
| Build exposure | Scene, quality tier, event category and fallback behavior |
| Reviewer/status | Owner, independent reviewer, date and readiness status |
| Evidence | Visual/listening, device, performance and causality evidence paths |

An invoice alone is not a licence. A marketplace listing without archived terms is not sufficient evidence. AI-assisted
source also needs the generator/tool, date, input provenance and governing commercial-use terms; it must pass the same
likeness, trademark and embedded-work review.

## 8. Import and quarantine workflow

1. Register the proposed item before importing it into a player-facing scene or audio bank.
2. Verify checksum, source, licence, releases, attribution and embedded content.
3. Keep unresolved material outside player-facing build paths and mark it `QUARANTINED`.
4. Preserve the untouched source/master outside generated Unity caches.
5. Create deterministic, versioned derivatives and record every material modification.
6. Validate scale, rig, animation, material, texture, loudness, phase, clipping and mobile memory/load cost.
7. Attach the exact candidate checksum to the build ID and evidence.
8. Obtain independent visual or blind-listening evaluation and physical-device verification.
9. Promote only the exact accepted derivative; reject or rework failures without hiding them.
10. Reconcile every shipped item into `docs/ASSET_REGISTER.md` through the correct owner before release.

No agent may purchase a plan, asset, recording, service or licence; accept terms; or download an incompatibly licensed
asset on the owner's behalf. A licensing or acquisition decision is a user blocker, not permission to substitute an
unidentified placeholder.

## 9. Causal audio and haptic acceptance

The event timeline must demonstrate:

- pitch, contact, field and wicket sounds follow the corresponding physics timestamp;
- contact audio and haptic are scheduled within 20 ms of physical contact where supported;
- a visual/physical miss emits no bat-impact sound and no contact haptic;
- nick, keeper/slip glove and result form one ordered physical sequence;
- wicket audio contains synchronized stump/bail components rather than one generic explosion;
- crowd reacts only after it could perceive the event;
- six is at least as strong as four, four is stronger than a single, and a single is stronger than a dot; routine
  Practice boundaries never use the maximum reaction;
- sound off and haptics off are independently respected, including background/interruption states;
- captions retain all essential information when sound is unavailable;
- no recording, bank, impulse, shader or other asset loads during the delivery.

Bluetooth device latency must be reported separately from internal scheduling error. It must not be subtracted silently
or presented as engine latency.

## 10. Physical-device mix gate

The exact candidate build must be exercised on:

- a representative low-cost Android phone speaker;
- a capable/premium Android phone speaker;
- wired headphones;
- Bluetooth headphones, with device/output latency recorded separately;
- muted mode;
- haptic-only mode;
- haptics-off mode.

Record model, OS, audio route, volume step, system processing, application settings, ambient conditions, uptime and the
candidate asset checksums. Verify no clipping; comfortable loudness; audible important transients on small speakers;
crowd/Coach never masking contact; and distinguishable middle, edge, nick, pad, pitch and wicket cues.

This gate is pending until performed on physical hardware. Emulator, waveform or developer-headphone results do not
substitute for it.

## 11. Blind-listening gate

Use real human listeners who did not build or mix the candidate. AI agents and implementers are not listeners. Present
audio without the screen and randomize labels/order. Include repeat presentations to expose guessing and inconsistency.
The protocol must ask listeners to distinguish at least:

- middle;
- defensive contact;
- edge;
- thin nick;
- pad;
- pitch impact;
- wicket.

Also verify that pitch impacts change with exposed surfaces, a six-ball sequence does not sound like one repeated
sample, nick-plus-catch is perceived as one causal sequence and wicket contains coherent stump/bail events. Record the
predeclared acceptance threshold, anonymized responses, confusion matrix, device/audio route and analysis method before
reporting a result. Do not invent a pass percentage after seeing responses.

Until this protocol runs, label authenticity and human-listening status `NOT RUN`. Automated spectral, timing and unit
tests may support the decision but cannot close this gate.

## 12. Acceptance boundary

An asset/audio set is ready for an accepted player-facing slice only when:

1. every visible/audible item has complete provenance and compatible rights;
2. exact imported derivatives and checksums match the candidate build;
3. no item on the path is `REFERENCE_ONLY`, `REQUIRED_MISSING` or `QUARANTINED`;
4. art agrees with cricket dimensions, physics, camera, field and quality tiers;
5. audio and haptics agree with the authoritative event timeline;
6. mobile memory/load/performance budgets pass without mid-delivery loading;
7. accessibility alternatives pass;
8. physical-device and applicable blind-listening evidence exists;
9. an independent evaluator records the decision;
10. every remaining limitation is stated without a quality or ceiling claim.
