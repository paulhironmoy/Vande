# Practice copy: translation status

Source: `en.ts` (keys `practice.*`, Practice UX workstream). Loaded by `usePracticeT()` in `index.ts`: English is
bundled, other locales are code-split and are partials of English, so a missing key shows the English line, never a
raw key. The Practice route waits for the active locale's file before it renders. `tests/unit/practice/ui/i18n.test.ts`
checks that every key the screens build at runtime exists in English, that every line parses, that Hindi and Hinglish
are complete, and that every translation uses exactly its English placeholders.

| Locale | Script | Coverage | Status | Before release |
| --- | --- | --- | --- | --- |
| `en` English | Latin | 474 / 474 | Source | Copy review |
| `hi` हिन्दी Hindi | Devanagari | 474 / 474 | Complete, written in-house (AI-authored), आप register | Native-speaker review recommended |
| `hi-Latn` Hinglish | Latin | 474 / 474 | Complete, written in-house (AI-authored), tum register (as the app and social catalogs) | Native-speaker review recommended |
| `bn` Bengali | Bengali | 0 / 474 | **English fallback** | Translation, then human linguistic QA |
| `te` Telugu | Telugu | 0 / 474 | **English fallback** | Translation, then human linguistic QA |
| `mr` Marathi | Devanagari | 0 / 474 | **English fallback** | Translation, then human linguistic QA |
| `ta` Tamil | Tamil | 0 / 474 | **English fallback** | Translation, then human linguistic QA |
| `gu` Gujarati | Gujarati | 0 / 474 | **English fallback** | Translation, then human linguistic QA |
| `kn` Kannada | Kannada | 0 / 474 | **English fallback** | Translation, then human linguistic QA |
| `ml` Malayalam | Malayalam | 0 / 474 | **English fallback** | Translation, then human linguistic QA |
| `pa` Punjabi | Gurmukhi | 0 / 474 | **English fallback** | Translation, then human linguistic QA |

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
