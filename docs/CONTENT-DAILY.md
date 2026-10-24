# Daily content: authoring guide

How the Daily Quick Play pool works, how to write a day, how to validate it, and how to grow the pool to 90 days
without changing any date that has already been played. Engine contracts live in `docs/DAILY-DESIGN.md` §2.1; this
document is about the content.

## 1. How a day resolves

| Step | Rule | Where |
| --- | --- | --- |
| Daily id | The UTC calendar date, `YYYY-MM-DD`. A new daily starts at 00:00 UTC everywhere. | `dailyIdFor`, `nextDailyAt` in `src/engine/daily.ts` |
| Which authored day | `schedule.pinned[dailyId]` if present, else `order[(daysSinceEpoch mod order.length)]`. | `dayIdFor` |
| Seed | `hashString("vande-daily-v2:<dailyId>:<dayId>:<day.version>")` — every date gets its own seed even when the authored day repeats. | `dailySeed` |
| Opponents, difficulty | The day's `opponents`; difficulty is always `standard`. | `resolveDaily` |
| Scenario | `compileDaily(day)` adds the shared city, opening events and opponent plays and returns a normal `Scenario` with id `daily:<dayId>`. `getScenario('daily:d007')` returns the memoised compiled day. | `src/engine/dailyCompiler.ts`, `src/engine/scenario.ts` |

Everyone who opens the same daily id plays the same crisis with the same seed, so results are comparable and
challenge codes reproduce exactly.

## 2. Files

```
src/content/daily/
  schedule.json        contentVersion, epoch, order[], pinned{}
  days/dNNN.json       one authored day each (DailyCrisis)
  daily.schema.json    JSON schema for a day (+ #/definitions/schedule)
  index.ts             generated: imports every day, exports SCHEDULE, DAYS, DAILY_CONTENT_VERSION
scripts/daily-gen/
  helpers.mjs          presets (O, D, E, R, EV, day, complicationEvent) that keep options balanced and copy short
  daysNN.mjs           authored batches (source of the JSON)
  build.mjs            writes days/*.json, appends new ids to schedule.order, regenerates index.ts
scripts/validate-daily.mjs   engine validation + balance table + schedule checks (+ --pin-through)
```

The JSON files are the runtime source of truth. The `scripts/daily-gen` batches are the authoring source: edit a
batch, rebuild, validate. Hand-editing a JSON file is fine for a one-word fix, but rebuild from the batch afterwards or
the next build will overwrite the fix.

## 3. The shape of a day

A day is a `DailyCrisis` (`src/engine/types.ts`). The compiler supplies the city, so a day only authors the crisis.

| Field | Meaning | Limits (validator) |
| --- | --- | --- |
| `id`, `version` | `dNNN`; bump `version` to reseed future dates after a content change that alters play. | id unique in the pool |
| `title`, `subtitle` | Full-style name and one-line hook. | ≤ 60 / ≤ 140 chars |
| `dilemmaKey` | The identity of the central trade-off, e.g. `curfew-vs-corridor`. | unique inside any 30 consecutive scheduled days |
| `themeTags` | 1–6 lowercase tags for the calendar/passport. | |
| `focus`, `institution` | District where the crisis centres; district whose institution is under pressure. | districts: campus, hospital, civic, market, records, transit, media; `institution` cannot be `market` |
| `mood` | `calm`, `tense`, `volatile`, `hopeful` → starting Pulse baseline (`MOOD_SCORES`). | `startingScores` overrides per dimension |
| `opponents` | 1–3 opponents active that day. All five still get a fallback play from the compiler. | |
| `coldOpen` | Three lines for the skippable cold open. | 3 × ≤ 60 chars |
| `briefing` | grievance, knownFacts[], unverifiedClaims[], responsibility, objective. | |
| `evidence` | Items with truth, metadata anomalies, corroboration. One or two are `truth: "false"` with `injectedBy` set to a day opponent (the compiler generates the inject play). One is `perishable` (the compiler generates a sabotage destroy play). | 4–6 items; claim ≤ 140 chars; official corroborators |
| `decisions` | Timed decisions (`triggerAt` 4/24/46/70 in the standard template) plus one bait decision with no `triggerAt` (opened by the complication). | 4–6; first `triggerAt` ≤ 6; `expiresAfter` 15–30; title ≤ 48, situation ≤ 160; option title ≤ 48, preview ≤ 80, consequence ≤ 110 |
| `rightsMoments` | At least one, attached to a decision via `rightsMomentId`, with `source` from the official-source list and `contentDate`. | question answerable from the day |
| `events` | Authored extras. Opening (`g-open-*`), pressure (`g-pressure-builds`, fires unless `acknowledged` is set), calm (`g-calm-returns`) and settling events are generated. | |
| `complication` | `{ opponent, earliest, latest, eventId, baitDecisionId }`: the compiler turns `eventId` into a play-only event that sets `complication-live` and opens the bait decision. | `latest` ≤ duration − 15 |
| `resolution` | `resolved`, `unresolved`, `rightsProtected`, `rightsHarmed`, `improvements` rule lists + `closing {good, mixed, poor}`. Every rule carries a `simple` line. | |
| `duration` | Ticks; default 100. | 80–140 |
| `simple` | Simple-style title, subtitle, briefing, closing, coldOpen (≤ 7 words per line). | sentences ≤ 12 words (+2 tolerance) |

Every decision, option, evidence item and rights moment also carries its own `simple` block (title/situation/options,
title/claim/note/caption, question/options/feedback/principle/why). Simple limits: decision title ≤ 40, situation
≤ 200, option title ≤ 40, preview ≤ 90, consequence ≤ 100, claim ≤ 110, question ≤ 140.

### Trade-off rules the validator enforces

* Every decision's `defaultOption` is a `wait` option that costs safety, economy and grievance: inaction is never free.
* At least one option in the day is suppressive (`suppressive` / `detention` / `censorship` / `disproportionate`) and
  costs freedom and trust; the suppressive shortcut must look tempting and bite later (`delayed` backlash).
* At least one option is gated on evidence (`requiresEvidence`); every `accusation` option carries
  `falseAccusationEffects`. Proportionate force needs `proportionateIf` and `disproportionateEffects`.
* No two decisions in a day share the same set of option titles, and no two days in the pool do either.
* Every option, decision, evidence item, rights moment and resolution rule has Simple copy.
* After these checks the day is compiled and run through `validateScenario`, then compiled twice and compared.

## 4. Writing a day with the presets

`scripts/daily-gen/helpers.mjs` exports builders that fill in effects, tags, authority lines and derived evidence
states so a day stays balanced by construction:

| Builder | Produces |
| --- | --- |
| `O(id, archetype, title, preview, consequence, extra, [simpleTitle, simplePreview, simpleConsequence])` | A decision option. Archetypes: `dialogue`, `transparent`, `investigate`, `service`, `protect`, `press`, `targeted` (needs `prop`), `accuse` (needs `req`), `suppress`, `detain`, `censor`, `wait`. `extra` accepts `effects`, `req`, `flags`, `clears`, `unlocks`, `map`, `prop`, `undo`, `delayed`, `noBacklash`, `authority`, `tags`, `falseAccusationEffects`. |
| `D(id, title, situation, { at, exp, urg, district, rights, def, flag, cond }, options, [simpleTitle, simpleSituation])` | A decision. Omit `at` for a bait decision. |
| `E(id, title, source, sourceType, time, claim, { truth, at, by, meta, corr, contra, vis, district, perish, flags, note, verifiedBy }, [title, claim, note, caption])` | An evidence item; `by` marks injected (false) evidence. |
| `R(id, question, [[id, text, correct, feedback]], principle, why, SRC.x, simple)` | A rights moment with an official source. |
| `EV(id, at, kind, message, { effects, map, flags, clears, cond }, simpleMessage)` | An authored event. |
| `complicationEvent(opponent, district, id, { message, simple })` | The complication event. |
| `day({...})` | Assembles the `DailyCrisis` (see any `daysNN.mjs` for the full field list). |

Standard template (all thirty shipped days follow it): four timed decisions at ticks 4, 24, 46 and 70 with
`exp` 22–24, one bait decision, five evidence items (two official, one or two injected false, one perishable), one
rights moment attached to the third decision, one complication plus one authored follow-up event.

Workflow:

```sh
# 1. author or edit a batch
$EDITOR scripts/daily-gen/days11.mjs          # export const days = [day({...}), ...]
# 2. build JSON, schedule, index (lints copy lengths first)
node scripts/daily-gen/build.mjs
# 3. engine validation, balance table, schedule freshness
node scripts/validate-daily.mjs               # or: node scripts/validate-daily.mjs d031 d032
# 4. unit tests (schema, compiler, balance, resolution)
npx vitest run tests/unit/engine
```

Balance targets (`dailyBalance`, headless strategies over the compiled day): principled ≥ 60, and principled beats
both the suppressive and the idle strategy by ≥ 12. The thirty shipped days score principled 61–71, suppressive 15–32,
idle 33–41. If a day comes in low, raise the constructive options' effects (the archetype presets are the first lever),
lower the mood baseline cost, or move the complication later.

## 5. Growing the pool (days 31–90) without changing past dates

The rotation is `order[(daysSinceEpoch mod order.length)]`, so appending days changes which day falls on dates after
the first cycle. Pins freeze what has already been published:

1. Run `node scripts/validate-daily.mjs --pin-through=<today's UTC date>` and paste the printed entries into
   `schedule.pinned`. Every date from the epoch to today now resolves exactly as it did.
2. Author the new batch and run `node scripts/daily-gen/build.mjs`: new ids are appended to `order`; existing
   `order`, `pinned`, `epoch` and `contentVersion` are preserved.
3. Validate: the schedule check fails if a `dilemmaKey` repeats inside any 30 consecutive scheduled days (the window
   wraps around the end of the rotation), if an id is missing or duplicated, or if the pool is smaller than 30.
4. Bump `contentVersion` (`YYYY.M.n`) when the pool changes. Clients record it with every result so community stats
   are never mixed across pools.

Never reorder or delete an id in `order`, and never change a pinned date. To retire a day, leave it in `order` and pin
nothing new to it; to fix a day's copy, edit it in place and bump its `version` only if the fix changes play (a
version bump reseeds every future date that resolves to it; past results stay valid because they carry their seed).

## 6. Review checklist

* Full copy fits the limits and reads in one glance; Simple copy is plain enough for an eight-year-old and never
  longer than the Full line it replaces.
* The false evidence has a visible anomaly or a contradiction, and the official corroborator exists.
* The perishable item matters: losing it should cost something the player can feel.
* The bait decision is a real temptation with a lawful answer that is not simply "wait".
* The rights moment is answerable from the day's facts, cites an official source and explains the principle in one
  sentence of Simple copy.
* `node scripts/validate-daily.mjs` prints `✓ … valid` with no `✗`, and the balance row sits inside the targets.
