# Lite pictures: visual answers only where they cannot confuse

Lite answer cards can show a small composed picture (who acts, the action, the object) with a 2–4 word label in
place of the longer title. Pictures speed up reading for young players, but a picture can also nudge a choice. So
the rule is strict: **a question shows pictures only when every one of its answers passes all four tests; otherwise
the whole question stays text.** The decision is made per question, never per answer, because a lone picture draws
the eye.

## The four tests

1. **Concrete.** The answer has a visible actor, action and object: lock the gates, meet the student leaders,
   reroute the buses. Procedural or legal ideas fail ("open a transparent review", "follow due process"), as do
   statements whose difference is truth versus falsehood, and almost every fair-play question.
2. **Distinct.** Every answer differs from every other answer in the question in at least one of actor, action or
   object, so no two pictures look alike.
3. **Neutral.** Nothing signals good or bad: no red or green meaning, no ticks, crosses or warning marks, no weapons,
   handcuffs, injuries, fire or frightening imagery, no smiling or angry faces, and the same visual weight for every
   answer. Arrests, lock-ups, raids and crowd clearing therefore stay text.
4. **Label stays.** A 2–4 word label sits under every picture and keeps the words that make the answer different
   ("only", "every", "now", "first"). The picture never replaces the words; screen readers and young readers rely on
   them.

Tests 2–4 are enforced in code. Test 1 is an authoring judgement: authors tag only answers that pass it, and leave a
question untagged when any of its answers cannot be drawn.

## Where it lives

| Piece | File |
|---|---|
| Vocabulary (data only, permanent ids) | `src/content/lite/visualVocabulary.ts` |
| Glyph components and the composed pictogram | `src/components/game/pictograms/` |
| Gate and validator | `src/lite/visuals.ts`: `visualPlanFor(decision)`, `validateVisuals(scenario)`, `visualCoverage(scenario)` |
| Tags | `simple.options[<id>].label` and `simple.options[<id>].visual` in a scenario JSON |
| Card rendering | `ActionCard` `visual` prop (picture, label, kind badge, Gain/Cost) |
| Coverage report | `node scripts/lite-visuals-report.mjs [scenario ids…] [--all]` |
| Tests | `tests/unit/lite/visuals.test.ts`, `tests/unit/game/pictogram.test.tsx`, `tests/unit/game/actionCardVisual.test.tsx` |

`visualPlanFor` is the only thing the screen asks. It returns a plan for every option, or `null` when any option is
untagged, uses an unknown or non-neutral glyph or a glyph in the wrong role, repeats another answer's picture, or has
a label outside 2–4 words. `validateVisuals` reports the same problems as errors (unit tests run it over every chapter
and every daily crisis and expect none) and lists partially tagged questions in the coverage as text, not as errors.

## Coverage: Chapter 1

| Question | Shows | Why |
|---|---|---|
| d-first-response · Students are gathering | Pictures | Meet, ask the office to speak, lock the gates, wait: all concrete and neutral |
| d-investigation · Who checks the leak? | Text | Procedural: who checks and how independent they are cannot be drawn |
| d-civic-square · The gathering reaches Civic Square | Text | Force: moving or clearing people needs crowd-control imagery |
| d-racket · Someone is selling a 'sure paper' | Text | Force: an arrest and a raid are among the answers |
| d-communication · What do you tell the city? | Text | Statements: the difference is what is said and whether it is true |
| d-services · Keep the city moving | Pictures | Open a path, reroute buses, stop all buses, leave it to traffic police |
| d-resolution · Ending the day | Text | Statements: blaming and promising are words, not visible actions |
| d-bait-cancel · Cancel it now? | Text | Timing is the difference, and cancelling would need a cross mark |
| d-bait-disperse · Send everyone away now? | Text | Force: holding people and clearing a square |
| d-bait-shutdown · Calls to 'shut it all down' | Text | Lock-up: locking up the student leaders |
| Three fair-play questions | Text | Fair-play questions are always text |

Labels and pictures in the two picture questions:

| Answer | Label | Actor · action · object |
|---|---|---|
| Meet the student leaders today | Meet student leaders | official · meet · students |
| Ask the exam office to speak | Ask office to speak | office · announce · students |
| Lock the university gates | Lock university gates | police · lock · gate |
| Wait for the exam office | Wait for the office | official · wait · office |
| Open a path with student helpers | Open path with students | students · guide · road |
| Reroute buses, open a hospital lane | Send buses another way | official · reroute · bus |
| Stop all buses to break the crowd | Stop all buses | official · stop · bus |
| Leave it to traffic police | Leave to traffic police | police · wait · road |

The rollout stops at Chapter 1 until the owner has reviewed the screenshots. Other chapters, twists and daily crises
are not tagged.

## Vocabulary

Every id is permanent: never rename or reuse one. The list is only as big as the tagged answers need (a test fails if
a glyph is unused).

| Id | Roles | Shows |
|---|---|---|
| official | actor, object | A city official wearing an ID badge on a lanyard |
| police | actor, object | A police officer in a peaked cap with a small badge; no equipment |
| students | actor, object | Three students standing together, one in front |
| office | actor, object | The exam office: a public building with columns and steps |
| gate | object | A campus gate: two posts, an arch and a few bars |
| bus | object | A city bus seen from the side |
| road | object | A road with a dashed centre line |
| meet | action | Two speech bubbles: talking together |
| announce | action | A megaphone with two sound waves: telling everyone |
| lock | action | A closed padlock |
| wait | action | An hourglass |
| guide | action | A dotted path ending in an arrow: making a way through |
| reroute | action | An arrow that turns: sending traffic another way |
| stop | action | A pause sign, two upright bars |

## How to tag an answer

Add both fields to the option's simple copy, and do it for **every** answer of the question, or for none:

```json
"o-cordon-campus": {
  "title": "Lock the university gates",
  "preview": "…",
  "label": "Lock university gates",
  "visual": { "actor": "police", "action": "lock", "object": "gate" }
}
```

Then run `node scripts/lite-visuals-report.mjs <scenario id>` and the unit tests. Before tagging, check every answer
against the four tests; if one fails, leave the whole question as text and add a one-line reason to
`TEXT_ONLY_NOTES` in `src/lite/visuals.ts` so the report explains it.

## How to add a glyph

1. Add an entry to `VISUAL_VOCABULARY` with a new permanent id, its roles, what it shows and `neutral: true`. Never add
   a glyph that signals good or bad; if one must be listed for documentation, mark it `neutral: false` and validation
   rejects any answer that uses it.
2. Draw the component in `src/components/game/pictograms/glyphs.tsx` and add it to `GLYPHS` under the same id.
   - People, places and things: 64-unit grid, content inside x 6–58, standing on y 60.
   - Actions: 24-unit grid; they sit in the round badge between actor and object.
   - Strokes only in `currentColor` (rounded caps and joins); fills only through the shared `accent` tint, the `solid`
     ink or the `occlude` surface (to hide what is behind). No literal colours, no text, no faces.
3. Run the pictogram tests (id and component parity, aria-hidden, no text, no literal colours) and look at it at
   360, 390 and 412 px and in forced colours before tagging anything with it.

## Style and accessibility

- One composition for every answer: actor on the left, the action in a round badge in the middle, the object on the
  right, on one ground line. Same structure, same weight, so no answer stands out.
- The tile carries its own surface and ink (`--pictogram-surface`, `--pictogram-ink`) and one shared neutral accent
  (`--pictogram-accent`) for every kind. Kind colours stay in the small kind badge, as on text cards.
- Pictures are `aria-hidden`; the card's accessible name is exactly its visible text (label, kind, Gain, Cost).
- High contrast (`data-contrast='high'`) brightens ink and accent; forced-colours mode switches to `Canvas` and
  `CanvasText`. Nothing animates beyond the card's existing entrance, which reduced motion already turns off.
- Two sizes: `card` (full card width, 2:1) and `mini` (5 rem wide, for the reveal list). In the reveal, a row with a
  picture puts the picture and the points on top and the words full width below, so the text never squeezes on a
  phone.
- After an answer, the picked card lifts and the others fade back; the card entrance animation fills backwards only,
  so it never overrides those states.
- `tests/e2e/lite-a11y.spec.ts` keeps all of this checked on every new Lite screen: axe WCAG 2.2 AA, a keyboard-only
  friend loop (focus lands on each new heading; sheets close with Escape and return focus), phones at 320 (best
  effort), 360, 390 and 412 px plus 390 px landscape (no horizontal overflow, 44 px targets, nothing clipped), reduced
  motion (the setting and the system preference) and forced colours.

## Bias check

Pictures must not make a question easier or harder by accident. `lite_completed` carries four integers (analytics
off unless configured): `visualQuestions`, `visualBest`, `textQuestions`, `textBest`. Once real players arrive,
compare the best-move rate on picture questions with the rate on text questions, and compare each picture question
with its own history before pictures. A large gap means a picture is nudging choices: untag that question and review
its glyphs. No per-answer or per-option data is collected.

## Review previews

Static renders of the picture cards at 360, 390 and 412 px, in forced colours, in the picked state, next to a text
question, and a glyph sheet: `release/lite-review/visuals/preview/`. In-app screenshots of every new Lite screen at
320, 360, 390 and 412 px, 390 px landscape and forced colours: `release/lite-review/v2/` (regenerate with
`LITE_SHOTS=1 npx playwright test tests/e2e/lite-a11y.spec.ts`).
