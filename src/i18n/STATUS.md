# Translation status

## Sources

Translations come from separate catalogs, each owned by one workstream (`src/i18n/sources.ts`):

| Source | Files | Owner | Keys (prefixes) |
| --- | --- | --- | --- |
| App | `catalogs/<locale>.ts` | experience | Everything else: `brand`, `common`, `state`, `outcome`, `onboarding`, `training`, `plan`, `bat`, `reveal`, `stage`, `settings`, `a11y`, `update`, `home`, `alias_fix`, `consent`, `push`, `duel`, `invite`, `match`, `daily`, `ghosts`, `card`, `notfound`, `highlight`, `shared`, `age`, `legal` |
| Engine | `engine/<locale>.json` | gameplay | `variant`, `family`, `line`, `length`, `intensity`, `intent`, `field`, `shot`, `zone`, `pitch`, `weather`, `timing`, `contact`, `execution`, `wicket` (each with `_hint`), `ghost`, `explain`, `commentary`, `guide` (see `engine/STATUS.md`) |
| Social | `social/<locale>.ts` | social | `social.*` and `banter.*` only. Loaded by the social workstream's own hook (`loadSource('social', locale)`), never merged into the app translator |

The app translator (`useT()`) merges the app and engine catalogs per locale. A key may exist in only one source:
`tests/unit/ui/i18n-sources.test.ts` fails on a duplicate between the app and engine catalogs in any locale, on an
app key that uses an engine or social prefix, and on an engine key that uses an app or social prefix. It also checks
that every translation parses and uses the same placeholders as its own English.

Loading: the English app catalog is bundled with the shell. Every other catalog is code-split. A route waits for the
copy it needs before it renders (screens with cricket vocabulary also wait for the engine catalog). Until a catalog
arrives, and for any key a locale does not have, the text falls back to English. A raw key is never shown.

## App catalog coverage

Source: `catalogs/en.ts` (677 keys).

| Locale | Script | Coverage | Status | Before release |
| --- | --- | --- | --- | --- |
| `en` English | Latin | 677 / 677 | Source | Copy review |
| `hi` हिन्दी Hindi | Devanagari | 677 / 677 | Complete, written in-house (AI-authored) | Native-speaker review recommended |
| `hi-Latn` Hinglish | Latin | 677 / 677 | Complete, written in-house (AI-authored) | Native-speaker review recommended |
| `bn` বাংলা Bengali | Bengali | 93 / 677 (core UI) | **Machine-drafted** | **Human linguistic QA required**, then complete |
| `te` తెలుగు Telugu | Telugu | 93 / 677 (core UI) | **Machine-drafted** | **Human linguistic QA required**, then complete |
| `mr` मराठी Marathi | Devanagari | 93 / 677 (core UI) | **Machine-drafted** | **Human linguistic QA required**, then complete |
| `ta` தமிழ் Tamil | Tamil | 93 / 677 (core UI) | **Machine-drafted** | **Human linguistic QA required**, then complete |
| `gu` ગુજરાતી Gujarati | Gujarati | 93 / 677 (core UI) | **Machine-drafted** | **Human linguistic QA required**, then complete |
| `kn` ಕನ್ನಡ Kannada | Kannada | 93 / 677 (core UI) | **Machine-drafted** | **Human linguistic QA required**, then complete |
| `ml` മലയാളം Malayalam | Malayalam | 93 / 677 (core UI) | **Machine-drafted** | **Human linguistic QA required**, then complete |
| `pa` ਪੰਜਾਬੀ Punjabi | Gurmukhi | 93 / 677 (core UI) | **Machine-drafted** | **Human linguistic QA required**, then complete |

No machine-drafted catalog has been reviewed by a native speaker. None may be described as native-reviewed in store
listings or release notes until a reviewer signs off here (name of the reviewing vendor or person, date, commit). In the
app, Settings marks these languages "(draft)" and says that untranslated lines show in English.

"Core UI" = brand, common actions, outcomes, the age question and its stop screen (every locale has them, because
they come before anything else), onboarding, training steps, the main batting, planner, reveal and stage labels, and
the most visible hub, invite and settings lines. Cricket vocabulary, explanations and commentary come from
the engine catalogs (gameplay, `engine/STATUS.md`).

## Register and wording

- Hindi addresses the player as आप throughout. Hinglish uses tum throughout, the same register as the social catalog.
- Copy names buttons by their own label in each language: "बैट" in Hindi, not "BAT".
- Hinglish relative times ("5 ghante mein", "2 din pehle", "kal") are written by the translator itself
  (`hinglishRelative`), because Intl has no Hinglish and would put English into a Hinglish sentence.
- Nothing about the opponent implies real time ("just now", "is batting", "waiting for"): their lock and innings
  flags can appear minutes late, so every line about them is a status ("has locked their over").

## Layout support

- Fonts: Manrope (Latin) is bundled. Noto Sans Devanagari is bundled for Hindi and Marathi, and is only downloaded
  when Devanagari text appears (`local()` first, because Android ships it). Other scripts use the platform's Noto
  family, with Windows and Apple fallbacks (`src/styles/tokens.css`, `:root:lang(..)`). The highlight renderer bundles
  its own faces (`src/highlight/fonts.css`), because its page has no network and no system fonts.
- Indic locales get taller line heights and zero letter-spacing (tracking breaks conjuncts and matras). Uppercase
  transforms only affect Latin text.
- Layouts are designed for +40% text expansion and checked at 360 px in Hindi and Hinglish
  (`tests/e2e/ux-journeys.spec.ts`). Buttons wrap. Labels truncate with an ellipsis only where the full label is
  repeated elsewhere (aliases). Nothing important relies on a fixed width.
- Numbers, plurals, dates and relative times use `Intl` with the locale's BCP 47 tag (`hi-IN`, `bn-IN`, and so on;
  Hinglish uses `en-IN` for Latin digits with Indian grouping). Daily Six days are formatted in India time
  (`Asia/Kolkata`) whatever the device's time zone.
