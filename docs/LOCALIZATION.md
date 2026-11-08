# Localization

Three languages are complete and eight are drafts. This page says where the text lives, how to add a string and which
checks guard player-facing wording. Coverage counts and review state are kept in the STATUS files named below, so they are
not repeated here.

## Languages

| Locale | Language | State |
| --- | --- | --- |
| `en` | English | The source of every catalogue |
| `hi` | Hindi, Devanagari, addresses the player as आप | Complete, written in-house (AI-authored). Native-speaker review recommended before release |
| `hi-Latn` | Hinglish, Latin script, tum register | Complete, written in-house (AI-authored). Native-speaker review recommended before release |
| `bn` `te` `mr` `ta` `gu` `kn` `ml` `pa` | Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Malayalam, Punjabi | Machine-drafted: the core app text only, English for the rest and for Practice. Human linguistic QA is required before release |

No machine-drafted language may be called native-reviewed in a store listing or release note until a reviewer is recorded in
`src/i18n/STATUS.md` (name of the person or vendor, date, commit). The state flag of each language is in
`src/i18n/locales.ts`; Settings marks the drafts "(draft)".

## Where the text lives

| What | Files | Status |
| --- | --- | --- |
| Practice screens (Stage 1), keys `practice.*` | `src/i18n/practice/en/<area>.ts` (start, play, coach, field, deliveries, settings, chase, lesson, camera, controls), joined in `en.ts`; `hi/` and `hi-Latn/` mirror it. `usePracticeT()` in `src/i18n/practice/index.ts` reads them | `src/i18n/practice/STATUS.md` |
| App shell, onboarding, settings, legacy screens | `src/i18n/catalogs/<locale>.ts` | `src/i18n/STATUS.md` |
| Cricket vocabulary: commentary, explanations, hints | `src/i18n/engine/<locale>.json` | `src/i18n/engine/STATUS.md` |
| Social features | `src/i18n/social/<locale>.ts` | `src/i18n/social/STATUS.md` |
| Android notifications | `android/app/src/main/res/values/strings.xml` (English) and `values-<lang>/strings.xml` for `hi`, `bn`, `gu`, `kn`, `ml`, `mr`, `pa`, `ta`, `te` | this page |

A key a language lacks shows the English line, never a raw key. Hinglish has no Android folder. The Android files hold
notification text only: FCM sends keys, never text or results (`backend/src/ops/push.ts`), so every notification kind needs
a title and a body in every folder. The eight machine-drafted files say so in their first comment and point here.

## Adding a string

1. **Practice text.** Add the key (prefix `practice.`) to the matching `src/i18n/practice/en/<area>.ts`, then the Hindi and
   Hinglish lines to `hi/<area>.ts` and `hi-Latn/<area>.ts`: the tests require both to be complete. The other languages fall
   back to English. A translation uses exactly the English line's `{placeholders}`.
2. **App text.** Add the key to `src/i18n/catalogs/en.ts`, then to `hi.ts` and `hi-Latn.ts`. Engine and social keys go in
   their own files; `tests/unit/ui/i18n-sources.test.ts` fails on a duplicate or on a key in the wrong source.
3. **A notification.** Add the kind to `NotifyKind` in `backend/src/ops/messages.ts`, then `notif_<kind>_title` and
   `notif_<kind>_body` to every `strings.xml`, with apostrophes written `\'`.
4. Update the area's STATUS file, then run `npx vitest run tests/unit/ui/i18n.test.ts tests/unit/ui/i18n-sources.test.ts
   tests/unit/practice/ui/i18n.test.ts tests/unit/app/androidStrings.test.ts`.

## Player-facing wording (F8)

The locked ceiling rubric (`release/player-experience/ceiling-rubric.md`) item F8 forbids technical device wording on a
player-facing screen. Two checks hold a word list:

- `tests/unit/practice/ui/i18n.test.ts` matches every Practice line in every language against (any case): tier, tiers, fps, frame
  rate, frame rates, GPU, WebGL, renderer, software graphics, benchmark, shader, MSAA, assisted, lite. Keys that start
  with `practice.dx.` (the hidden diagnostics screen) are excepted, and `{placeholder}` names are not matched.
- `scripts/eval/scan.mjs` scans the rendered text and accessible names of every captured state during an evaluation. Its list
  is longer: it adds "device check", "cutoff", "Full Batter View" and "Assisted Performance", and matches Full, Assisted and
  Lite when they are used as tier names.

Practice copy with a word of the first list fails the unit test; text on a captured screen with a word of the second is
reported to the evaluator. The copy rules for Practice (honest numbers, never blame the player, cricket words stay cricket
words) are in `src/i18n/practice/STATUS.md`.
