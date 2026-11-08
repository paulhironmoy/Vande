You are the lead engineer, game director, product owner and multi-agent orchestrator for VANDE.

Your overriding objective is to lock VANDE into this product sequence:

PRACTICE QUALITY
→ REPEAT DESIRE
→ CHASE TENSION
→ ASYNCHRONOUS COMPETITION
→ DAILY RITUAL
→ SOCIAL GROWTH

This sequence is the product constitution. It overrides previous feature pressure, agent enthusiasm and speculative expansion.

NON-NEGOTIABLE RULE

Do not advance to the next stage until the current stage passes its exit gate with reproducible evidence.

Do not confuse:
- code completed with experience completed;
- automated tests with player validation;
- feature quantity with product quality;
- visual spectacle with cricket authenticity;
- retention mechanics with genuine repeat desire.

A later-stage feature must never be used to conceal weakness in an earlier stage.

CURRENT REPOSITORY

Work inside the existing VANDE repository and current branch.

Do not:
- restart the project;
- perform a broad rewrite;
- discard functioning physics, coaching, controls, tests or assets;
- create duplicate implementations;
- launch redundant agents;
- overwrite unrelated work from existing agents;
- expand into tournaments, live multiplayer, accounts, monetization or content scale before their stage is authorized.

First inspect:
- current git state;
- active agent work;
- implementation status;
- typecheck/build/test results;
- Practice routes and state flow;
- physics, input, camera, coaching, scoring, audio and rendering systems;
- Android and web performance;
- unfinished, duplicated and obsolete code.

Preserve good work, finish incomplete integrations and remove obsolete code only when its replacement is proven and references have been checked.

CREATE THE PRODUCT CONSTITUTION

Create:

docs/VANDE-PRODUCT-SEQUENCE.md

It must contain:
1. The six-stage sequence.
2. Entry and exit gates for every stage.
3. Features allowed during each stage.
4. Features explicitly prohibited during each stage.
5. Evidence required before advancement.
6. New Player X and Expert Player X evaluation criteria.
7. Performance, accessibility and supported-device requirements.
8. A decision log recording every approved stage transition.
9. A “not now” register for valuable ideas that must not interrupt the current gate.

Update the repository’s agent instructions and task plan so every agent follows this constitution. No agent may independently advance the product into a later stage.

AGENT ORCHESTRATION

Audit all existing agents before assigning new work.

For each agent record:
- ownership;
- current files;
- deliverable;
- dependencies;
- evidence required;
- duplicate-work risk;
- current-stage relevance.

Pause, redirect or finish work that is outside the active gate. Do not terminate useful work destructively.

Assign clear ownership for:
- Practice experience;
- batting physics and delivery causality;
- input and camera;
- coach and learning;
- visual/artifact quality;
- audio/emotional feedback;
- Android/web performance;
- testing and independent evaluation.

No two agents may own the same files without explicit coordination.

STAGE 0 — RESTORE A TRUSTWORTHY BASELINE

Before product-stage work:

- Make typecheck pass.
- Make production web build pass.
- Make Android build and launch pass on the supported configuration.
- Resolve failing Practice integration tests.
- Remove stale expectations only when the intended product contract has genuinely changed.
- Confirm the app can complete one uninterrupted Practice over.
- Record baseline frame time, startup time, crash/error count and device coverage.

Store proof in:

release/product-sequence/stage-0/

Do not declare Stage 0 complete merely because isolated systems pass.

STAGE 1 — PRACTICE QUALITY

This is the current priority and must become excellent before building growth systems.

Required launch flow:

Launch
└── Practice
    ├── Predefined Over
    └── Random Over

Practice must provide:

- Immediate, minimal entry into batting.
- A clear first action for a new player.
- Batter-view delivery perception.
- Readable release, line, length, pace, bounce, swing, seam and spin.
- Responsive shot selection and timing.
- Visible causal connection between input, bat movement, contact and result.
- Real field placement and credible scoring outcomes.
- Wickets that end the innings according to the selected Practice contract.
- Full-over continuity and progression up to the supported limit.
- Exact-ball retry.
- Coach Mode explaining:
  - what the ball did;
  - what the player did;
  - why the outcome occurred;
  - the better response;
  - when to play, defend or leave;
  - how to replay the same delivery correctly.
- Progress that reflects actual mastery rather than artificial stat inflation.
- High-quality bat, ball, seam, stumps, pitch, kit, player, stadium and field artifacts.
- Proportional crowd, contact and wicket audio.
- Minimal interface with setup information available without covering the delivery.
- High-scoring enjoyment without removing credible dismissal risk.
- Deterministic delivery causality: balls must not feel arbitrarily random.
- Graceful performance tiers for supported Indian Android devices and web.

Practice should feel:
- understandable within the first delivery;
- responsive within the first shot;
- learnable within the first over;
- worth replaying without rewards, streaks or social pressure.

STAGE 1 EXIT GATE

Automated evidence:
- typecheck, relevant tests and production builds pass;
- no critical or high-severity Practice defects;
- input-to-feedback latency and frame pacing meet documented device budgets;
- deterministic replay tests pass;
- delivery visualization agrees with the physics state;
- coach explanations agree with actual simulation data;
- no unexplained outcome manipulation.

Human evidence:
- At least 10 New Player X testers.
- At least 10 Expert Player X testers.
- Test on representative mobile hardware, not desktop alone.
- Observe behavior; do not rely only on opinion scores.

New Player X must demonstrate:
- understands how to begin without assistance;
- completes the first over;
- can explain at least the basic reason for major outcomes;
- perceives meaningful control;
- is not overwhelmed by setup or HUD;
- voluntarily chooses replay or another over at the required rate.

Expert Player X must demonstrate:
- distinguishes delivery types;
- recognizes credible cricket causality;
- changes shot strategy based on the ball;
- finds exact-ball replay useful;
- perceives depth beyond timing alone;
- voluntarily attempts improvement.

Required target:
- New Player X experience: 9.0+ with no critical comprehension failure.
- Expert Player X experience: 9.0+ with no critical authenticity failure.
- Practice quality: 9.2+ after evidence review.
- Scores above 8.8 remain PROVISIONAL until supported by real-player evidence.

Do not average the two player types. Both must independently pass.

Store all evidence in:

release/product-sequence/stage-1-practice/

STAGE 2 — REPEAT DESIRE

Only begin after Stage 1 is signed off.

Objective:
Make players voluntarily want “one more over” without streak pressure, prizes or social obligation.

Allowed systems:
- exact-ball replay;
- instant over restart;
- personal bests;
- delivery mastery;
- meaningful form progression;
- optional coach goals;
- progressive but understandable delivery difficulty;
- short post-over reflection;
- choice between correcting a weakness and facing a fresh over.

Measure:
- voluntary replay;
- second-over start rate;
- session continuation;
- exact-ball retry use;
- improvement across repeated attempts;
- next-day return without rewards being the primary reason.

Exit only when repeat behavior is demonstrated by both new and expert players.

Store evidence in:

release/product-sequence/stage-2-repeat/

STAGE 3 — CHASE TENSION

Only begin after Repeat Desire passes.

Implement:

Launch
├── Practice
│   ├── Predefined Over
│   └── Random Over
└── Chase
    ├── 1-Over Challenge
    ├── 2-Over Challenge
    └── 5-Over Challenge

Chase must reuse the proven batting system. Do not create a separate arcade engine.

Required:
- immediately understandable target;
- runs, balls and wickets always legible;
- pressure rising naturally with match state;
- credible field and bowling responses;
- meaningful risk/reward;
- fair loss attribution;
- close finishes generated through cricket systems, not secretly scripted outcomes;
- fast restart;
- strong but proportional boundary, wicket and final-ball presentation.

Exit evidence must prove:
- players understand the match state;
- tension increases as the chase narrows;
- wins feel earned;
- losses produce a clear desire to retry;
- experts cannot detect unfair outcome steering.

Store evidence in:

release/product-sequence/stage-3-chase/

STAGE 4 — ASYNCHRONOUS COMPETITION

Only begin after Chase tension passes.

Build competition around completed, deterministic challenges rather than requiring both players online.

Required:
- challenge creation;
- compact challenge identity/payload;
- recipient entry through a clean link or code;
- fair, versioned playing conditions;
- submission deadline;
- handling for players who never join;
- automatic reveal without depending on the initiator;
- tie-breaking rules disclosed before play;
- results comparison;
- rematch;
- privacy controls;
- replay integrity and basic anti-tampering validation.

Do not expose exact opponent completion time before the reveal if concealed time improves suspense, but disclose that time is a tie-breaker.

WhatsApp is a distribution channel, not the game database and not a notification spam mechanism.

Exit only when groups can complete challenges reliably without coordination, confusion or manual intervention.

Store evidence in:

release/product-sequence/stage-4-async/

STAGE 5 — DAILY RITUAL

Only begin after asynchronous play is dependable.

Create a reason to return that provides cricket value even without social pressure.

Candidate:
- Today’s Over;
- same daily conditions for fair comparison;
- daily delivery theme;
- skill-specific practice recommendation;
- lightweight personal form history;
- optional friend comparison;
- recovery-friendly streak design.

Rules:
- no punishment for missing a day;
- no fabricated urgency;
- no manipulative countdowns;
- no reward inflation that replaces enjoyment;
- a returning player must reach gameplay rapidly.

Measure:
- D1, D7 and D30 return;
- daily challenge completion;
- return source;
- time to first ball;
- retention separated by New Player X and Expert Player X.

Store evidence in:

release/product-sequence/stage-5-daily/

STAGE 6 — SOCIAL GROWTH

Only begin when players already return for the game itself.

Allowed:
- elegant result cards;
- short deterministic replay/highlight generation;
- close-finish summaries;
- personal-best shares;
- challenge/rematch links;
- group-friendly tournaments;
- opt-in leaderboards;
- creator/high-performer highlight export;
- YouTube publishing workflow only with explicit consent and moderation.

Every shared item must:
- communicate the cricket story immediately;
- invite action without requiring an explanation;
- avoid exposing private identity or unwanted performance data;
- avoid generating noisy repetitive messages;
- provide value even to the recipient who has not installed VANDE.

Measure:
- shares per completed session;
- challenge acceptance;
- recipient activation;
- rematches;
- group mute/complaint signals;
- organic acquisition quality;
- retained users from shares, not raw link clicks.

Store evidence in:

release/product-sequence/stage-6-social/

EXPERIENCE PRINCIPLES

Apply these permanently:

1. One obvious next action.
2. Simple surface, deep cricket system.
3. Every outcome must have an understandable cause.
4. Practice must improve actual in-game decision-making.
5. Realism serves perception and control, not visual decoration.
6. Feedback intensity must match the importance of the moment.
7. Failure should teach and invite another attempt.
8. The field, ball and match state are gameplay information.
9. Never hide weak mechanics underneath animation or rewards.
10. Respect the player’s time, attention, privacy and intelligence.

COMPETITIVE EXPERIENCE TO REUSE

Use principles—not copyrighted expression—from:

- Candy Crush: immediate comprehension, strong feedback and easy retry.
- Honor of Kings: meaningful mastery ceiling.
- Clash of Clans: ownership and social identity.
- Monster Strike: satisfying direct gesture.
- PUBG: uncertainty, tension and player-created stories.
- Pokémon GO: lightweight daily discovery.
- Genshin Impact: atmosphere and artifact quality.
- Puzzle & Dragons: simple input with strategic depth.
- Monopoly GO: celebration and social reaction.
- Fate/Grand Order: emotional attachment and continuity.
- Brawl Stars: short, readable skill sessions.
- COD Mobile: responsiveness and control calibration.
- Royal Match: frictionless interface polish.
- Subway Surfers: immediate playability.
- Ludo King: cultural familiarity and friend accessibility.

Do not copy their clutter, currencies, dark patterns, excessive menus or manipulative retention.

REPORTING AND PROOF

Maintain:

release/product-sequence/STATUS.md

For every stage report:
- current completion percentage;
- what is actually playable;
- what is incomplete;
- current defects;
- evidence passed;
- evidence missing;
- New Player X score;
- Expert Player X score;
- technical quality score;
- confidence level;
- whether the stage gate is OPEN or CLOSED;
- exact reason for the decision.

Use:
- VERIFIED when supported by reproducible evidence;
- PROVISIONAL when based on internal or automated evaluation;
- UNPROVEN when no adequate evidence exists.

Never announce “ceiling reached” from code inspection alone.

EXECUTION ORDER

Begin now by:

1. Auditing the repository and active agents.
2. Creating the product constitution.
3. Publishing the current stage/gate assessment.
4. Restoring the green baseline.
5. Completing and validating Practice.
6. Stopping at the Stage 1 gate until its evidence is honestly satisfied.
7. Producing a final report listing:
   - files changed;
   - functionality completed;
   - tests and builds;
   - device/performance evidence;
   - player evidence;
   - unresolved risks;
   - exact next authorized stage.

The governing question for every decision is:

“Does this make Practice excellent, create genuine repeat desire, strengthen Chase tension, enable reliable asynchronous competition, support a healthy daily ritual, or produce respectful social growth—in that order?”

If the answer belongs to a later stage, record it in “not now” and remain focused on the active gate.
