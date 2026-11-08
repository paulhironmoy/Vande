# Unity Practice experience contract

Status: implementation-readiness contract; it is not evidence that Unity, a physical device, or a human evaluation has
passed.

## 1. Authority and scope

This document narrows the Unity work to the active Practice stage. It does not open Chase or any later stage in
`docs/VANDE-PRODUCT-SEQUENCE.md`. The following existing documents remain authoritative and take precedence:

1. `docs/VANDE-PRODUCT-SEQUENCE.md`;
2. `docs/VANDE-EXPERIENCE-CONSTITUTION.md`;
3. `docs/prompts/VANDE-INTERFACE-ASSET-CONSTITUTION.md`;
4. `docs/ARCHITECTURE.md` and its exclusive ownership table;
5. the locked player-experience rubrics under `release/player-experience/`.

The purpose here is to state exactly what the smallest coherent Unity live-delivery surface must preserve and prove.
It does not change a locked rubric, authorize a score, or allow a builder to certify their own work.

## 2. Honest baseline

The existing React/TypeScript Practice journey, deterministic game facts, field layouts, camera rules, ball-readability
rules, feedback timing, accessibility settings and evidence harnesses are valuable inputs.

The current live presentation is not the final Unity presentation:

- current players, faces, equipment, animation, stadium and crowd are procedurally constructed in `src/render3d/**`;
- current Practice effects and crowd audio are synthesized in `src/audio/**`;
- there are no source production character models or authentic recorded cricket sounds in the repository at the time
  of this document's creation;
- existing procedural art and synthesized audio may be used only as a development fallback or behavioral reference
  for the requested production target. They must not be represented as final, recorded, photoreal, independently
  accepted, or player-validated.

The Three.js and Classic renderers remain fallbacks until an independent evaluator proves Unity parity. Do not remove
them merely because a Unity scene launches.

## 3. Runtime responsibility

React/TypeScript continues to own the product shell:

- launch, onboarding, Home and the choice of Random or Predefined Over;
- Practice setup, settings, account and language;
- session progression and established game rules;
- post-session surfaces where the integration decision keeps them in React;
- recovery routing and a useful failure state when Unity cannot start.

Unity owns the live Practice surface once control is handed off:

- the 3D cricket world, players, ball, pitch, fielders, stadium and Batter Eye camera;
- continuous delivery and bat simulation on its side of the approved authority boundary;
- input response, bat animation, contact presentation and field outcome presentation;
- in-delivery HUD, field PIP, quiet-mode visuals, cricket audio, haptics, replay and live Coach overlays.

The architecture decision record must choose the authoritative boundary before feature expansion. There must be one
canonical result, one scoring application and one replay record. A receiving runtime must never reroll, reinterpret or
visually contradict the result. The versioned bridge payload must include enough facts to reproduce and audit the
delivery, including contract and simulation versions, build ID, locale, quality tier, setup, deterministic seed,
assistance, input timestamps and trace, batter position, physical trace, contact, field result, score, wicket, replay,
coaching facts and explicit failure state.

## 4. Live journey and state machine

The player-facing sequence is:

1. React confirms the Practice setup.
2. React sends one immutable, versioned session/delivery configuration to Unity.
3. A branded, accessible handoff appears; it contains no engine or device jargon.
4. Unity shows the field and mandatory setup information before the approach.
5. The bowler begins the approach and the surface enters Delivery Quiet Mode.
6. The player reads release, flight and bounce, then supplies the established batting input.
7. Physics determines miss/contact, exit, fielding and the physical result.
8. Only after the physical event may score, crowd, result copy and coaching react.
9. Dead ball exposes one primary next action: replay/retry for the vertical slice, and the constitutional next action
   when the full over is implemented.
10. Exit returns a typed result or a typed recoverable failure to React.

Transitions must be explicit and logged. Backgrounding, interruption or Activity recreation must not create a second
delivery, duplicate a score, lose the current ball or permit save-scumming.

## 5. One-delivery vertical slice

Do not broaden the Unity surface until this path is coherent:

- one fictional, right-handed batter;
- one fictional, right-arm pace bowler;
- one balanced pitch and one field preset;
- one white/new ball and one deterministic stock good-length delivery;
- one Batter Eye camera;
- a complete run-up, gather, hand-connected release and follow-through;
- readable flight and bounce;
- touch response using the established shot-intent semantics;
- continuous swept-bat collision, including a physically possible miss;
- post-contact field trajectory and the responsible fielder when applicable;
- a result that follows the physical outcome exactly once;
- authentic pitch and bat audio for the exposed events;
- exact replay from the stored authoritative record.

This slice is a final-quality vertical sample, not a promise that every Practice combination is complete. If final
licensed art or authentic recordings are unavailable, label the build `engineering vertical slice`; do not call it an
accepted or production-ready slice.

### One-delivery acceptance

| Area | Required result | Minimum evidence |
| --- | --- | --- |
| Authority | One seed, delivery, input trace, contact/result and score; no reroll or double scoring | Serialized request/result and matching cross-runtime golden fixture |
| Release | Bowling hand is within 5 cm of the physics release point and the action matches the configured delivery | Frame-stepped scene/physics overlay and event log |
| Flight | Rendered ball remains within `max(2 px, half the ball diameter)` of projected physics in every sampled frame | Per-frame projection trace plus synchronized capture |
| Bounce | Visual bounce is within one presented frame of physics and occurs at the physics point | Physics/render timestamps and frame capture |
| Bat | At contact the rendered bat is within 3 cm and 5 degrees of the physics bat | Pose/contact trace and synchronized capture |
| Contact | Middle, edge and miss have physical causes; a miss produces no impact sound or contact haptic | Contact manifold, event log and capture |
| Response | Input-to-first-visible-bat-motion p95 is at most 50 ms on Premium/Balanced and 67 ms on Classic over at least 50 swings per configuration | Physical input-to-photon method, raw timestamps and calculation |
| Readability | From release through contact, UI never enters the ball corridor; at release, bounce and 5 m before the bat the ball or allowed aid is at least 3 px with at least 3:1 local contrast | Composited frame analysis on every tested tier/viewport |
| Camera | Eye height is 1.55-1.75 m, horizontal FOV is 55-75 degrees, there is no roll, delivery head motion is at most 2 cm and Reduced Motion removes nonessential movement | Scene values, trace and capture |
| Field | Exit bearing, fielder, boundary/wicket time and score agree with physics | Physical trace, fielder IDs, score-event ordering and capture |
| Replay | Replay reproduces identical flight samples, field and result | Record hash, engine comparison and screen trace |
| Audio/haptic | Contact sound and haptic are scheduled within 20 ms of physics contact where supported, never on a miss, and no reaction anticipates the outcome | Physics/audio/haptic timeline and raw logs |
| Assets | Every visible shipped asset has origin, licence and acceptance state; no placeholder is visible on an accepted path | Asset register, licence artefacts and evaluator captures |
| Performance | No load, network request, shader compile or quality change occurs during the delivery | Profiler markers, request/load log and tier trace |

The locked rubrics remain the source for the full sample sizes, methods and gates. Passing this table does not by
itself satisfy the full Stage 1 exit criteria.

## 6. Batter Eye and the ball

The camera represents a batter reading a real delivery. It must not become a broadcast camera between approach and
contact. Gloves, hands and bat may be visible only when anatomically and physically coherent, and they must not enter
the ball corridor.

The ball outranks every other pixel. Its seam axis, shiny side, rotation, swing, seam or spin presentation must agree
with simulation facts. Any focus aid is restrained, identical in effective readability across quality tiers and
recorded in evidence. Do not enlarge, teleport, glow or change the trajectory to rescue readability.

After contact, camera movement may follow the result only after the player has seen the contact. Reduced Motion keeps
the full game playable and removes nonessential head/camera motion.

## 7. HUD, field PIP and setup information

The existing behavior in `StatusStrip.tsx`, `MiniRadar.tsx`, `FieldMap.tsx` and `SessionBrief.tsx` is the reference, not
a second source of game facts.

Before the approach, the compact peripheral rail exposes:

- score, wickets, over and ball;
- pitch and ball condition;
- bowler family/arm and pace band;
- assistance state;
- compact field radar and pause.

The expanded setup remains available between deliveries and includes pitch behavior, ball age/condition, bowler
profile, known pattern information, labelled field, objective and assistance. Random Over must never disclose the
exact next delivery.

The field PIP must be rendered from the same canonical fielder IDs and coordinates used for the physical outcome. It
must mirror handedness and remain subordinate to the ball. A decorative miniature alone is insufficient evidence; a
fixture must show that each PIP marker maps to the live fielder transform and named field position.

The rail must remain outside the ball corridor and cover no more than 8% of the screen. It cannot become a permanent
dashboard.

### Delivery Quiet Mode

Quiet Mode begins when the approach begins and ends only when the ball is dead. During it:

- freeze HUD animation and decorative motion;
- reduce nonessential contrast;
- hide coaching, instruction, progression, rewards and notifications;
- do not move the camera for interface effect;
- play no interface sounds;
- allow no tappable control except pause;
- keep only the constitutional peripheral rail;
- defer score, boundary, wicket, crowd and mastery presentation until the corresponding physical fact exists.

Entry, exit and every attempted prohibited event must be visible in the event log.

## 8. Audio and haptics

`src/audio/**` provides reusable event taxonomy, causality, priorities, settings, captions and haptic intent. Its
waveforms and synthesized crowd are **non-final** for the requested authentic Unity target.

Unity audio must be driven by the authoritative physics timestamp and facts, not by score copy or animation guesses.
The initial physical transient for pitch, bat, edge, pad, glove and wicket must come from an original or properly
licensed real recording. Procedural processing may add resonance or environment but cannot replace that core.

One runtime owns playback and haptics during the live surface. React and Unity must not both respond to the same
contact event. Audio priority is release, pitch, bat, trajectory/fielding, calls, crowd, commentary and interface.
Crowd has no look-ahead. Haptics are proportional, optional, rate-limited and silent for navigation, routine score
updates and misses.

The exact sourcing, minimum recording library and blind-test gates are in `docs/UNITY_ASSET_AUDIO_READINESS.md`.

## 9. Accessibility and comfort

Unity does not remove the app's accessibility obligations. The live surface must provide, either natively or through
a synchronized accessible overlay:

- outcomes announced only after the physical outcome;
- captions for every essential audio cue;
- independent audio and haptic controls;
- fully playable muted and haptic-off modes;
- 200% text without overlap or corridor intrusion;
- at least 48 dp touch targets;
- logical focus and keyboard operation where the web surface exposes the action;
- screen-reader semantics for all actionable controls and essential status;
- color-safe feedback with no fact conveyed by color alone;
- Reduced Motion without loss of timing or control;
- safe-area support and existing VANDE locale/font coverage.

The 3D canvas itself may be hidden from a screen reader only when an accessible, synchronized equivalent exposes the
essential status, action and result.

## 10. Performance and lifecycle

Measure complete deliveries from one second before release through outcome, not menus or a hand-picked middle window.
The locked PERF1 targets apply: Premium p95 at most 18 ms; Balanced p95 at most 22.2 ms and p99 at most 33.3 ms;
Classic p95 at most 33.3 ms; no frame over 100 ms inside a delivery; at least 30 deliveries per tier and environment.

Quality may change only between balls. Physics, timing, ball readability and result must not change by tier or by 30
versus 60 fps. The Android integration must independently exercise pause/resume, Back, Activity recreation, process
replacement, audio focus, calls/interruptions, low memory, graphics-context loss, orientation, safe areas, Unity
unload/reload, offline operation and return to React.

Physical-device evidence must include at least a representative low-tier Android phone and a capable Android phone.
Emulator evidence does not satisfy that gate.

## 11. Evidence and promotion rule

Use `scripts/build-id.sh` and
`release/unity-practice/EVIDENCE-TEMPLATE.md`. Every claim records UTC, device/OS, viewport, tier, settings, method,
expected, observed, pass/fail, uptime and evidence path. Timing taken with one-minute load above 20 is indicative only.

A builder may produce evidence but may not certify their own work. Promotion from engineering slice to accepted slice
requires:

1. all player-facing Unity assets and recordings entered in both the Unity readiness inventory and the canonical asset
   register;
2. licences and releases available for inspection;
3. automated coherence, replay, accessibility, performance and lifecycle evidence attached to one build ID;
4. physical Android evidence;
5. independent evaluation;
6. no open Critical or High finding for the path;
7. honest `not run`, `blocked` or `failed` labels for every unmet gate.

Human results remain pending until real participants execute the locked blind protocol. AI agents are evaluators, not
players, and cannot estimate a rookie, expert or listening-test result.

## 12. Deliberately outside this slice

- Chase, tournaments, multiplayer, social sharing and monetization;
- multiple bowlers, pitch families, stadiums or full-over breadth;
- progression, rewards, currencies, streaks and promotional UI;
- commentary and music unless independently justified after cricket sound is correct;
- replacement or deletion of the existing renderer;
- claims of `10x`, `90% real`, ceiling scores, production readiness or human preference without the required evidence.

## 13. Android competitive north stars

The comparison set is deliberately narrow and current enough to be useful:

- [Real Cricket](https://play.google.com/store/apps/details?id=com.nautilus.realcricket) for control breadth,
  configurable batting and broadcast-scale presentation;
- [World Cricket Championship 3](https://play.google.com/store/apps/details?id=com.nextwave.wcc3) for the combined
  importance of timing, footwork, placement and shot selection;
- [Cricket League](https://play.google.com/store/apps/details?id=com.miniclip.cricketleague) for immediate onboarding
  and a compressed first playable match.

VANDE does not try to beat an animation-count claim with a larger animation count. Its intended advantage is one
continuously controllable, physically coherent ball whose causes can be audited. The competitive target is therefore
falsifiable:

1. the bowler's action exposes legitimate pace, spin and variation cues without revealing a Random delivery in text;
2. the ball or allowed focus aid is at least 3 px and 3:1 local contrast at release, bounce and five metres before
   contact, with no interface obstruction;
3. the bat first answers the player within the locked 50/67 ms p95 budgets, then reconciles without a pop to the
   TypeScript-normalized swing and canonical bat trace;
4. intended direction error is at most 10 degrees median and 20 degrees p90, while input power and elevation remain
   monotonic with rank correlation at least 0.9;
5. release, flight, bounce, bat contact, sound, haptic, field consequence and score meet the one-delivery tolerances
   in section 5 and never anticipate the authoritative event;
6. a failed ball names one physical cause and offers an identical-ball retry;
7. the atmosphere supplies scale, light, surface response, spatial sound and proportional crowd emotion, but never
   reduces ball readability, frame stability or the 50,000,000-byte/90% Android end goals.

This is the engineering interpretation of “dramatically better.” A multiplicative superiority or human preference
claim still requires a common competitor task, blind player cohorts and physical-device evidence; source inspection
or feature completion cannot establish it.
