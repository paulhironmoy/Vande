# VANDE — Content & Copy Audit (release gate)

Audit date: 2026-10-23. Scope: everything the player reads or clicks — the three scenario files, every screen, the share
card and the About pages. Method: scripted greps over `src/`, a length/reference script over the scenario JSON, a manual
read of all rights moments and `authority` lines, and a manual read of the six About pages.

## 1. Placeholder or dead text

* Searched `src/` for TODO, FIXME, lorem, "coming soon", placeholder, TBD, xxx and literal "test" copy. **None found.**
  The only `placeholder=` attribute is the genuine hint on the challenge-code field ("Paste a code or link").
* Template strings with optional chaining and no fallback (risk of "undefined" in copy): **none**.

## 2. Dead controls

* No empty `onClick` handlers, no `href="#"`, no anchors without `href`, no external links without `rel="noopener"`.
* Every `disabled` attribute is conditional on real state (nothing selected, game not running, busy, empty input, pager
  bounds, chapter ended). Home, Settings, Final result, Republic, Daily, Challenge and History handlers all navigate or
  call store actions. Nothing found that cannot be reached or does nothing.

## 3. Real-world references

* Grepped content and screens for real platforms, parties, politicians, exam bodies, ID schemes, cities, media houses and
  religious/caste/community identifiers. **No hits in game copy.** The only matches are the Disclosure page (which
  names the Government of India and the Election Commission of India purely to disclaim affiliation) and the
  Attribution page's font specimen URLs.
* Words like `rumor`/`organizer` appear only as engine enum values and element ids, never as player-facing copy; UI copy
  uses "rumour", "organiser", "behaviour", "colour" consistently.
* "Swarm"/"bug" wording appears only for the paid automated account network and fabricated evidence (Chapter 3), never for
  people. No protester, student or community is described as an enemy, insect or vermin.

## 4. Legal and civic accuracy (rights moments and authority lines)

Checked against the constitutional text and the principles of the cited judgments, in plain language without overclaiming:

| Item | Verdict |
| --- | --- |
| Article 19(1)(a)/(b) with 19(2)/(3) reasonable restrictions (assembly, speech, political criticism, prior restraint) | Accurate; restrictions described as specific, necessary, proportionate, never blanket |
| Articles 21 and 22 (liberty by procedure established by law, grounds of arrest, access to a lawyer, no dragnet detention) | Accurate |
| Article 14 (same rules for rival assemblies, no collective punishment of lawful trade) | Accurate |
| Internet suspension standard (Anuradha Bhasin, 2020: 19(1)(a) and 19(1)(g) online; orders necessary, proportionate, published, reviewable) | Accurate; source label now names the judgment |
| Online speech (Shreya Singhal, 2015: vague "offensive/annoying" restrictions struck down; discussion vs. incitement) | Accurate; source label names the judgment |
| Incitement/threat vs. heated opinion (specific, imminent threat justifies action) | Accurate |
| Election objections (decided openly with candidates' agents present; record checkable) | Accurate and generic; label reworded to "counting and objection procedures (reference)" |
| "Section 144" / CrPC | Not used anywhere, so no BNSS-2023 renumbering issue arises |

"Educational content—not legal advice" is rendered verbatim with every rights moment (`RightsMomentCard.tsx`), and also on
the Intro panel and every About page footer.

### Changes made to content (copy only; ids, numbers and references untouched)

| File | Before | After |
| --- | --- | --- |
| `examination-crisis.json` (rm-internet source) | "Supreme Court of India, judgments portal" | "Supreme Court of India — judgments, including Anuradha Bhasin v. Union of India (2020)" |
| `electoral-dispute.json` (rm-review-transparency source) | "Election Commission of India: procedures and guidance" | "Election Commission of India — counting and objection procedures (reference)" |

Scenario validator + JSON-schema tests re-run after the edits: passing.

## 5. About pages

* **Disclosure**: states independence and non-affiliation with the Government of India, state governments, the Election
  Commission, courts, police, political parties, public institutions and news organisations; fiction notice; opponents are
  behaviours; bug glyphs never people. No change needed.
* **Privacy** (edited): now states the localStorage fallback when IndexedDB is unavailable, that fonts are bundled and never
  fetched from a third party, that the Android share image is written to the app's own cache folder, and that support
  links open GitHub.
* **Accessibility** (edited): known limitations now include the text summary of the Republic Pulse chart, the district
  buttons mirroring the canvas, and that screen-reader verification used automated checks (axe) and keyboard testing.
* **Attribution** (edited): added Capacitor plugins, Fontsource (MIT) and axe-core (MPL-2.0); licences for React, Vite,
  TypeScript (Apache-2.0), PixiJS, Zustand, idb (ISC), Workbox, Capacitor, Manrope and Noto Sans Devanagari (SIL OFL 1.1)
  verified.
* **Support**: links to https://github.com/paulhironmoy/Vande/issues. **Version**: version, build id, build date, platform,
  connection state and storage usage.

## 6. Tone, length and exact strings

* Scripted check over all three scenarios: decision/option titles ≤ 48, previews ≤ 110, claims ≤ 140, event messages ≤ 120
  characters — **0 violations**.
* Exact strings verified in code: tagline "Freedom. Order. Your Move." (Home), launch line "Every choice changes India."
  (Launch), share line "I held the Republic together. Can you?" (`src/share/resultCard.ts`), rights disclaimer
  "Educational content—not legal advice" (`RightsMomentCard.tsx`).

## Remaining risks

* Legal content is deliberately high-level; it cites principles, not section numbers, and links to official portals rather
  than deep links (to avoid link rot). Reviewers wanting case-specific citations can extend the `source` labels.
* The local-body election in Chapter 2 is administered in reality by State Election Commissions; the source link points to
  the Election Commission of India as the brief requested. The label is now worded as a procedural reference only.
* Screen-reader verification is automated/keyboard only; a manual pass with TalkBack and VoiceOver is recommended before a
  store listing claims full screen-reader support.
