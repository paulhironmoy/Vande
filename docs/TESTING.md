# VANDE — Test Coverage Map

Automated suites: **Vitest** (`npm test`, `tests/unit/**`) and **Playwright** (`npm run test:e2e`, `tests/e2e/**`,
runs against the production build served by `vite preview`). `VISUAL=1 npx playwright test --project=visual`
captures every screen at phone and desktop sizes into `test-results-visual/` for manual review.

| Requirement | Where it is tested |
| --- | --- |
| Complete playthrough of all three chapters | `tests/e2e/journey.spec.ts` (fresh profile → intro → opponents → three chapters → final result → home) |
| Opponent selection (1–5, default two at standard, difficulty) | `tests/e2e/opponents.spec.ts`; `tests/unit/engine/simulation.test.ts` (scheduling by seed/difficulty) |
| Deterministic scoring / identical seeds ⇒ identical games | `tests/unit/engine/simulation.test.ts` (deep-equal replay), `tests/unit/engine/balance.test.ts` (strategy outcomes), `tests/unit/engine/scoring.test.ts` |
| Evidence confidence states (verified, corroborated, unverified, manipulated, unknown) | `tests/unit/engine/simulation.test.ts`, `tests/unit/play/*.test.tsx` (chips, detail actions) |
| False-accusation penalties | `tests/unit/engine/simulation.test.ts` (freedom and trust fall, stats increment), `balance.test.ts` (reckless strategy) |
| Disproportionate-enforcement penalties | `tests/unit/engine/simulation.test.ts`, `balance.test.ts` (suppressive strategy loses freedom/trust) |
| Save and restore / refresh during gameplay | `tests/unit/app/store.test.ts` (IndexedDB round trip), `tests/e2e/persistence.spec.ts` (reload keeps tick and open evidence) |
| Daily seed generation | `tests/unit/engine/daily.test.ts` (same local day ⇒ same spec, rotation), `tests/e2e/daily.spec.ts` |
| Challenge-link reproduction | `tests/unit/engine/challenge.test.ts` (codec round trip, tamper rejection, URL parsing), `tests/unit/share/*.test.ts` |
| Result-card generation | `tests/unit/share/resultCard.test.ts` (model), `tests/visual/screens.spec.ts` (rendered PNG preview) |
| Offline loading | `tests/e2e/offline.spec.ts` (service worker precache, reload offline, start a chapter offline) |
| Target viewport sizes (360×800 … 1920×1080) | `tests/e2e/viewports.spec.ts` (no horizontal overflow, controls reachable, 44 px targets, screenshots) |
| Keyboard navigation | `tests/e2e/accessibility.spec.ts` (Tab to a decision option, visible focus, Enter activates) |
| WCAG 2.2 AA (axe) | `tests/e2e/accessibility.spec.ts` (home, opponents, gameplay) |
| Text scaling to 200 % | `tests/e2e/accessibility.spec.ts` |
| Reduced-motion behaviour | `tests/e2e/reduced-motion.spec.ts` (system preference and explicit setting) |
| Android back navigation | `tests/e2e/navigation.spec.ts` exercises the shared `back()` path through browser history; the Capacitor `backButton` listener calls the same function (`src/app/navigation.ts`). Device check: `docs/ANDROID.md` §Smoke test |
| Scenario content validity | `tests/unit/engine/scenarios.test.ts` (engine validator + JSON schema for all three files, full deterministic run) |
| Console errors | `tests/e2e/journey.spec.ts` fails on any uncaught page error or console error during the full campaign |

## Running

```bash
npm test                       # unit, ~3 s
npm run build && npm run test:e2e   # e2e, ~5 min on a laptop (3 workers)
VISUAL=1 npx playwright test --project=visual   # screenshots for design review
```

Playwright uses `page.clock` to fast-forward game time deterministically; the game loop is driven by window timers for
exactly this reason (see `docs/ARCHITECTURE.md` §6).
