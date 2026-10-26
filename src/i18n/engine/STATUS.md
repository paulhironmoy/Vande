# Engine copy: translation status

Player-facing text for everything the Sealed Six engine emits. Owner: gameplay workstream. Source of truth: `en.json`
(278 keys). `src/i18n/sources.ts` loads these files as the `engine` source next to the app catalogs
(`src/i18n/catalogs`, experience workstream); `src/i18n/keys.ts` types engine keys from `en.json`, so renaming a key
here is a type error in the screens that use it.

## Key families

| Prefix | Keys | What it is |
| --- | --- | --- |
| `variant`, `family`, `line`, `length`, `intensity` (+ `variant_hint`) | 24 + 8 | Delivery names, and one-line descriptions of the deliveries |
| `shot`, `zone` (+ `shot_hint`) | 15 + 7 | Shot and target-zone names, and shot descriptions |
| `intent`, `field` (+ `_hint`) | 6 + 6 | Bowling intent and field settings |
| `pitch`, `weather` (+ `pitch_hint`) | 6 + 3 | Conditions, and pitch descriptions |
| `timing`, `contact`, `execution`, `wicket` | 22 | Timing, contact and execution grades, dismissal kinds |
| `ghost.<id>.name`, `ghost.<id>.style` | 10 | The five Practice Ghosts |
| `auto.tag`, `auto.batted`, `auto.bowled` | 3 | The "Auto" label the reveal puts on balls a stand-in played (Auto XI, Auto Over, the Training lesson); added in wave E, the eight machine-drafted locales need the same QA |
| `advice.unlock.*`, `advice.pitch.*`, `advice.weather.*`, `advice.summary.*`, `advice.read.*` | 34 | Planner advice: how locked deliveries are earned, pitch and weather tips, the over summary and its reads (GAME_RULES section 17); added in wave F, Hindi in आप and Hinglish in tum, the eight machine-drafted locales need the same QA |
| `explain.*` | 80 | Every `EXPLAIN_KEYS` entry (one-line tactical explanation; no placeholders) |
| `commentary.*` | 34 | Every `COMMENTARY_KEYS` entry (text commentary, original) |
| `guide.*` | 20 | Tactics guide for a 12-year-old, exactly the sections the Settings guide shows: sealing, the match, energy, intent, timing, the three pitches and weather, Super Ball tie-breaks |

## Rules every locale follows (enforced by `tests/unit/engine/i18n-engine.test.ts`)

- ICU-lite syntax (`src/i18n/format.ts`). Every locale has exactly the English keys, every message parses, and every
  message uses exactly the English placeholders. `explain.*` takes none.
- English has copy for everything the app and engine show: every name, the hints the screens show (deliveries, shots,
  pitches, intents and fields), the ghosts, the Auto labels, the planner advice, every explanation and commentary key,
  and the guide sections the Settings sheet lists (read from `SettingsRoute.tsx`, so a new section needs its copy).
- Commentary uses only params the engine **always** sends with that key (the list is in the test), so no raw
  `{placeholder}` can ever show. The reveal screen resolves ids before formatting: `{batter}`, `{bowler}`, `{winner}`,
  `{player}` become aliases; `{shot}`, `{variant}`, `{zone}`, `{fielder}`, `{wicket}`, `{field}`, `{pitch}`,
  `{weather}` become this catalog's own names; `{speed}` and `{distance}` are rounded numbers. The test renders every
  commentary line of the golden replays, 160 simulated matches and a Daily Six attempt in every locale.
- `{zone}` in ball commentary is the zone the batter aimed at, so only lines where that is where the ball went use it
  (middled fours, sixes, punished loose balls); `{fielder}` is used only on catches that always name one.
- Names are substituted as written (ICU-lite cannot lowercase), so sentences are built where "Good length" or
  "Off-spin" reads naturally mid-sentence.
- Several explanation keys fire for good and bad results alike (pitch, weather, deep field, matchup keys); their lines
  stay outcome-neutral. Every explanation follows engine v1 as documented in `docs/GAME_RULES.md`.
- Aliases can be any gender. Hindi, Marathi, Gujarati and Punjabi use ergative (ने / -એ / ਨੇ) constructions whose verb
  agrees with the object, or verbless sentences; Telugu, Kannada and Tamil use the honorific plural; Bengali and
  Malayalam verbs carry no gender. A case suffix on a Latin-script alias is hyphenated (Bengali `{batter}-এর`,
  Malayalam `{batter}-ന്`); zone names take a noun rather than a suffix (`{zone} ഭാഗത്ത്`, `{fielder} பகுதியில்`).
- Commentary is original: no catchphrases of real commentators.

## Status

| Locale | Script | Coverage | Status | Before release |
| --- | --- | --- | --- | --- |
| `en` English | Latin | 278 / 278 | Source | Copy review |
| `hi` हिन्दी Hindi | Devanagari | 278 / 278 | Complete, written in-house (AI-authored) | Native-speaker review recommended |
| `hi-Latn` Hinglish | Latin | 278 / 278 | Complete, written in-house (AI-authored) | Native-speaker review recommended |
| `bn` বাংলা Bengali | Bengali | 278 / 278 | **Machine-drafted** | **Human linguistic QA required** |
| `te` తెలుగు Telugu | Telugu | 278 / 278 | **Machine-drafted** | **Human linguistic QA required** |
| `mr` मराठी Marathi | Devanagari | 278 / 278 | **Machine-drafted** | **Human linguistic QA required** |
| `ta` தமிழ் Tamil | Tamil | 278 / 278 | **Machine-drafted** | **Human linguistic QA required** |
| `gu` ગુજરાતી Gujarati | Gujarati | 278 / 278 | **Machine-drafted** | **Human linguistic QA required** |
| `kn` ಕನ್ನಡ Kannada | Kannada | 278 / 278 | **Machine-drafted** | **Human linguistic QA required** |
| `ml` മലയാളം Malayalam | Malayalam | 278 / 278 | **Machine-drafted** | **Human linguistic QA required** |
| `pa` ਪੰਜਾਬੀ Punjabi | Gurmukhi | 278 / 278 | **Machine-drafted** | **Human linguistic QA required** |

No file in this folder has been reviewed by a native speaker. None may be described as reviewed or native-quality
(store listings, release notes, marketing) until a reviewer signs off in the log below.

## Review log

| Locale | Reviewer (person or vendor) | Date | Commit | Notes |
| --- | --- | --- | --- | --- |
| | | | | |

## For reviewers of the drafted locales

- Cricket vocabulary: the names match the app catalogs' core-UI drafts; decide per market between English loans
  (बोल्ड, ক্যাচ) and native terms (Marathi uses त्रिफळाचीत, झेलबाद, पायचीत, यष्टिचीत, धावबाद).
- Ghost names: Hindi and Hinglish localise them (एंकर / Anchor, स्विंगर / Swinger, दबंग / Dabang, जादूगर /
  Jaadugar, उस्ताद / Ustaad); the drafts transliterate the English names.
- The guide is written for a 12-year-old: short sentences, everyday words, and the second person (polite आप,
  तुम्ही, మీరు, நீங்கள், તમે, ನೀವು, ਤੁਸੀਂ; familiar তুমি in Bengali; Hinglish mixes *aap* with friendly imperatives).
  Confirm the register suits each market.
- Check that numbers in prose read naturally (Bengali writes ১৫ in the energy guide; the others use 15) and that
  plural branches (`=1`, `=2`, `one`, `other`) give correct agreement.
- Keep every `{placeholder}` exactly as it is; the test fails otherwise.
