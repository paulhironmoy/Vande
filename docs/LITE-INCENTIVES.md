# Lite incentives: points, fair friend rewards, twists and rematches

How Lite Chapter 1 (`/lite`) rewards players, and why each reward is fair to the helper who sends a dare, the friend
who answers it, and everyone else. Sources of truth in code:

| What | Source of truth |
| --- | --- |
| Every number a player can see | `src/lite/points.ts` (`LITE_POINTS`, `INSIGHT`, `FRIEND_POINTS`, `pointsRules()`) |
| Toughness tiers and the close-call margin | `src/content/lite/toughness.json`, method in `docs/LITE-TOUGHNESS.md` |
| Helper and Challenger awards, caps, dedupe | `src/lite/ledger.ts` |
| Twist draws, attempts, nonces, rematches | `src/lite/twists.ts`, pool in `src/content/lite/twists.json` |
| Dare and reply codes | `src/share/dare.ts` |

The "How points work" card renders `pointsRules()` from the same constants the scoring uses, so the card and the
scoring cannot drift. If a number below disagrees with `src/lite/points.ts`, the module is right and this page is
stale.

## Points economy

### Score

| Rule | Number | Constant |
| --- | --- | --- |
| Every move | 100, plus 8 per point a city bar rises, minus 8 per point it falls, never below 10 | `moveBase`, `movePerBarPoint`, `moveMin` |
| Clue bonus | ×2 when every visible clue the move relies on was scanned | `clueMultiplier` |
| Calm streak | ×1.25, ×1.5, ×1.75, then ×2 for 2, 3, 4 and 5+ fair moves in a row; a harsh move resets it | `streakStep`, `streakMaxSteps`, `HARSH_TAGS` |
| Clues | +50 for a real clue checked, +200 for a fake caught | `clueVerified`, `clueFakeCaught` |
| Fair-play questions | +100 for the fair answer | `fairPlayCorrect` |
| End of the chapter | +50 per mission, +100 per star (stars come from how the city ends up) | `missionBonus`, `starBonus` |

A harsh move is one tagged `disproportionate`, `suppressive` or `censorship`, or one the engine flags as
disproportionate or a false accusation. The score, stars, medal, best score and the `L1` challenge code use only the
numbers above.

### Insight points (a separate tally)

| Tier | Best move | Close second | Anything else |
| --- | --- | --- | --- |
| Tricky ×1 | 50 | 25 | 0 |
| Tough ×2 | 100 | 50 | 0 |
| Boss ×3 | 150 | 75 | 0 |

- The best move is rank 1 in the reveal, and ties count as best. A close second is rank 2 and within the close-call
  margin, currently 40 points (`toughness.json` → `thresholds.closeCallMargin`).
- Insight is earned only in the player's own run. Dares, twists and rematches earn none.
- It is never negative, never multiplied by the streak or the clue bonus, and never enters the score, stars, medal,
  best score, missions, challenge codes or dare comparisons.
- The tier shows before answering ("Boss question · ×3 Insight"). In a dare the badge shows the tier without the
  multiplier, because dares earn no Insight.
- City bars still react to every move. No penalty never means no consequences.
- Best Insight is kept separately in `vande:lite-best-insight`. The name is `INSIGHT.name` ("Insight points"); the
  owner's first name for them was "magic points", and renaming is that one constant.

### Friend points (separate tallies)

| Points | Amount | Caps |
| --- | --- | --- |
| Helper | +40 when a friend's reply arrives; +100 more when the friend found the best move on the dare and got the twist right | 3 rewarded replies per dare, 10 per local day |
| Challenger | The same amounts, earned by the friend who sends their result back | Once per dare, 10 per local day |

During a dare, both players are compared on the reveal's points for that one move: the clue bonus counts, the streak
does not.

## Who earns what, and why

| Who | Does | Earns | Why it is fair |
| --- | --- | --- | --- |
| Helper (sent the dare) | Sends one move to friends, optionally with a principle hint | +40 per friend who answers, +100 more when that friend also understood | Pays for teaching the idea. The +100 needs a twist the helper has never seen, so phoning in an answer earns nothing extra. |
| Friend (answered the dare) | Answers the dare, may take the twist, sends the result back | The same amounts, as Challenger points | Replying is a win for both sides, not a favour. |
| Anyone | Sends a dare | Nothing for sending alone | Spamming contacts earns nothing. |
| Anyone | Answers a rematch | No points; the reward is the win | Two friends cannot farm points by bouncing rematches. |
| Everyone else | Ignores a dare, never shares | Loses nothing | Scores, stars, medals and all content stay open to people who never share. |

## Fairness rules

- **One hop only.** You earn from replies to your own dares. Passing a dare on creates a new dare owned by the person
  passing it on, so nobody earns from a friend's friends.
- **Nothing for sending alone.** Only an answer, a reply or an understood twist earns.
- **The same caps for everyone.** The caps cover the +40 too, so reach alone cannot out-earn understanding.
- **Sharing never buys progress.** Helper and Challenger points are personal tallies. The start screen leads with
  people ("Friends helped 5 · understood 3") and never ranks players.
- **No pressure.** Deadlines are real midnights and end quietly ("This dare has ended. You can still play."). There
  are no reminders, no nagging and no streak loss for ignoring a dare.
- **No contact access.** Nothing reads contacts or sends automatically. Every message goes out by the player's own
  tap through the share sheet, a channel link or copy.
- **Hints stay encouraged.** Hints are principles ("Check the clue before you act."), never answers.
- **First answers count.** The friend's first answer to a dare on a device is the one that counts, so a retake after
  the reveal cannot turn a miss into the best move.
- **Nothing is taken away.** Earned points never decrease.

## How awards are counted

All award logic is pure in `src/lite/ledger.ts`; the screens only read and write the ledger.

- **Helper amount.** +40 for any reply. +100 more only for an R2 reply with the best move and a right twist. R1 replies
  (older codes, no twist) earn +40 only.
- **Dedupe.** An R2 reply is identified by `${dareKey}#${nonce}` and an R1 reply by its canonical code. The same reply
  counts once. Two friends with identical answers have different nonces, so both count.
- **Caps.** A reply over a cap is recorded at 0 and stays at 0, even after midnight, so reopening an old link never
  bypasses a cap. Capped replies cannot be upgraded. The cap message is calm: "You've helped 10 friends today. New
  Helper points start at midnight." or "This dare already rewarded 3 friends. Dare a new move to earn more."
- **Upgrades.** When the same attempt comes back worth more, because the friend took the twist after first replying,
  only the difference is added. An upgrade uses no new slot and is not blocked by caps.
- **Challenger.** Awarded on the friend's first successful share in the reply sheet, once per dare, with the same
  upgrade rule and a daily cap. A capped Challenger award is recorded at 0 and stays at 0.
- **Days.** Day counters follow the device's local date and reset when it changes.
- **Dare identity.** Seed, path, step and deadline; the chain and hint are not part of it. A deadline is the sender's
  next local midnight, so the same move dared again after midnight is a new dare with its own per-dare cap.
- **Verified points.** `helper.verifiedPoints` is meant to hold only points from replies whose signature was
  verified, so any future public use can count verified awards only. A signature counts only once the app has checked it with the public key (verified dares, off by default); a signature field alone never does.

## Twists and rematches

- **When.** After the friend answers a dared question and sees the reveal, they can take one twist: a new short
  situation built on the same idea. It has no timer and can be skipped at no cost. When the friend found the best
  move, the button says "Try the twist · +100 for you both".
- **Which twist.** It matches the action kind of the dared move's best option, computed exactly as the reveal
  computes it. Fair-play dares draw a `rule` twist. Only when the pool has none of that kind does any kind qualify.
  The draw prefers twists the device has not seen, uses `crypto.getRandomValues` and shuffles the options.
- **One attempt per device per dare.** The nonce is created with the friend's first answer, before any twist. The
  friend's first answer to the dared question, the twist, its option order and the first twist answer are stored once
  and never change, so retaking the dare after seeing the reveal cannot turn a miss into the best move. Retired twists
  stay in the pool, so old links still resolve.
- **The pool.** 31 twists, `t1`–`t31`: six each of protect, check, enforce and talk (the only kinds that are ever best
  in Chapter 1) and seven fair-play. `src/lite/twistValidate.ts` and `src/content/lite/twists.schema.json` enforce ids,
  word limits, a single best and tags that match the kind.
- **The rematch.** The reply carries the friend's twist. The helper has never seen it, while every Chapter 1 question
  is already familiar to them. The helper answers it, then sees who won; both right is a draw. The rematch ends at the
  friend's next local midnight and earns no points. A skipped twist means no rematch.
- **Hidden until the rematch.** Nothing the helper sees depends on the friend's twist outcome before they answer it:
  not the reply text ("I took a twist too"), the landing's title and lines, the sounds, or the tally. The helper's
  points are counted at once (+40 shows; the +100 for a friend who understood is counted too, so it is never lost),
  and the +100 is announced after the rematch answer. Follow-up replies from the same friend read the same whether
  the twist was right or wrong.
- **Trade-results experiment.** With it on, the friend's reply sheet also hides the helper's score until the first
  successful share.

## Code formats

Dare (unchanged): `I1_<seed36>_<path or ~>_<step>_<points36>_<0|1>_<deadline36>_<chain36>[_h<hint>]_<chk>`.

Reply, current form:

```
R2_<dare fields>[_h<hint>]_<friendPoints36>_<0|1>_<twist36 or ~>_<r|w|s>_<nonce>_<rematchDeadline36>_<chk>[_x<sig>]
```

| Field | Meaning |
| --- | --- |
| dare fields | The helper's dare exactly as in `I1`. |
| `friendPoints36`, `0/1` | The friend's points on the move and whether it was the best move. |
| `twist36` or `~` | The number n of twist `t<n>` (1–1295) in base36, or `~` when no twist was taken. |
| `r`, `w`, `s` | Twist right, wrong or skipped. `s` if and only if the twist field is `~`. |
| `nonce` | Exactly six base36 characters, random per friend attempt. |
| `rematchDeadline36` | Unix seconds when the rematch ends: the friend's next local midnight when they replied. |
| `chk` | Two base36 characters of a hash of everything before it. It catches typos and casual edits; it is not security. |
| `_x<sig>` | Reserved for verified dares. It follows the checksum and is not covered by it. Codes are lowercased on decode, so it must be a lowercase alphabet (16–256 characters, for example hex). |

`R1_<dare fields>[_h<hint>]_<friendPoints36>_<0|1>_<chk>` still decodes and earns +40 only. Encoding without a nonce
still writes R1, kept for compatibility. Every field is canonical base36, and any malformed or tampered code decodes to
nothing.

## Storage

Everything stays on the device. Every access is guarded, and when storage is unavailable the stores fall back to memory
for the session.

| Key | Where | Holds | Bound |
| --- | --- | --- | --- |
| `vande:lite-awards` | localStorage | Ledger v2: Helper and Challenger tallies, counted replies, per-dare counts, Challenger awards, local-day counters | 300 newest entries in each map |
| `vande:lite-helper` | localStorage | v1 Helper stats; read once to migrate (every v1 reply counts as fully paid), then left untouched | — |
| `vande:lite-twists` | localStorage | Friend attempts (nonce, first dare answer, twist, order, answer), twists seen, rematch records | 200 attempts, 200 seen ids, 200 rematches |
| `vande:lite-best` | localStorage | Best score | one number |
| `vande:lite-best-insight` | localStorage | Best Insight | one number |
| `vande:lite-run` | sessionStorage | The current run's counters (points, streak, path, Insight, picture stats) | one run |

Known limit of the bounds: after 300 replies, or 200 dares answered on one device, the oldest entries are forgotten,
and a very old reply or dare could count again within that day's caps.

## Threat model

Helper and Challenger points are personal, capped and invisible to anyone else, so every trick below fools only the
person using it. Before Helper points ever feed a leaderboard, a prize or anything public, the server checks must be on
(prerequisites in `docs/COMPETITION-READINESS.md`).

| Way to game it | Defence now (local) | Defence once verified dares are on |
| --- | --- | --- |
| Phone the friend with the answer | Twist chosen on the friend's device; both answers needed for the +100 | Server-chosen twist |
| Forge a reply link | Checksums only; points are personal and capped | Server-graded, signed replies |
| Retry the twist | One recorded attempt per device per dare | One server attempt per device key per dare |
| Answer your own dare on a second device | Caps | Caps; cannot be fully stopped |
| Coach the friend live | Accepted: close to real teaching | Same |
| Guess or use an answer key | Pool of 31, shuffled options, both answers needed | Same; server-only answers before any prize |

Verified dares are specified as deployment-ready and switched off; endpoints, keys and flags live in
`docs/BACKEND.md`, `docs/PRIVACY.md` and `docs/FEATURE-FLAGS.md`. The twist answer key also ships in the app for
offline play, so anything with real value must serve twists and their answers from the server only.

## Experiments and measurement

- **Trade-results experiment.** `VITE_LITE_TRADE_RESULTS=1`, default off. The friend still sees their own score and
  the full reveal at once, but "who won" shows "Send your result back to see who won." until their first successful
  share. Compare `lite_reply_sent` (with `tradeResults`) against dares answered between builds with the flag on and
  off.
- **Events.** All are in the closed dictionary in `src/analytics/types.ts` and are sent only when analytics are
  configured and allowed (`docs/ANALYTICS.md`):
  - `lite_twist_answered` (`right`): how often friends crack the twist.
  - `lite_reply_sent` (`shareMethod`, `tradeResults`): one per successful share action in the reply sheet, so repeated
    shares of one reply count more than once.
  - `lite_reply_opened` (`awarded`, `capped`): how many replies reach the helper and how often caps bite.
  - `lite_completed` (`visualQuestions`, `visualBest`, `textQuestions`, `textBest`): the bias check for pictures,
    counted over move questions in the player's own run.
- **Never sent.** Codes, nonces, dare or twist ids, option ids, answers, scores, free text and precise timestamps.

## Not built

Prizes, giveaways, public leaderboards, the "why was this best?" question and any public ranking of Helper,
Challenger or Insight points. `docs/COMPETITION-READINESS.md` lists what would have to be true first.
