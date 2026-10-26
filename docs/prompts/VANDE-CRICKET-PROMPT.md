You are the principal product architect, game director, senior game engineer, backend
architect, security engineer, growth designer and release owner responsible for rebuilding
the existing VANDE repository into the best mobile cricket game for India.

Your mission is to deliver a production-quality, store-release-ready MVP—not a concept,
prototype, design document or collection of placeholders.

PRODUCT
Name: VANDE Cricket
Signature mode: Sealed Six
Tagline: “Lock your over. Reveal the rivalry.”

PLATFORMS
- Android through Capacitor
- Responsive web application and installable PWA
- Optimize Android as the primary experience
- iOS is outside this release, but architecture must not prevent it later

PRIMARY OUTCOME

Build an original cricket game that can compete with Cricket League from launch by being
better in the areas where it is vulnerable:

- Asynchronous play without connection losses
- Skill plus strategy rather than pay-to-win attributes
- Premium cinematic cricket presentation
- Friend-group tournaments for 3–10 people
- Sealed decisions followed by dramatic reveals
- Persistent match history and replay
- WhatsApp-native acquisition without group spam
- Daily competition and genuine FOMO
- National, city, college, company and friend leaderboards
- Daily Top 100 YouTube match highlights
- Low infrastructure cost
- Excellent performance on ordinary Indian Android devices and weak networks

Do not clone Miniclip, Cricket League, licensed teams, players, kits, stadiums, commentary,
music, branding, animations or interface. Produce an unmistakably original product.

AUTONOMOUS EXECUTION

Inspect the repository, plan, implement, test and validate the full product. Continue until
all feasible work is complete. Do not stop after writing plans or scaffolding.

Do not ask routine questions. Make strong, documented product decisions. Ask only when an
irreversible external decision genuinely prevents progress.

Missing credentials, signing keys, cloud accounts or store access must not stop development.
Build production adapters, local emulators and mock integrations; document only the external
activation steps that remain.

Never commit, push, publish, deploy, alter external accounts or submit to an app store without
explicit authorization.

MULTI-AGENT EXECUTION

Use a root agent and up to three concurrent subagents. Give each subagent a bounded task and
exclusive file ownership. Agents must communicate contracts before editing shared interfaces.

Initial workstreams:

1. GAMEPLAY AGENT
   Own:
   - Deterministic rules engine
   - Sealed Six mechanics
   - Ball outcome model
   - Skill-input validation
   - Pitch and weather modifiers
   - Simulation, balance and fairness tests
   - Replay event schema

2. EXPERIENCE AGENT
   Own:
   - Design system and user journeys
   - 3D match renderer
   - Animation, cameras, particles, lighting and audio
   - Training mode
   - Responsive web and Android interactions
   - Accessibility and low-end-device fallbacks

3. PLATFORM AGENT
   Own:
   - Backend, persistence and authentication
   - Match orchestration and deadlines
   - Group Cups, leaderboards and Cricket Rooms
   - Notifications, WhatsApp sharing
   - Video rendering and YouTube integration
   - Security, abuse prevention and infrastructure

The root agent owns architecture, contracts, integration, Android packaging, release quality,
cross-workstream tests and final acceptance.

After implementation, reuse agents for independent gameplay, UX, security and release audits.
Do not let multiple agents edit the same files simultaneously.

REPOSITORY REBUILD

First inspect:

- AGENTS.md and repository instructions
- Git status and existing uncommitted work
- Package manifests and lockfiles
- Source and test architecture
- Capacitor and Android configuration
- Current app identifier and signing configuration
- Existing PWA, sharing, deep-link, notification and persistence features
- Existing deterministic game logic and reusable UI primitives

Create REBUILD_DECISIONS.md listing every significant subsystem as:

- Reuse unchanged
- Adapt
- Rewrite
- Remove

Selectively reuse proven foundations such as:

- React
- TypeScript
- Vite
- Zustand or equivalent state management
- Capacitor Android integration
- PWA installation and caching
- IndexedDB/offline persistence
- Existing sharing, deep-link and notification utilities
- Vitest and Playwright
- Deterministic engine patterns
- Useful visual or audio infrastructure

Remove obsolete civic campaign, republic, political, opponent, content, navigation, branding,
tests and documentation only after verifying that nothing reusable depends on them.

Preserve:

- Git history
- User-owned uncommitted changes
- Signing files
- Secrets and environment files
- Release configuration whose purpose has not been established

Never create a miscellaneous “legacy” directory merely to retain unused code. Git is the
history. Do not perform destructive repository-wide commands.

Inspect whether the existing Android package identifier has been published. Use
`in.vande.cricket` for a genuinely new application; otherwise preserve the published ID and
record the decision.

CORE GAME: SEALED SIX

A match contains two one-over innings. Each player bowls one sealed six-ball over and bats
against the opponent’s sealed over at a convenient time.

MATCH FLOW

1. A player creates a duel or tournament fixture.
2. Both players secretly construct a six-delivery bowling plan.
3. Each delivery includes:
   - Delivery family
   - Line
   - Length
   - Pace or spin modifier
   - Tactical intent
   - Execution-quality gesture
4. A limited energy budget prevents repeating the strongest delivery six times.
5. The server commits and locks each over; it cannot be changed afterward.
6. When an opponent’s over is available, the batter plays against it asynchronously.
7. The batter sees each delivery only as it is bowled and responds using shot selection,
   direction and timing.
8. Results are server-authoritative and deterministic from the committed plan, validated
   player input, player-independent rules, pitch state and versioned random seed.
9. The final result remains sealed until both innings are finished or the deadline expires.
10. At reveal, present both innings ball by ball as a cinematic match.
11. Ties use a precommitted Super Ball.
12. Store the complete replay as a compact deterministic event log.

BOWLING OPTIONS

Include a balanced, readable set such as:

- Yorker
- Good length
- Bouncer
- Slower ball
- In-swing
- Out-swing
- Off-spin
- Leg-spin

Not every option must be available immediately. Unlock tactical variety through achievement,
not statistical pay-to-win power.

BATTING OPTIONS

Include:

- Defend
- Rotate strike
- Drive
- Cut or pull
- Sweep
- Loft
- Directional targeting
- Timing-based execution

The outcome model must account for matchup logic, execution quality, field placement, pitch,
risk, wickets and remaining balls. It must remain understandable to players.

FAIRNESS

- No purchasable performance advantage
- Identical rules for free and paying players
- Publish useful tactical explanations
- Record engine version and seed for every match
- Generate a commit hash before reveal
- Make completed matches auditable and reproducible
- Prevent client-selected results
- Validate input traces and reject impossible timing or gesture data
- Rate-limit suspicious behavior
- Add replay protection and idempotency
- Simulate at least 100,000 matches during balance testing
- Detect dominant strategies, impossible outcomes and unfair first-player advantages

PITCHES

Launch with three strategically distinct, clearly communicated pitches:

- Green: movement and swing
- Hard: pace, bounce and boundary potential
- Slow: spin, mistiming and placement

Pitch effects must change tactics without making results arbitrary.

GAME MODES

1. TRAINING
   - Works offline
   - Teaches batting and bowling in under one minute
   - Immediately demonstrates the reveal payoff

2. DAILY SIX
   - One common daily challenge
   - Same conditions for everyone
   - Best-three-attempt scoring or another anti-grinding system
   - City, college, company, friend and national leaderboards
   - Daily reset and streak system

3. FRIEND DUEL
   - Invite through link, QR code or WhatsApp
   - Guest-first onboarding
   - No installation required before opening the invitation
   - App installation preserves the pending match

4. GROUP CUP
   - Three to ten friends
   - Round-robin tournament
   - Automatic fixtures and standings
   - Fixed submission and reveal deadlines
   - Initiator is never required to trigger progression
   - Auto Over/Auto XI handles joined players who miss a deadline
   - Non-joiners do not block the tournament
   - Late play is permitted as unofficial practice
   - Finals receive enhanced presentation

5. PRACTICE GHOSTS
   - Play against deterministic local opponents
   - No server dependency
   - Useful during poor connectivity

Do not add synchronous real-time multiplayer to the MVP. Preserve an architecture that could
support it later, but win first through asynchronous social cricket.

FOMO AND DAILY ENGAGEMENT

Use honest anticipation, not manipulative dark patterns:

- Submission deadline
- Number of friends who have locked their overs
- Reveal countdown
- Tournament qualification pressure
- Rivalry records
- Winning and upset streaks
- Table movement
- Daily challenge
- Finals and championship windows
- “Your opponent has locked their over” notifications

Never expose hidden decisions, exact completion times or match results before reveal.
Never fabricate players, countdowns, scarcity or activity.

The core retention loop is:

Invite → lock bowling plan → bat asynchronously → anticipation → reveal → replay →
standings change → highlight/share → banter → rematch or next fixture.

CRICKET ROOM

Create a private in-app Cricket Room for every group and tournament.

Automatically post only meaningful events:

- Invitations
- Fixture creation
- Lock completion status
- Deadline reminders
- Reveal availability
- Final scorecards
- Standings changes
- Achievements
- Highlight links
- Rematch challenges

Do not post every delivery or routine action.

Include:

- Emoji reactions
- Safe predefined cricket banter
- Free-text chat disabled by default
- Mute and notification-frequency controls
- Reporting and blocking
- Spoiler-safe cards
- No public exposure of private group information

WHATSAPP STRATEGY

WhatsApp is an acquisition and return channel, not the game database or activity feed.

For one match, allow at most:

1. Invitation
2. Optional deadline reminder
3. Final reveal or highlight

Use the system share sheet and deep links. Never auto-send messages. Never require access to
contacts or private WhatsApp data. Make every shared card valuable even to a non-player.

DAILY TOP 100 YOUTUBE PROGRAM

Create a Daily Top 100 performance leaderboard.

Ranking should combine:

- Wins
- Opponent strength
- Tactical efficiency
- Tournament importance
- Clutch performance
- Batting and bowling execution
- Valid-match status

Use only each player’s best three eligible matches per day so grinding cannot purchase or
manufacture ranking position. Purchases and ads must never affect ranking.

At the daily cutoff:

1. Freeze and publish the leaderboard.
2. Give qualifying players a permanent “YouTube Top 100” badge.
3. Select each player’s best match.
4. Deduplicate matches when both participants qualify.
5. Generate a 30–60 second 1080×1920 YouTube Short.
6. Show participants the video, names/aliases, title, description and visibility.
7. Obtain all necessary publication consent.
8. Run moderation, anti-cheat and duplication checks.
9. Queue approved videos for the official VANDE Cricket YouTube channel.
10. Publish the link to the relevant Cricket Room and share sheet.
11. Track views, shares, installs, invitation opens and completed matches attributed to it.
12. Preserve the badge even if publication consent is declined.

A highlight should contain:

- VANDE Cricket identity
- Player aliases and generated avatars
- Fixture and tournament
- Best deliveries
- Boundaries and wickets
- Turning point
- Final result
- Player of the Match
- Standings movement
- “Can you beat them?” call to action
- Install or challenge deep link

Create an admin console to preview, approve, schedule, retry, unlist and remove videos.

Store YouTube credentials only on the server. Use OAuth securely. Implement idempotent,
recoverable uploads and a dead-letter queue. Never expose credentials in web or Android code.

YouTube quota must be treated as a launch dependency. The default upload allowance must not be
fully consumed without operational headroom. Support overflow scheduling and document the
process for requesting enough quota to publish 100 highlights daily.

Until credentials and quota approval are available, run the complete pipeline against a mock
YouTube adapter.

REPLAY AND VIDEO ARCHITECTURE

A replay is not a screen recording. It is a versioned event log containing:

- Engine version
- Match seed
- Pitch
- Committed strategies
- Validated inputs
- Delivery results
- Commentary events
- Camera cues
- Animation cues
- Score progression

The same event log must power:

- In-app replay
- Scorecard
- Tactical explanation
- Share card
- YouTube highlight
- Result auditing

Support:

- Watch Replay
- Key Moments
- Skip to Result
- Slow motion
- Delivery timeline
- Share Highlight
- Rematch

Render official YouTube videos on trusted infrastructure from validated event logs. Delete
temporary MP4 files after confirmed upload and a short recovery window. Keep the lightweight
event log.

VISUAL DIRECTION

The game must look premium and intentional, not like a generic dashboard or AI-generated
template.

Style:

- Stylized cinematic 3D
- Indian night-cricket energy
- Deep indigo atmosphere
- Electric cyan interface accents
- Amber stadium light
- Rich grass and pitch materials
- Strong silhouettes
- Restrained glass and glow
- Original fictional players and kits
- Broadcast-inspired presentation without copying a network

Required match presentation:

- Bowlers with distinct actions
- Batting footwork
- Ball seam/spin and readable trajectory
- Bat impact
- Stumps and bails
- Fielding and catches
- Stadium crowd reactions
- Boundary and wicket celebrations
- Multiple camera angles
- Slow-motion decisive moments
- Haptics
- Layered crowd, bat, ball and wicket audio
- Reduced-motion alternative

Use React for application UI and isolate the match renderer behind a clean interface.

Evaluate Babylon.js, Three.js or another web-capable 3D renderer through a measured technical
spike. Select the smallest approach that delivers:

- Web and Capacitor Android compatibility
- glTF animation support
- Reliable replay determinism
- Asset compression
- Low-end Android performance
- Maintainable integration

Do not retain PixiJS merely because it already exists. Reuse it only where it is genuinely the
best tool, such as a lightweight fallback or 2D effects.

Implement:

- Level of detail
- Object pooling
- Compressed textures
- Compressed glTF assets
- Adaptive shadows
- Adaptive particle density
- 30 FPS low-end mode
- 60 FPS standard mode
- Graceful WebGL failure fallback
- Performance instrumentation

Use original or properly licensed assets only. Store licenses and attribution where required.
No placeholder rectangles, emojis pretending to be final art or copyrighted sports assets may
remain in the release experience.

DESIGN AND UX

The first session must reach meaningful play rapidly:

1. Open invitation or app
2. Choose an alias and generated avatar
3. Complete a sub-one-minute interactive tutorial
4. Lock an over or play a practice ball
5. Experience a reveal
6. Invite a friend or enter Daily Six

Build complete states for:

- Loading
- Offline
- Reconnecting
- Empty tournament
- Pending opponent
- Locked
- Deadline expired
- Reveal ready
- Error and retry
- Consent declined
- Upload queued
- Upload failed
- Muted group
- Reduced-motion mode

Use thumb-reachable controls, readable typography, safe areas, haptics and accessibility.
Never communicate outcomes using color alone.

LOCALIZATION

Ship production-quality:

- English
- Hindi
- Hinglish where conversational copy benefits from it

Build localization files and layout support for:

- Bengali
- Telugu
- Marathi
- Tamil
- Gujarati
- Kannada
- Malayalam
- Punjabi

Do not claim machine-generated translations are native-reviewed. Clearly track translations
requiring human linguistic QA. Support Indic scripts, text expansion and locale-aware dates
and numbers.

BACKEND ARCHITECTURE

Prefer a serverless, low-operations architecture:

- Cloudflare Workers for APIs
- Durable Object or equivalent per active match/tournament
- D1 or equivalent indexed persistence for profiles and leaderboards
- R2 for assets, temporary videos and exported artifacts
- Queue-based deadlines, rendering and YouTube publication
- Firebase Cloud Messaging for Android push
- Cloud Run job or measured equivalent for FFmpeg/video rendering

Use infrastructure adapters so providers can be replaced.

Required backend qualities:

- Server-authoritative match state
- Encrypted sealed strategies at rest
- Signed commit hashes
- Versioned APIs and event schemas
- Idempotency keys
- Rate limits
- Abuse controls
- Retry policies
- Dead-letter queues
- Structured logs
- Metrics and traces
- Data-retention policies
- Export and deletion workflows
- Backup and recovery documentation
- No secret in the client bundle

Set launch cost targets:

- Approximately $25 per month expected
- $100 per month operational ceiling through early launch
- Billing alerts at $25, $50 and $100
- No always-on servers unless measurements prove they are necessary

AUTHENTICATION

Use guest-first identity. Let players begin without phone verification.

Support account recovery/linking through suitable platform identity such as Google sign-in or
passkeys. Avoid SMS authentication because of cost, friction and abuse exposure.

Allow:

- Alias
- Generated avatar
- Locale
- City or optional regional affiliation
- Optional college/company group entered privately

Do not require real names, contact uploads or public location.

MONETIZATION

The game must be commercially viable without pay-to-win mechanics.

Allow only:

- Cosmetic kits
- Celebrations
- Stadium themes
- Replay themes
- Profile customization
- Optional rewarded advertising
- Reasonably priced season cosmetics

Never:

- Sell stronger batsmen or bowlers
- Sell favorable match outcomes
- Sell leaderboard position
- Interrupt an active innings with advertising
- punish players who decline tracking consent
- use loot-box mechanics in the MVP

Keep advertising and billing providers behind disabled-by-default adapters until credentials
and policy configuration are available.

ANALYTICS

Define a privacy-conscious event schema for:

- Tutorial started/completed
- First delivery
- Invite created/opened/accepted
- Over locked
- Batting innings completed
- Reveal watched
- Replay completed
- Tournament joined/completed
- Reminder sent/opened
- Share initiated/completed
- Highlight consent
- YouTube publication
- Attributed view/install/challenge
- Rematch
- D1, D7 and D30 retention
- Notification opt-out
- Group mute
- Crash and renderer fallback

Do not log hidden player strategies before reveal, message content, contacts or unnecessary
personal information.

PERFORMANCE TARGETS

Measure on representative low-, mid- and high-tier Android profiles.

Targets:

- Useful shell visible in under 2.5 seconds on a reasonable mobile connection
- Training available offline after installation
- Standard renderer near 60 FPS on mid-tier devices
- Low mode at a stable 30 FPS
- No interaction-blocking work on the main thread
- Resumable asset downloads
- Small initial bundle
- Lazy-loaded stadium and cosmetic assets
- Functional play on intermittent networks
- No match loss caused by app suspension or connection interruption
- Android App Bundle configured for release

TESTING

Create and run:

- Rules-engine unit tests
- Determinism tests
- Property-based outcome tests
- 100,000-match balance simulation
- Commit/reveal tests
- Deadline and Auto XI tests
- Tournament progression tests
- Idempotency and retry tests
- Authentication tests
- Authorization tests
- Abuse and rate-limit tests
- Replay compatibility tests
- YouTube adapter and queue tests
- Consent tests
- React component tests
- Playwright end-to-end tests
- Offline/PWA tests
- Deep-link tests
- Android build and smoke tests
- Accessibility checks
- Performance budgets
- Dependency and secret scans

Test interrupted flows:

- App closes during batting
- Network disappears after a shot
- Duplicate submission
- Opponent never joins
- Opponent joins but never locks
- Initiator disappears
- Tournament deadline passes
- Video render fails
- YouTube rejects an upload
- Consent is withdrawn
- An old replay is opened after engine upgrade

Never weaken a test merely to make it pass. Fix the defect.

SECURITY AND TRUST

Threat-model:

- Strategy disclosure before reveal
- Forged scores
- Replay tampering
- Automated grinding
- Multiple-account abuse
- Invitation token guessing
- Tournament manipulation
- Offensive aliases
- YouTube credential theft
- Malicious media uploads
- Admin-console access
- Dependency compromise

Use least privilege, secure token storage, strict authorization and audit logs. No user-supplied
file may be published to the official YouTube channel. Official videos must be rendered from
validated structured match data.

DOCUMENTATION

Deliver and keep current:

- README.md
- REBUILD_DECISIONS.md
- ARCHITECTURE.md
- GAME_RULES.md
- VISUAL_SYSTEM.md
- SECURITY.md
- PRIVACY_AND_CONSENT.md
- ANALYTICS.md
- INFRASTRUCTURE.md
- COST_MODEL.md
- YOUTUBE_OPERATIONS.md
- ANDROID_RELEASE.md
- STORE_LISTING.md
- TEST_REPORT.md
- LAUNCH_BLOCKERS.md

Include exact local development, test, Android build and production activation commands.

IMPLEMENTATION PHASES

Phase 0: Audit
- Read instructions and inspect the repository
- Preserve user work
- Run the current tests
- Record the baseline
- Write REBUILD_DECISIONS.md

Phase 1: Product contracts
- Freeze the Sealed Six rules
- Define schemas and interfaces
- Create the design system
- Build simulations and technical rendering spikes
- Select the renderer using measured evidence

Phase 2: Vertical slice
- Complete one production-quality tutorial
- Complete one Friend Duel
- Lock both overs
- Play both innings asynchronously
- Reveal the match in 3D
- Produce replay and scorecard
- Demonstrate deep-link sharing

Phase 3: Social product
- Daily Six
- Group Cups
- Cricket Rooms
- Leaderboards
- Deadlines
- Auto XI
- Notifications and WhatsApp flows

Phase 4: Highlight system
- Event-log video rendering
- Top 100 ranking
- Consent
- Moderation
- Publishing queue
- Mock and real YouTube adapters
- Admin console
- Attribution

Phase 5: Hardening
- Offline behavior
- Security
- Performance
- Accessibility
- Localization
- Android lifecycle
- Full automated tests

Phase 6: Release preparation
- Production build
- Signed-build instructions
- Store assets and listing copy
- Privacy disclosures
- Cost model
- Operational runbooks
- Final audits

QUALITY RUBRIC

Before declaring completion, score the actual implemented product from 0–10 on:

- First-minute clarity
- Batting satisfaction
- Bowling strategy
- Reveal excitement
- Visual quality
- Audio and haptics
- Asynchronous fairness
- Friend-group engagement
- Daily return motivation
- FOMO
- Shareability
- Tournament quality
- YouTube-worthiness
- Low-end-device performance
- Reliability
- Accessibility
- Trust and privacy
- Monetization fairness

No category may remain below 8/10. Core gameplay, reveal excitement, reliability and
shareability must reach at least 9/10. If a score is lower, identify the concrete deficiency,
improve the implementation and reevaluate.

DEFINITION OF DONE

The work is complete only when:

- A new player can install/open the product and understand it without explanation
- Training, Daily Six, Friend Duel and Group Cup operate end to end
- A 3–10-person tournament cannot be stalled by its creator or an absent player
- Sealed choices remain hidden until the intended reveal
- Match results are deterministic, validated and reproducible
- The 3D match is attractive and performant
- Every completed match has a replay and scorecard
- Cricket Rooms and spoiler-safe sharing work
- Top 100 selection and highlight rendering work
- YouTube publishing works through a tested adapter
- Consent and moderation are enforced
- Web/PWA production builds pass
- Android release build passes
- Automated tests pass
- No critical accessibility or security issue remains
- No copyrighted or unlicensed asset remains
- No secret is committed
- Documentation matches the implementation
- Remaining blockers are exclusively external credentials, approvals or publishing actions

FINAL HANDOFF

At completion, provide:

1. What was built
2. What existing VANDE code was reused, adapted, rewritten and removed
3. Product screenshots or previews
4. Gameplay and architecture summary
5. Exact commands run and test results
6. Performance results
7. Fairness simulation results
8. Security and accessibility findings
9. Android artifact location
10. Web build location
11. Current infrastructure cost estimate
12. External launch blockers
13. A concise store-release checklist

Do not report success based on scaffolding. Verify the actual product.
