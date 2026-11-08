# Lifecycles, state machines and reveal rules

> **Stage 4–6, not active: paths in this document refer to code that is not built.** The owner's product sequence
> keeps these stages closed; see [VANDE-PRODUCT-SEQUENCE.md](../VANDE-PRODUCT-SEQUENCE.md) and the
> [docs index](../README.md).

> **Status: Stage 4–6 design, not authorized for build.** Building waits for the stage gates in
> `docs/VANDE-PRODUCT-SEQUENCE.md`. Stage tags: **[S4]** asynchronous competition, **[S5]** daily ritual, **[S6]**
> social growth.
>
> Stage 5 forbids countdowns and fabricated urgency. Every deadline and reset is shown as a **clock time** ("ends
> 9:30 pm Tue"), never as a ticking timer.

All times are **server time**. Exact times stay inside the owning object; views use minute resolution. Types are in
`CONTRACTS.md`; the stored data model is in `BACKEND.md`.

## 1. Sealed Over [S4]

### 1.1 Roles and seats

- **The setter** creates the challenge and plays the over first. Their verified score is the **target**.
- **Seats:** 1 (a duel) to 10 (a group), chosen at creation. One link serves every seat. The first joiners take the seats; later visitors see "This challenge is full".
- **Joining** reserves a seat. It is done with **Play now** (join and start) or **Play later** (join only, which also opts into one reminder; see `NOTIFICATIONS.md`). Opening the link without joining is not joining.
- **Invited** means someone has the link. Invited people who never join never block anything.

### 1.2 States

```
          create (server picks the over; setter's attempt starts)
               │
           SETTING ──setter finishes (6 balls, or two wickets)──▶ OPEN ──▶ link issued, share sheet on tap
               │                                                   │
               │ setter has not finished 24 h after creation       │ every seat taken AND every seat holder
               ▼                                                   │ finished ──▶ reveal at the next 5-minute
             VOID                                                  │ slot, at least 60 s later
               ▲                                                   │ (DUEL_REVEAL_SLOT_S, as for duels today)
               │ setter revokes before anyone joins                │
               └───────────────────────────────────────────────────┤ deadline T reached
                                                                   │   ├─ ≥ 1 joined ──▶ REVEALED at T + 2 min
                                                                   │   │                 (DEADLINE_GRACE)
                                                                   │   └─ nobody joined ──▶ EXPIRED
                                                                   ▼
                                                               REVEALED (immutable; rematch offered)
```

**Per seat:** `joined → playing → finished`. A seat still `joined` or `playing` at T + 2 min becomes `dnp`.

Rules:
1. **Deadline** of 6, 12, 24 or 48 hours, default 24. Fixed at creation and **never extended or shortened**.
2. **Starting closes before the deadline.** No ball is issued after T. Starting is refused when less than 3 minutes
   remain, and the UI warns first.
3. **The initiator cannot block or delay the reveal.** The reveal is a storage alarm in the object. No setter action
   can move it, and nothing can be cancelled after the first join. The setter's own absence changes nothing.
4. **Players who never join do not block the reveal.** The early reveal needs every *seat* to be taken and finished.
   Otherwise the reveal happens at the deadline.
5. **Joined players who do not finish are DNP.** Their partial balls are shown in the reveal as "did not finish (3 of
   6)". They rank below every finisher, in join order.
6. **Late attempts count as practice.** After T, or once revealed, the over can be played only as offline Practice:
   unranked, never sent, never changing the official result.
7. **Interruptions** (app killed, network lost).
   - A ball that was issued but not answered settles as a **leave** after `BALL_LATE_MS`, the same as Practice's
     in-flight rule. It never gets a second chance.
   - Between balls nothing is in flight, so the attempt simply resumes later, until T.
8. **Activity visibility.**
   - Before the reveal, participants see counts only: "3 of 5 joined · 2 played". Counts update after the existing
     activity jitter (60–600 s).
   - Results are never visible before the reveal. The setter's target is public by design.

### 1.3 Ranking and tie-breakers

The ranking key for finishers is:
1. runs, descending;
2. wickets, ascending;
3. **completion time**, ascending: the server's ms timestamp of the last answered ball. Equal ms falls back to the attempt id.

- **The rule is disclosed before play,** on the preview and the batting intro, as the sequence doc requires for
  Stage 4: "Ties: fewer wickets, then whoever finished first".
- **Completion times are never shown**, neither before nor after the reveal. The reveal says only who finished first,
  and only when that decided the order.
- **Note:** the setter always finishes first, so an exact tie on runs and wickets goes to the setter. That matches
  "beat it to win" and is stated on the preview.

### 1.4 Rules of the innings

These are Super Over rules:
- six legal balls;
- the second wicket ends the innings, and the remaining balls are dead;
- no extras;
- an early pass of the target does not end the innings: every finisher plays on, so totals compare across the group.

Assistance is pinned for every participant; the device allowance and handedness follow the ranked policy (`VERIFICATION.md` §5).

### 1.5 What the reveal shows

1. **Winner and ranking.** DNP players are listed last.
2. The **tie-break line**, only if one was used ("Tied on 18 and 1 wicket: Riya finished first").
3. **The decisive ball** (§1.6), as a replayable moment.
4. **The shot map:** every participant's six balls, from the stored verdicts (`endBearing` and `endCm`). Replays are re-simulated on the device with the pinned sim version.
5. **One coaching insight for the viewer.** It is `primaryInsight` for the viewer's own decisive or worst ball, computed on the device from their own record (no server work).
6. **The over itself:** all six deliveries, now revealed, plus the salt, so any device can check the commitment.
7. **Rematch:** two buttons, "Same over" and "New over".
8. The **series and rivalry line**, when one exists.

### 1.6 The decisive ball (deterministic)

For the winner W against the runner-up L, over the balls both faced:

```
swing(i) = (runs_W(i) − runs_L(i)) + 5 × (wicket_L(i) − wicket_W(i))
```

- The decisive ball is the `argmax` of `swing(i)`; on a tie, the later ball.
- If every `swing` is ≤ 0 (W won by accumulating), use `argmax(runs_W(i) − runs_L(i))`.
- If a tie-break decided the result, the decisive item is the tie-break.
- The facts use a closed vocabulary (`DecisiveFact`), for example "Ball 5, the yorker: you dug it out for 2 and Arjun was bowled". Both players faced the same ball, which makes this comparison unique to the format.

### 1.7 Rematch

- **One tap on the reveal:**
  - "Same over" creates a new challenge with the same definition (`source: 'same_over'`, new id, new salt and commitment). Both players have now seen it once, so it is fair.
  - "New over" creates a fresh server over.
- **The requester plays first** and sets the target, which comes from that new attempt.
- **One offer per revealed challenge** (whoever asks first). Asking again returns the same offer until its deadline passes.
- **Delivery:** the opponent gets a push if they enabled it (`rematch_requested`), or the requester shares the link.
- **Groups:** a group rematch offers seats to the previous participants first.

## 2. Rivalries and series [S4]

**A rivalry** is one row per pair, updated idempotently at each 1v1 reveal (keyed by challenge id). It holds:
- the head-to-head record (W, L, T);
- the current series;
- the current winning streak (holder and length);
- the previous five results;
- the best chase (the highest finishing score of the second player);
- the closest result (the smallest run margin; 0 is a tie);
- the last three decisive deliveries;
- each player's preferred conditions (best win rate on a pitch, at least 2 games);
- a one-tap rematch.

Group challenges and tournaments do **not** feed rivalries; they have their own tables.

**Prompts** are contextual, use a closed set of templates, and only use real records:
- "Arjun leads 4–3. One over can level the rivalry."
- "You lead 4–3. One more makes it 5–3."
- "Level at 3–3. The next over takes the lead."
- "Game 2 of 3 · Arjun leads 1–0."

**Series (optional best of 3 or 5):**

```
ACTIVE ──game revealed──▶ check: someone has the majority (2 of 3, 3 of 5)? ──▶ WON or LOST
   │                       otherwise ──▶ next game offered (setters alternate; default 24 h deadline)
   └─ no game started for 7 days ──▶ ABANDONED (the record is kept)
```

- A game's **DNP** counts as a loss for the absent player. If **both are DNP**, the game is void and does not count.
- **Ties** count for neither player. If all games are played without a majority, the series is **SHARED**.
- The series state is shown on the reveal and on home (§9).

## 3. Today's Over [S5]

### 3.1 Publication and versioning

```
PREPARED (definition encrypted, story report, rev n)  ──root/admin approves──▶  SEALED (commit signed, rev fixed)
     ▲  edits only before sealing                                                     │ 00:00 IST of dayId
     └─────────── sim version changes before opening: re-validate, rev n+1 ───────────┤
                                                                                      ▼
                                       OPEN (ranked attempts; per-ball streaming) ──00:00 IST next day──▶ CLOSED
                                       (+2 min grace for balls in flight)                                    │
                                                                                                    BOARDS FINAL
```

- Overs are prepared **at least 7 days ahead**.
- **The global id is the IST calendar day**, with the reset at 00:00 IST (owner decision O3). The UI shows the reset as a clock time in the player's own timezone, for example "New over at 6:30 pm (00:00 IST)". Never a countdown.
- **Once OPEN, the definition is immutable.** An emergency void after a physics bug makes the day unranked; its boards are hidden and the day says so.

### 3.2 Curated story-arc validation

The setter is a script run offline in CI or by the owner (`scripts/todays-over-setter.mjs`), never inside a request. It generates candidate overs, then evaluates each one:
- with the pinned physics;
- against three reference batters, with timing error σ = 25 ms (good), 40 ms (club) and 60 ms (beginner);
- playing the coach's recommended decision and direction;
- 64 deterministic swings per ball and model.

These are the initial thresholds. They are **UNPROVEN**: calibrate them with Stage 5 data.

| Beat | Rule |
| --- | --- |
| Setup (ball 1) | A stock ball; P(out \| club) ≤ 0.10; E[runs \| club] ≥ 0.8 |
| Escalation (balls 2–3) | At least one movement ball (air or pitch movement ≥ 0.15 m); P(out \| club) higher than ball 1 |
| Tactical decision | At least one ball where the recommended decision is **leave**, or where the best gap is ≥ 40° from straight (the field must be read) |
| Pressure delivery (ball 4 or 5) | A change-up (yorker, bouncer, slower ball, wrong'un or arm ball) with P(out \| club) between 0.20 and 0.45 |
| Recoverable difficulty | No ball with P(out \| good) > 0.25. The over's E[runs \| club] is between 6 and 14. P(two wickets before ball 6 \| club) ≤ 0.20 |
| Memorable final ball (ball 6) | Either P(boundary \| good) ≥ 0.35 and P(six \| good) ≥ 0.10 with a deep fielder in the arc, or a yorker with P(out \| club) ≥ 0.25 |
| Global | `validateOver` is legal; ≤ 2 change-ups; ≤ 1 bouncer; ≥ 3 distinct variations |

The chosen over, its report and a human approval are uploaded through the admin console (Cloudflare Access). The Worker re-validates a reduced sample (16 swings per model) before sealing.

### 3.3 One ranked attempt, then unlimited practice

- **The attempt id is derived from the day and the player** (`CONTRACTS.md` §8), so a second ranked attempt is impossible. It is created on the first `POST /v2/today/attempt` and resumed afterwards.
- **Same per-ball protocol and windows as a Sealed Over.** If the attempt is unfinished at the close, the day is "missed" for boards, and finished balls still count for the rhythm (§6) only if six were faced.
- **Unlimited unranked practice afterwards.** The client receives `OverReveal` for the day, so the exact over (and each exact ball) can be practised offline with no network.
- **Offline, or the ranked over unavailable:** "Today's Over needs a connection for your ranked try. Practise now", which opens a Random Over. Practice never waits on the network.

### 3.4 Boards and privacy thresholds

| Board | Who | Threshold | Aliases shown |
| --- | --- | --- | --- |
| Friends | Players you have completed a challenge with (`friends`) | None | Yes (they know you) |
| Group | Members of a tournament group, or a college or company group | ≥ 3 members played | Yes |
| City | The coarse city from the fixed list | **≥ 50 ranked players that day**; otherwise no board, only your percentile once ≥ 20 | **Only players who opted in** ("Show my alias on public boards", off by default); everyone else is "Player" |
| National | Everyone | ≥ 50 | Same opt-in |

- Flagged attempts are held off the city and national boards (`VERIFICATION.md` §7.6).
- Irregular attempts (more than one irregular ball) never appear on the city or national boards.

## 4. Quiet group tournaments [S6]

```
GATHERING (code link; 3–10 members; start time fixed) ──start──▶ fewer than 3 joined ──▶ CANCELLED
        │                                                       │
        │                                                       └─▶ RUNNING: round r opens at start + (r − 1) × window
        ▼                                                                │  each round is one OverDO:
  (creator not needed after creation)                                    │    league   = all members, the same over
                                                                         │    knockout = one 1v1 per tie, the same
                                                                         │               over for the whole round
                                                                         ▼
                                                    round deadline ─▶ round reveal (all ties together) ─▶ next round
                                                                         │
                                                                     last round ─▶ COMPLETE (final card)
```

**Formats** (two engines). The six brief names are templates over them: one-over league, knockout cup, weekend series, alumni challenge, friends championship, office or family competition.
- **League.** R rounds (3–5). Every member bats the same over each round, so it is a round robin on identical conditions.
  - **Round points:** 1 for each member you beat in that round and ½ for each tie, using the §1.3 ranking. A DNP scores 0 and counts as beaten by every finisher.
  - **Table:** points, then total runs, then fewer total wickets, then the earlier joiner.
- **Knockout.** The bracket is seeded by a committed random draw at the start, revealed with round 1 (fair, verifiable seeding). Byes go to the top seeds.
  - Each tie is a 1v1 on the round's over.
  - A DNP loses the tie. If both are DNP, the higher seed advances.

**Explicit windows.** Pace presets are reused from `backend/src/cup/schedule.ts`:
- sprint: 1 h gathering, 1 h rounds;
- daily: 12 h gathering, 12 h rounds;
- weekend: 24 h gathering, 6 h rounds.

Every transition is a storage alarm, re-applied lazily on every request. Missing players never block a round.

**Fair, deterministic conditions:**
- Round r's over comes from the tournament seed and r. It is generated and sealed when the round opens.
- Every member faces it with the ranked policy.

**Visibility:**
- Before a round's reveal: counts only ("4 of 6 played").
- At the reveal: the round table or bracket, the over and the shot maps.

**Private reminders:**
- A member may nudge an incomplete member: one push, if the target enabled nudges.
- Limits: once per round per target overall, and once per day per nudger.
- It is never posted to WhatsApp.

**Three group-share moments only,** enforced by the server share cap:
1. invitation (before the start);
2. reveal ready (at most once, at any round's reveal);
3. final result.

No automatic or repeated posting into WhatsApp groups.

**The final card** shows:
- the winner and the ranking;
- the best six (the longest six in the most important round);
- the best defence (the survived ball with the highest dismissal risk, computed on the device with the coach's neighbourhood simulation);
- the next challenge: "Start the next league" or "Rematch the final".

## 5. Playable highlights [S6]

**Qualifying moments.** Pure detectors over verified results, computed on the device:

| Moment | Rule |
| --- | --- |
| Last-ball win | The decisive ball is ball 6 and it changed first place |
| Six under pressure | A six on ball 5 or 6 while ≥ 6 were still needed to win, or a six in a tie-deciding position |
| Perfect yorker | A yorker that was dug out for runs (face contact), or that bowled the batter |
| Edge or close call | An edge that fell short or was dropped; a ball that missed the stumps by < 2 cm; an LBW "missing" by < 2 cm |
| Collapse and recovery | A wicket in balls 1–3, then ≥ 10 runs off the rest |
| Impossible-looking defence | A defended ball whose coach dismissal risk is ≥ 0.7 |
| Group-winning delivery | The decisive ball of a tournament final |

**Rendering** (decision: on the device):
- The existing deterministic composer (`src/highlight`, `HighlightRenderHost.frame(tMs)`) is adapted to replay `DeliveryRecord`s with the pinned sim version.
- Frames are rendered at a fixed timestep, at 720 × 1280 and 30 fps, for 6–12 s (the moment plus 2–3 s of context).
- They are encoded with WebCodecs (H.264), then muxed to MP4.
  - The muxer is a new client dependency (owner decision O8).
  - Where WebCodecs is unavailable or the tier is Classic, a static result card is shared instead.
- **Cost: $0 server.** Nothing leaves the device until the player taps Share.
- **Rejected:** server rendering of every clip. At about 150 vCPU-s per clip (estimated from COST_MODEL's 600 vCPU-s per 45 s Short), 10,000 clips a day would cost about $800 a month.

**Contents** (every highlight):
- match context, and the score and requirement;
- a clean VANDE mark;
- a localised caption;
- "Can you play this ball?";
- the `/b/<code>` deep link to the **exact delivery** (or the whole over, if the sharer allowed it).

**Consent:**
- The sharer's alias is shown by their choice.
- Other players appear as "Rival", unless they turned on "Show my alias in friends' clips" (default off).
- No private data appears without consent.

**No automatic YouTube upload.** The existing pipeline (render-service, consent, moderation and uploader) becomes the opt-in **top-performer publishing programme**:
- every shown participant must consent;
- a human approves in the moderation queue;
- the `growth.publishing` and `legacy.youtube` flags stay off until the owner opts in.

**Downloadable:** "Save video" stores the MP4 locally (Capacitor Filesystem, already a dependency), or downloads it on the web.

## 6. Flexible rhythm (the streak) [S5]

- **A meaningful over** means six balls faced in Practice, Today's Over, a challenge or a Coach Ball session.
- **One automatic grace day per ISO week** (Monday first). The first missed day of a week, while a run is alive, is covered: shown as a hollow dot and never as a loss.
- **A run** is the unbroken span of played or covered days ending today or yesterday. Today is not lost before midnight.
- **A second miss in a week** ends the *current run* only. **Total days played** and **best run** are never erased.
- **The weekly rhythm comes first:** "4 of 7 days this week", with seven dots. The run is secondary text; there is never an infinite flame counter.
- **Never shaming.** No "you lost your streak" message. After a gap the copy is simply "Welcome back. Here's today's over."
- **Data:**
  - The device keeps its played days; Practice works offline.
  - The server keeps days from ranked play.
  - Both sync dates only (`/v2/rhythm`), in the player's local calendar.
  - `Rhythm` is a pure function (`CONTRACTS.md` §6).

## 7. Personal Coach Ball [S5] (on the device only)

1. **Evidence** comes from the local `FormSample`s (`src/practice/coach/form.ts`, last 300) and the stored `DeliveryRecord`s, mapped to the seven weakness ids:

   | Weakness | Samples it uses |
   | --- | --- |
   | Late-inswing defence | Pace, mover inswing |
   | Short-ball reaction | `short` |
   | Off-spin reading | Spin that turns in |
   | Front-foot timing | Forward footwork, timing |
   | Off-side placement | Attack aimed off side, face error |
   | Lofted-shot risk | Elevation, caught |
   | Yorker survival | Yorkers, out |

2. **Selection** happens once per local day, at the first open:
   - for each weakness with ≥ 6 innings samples in 30 days, compute the posterior mean success with a Beta(2, 2) prior (`metStandard` = success);
   - pick the lowest; on a tie, the most recent failure; then the alphabetical id;
   - require that the recommended response has a dismissal risk < 0.3, so the weakness is learnable;
   - mastery attempts at assistance stages 1–2 never count (the existing Form rule).
3. **The exact ball** is the player's most recent *failed* real delivery in that category: a `DeliveryRecord` with its plan, seed, field and conditions. Never an invented ball.
4. **Explain:** "Chosen because the last 5 late inswingers got you out 3 times, on average 34 ms early." Only real counts are used.
5. **Demonstrate:** the recommended `CoachOption` (ghost contact point and timing), already built in Coach Mode.
6. **Unlimited repetition** with `repeatDelivery`, plus mastery stages and `compareAttempts` against the previous try.
7. **The skill profile is the Form report.**
8. **Progress** ("Late-inswing survival improved from 54% to 68%") is shown only when:
   - there are at least 10 innings samples on each side;
   - the change is at least 10 points;
   - the 80% credible intervals do not overlap.
   
   Otherwise: "Not enough evidence yet (4 balls)". Nothing is ever invented.
9. **Nothing is sent.** No server knows the weakness. A reminder, if any, is a *local* notification (opt-in, default off; `NOTIFICATIONS.md`).

## 8. Identity: guest to registered [S4]

- **Practice:** no account, ever (existing).
- **Guest:** created silently the first time a player starts ranked play: a challenge, a join, or Today's Over.
  - It follows the neutral **18+** age screen; the server refuses a sign-up without `adultConfirmed`.
  - It is bound to the device's secure storage.
- **Registered:** a linked identity (Google today; passkeys when the verifier exists). Nothing else is asked: no phone, email or real name.
- **When to offer linking.** Never before playing. Offer it only where losing the result would hurt, and at most once per moment:
  1. after the first rivalry reaches 2 games ("Keep your rivalry with Arjun on any phone");
  2. on **Continue in the app** after web play (the claim code is the no-account path, `LINKS.md` §8);
  3. before "Sign out" or "Delete local data" when unlinked;
  4. after 3 finished challenges.
- **Legal decisions** (owner and legal: O5):
  - **18+ for all networked play at launch.** Recommended. It matches the existing policy. DPDP s.9 requires verifiable parental consent for under-18s, and its obligations commence in May 2027.
  - Whether **Practice stays before the age screen** (an existing open item).
  - Whether to design Rule 10 parental consent later.
  - The privacy notice must list the new data (`BACKEND.md` §5).

## 9. The home primary action [S4–S5] (deterministic)

`homeAction(inputs)` is a pure function (`CONTRACTS.md` §6). The first matching rule wins; ties within a rule are broken by the listed time, then by id.

| # | Condition | Action | Order within the rule |
| --- | --- | --- | --- |
| 1 | A turn whose deadline is within 2 h | **Your Turn** (or **Continue Rivalry** if it is from a rival) | Soonest deadline |
| 2 | An unviewed reveal from the last 48 h | **Reveal Result** | Newest |
| 3 | A rival's rematch or series game waiting for you | **Continue Rivalry** | Oldest request |
| 4 | Any other turn | **Your Turn** | Soonest deadline |
| 5 | Today's Over available and not played | **Play Today's Over** | — |
| 6 | A rival played within 7 days, nothing pending | **Continue Rivalry** (`recent`) | Most recent |
| — | None | `null`: Practice is the primary | — |

- **Stable:** the action shown stays for the session until it is completed or no longer valid, so the home screen never flickers.
- **Restrained activity:** home also shows Practice, and Chase once Stage 3 ships, plus a small activity dot with the count of other pending items. No other cards.
- **Sequencing:** rows 1–4 and 6 open with Stage 4, row 5 with Stage 5.
