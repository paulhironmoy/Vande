# Lite toughness tiers (Insight points)

Every Lite Chapter 1 question has a fixed tier: **Tricky ×1**, **Tough ×2** or **Boss ×3**. The tier sets the Insight
bonus for finding the best move (50 × tier; a close second earns half; nothing is ever taken away). Tiers come from
the game itself, never from live player answer rates, which could be gamed and would drift during the day.

- Generator: `src/lite/toughness.ts` (`computeToughness`), run by `node scripts/lite-toughness.mjs`.
- Manifest: `src/content/lite/toughness.json` (committed). The Lite screen reads it through `tierOf(id)` and
  `closeCallMargin()`.
- Staleness: `tests/unit/lite/toughness.test.ts` recomputes the manifest and fails with
  "run node scripts/lite-toughness.mjs" when content, the engine or the thresholds change the result.
  `node scripts/lite-toughness.mjs --check` does the same from the command line.
- How Insight is paid, and every other Lite number: `docs/LITE-INCENTIVES.md`. Where the modules sit:
  `docs/ARCHITECTURE.md` §12.

## Method

1. For each seed, play Lite exactly as the screen does (pure replay in `src/lite/replay.ts`, with a parity test
   against the real store). Before each decision, scan the clues its moves rely on, the way the Scan button does;
   then take the move the reveal marks **Best**. Fair-play moments are answered fairly.
2. At each decision, evaluate every move from that same moment (the reveal's own scoring, `evaluateAll`) and read
   three signals:
   - **Close call**: the best and second-best moves are within `closeCallMargin` points.
   - **Trap**: a non-best move looks better right now on at least one city bar, by at least `trapMargin`, while
     its total effect (its immediate change plus its delayed effects) is worse than the best move's. In Chapter 1
     the harsh moves already score low straight away, so this is about temptation, not low immediate points.
   - **Clue needed**: the best move relies on a visible clue, so scanning first matters.
3. No signal is Tricky, one is Tough, two or more is Boss. Each question takes its most common tier across all
   seeds (ties go to the lower tier, so a coin flip never inflates a tier).
4. Fair-play moments default to Tricky. `TOUGHNESS_CONFIG.rightsOverrides` can set a validated tier for one.

Thresholds are tuned for the whole chapter, never per question, so that Chapter 1 has at least one Boss and at most
a third Boss (a unit test enforces both bounds).

## Thresholds and seeds

| Setting | Value | Why |
| --- | --- | --- |
| `closeCallMargin` | 40 points | Five bar steps. The closest Chapter 1 pair is 32 points apart and the next is 56, so 40 separates genuinely close calls from clear ones with headroom. It is also the Insight close-second margin. |
| `trapMargin` | 1 bar point | Any visible advantage on a bar counts as temptation, provided the move is worse overall. |
| Seeds | 48 | `hashString("vande-lite-toughness:<i>")` for i = 0…47; the full list is in the manifest. Every signal read the same in all 48 seeds. |

## Tiers for owner review

Points are the reveal's points at that moment along the best path (median over the seeds; the best move includes the
×2 clue bonus when its clue was scanned).

| Question | Best move | Best | Second best | Close call | Trap | Clue needed | Tier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Students are gathering (`d-first-response`) | Meet the student leaders today | 196 | 164 (Ask the exam office to speak) | yes | yes: "Lock the university gates" looks safer now | no | **Boss ×3** |
| Who checks the leak? (`d-investigation`) | Pick an independent check team | 252 | 196 (Police: open a case, keep the records) | no | yes: the police case adds more evidence and safety now, less trust | no | **Tough ×2** |
| The gathering reaches Civic Square (`d-civic-square`) | Move the barrier group aside | 376 | 180 (Keep the square open, move traffic) | no | no | yes: the field report must be scanned | **Tough ×2** |
| Someone is selling a 'sure paper' (`d-racket`) | Freeze the account, trace the payers | 196 | 124 (Arrest the account owner now) | no | yes: arresting now looks safer, costs freedom and trust | no | **Tough ×2** |
| Cancel it now? (`d-bait-cancel`) | Promise an answer in 48 hours | 156 | 88 (Cancel the exam right now) | no | yes: cancelling pleases the crowd now, then trust falls | no | **Tough ×2** |
| What do you tell the city? (`d-communication`) | Tell people what you know and don't | 228 | 156 (Post checked facts every hour) | no | no | no | Tricky ×1 |
| Keep the city moving (`d-services`) | Open a path with student helpers | 236 | 164 (Reroute buses, open a hospital lane) | no | no | no | Tricky ×1 |
| Ending the day (`d-resolution`) | Announce the new exam plan | 268 | 132 (Promise an answer after the report) | no | no | no | Tricky ×1 |
| Send everyone away now? (`d-bait-disperse`) | not reached | – | – | – | – | – | Tricky ×1 |
| Calls to 'shut it all down' (`d-bait-shutdown`) | not reached | – | – | – | – | – | Tricky ×1 |
| Three fair-play moments (`rm-assembly`, `rm-detention`, `rm-internet`) | the fair answer | – | – | – | – | – | Tricky ×1 |

Totals: 1 Boss, 4 Tough, 5 Tricky decisions; the 3 fair-play moments are Tricky.

Notes:

- The two "not reached" bait decisions are triggered by opponents that Lite never selects (Lite always plays the
  default opponents), so no seed reaches them. They stay Tricky until content or opponents change.
- The very first question is the only Boss. That is the computed result, not a hand-picked one: its two good moves
  are close and locking the gates looks safer right now.
- At Civic Square the best move depends on scanning: with the field report scanned, moving the barrier group aside
  scores ×2 and is best; without the scan, keeping the square open is best.

## Twist coverage

Twist questions (`src/content/lite/twists.json`) are matched to the action kind of the dared move's best option.
`bestMoveKindSurvey` (and `node scripts/lite-toughness.mjs --survey`) reports which kinds can be best: along the
best path over all seeds (with and without scanning) plus 300 seeded random games, the best move was **protect**,
**check**, **enforce** or **talk**; never restrict or wait. The pool has at least four twists for each of those kinds
plus at least four fair-play (`rule`) twists, and `tests/unit/lite/twistPool.test.ts` re-checks coverage.

## Regenerating

```
node scripts/lite-toughness.mjs           # recompute, write the manifest, print this table's data
node scripts/lite-toughness.mjs --check   # fail when the committed manifest is stale
node scripts/lite-toughness.mjs --survey  # also print best-move kinds for twist coverage
```

Change `TOUGHNESS_CONFIG` in `src/lite/toughness.ts` to tune thresholds or seeds, rerun the script, update this table,
and commit the manifest with the change. Bump `TOUGHNESS_GENERATOR_VERSION` when the method itself changes.
