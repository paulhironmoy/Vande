# Practice copy: translation status

Source: `en.ts` (keys `practice.*`, Practice UX workstream). Loaded by `usePracticeT()` in `index.ts`: English is
bundled, other locales are code-split and are partials of English, so a missing key shows the English line, never a
raw key. The Practice route waits for the active locale's file before it renders. `tests/unit/practice/ui/i18n.test.ts`
checks that every key the screens build at runtime exists in English, that every line parses, that Hindi and Hinglish
are complete, and that every translation uses exactly its English placeholders.

| Locale | Script | Coverage | Status | Before release |
| --- | --- | --- | --- | --- |
| `en` English | Latin | 958 / 958 | Source | Copy review |
| `hi` हिन्दी Hindi | Devanagari | 958 / 958 | Complete, written in-house (AI-authored), आप register | Native-speaker review recommended |
| `hi-Latn` Hinglish | Latin | 958 / 958 | Complete, written in-house (AI-authored), tum register (as the app and social catalogs) | Native-speaker review recommended |
| `bn` Bengali | Bengali | 0 / 958 | **English fallback** | Translation, then human linguistic QA |
| `te` Telugu | Telugu | 0 / 958 | **English fallback** | Translation, then human linguistic QA |
| `mr` Marathi | Devanagari | 0 / 958 | **English fallback** | Translation, then human linguistic QA |
| `ta` Tamil | Tamil | 0 / 958 | **English fallback** | Translation, then human linguistic QA |
| `gu` Gujarati | Gujarati | 0 / 958 | **English fallback** | Translation, then human linguistic QA |
| `kn` Kannada | Kannada | 0 / 958 | **English fallback** | Translation, then human linguistic QA |
| `ml` Malayalam | Malayalam | 0 / 958 | **English fallback** | Translation, then human linguistic QA |
| `pa` Punjabi | Gurmukhi | 0 / 958 | **English fallback** | Translation, then human linguistic QA |

No Practice file exists yet for the eight locales above: Practice shows English there (the rest of the app keeps its
own translations). Adding one is a partial of `en.ts` named `<locale>.ts` with a default export; nothing else changes.

Copy rules (all locales):

- Honest numbers only. A delivery's speed is its real release speed; a timing error is the measured one. Nothing says
  "150 km/h" about a slowed ball, and no line claims a result the physics did not produce.
- Never blame the player. Coaching names what happened (late, early, the edge, the swing) and one thing to try.
- Cricket words stay cricket words: Hindi uses the Devanagari forms the app and engine catalogs already use (कवर,
  बोल्ड, एलबीडब्ल्यू, चौका, छक्का); Hinglish keeps the English fielding terms.
- Uppercase is a style (CSS `text-transform`), never typed into the copy, so Devanagari is never affected.
- "On time" means the physics classified the swing as perfect: the words never use a timing threshold of their own.
- Where the ball goes is worded by role, never by pasting a region word into a frame made for a fielding position:
  `practice.zone.to.*` ("to cover", "straight down the ground"), `practice.zone.towards.*` and `practice.zone.gap.*`
  ("the cover gap", "the gap behind the wicket"), each with `any` for no region (`tests/unit/practice/ui/card-copy.test.ts`
  renders every region-bearing line for every region in en, hi and hi-Latn). Hindi `gap` phrases are oblique ("कवर के गैप")
  because every line puts a postposition after them.
- Footwork (`practice.footwork.*`) is worded as a manner ("on the front foot", "आगे के पैर पर", "front foot pe"), so it
  reads alone in Why? and inside the option lines, whose frames add no postposition of their own. A direct-case noun
  inside a frame that adds one gave "आगे का पैर पर" (2026-11-03 rerun; the new and changed Hindi and Hinglish lines are
  AI-written and await native review).
- 2026-11-03 (Track A): 946 keys per locale. New since 926, in en, hi and hi-Latn, the hi and hi-Latn lines AI-written
  and awaiting native review: `practice.coach.played_on`; `practice.option.stroke.*` (14 stroke families, for
  Alternatives.tsx); `practice.tip.where.toe`; `practice.tip.fact.slow`, `.toe`, `.off_sweet_toe` and
  `.off_sweet_handle` (how the bat met the ball, from the contact itself, never the timing label).
- 2026-11-04 (Track A, D-1 display honesty; lead ruling): still 946 keys per locale.
  - `practice.option.numbers` changed in en, hi and hi-Latn. A risk that rounds to 0% reads "under 2%" ("2% से कम",
    "2% se kam"), never "0%": the coach's spread is a grid and cannot see a failure thinner than its spacing.
  - The changed hi and hi-Latn lines are AI-written and **join the owner's native-Hindi review list**.
  - `tests/unit/practice/coach/risk-display.test.tsx` renders Alternatives in all three locales. It checks that no line
    claims certainty.
- 2026-11-04 (Track A, lead ruling (B) and (C), the physics evaluator's "perfect/solid with no bat contact"): **958 keys**
  per locale, 12 new in en, hi and hi-Latn. The new hi and hi-Latn lines are AI-written and **join the owner's
  native-Hindi review list**:
  - `practice.tip.fact.no_reach.off`, `.stumps`, `.leg`, `.moved_away`, `.moved_in`, `.across`, `.too_short_to_drive`,
    `.at_the_toes`, `.too_short_forward`, `.full_back` and `.stroke`. A swing timed inside the band that the bat never
    met says so plainly, with why ("It was 12 cm wide of off stump, and the bat never reached it").
  - `practice.why.no_reach` ("On time, but the bat never reached the ball."), for Why? beside a perfect label on a miss,
    the pad or the body. WORKER wires it.
