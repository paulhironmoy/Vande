# VANDE Lite: fair friend incentives, twist questions, Insight points and clear visuals

## REPOSITORY

/Users/hironmoy/Vande/Vande

## PRIMARY OUTCOME

Make Lite Chapter 1 ("The Exam Leak", at /lite) reward understanding instead of copied answers, and make every reward fair to the three people involved: the helper who sends a dare, the friend who answers it, and everyone else. In the same pass, reward tough questions without punishing mistakes, and show answers as pictures only where a picture cannot confuse or nudge the player.

Deliver:

- a twist question that makes relayed answers worthless and pays for teaching the idea;
- equal Challenger points for the friend, and a rematch that keeps the loop going;
- caps and rules that keep rewards fair for everyone;
- one "How points work" card that explains every number;
- Insight points for Tricky, Tough and Boss questions, with no penalty for wrong answers;
- pictures for answers only where every answer of a question passes strict clarity tests;
- server-verified dares, built deployment-ready and switched off;
- written prerequisites for any future prizes, with nothing prize-related built.

These decisions were agreed with the product owner. Implement them; do not reopen them. Where this prompt leaves a detail open, choose the simplest option that keeps every rule true, and list the choice in the final report.

The owner authorizes a reasonable development budget. This work adds no recurring infrastructure cost: nothing is deployed or purchased.

## SUCCESS DEFINITION

The helper:
finish a Lite move
→ dare up to three friends, optionally with a hint
→ a friend replies
→ earn +40, and +100 more if that friend found the best move and also cracked a twist question the helper has never seen
→ watch "Friends helped" grow
→ get dared back on the friend's twist
→ answer it and see who won.

The friend:
open the dare
→ see the question's tier and that the helper's score is hidden
→ answer before the helper's midnight
→ see the full reveal of every move
→ take a 15-second twist on the same idea in a new place
→ send the result back
→ earn the same amounts as Challenger points
→ challenge the helper with the twist.

Everyone else:
nobody is pressured, nagged, tracked or recruited. Ignoring a dare costs nothing. Scores, stars, medals and all content stay fully available to people who never share. Nobody earns from a friend's friends.

Any player in their own run:
see "Boss question · ×3 Insight" before answering
→ think
→ the best move earns Insight; a wrong move earns none and loses nothing, while the city bars still react
→ questions whose answers can all be drawn clearly show pictures with short labels; every other question shows text cards exactly as today.

## NON-NEGOTIABLE SAFETY AND REPOSITORY RULES

1. Read all applicable AGENTS.md files before acting.
2. Inspect README, package scripts, architecture, privacy, release, performance, testing, and rollback documentation.
3. Run git status before editing.
4. Assume existing modified and untracked files contain valuable user work.
5. Preserve and integrate existing changes.
6. Never run:
   - git reset --hard;
   - git clean;
   - destructive checkout commands;
   - broad recursive deletion;
   - commands that overwrite uncommitted work.
7. Never commit credentials or private keys.
8. Do not rewrite unrelated code.
9. Do not silently remove features.
10. Preserve both Simple and Full modes.
11. Preserve offline play.
12. Backend, analytics, or notification failures must never prevent local gameplay.
13. Preserve keyboard navigation, screen-reader usability, reduced motion, high contrast, responsive layouts, and readable touch targets.
14. Preserve or improve the documented bundle and performance budgets.
15. Do not introduce:
    - advertisements;
    - pay-to-win mechanics;
    - loot boxes;
    - manipulative streak loss;
    - shame-based messages;
    - false urgency;
    - fabricated social proof;
    - invasive tracking;
    - precise location collection;
    - advertising identifiers;
    - unnecessary accounts;
    - unnecessary personal data.
16. Update privacy documentation before enabling any new network data flow.
17. Do not deploy or purchase anything. Implement deployment-ready code, configurations, migrations, documentation, and cost estimates.
18. Make reasonable implementation decisions autonomously. Ask the user only if a genuine blocker would materially change scope, privacy, cost, or architecture.
19. Do not stop after planning or scaffolding.
20. Continue until the full scope is implemented and verified, unless blocked by something that genuinely requires external authorization.

Additional rules for this task:

21. Commit locally at the end of each wave with a clear message. Never push, deploy (GitHub Pages, Cloudflare or anywhere else) or publish Android builds.
22. Never print, copy or commit anything under android/keystore/ or android/keystore.properties.
23. Do not change the main score formula, stars, medals, missions, best score, Lite challenge codes (L1), daily content, the daily schedule or campaign content, except for the additive fields this prompt defines.
24. Keep every existing data-testid and route. Add new test ids for new UI.
25. Twist questions never come from the daily crises or the campaign chapters, so no future content is spoiled.
26. Write all Lite copy for an eight-year-old: short sentences, plain words, no shame, no exaggerated urgency.

## CURRENT STATE (verify in code; this is a map, not a substitute)

- Lite: src/screens/Lite/LitePlayScreen.tsx (about 1,400 lines) plays src/content/scenarios/examination-crisis.json: 10 decisions with 3–4 options each and 3 fair-play moments, with a simple-language layer under each item's `simple` key. Routes /lite, /lite/<challenge code>, /lite/dare/<code> and /lite/reply/<code> live in src/app/routes.ts; the store entry is `startLite` in src/app/store.ts.
- Move points: max(10, 100 + 8 × bar points gained − 8 × bar points lost); ×2 when every clue the move relies on (`requiresEvidence`) was scanned; calm-streak multiplier 1 + 0.25 × min(streak − 1, 4), reset by a harsh move; +50 per mission; +100 per star at the end, with stars from `starsFor`; best score in localStorage `vande:lite-best`.
- After each answer, every option is evaluated from the same pre-decision state with the pure engine (`evaluateMove` calling `reduce`) for the ranked reveal. The reveal uses immediate effects; options can also carry `delayed` effects and `proportionateIf` / `disproportionateEffects`.
- Cards: src/components/game/cards/ActionCard.tsx shows a kind badge and fixed Gain/Cost lines per kind (actionKind.ts: talk, check, protect, enforce, restrict, wait, rule; `actionKindOf(tags)`).
- Dares and replies: src/share/dare.ts. `I1_…` dare codes replay the sender's path to the dared question, hide the sender's result until the friend answers, end at the sender's next local midnight, and may carry one of three principle hints (`DARE_HINTS`). `R1_…` reply codes award the sender Helper points (+40 per answer, +100 more if the friend found the best move), stored in localStorage `vande:lite-helper` and deduplicated by reply code. The share UI is src/components/game/dare/DareSheet.tsx (three friend slots, group-chat copy).
- Known bug: two friends who give identical answers produce identical R1 codes, so the second friend is treated as already counted.
- Backend: backend/ is a Cloudflare Worker with D1 (anonymous daily results and stats, rate buckets, fail-closed `RATE_SALT`, tests with an in-memory D1). It is not deployed. backend/src/contract.ts mirrors app types by hand.
- Flags: src/app/flags.ts. Every network feature is off unless configured at build time, and community sharing is also opt-in per player.
- Analytics: a closed event and property dictionary in src/analytics/types.ts; off unless configured.
- Validation: src/engine/validate.ts (scenarios) and src/engine/dailyValidate.ts; schema in src/content/schema/scenario.schema.json. scripts/validate-daily.mjs shows how scripts load TypeScript through Vite.
- Nothing since release 1.0.0 is pushed or deployed; the work sits in local commits on main. There were no AGENTS.md files when this prompt was written; check again.

## PRODUCT RULES

These are the agreed rules. Every number lives in one module (see CONTRACTS) and nowhere else.

### A. Twist question

A1. After a friend answers a dared question and sees the reveal, offer one twist: a new short situation built on the same idea. It takes about 15 seconds, has no timer, and can be skipped at no cost.

A2. Twists come from a new authored pool, for example src/content/lite/twists.json with its own JSON schema and validator:
- simple language for age eight: situation of at most 30 words, 3–4 options (prefer 4), option titles of at most 7 words, and a one-line "why" of at most 20 words;
- each option carries tags, so the kind badge, Gain/Cost lines and `actionKindOf` work unchanged;
- exactly one best option; every option plausible, with the harsh option tempting because it is fast;
- the same principles as the main content: evidence before action, targeted and proportionate responses, protection of peaceful people, due process; no real parties, politicians or identifiable places;
- each twist has a `kind`: the action kind of its best option, or `rule` for fair-play twists;
- coverage: at least 4 twists for every action kind that can be the best move of a Chapter 1 decision (compute this with the engine across seeds and paths), at least 4 `rule` twists for fair-play dares, and at least 30 twists in total;
- ids are permanent: never renumber or reuse them; retire a twist instead of deleting it, so old links still resolve.

A3. Selection happens on the friend's device. Match the action kind of the dared question's best move, computed exactly as the reveal computes it; fair-play dares draw a `rule` twist; if no twist of the needed kind exists, draw from any kind. Pick with `crypto.getRandomValues`, prefer twists this device has not seen, and shuffle the option order.

A4. One attempt per device per dare. Persist the chosen twist, option order, answer and a random reply nonce, keyed by the dare's identity (seed, path, step, deadline), so reloading shows the same twist and its recorded answer.

A5. After answering, show "Right" or "Not quite", the why line and the twist's cards. Nothing is ever taken away.

### B. Who earns what

| Who | When | Earns |
|---|---|---|
| Helper (sent the dare) | Opens a friend's reply | +40 for the answer; +100 more when the friend found the best move on the dare and got the twist right |
| Challenger (answered the dare) | Taps any send channel for their reply | The same amounts, as Challenger points |
| Anyone | Sends a dare | Nothing for sending alone |
| Anyone | Answers a rematch | No points; the reward is the win |

B1. Caps, the same for everyone: rewarded replies at most 3 per dare and at most 10 per local day. Challenger awards at most once per dare and at most 10 per local day. The caps cover the +40 as well, so reach alone cannot out-earn understanding. Over a cap, still show the friend's result, award 0, and say so calmly, for example "You've helped 10 friends today. New Helper points start at midnight."

B2. One hop only. You earn from replies to your own dares, never from your friends' friends. Passing a dare on creates a new dare owned by the person passing it on.

B3. Helper and Challenger points never feed the score, stars, medals, missions, best score, challenge codes or daily results. Show them as a personal tally that leads with people, for example "Friends helped 5 · understood 3 · 420 Helper points". No ranking and no comparison with other players.

B4. Deduplicate: the same reply counts once. Two friends with identical answers must produce different reply codes, using the nonce from A4. The same friend reopening their reply regenerates the same code.

B5. Hints stay and stay encouraged: they teach the idea, not the answer.

B6. Deadlines stay real and quiet. An unanswered dare or rematch simply ends ("This dare has ended. You can still play."). No reminders, no nagging, no streak loss.

B7. No contact access, contact upload or automatic sending. Every message is sent by the player's own tap.

### C. Reply code R2 and the rematch

C1. A new reply format `R2_…` carries the dare fields, the friend's points and best-move flag on the dare, the twist id, the twist outcome (right, not quite or skipped), the nonce and the rematch deadline (the friend's next local midnight), with a checksum. Follow the style of I1 and R1: URL-path-safe, canonical base36, and null for anything malformed or tampered. Keep the new fields short, because wave 2 may append a signature.

C2. R1 codes still decode and award +40 only, because they carry no twist.

C3. The reply is a rematch. After the award, the helper is dared back on the friend's twist. The helper has never seen it, while every Chapter 1 question is already familiar to them. The friend's twist outcome stays hidden until the helper answers; then show who won, and both right is a draw. If the friend skipped the twist, there is no rematch; offer "Dare more friends" as today.

### D. Trade-results experiment (off by default)

D1. Behind a build flag, for example `VITE_LITE_TRADE_RESULTS` (default off), the friend still sees their own score and the full reveal at once, but "who won" against the helper unlocks after they tap a send channel. Document it as an experiment in docs/FEATURE-FLAGS.md.

### E. How points work

E1. One card explains every number a player can see: move points, the clue bonus, the streak, missions, stars, Insight, and Helper and Challenger points with their caps. It also says "Points you have earned are never taken away, but the city still feels every move" and "Sharing never changes your score, stars or medals." Stars come from how the city ends up, so the card must not claim that harsh moves cost nothing.

E2. The card is generated from the points module, so the text and the scoring cannot drift apart.

E3. It opens from the Lite start screen, the in-game HUD, the result screen and the dare and reply landings. It works with keyboard and screen reader, closes with Escape and returns focus to the control that opened it.

E4. Update every existing promise of points for sharing to the new rules, for example "Earn +100 Helper points for every friend who finds the best move" in LitePlayScreen.tsx and "You earn +100 Helper points for every friend who finds the best move, +40 for every answer" in DareSheet.tsx.

### F. Insight points for tough questions

F1. Each Chapter 1 decision has a fixed tier: Tricky ×1, Tough ×2 or Boss ×3. Toughness comes from the game itself, never from live player answer rates, which can be gamed and would drift during the day.

F2. Signals, computed with the engine at the state where the decision appears:
- close call: the best and second-best moves are within a small points margin;
- trap: a non-best move looks better right now on at least one city bar, while its total effect, including `delayed` effects and disproportionate penalties, is worse;
- clue needed: the best move relies on a clue, so scanning first matters.
In Chapter 1 the harsh moves already score low right away, so define "trap" by temptation as above, not by immediate points alone.

F3. No signal is Tricky, one is Tough, two or more is Boss. Because the state varies by seed, evaluate along the best path over a fixed set of seeds and take the most common tier.

F4. Store the tiers in a committed manifest generated by a script. A unit test recomputes it and fails when content changes make it stale. Tune thresholds, never individual questions, so Chapter 1 has at least one Boss and at most a third Boss. Record each question's signals and tier, and the thresholds, in docs for owner review.

F5. Fair-play moments default to Tricky; content may set a validated override.

F6. Insight is earned in the player's own run only. The best move (rank 1 in the reveal; ties count as best) earns 50 × tier. A close second (rank 2 and within the close-call margin) earns half. Anything else earns 0. Insight is never negative.

F7. Insight is its own tally. It is never multiplied by the streak or the clue bonus, and it never enters the score, stars, medal, best score, missions, challenge codes or dare comparisons. Dares, twists and rematches earn no Insight.

F8. Show the tier before answering, in the decision header, for example "Boss question · ×3 Insight", as text and never by colour alone. Show it on the dare landing for the dared question too. Feedback shows the Insight earned; the HUD and the result show the total; keep a separate best Insight in localStorage.

F9. No penalty does not mean no consequences. City bars still react to every move exactly as today; never imply that harsh moves are free.

F10. Call it "Insight points", defined in one constant. The owner first called them "magic points", so renaming must be a one-line change.

### G. Pictures only where they cannot confuse (Lite Chapter 1 only)

G1. Decide per question, never per answer. A question shows pictures only if every one of its answers passes all four tests below; otherwise the whole question stays text with the kind badge. A lone picture draws the eye and nudges choices.

G2. The four tests:
1. Concrete: the answer has a visible actor, action and object (lock the gates, send water tankers, meet the student leaders, scan the document). Procedural or legal ideas fail ("open a transparent review", "follow due process"), and so do almost all fair-play questions.
2. Distinct: every answer differs from every other answer in the question in at least one of actor, action or object.
3. Neutral: nothing signals good or bad. No red or green meaning, no ticks, crosses or warning marks, no weapons, handcuffs, injuries, fire or frightening imagery, no smiling or angry faces, and equal visual weight across the answers.
4. Label stays: a 2–4 word label sits under every picture and keeps the words that make the answer different ("only", "every", "now", "first").

G3. Pictograms are composed from reusable parts (actor, action, object) as inline SVG React components in one consistent, premium style. Use currentColor and one shared neutral accent for every kind, so the picture adds no colour cue. No text inside pictures, no raster images, no new runtime dependencies.

G4. Keep the vocabulary as small as Chapter 1 needs and reusable for later chapters. Vocabulary ids are permanent and live in a data module with no React, imported by both the validator and the UI. A test asserts that every vocabulary id has exactly one component and every component has an id.

G5. Content: additive fields in the simple layer of examination-crisis.json, a `label` of 2–4 words and a `visual` of {actor, action, object}, on each option that can pass. Update scenario.schema.json.

G6. A pure gate function returns a visual plan for a question, or null for text. Rendering uses only this function.

G7. Validator: error on unknown vocabulary ids, labels outside 2–4 words, duplicate compositions within a question, and non-neutral glyphs. Report, but do not fail on, partially tagged questions; they fall back to text. Print a coverage report of which questions are visual.

G8. ActionCard gains an optional visual prop. Without it, nothing changes. With it, the card shows the picture and the label in place of the longer title, plus the kind badge and the Gain/Cost lines. The picture is aria-hidden, and the accessible name stays the visible text. The lite-option-<id> test ids stay.

G9. The reveal shows the same small picture beside each answer of a visual question, and the reveal and feedback keep the full sentence.

G10. Pictures work at 360, 390 and 412 px widths without horizontal scroll, with touch targets of at least 44 px, under reduced motion (no animated pictures) and in forced-colours (high-contrast) mode.

G11. Stop at Chapter 1. Do not tag other chapters, twists or daily crises; the owner reviews screenshots first.

### H. Measurement (closed dictionary, off unless configured)

H1. Add four integer properties to `lite_completed`: visual questions, best picks on visual questions, text questions, and best picks on text questions. This is the bias check for pictures.

H2. Add only what the experiments need: `lite_twist_answered` (right or not), `lite_reply_sent` (share method, and whether trade-results is on) and `lite_reply_opened` (awarded or not, capped or not). No ids, free text, option-level data or timestamps.

H3. Extend the property key list and the analytics tests, and update docs/ANALYTICS.md and docs/PRIVACY.md.

### I. Verified dares (wave 2: deployment-ready, switched off, not deployed)

This is the prerequisite for ever giving Helper points value, such as a leaderboard, a prize or anything public. Today's points are personal and capped, so local checks are enough until then.

I1. Two endpoints that follow backend/src conventions:
- start: records one attempt per device key per dare and returns a server-chosen twist matched by kind;
- grade: grades the twist against the server's copy of the pool, verifies the dared answer by replaying the dare through the same deterministic engine, and returns a signed result.
Share the engine, the evaluation helpers and the content with the Worker through the bundler instead of hand copies. If that is impractical, document why and add a test that the copies match. Measure CPU time in tests. If replay does not fit the Workers free-plan CPU limit, keep twist grading, mark the dare flag as unverified in the signed payload, and document it.

I2. Device key: the client sends SHA-256 of its install id plus the dare identity, so attempts cannot be linked across dares. IP addresses are used only for the existing hashed rate limits.

I3. Signing: ECDSA P-256 with SHA-256 through WebCrypto, which Workers and browsers provide without dependencies. The private key exists only as a Worker secret. The public key is embedded at build time, for example as `VITE_DARE_PUBLIC_KEY`. Provide a key-generation script that prints both keys and writes nothing into the repository. Without the secret, the endpoints fail closed.

I4. The helper's app verifies the signature offline with the public key; no extra request. Store signed awards separately from local ones, so any future public use can count verified awards only.

I5. Storage: a D1 migration for attempts, rows deleted after 7 days by scheduled cleanup, and both endpoints rate-limited with the existing buckets.

I6. Client: on only when the community API is configured, a new flag is on (for example `VITE_LITE_VERIFIED_DARES`), the public key is present, the community kill switch is off and the player has opted in to community sharing. Use a short timeout. On any failure, fall back to the local twist and an unsigned reply. Gameplay never waits on the network.

I7. Community goal: the grade endpoint also increments a per-UTC-day count of answers and best moves found. A cached read shows "Today X% of dare answers found the best move" only once the count reaches the existing minimum cohort; otherwise it shows nothing. Real numbers only.

I8. Note in the docs that the twist answer key also ships in the app for offline play. Anything with real value must serve twists and their answers from the server only.

### J. Prizes and giveaways: documentation only

Build nothing prize-related. Write docs/COMPETITION-READINESS.md with the prerequisites the owner must meet before any prize, giveaway or public leaderboard:

- Legal and tax: no money in, ever, with free entry and no purchase necessary, because India's 2025 online gaming law bans real-money games; prizes for skill rather than random draws, since state lottery and prize-competition rules vary; TDS on prizes above ₹10,000, including prizes in kind, with winners' PAN and record keeping; prize delivery needs personal data, which breaks the no-accounts promise and brings Digital Personal Data Protection Act duties; under-18s need verifiable parental consent and cannot accept contest terms; countdowns must stay honest under the consumer regulator's dark-pattern rules; Google Play contest and families policies apply; official rules must be published, covering eligibility, winner selection, dates and the sponsor.
- Integrity: scores are self-reported today, so prize scores need server replay of move logs; all daily content ships in the app, so prize days need server release at unlock time; shared solutions, bots and ties need tie-breaks that neither punish accessibility nor turn into lotteries; multi-accounting needs identity or device checks that cut against the privacy stance; outages during a prize window become fairness disputes.
- Guessing: with no penalty, lucky guessers can tie experts on Boss questions. Prize Insight should count only when the player also answers a one-tap "why was this best?" question, which is not built now.
- Product: prizes can crowd out learning and inflate retention data; money riding on a "best" civic answer invites disputes, so content review and appeals are needed; Simple versus Full mode, connectivity and language affect who can win; prizes near elections can look like influence; fulfilment, payouts, tax filings, fraud review and a grievance officer usually cost more than the prizes.
- Recommendation: keep the learning game prize-free for children; run any contest as a separate adults-only league with free entry, published rules, skill prizes from server-verified replays of server-released content, and identity checks only for winners; start with recognition prizes; take Indian legal and tax advice first.

## CONTRACTS (the lead writes and commits these before parallel work)

1. Points module, for example src/lite/points.ts: every number from rules B, E and F plus the existing scoring constants. Move the pure Lite scoring helpers (`scoreDelta`, `evaluateMove` and the move-points formula) out of LitePlayScreen.tsx into a pure module with identical behaviour, proven by a test that compares old and new results on every Chapter 1 option.
2. Twist types, JSON schema and an empty pool file.
3. The toughness manifest type.
4. The visual vocabulary type, the `label` and `visual` content fields, and the gate function signature.
5. The R2 reply layout and the local award ledger shape: helper and challenger tallies, per-dare and per-day counters, seen replies and a verified flag, with a safe migration from the current `vande:lite-helper` value.
6. The analytics additions.

## MULTI-AGENT EXECUTION MODEL

Use one lead agent and up to three specialist agents concurrently, reused across waves. The lead owns architecture, contracts, integration, conflict prevention, final decisions, testing and release quality.

Only the lead edits src/screens/Lite/LitePlayScreen.tsx, its CSS module, src/app/store.ts and src/app/routes.ts. Specialists deliver pure modules, components and tests that the lead integrates. No two agents edit the same file at the same time; route shared files through the lead.

### AUDIT WAVE (short, read-only, parallel)

- Lite and sharing: LitePlayScreen.tsx, dare.ts, DareSheet.tsx, ChallengeSheet.tsx and the Lite e2e tests. Return the exact flow, state and storage keys, and where each rule above plugs in.
- Engine and content: `evaluateMove` and `reduce`, delayed and proportionality effects, validators and schemas. Return how to compute best-move kinds and toughness signals, and a twist coverage plan.
- Backend and platform: backend/, flags, analytics, privacy and cost docs, and the bundle check. Return the endpoint plan, how the Worker can import the engine, and the budget headroom.

### WAVE 1 (local only, $0)

Agent 1, friend loop: R2 encode and decode with the nonce and rematch fields, R1 compatibility, the award ledger with caps, dedupe, local-day rollover and migration, twist selection and the attempt store, the trade-results flag, and the DareSheet copy. Unit tests for all of it.

Agent 2, content and difficulty: the twist pool (at least 30, with coverage per A2), its schema, validator and tests; the toughness computation, generator script, manifest and staleness test; the tier review table for the docs.

Agent 3, visuals: the vocabulary, pictogram components, gate function, ActionCard visual prop, Chapter 1 tagging, schema and validator rules, the coverage report, and screenshots at 360, 390 and 412 px plus forced colours.

Lead: the contracts; the points module extraction; the How points work card; integration into the Lite screen of the twist step, reply and rematch landings, cap messages, tier badges, Insight scoring and display, and visual cards; focus management for every new step; analytics; e2e tests.

### WAVE 2

Agent 1, verified dares (rule I): endpoints, migration, signing, cleanup, rate limits, the key script, a client module with timeout and fallback, and backend and client tests.

Agent 2, documentation: rule J and the documentation list below.

Agent 3, accessibility and phone pass over all new UI: axe, keyboard, screen-reader names, reduced motion, forced colours, touch targets and final screenshots.

### REVIEW WAVE

Reuse the specialists as independent reviewers. Give them the code, not your conclusions.

Reviewer 1, fairness and gaming: try every row of the threat model below, plus cap bypasses, double awards, R1 and R2 confusion, rematch farming, multi-tab races, clock changes around midnight, replayed or edited links, and Insight inflation.

Reviewer 2, accessibility and clarity: keyboard-only play through dare, twist, reply and rematch; focus order and restoration; screen-reader names on picture cards; reading level; whether any picture hints at the answer; narrow phones; reduced motion; forced colours.

Reviewer 3, privacy, security and cost: actual network requests with every flag off and on, payloads against the docs, key handling, retention, rate limits, fail-closed behaviour and free-tier assumptions.

Each finding has a severity. The lead fixes every critical and high finding and re-runs the affected tests.

Threat model to test and document:

| Way to game it | Defence now (local) | Defence once verified dares are on |
|---|---|---|
| Phone the friend with the answer | Twist chosen on the friend's device; both answers needed | Server-chosen twist |
| Forge a reply link | Checksums only; points are personal and capped | Server-graded, signed replies |
| Retry the twist | One recorded attempt per device per dare | One server attempt per device key per dare |
| Answer your own dare on a second device | Caps | Caps; cannot be fully stopped |
| Coach the friend live | Accepted, since it is close to real teaching | Same |
| Guess or use an answer key | Large pool, shuffled options, both answers needed | Same; server-only answers before any prize |

## FUNCTIONAL ACCEPTANCE CRITERIA

The work is incomplete unless all of these hold:

1. A friend who answers a dare can take one twist matched to the dared question's best-move kind, or a fair-play twist for fair-play dares.
2. Reloading or reopening the dare shows the same twist and the recorded answer.
3. The +100 requires both the best move on the dare and a right twist; R1 replies award +40 only.
4. The helper gets at most 3 rewarded replies per dare and 10 per local day; the friend earns Challenger points once per dare and at most 10 per day; over-cap replies still show results and say calmly that the cap is reached.
5. Two friends with identical answers both count; the same reply never counts twice.
6. Nobody earns from a friend's friends; sending alone earns nothing; rematches earn nothing.
7. The rematch hides the friend's twist outcome until the helper answers, then shows who won.
8. Helper, Challenger and Insight points never change the score, stars, medals, missions, best score, challenge codes or daily results.
9. The How points work card matches the points module exactly, tested, and is reachable by keyboard from every listed screen.
10. Each Chapter 1 decision shows its tier before answering; the tiers come from the committed manifest, and the staleness test passes.
11. Insight is 50 × tier for the best move, half for a close second and otherwise 0; it is never negative, never multiplied, and earned only in the player's own run.
12. A question shows pictures only when every answer passes the gate; one failing answer turns the whole question to text.
13. Every picture card keeps its 2–4 word label, kind badge and Gain/Cost lines, and an accessible name equal to its visible text.
14. With every flag off, the app makes no new network requests and plays fully offline.
15. With verified dares configured but the backend failing, the friend still gets a local twist and can reply.
16. Signed replies verify offline; altered ones are rejected and handled as local replies.
17. The trade-results experiment is off by default, and when on it changes only when "who won" appears.
18. Every existing feature, route and test id, Simple mode and Full mode still work.

## TESTING REQUIREMENTS

- Baseline first: typecheck (app, node and backend), Vitest, Playwright and the bundle check, with exact counts recorded before any change. Report failures that already exist; do not hide them.
- Unit: points module parity with the old inline scoring; Insight awards; toughness recomputation; caps, dedupe, nonce, local-day rollover and ledger migration; R2 round trip, tampering, canonical forms and R1 compatibility; twist selection by kind, seen-avoidance, persistence and shuffling; the one-hop rule; the visual gate (all-or-none, distinct, neutral, label words); validator rules for twists and visuals; vocabulary and component parity; analytics keys.
- Backend: start and grade happy paths, one attempt per device key per dare, tampered and replayed payloads, signature verify and reject, rate limits, retention cleanup, fail-closed without the secret, and CPU measurement for replay.
- E2E with Playwright and page.clock: the helper plays, dares; the friend answers, takes the twist and sends the reply (Challenger points awarded once); the helper opens the reply (+140 once, and reopening says it was already counted); the rematch round trip; a fourth reply on one dare earns 0 with the calm message; tier badges before answering; Insight on feedback and result; a visual question at 360, 390 and 412 px with no horizontal overflow and 44 px targets; a text fallback question; the How points card by keyboard; offline play with every flag off.
- Accessibility: axe WCAG 2.2 AA clean on the twist step, the reply and rematch landings, the How points card, a visual question and the tier badge; a keyboard-only run through the whole friend loop; reduced motion; forced colours.
- Update existing tests whose copy or flow legitimately changed. Never weaken an assertion to make it pass.

## QUALITY AND PERFORMANCE TARGETS

- The initial transfer stays under the documented 2 MB budget. Report the initial transfer and the Lite chunk size before and after. Keep the pictograms, twist pool and manifest together under about 30 kB gzip, or document why not.
- No new runtime dependencies.
- Lite copy reads at an eight-year-old level, and every new message is one or two short sentences.

## DOCUMENTATION REQUIREMENTS

- docs/LITE-INCENTIVES.md: the points economy, who earns what and why, the fairness rules, the threat model, and what is local versus verified.
- docs/LITE-VISUALS.md: the four tests, the vocabulary, how to tag an option and add a glyph, the coverage report and the bias-check data.
- docs/COMPETITION-READINESS.md, per rule J.
- The toughness table for owner review: each question's signals and tier, and the thresholds.
- Updates to docs/ARCHITECTURE.md, ANALYTICS.md, PRIVACY.md (before any new flow can be enabled), BACKEND.md, COST.md, FEATURE-FLAGS.md, TESTING.md, PERFORMANCE.md and ROLLBACK.md.

## COST MODEL

Wave 1 adds no infrastructure and costs $0. For verified dares, update docs/COST.md from its existing assumptions: about two requests and four D1 writes per answered dare, and about eight answered dares per player per month. At those rates the work stays free up to about 50,000 monthly players, then needs the $5/month Workers Paid plan, reaching about $22/month in total at one million players. Signature checks happen on the device and cost nothing. Recompute these figures and correct them if the code differs.

## FINAL RELEASE GATE

Before declaring completion:

1. Run git status and inspect every changed file.
2. Confirm no user work was lost.
3. Confirm no secrets, private keys or keystore files are staged or committed.
4. Confirm every critical and high review finding is fixed.
5. Run the full verification suite and the production build.
6. Verify the bundle budget.
7. Verify offline play, and behaviour with the backend and analytics off.
8. Verify the caps, the one-hop rule and the rule that bonus points never change the score.
9. Verify the privacy docs against the actual payloads.
10. Confirm nothing was pushed or deployed.

## FINAL RESPONSE FORMAT

Lead with the outcome. Then provide:

1. What was built, per rule section, with file paths.
2. An acceptance-criteria matrix: criterion, implementation, files, test evidence, status.
3. Test and build results with exact counts, before and after.
4. Bundle numbers, before and after.
5. Accessibility verification.
6. A privacy and data-flow summary with every flag off and on.
7. The cost estimate.
8. The toughness table and the visual coverage report.
9. The screenshot folder for owner review.
10. Choices made where this prompt left room.
11. Known limitations, and anything skipped with the reason.
12. Exact local commands to review the result.

Do not claim the loop is viral, addictive or fair in practice before real data exists. Describe it as prepared for validation.

Begin with the audit wave, then the contracts, wave 1, wave 2, the review wave and full verification.
