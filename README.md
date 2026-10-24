# VANDE: Republic Under Pressure

**Freedom. Order. Your Move.**

An independent civic-strategy game. In three short chapters you protect constitutional freedom, resolve a legitimate
grievance, keep people safe, verify evidence and expose manipulation, while five rule-based opponents try to turn the
crisis against you. You do not win by suppressing protest; you win by holding the Republic together.

* Play on the web: **https://paulhironmoy.github.io/Vande/** (installable PWA, works offline)
* Android: APK and Play-ready AAB built from this repository (see `docs/ANDROID.md`)
* No accounts, no servers, no analytics. Everything runs and stays on your device.

> VANDE is an independent product. It is not affiliated with, or endorsed by, the Government of India, any political
> party or any public institution. All scenarios, characters and organisations are fictional. Educational content is not
> legal advice.

## The game

| Chapter | Crisis | You must |
| --- | --- | --- |
| 1 | Examination Crisis | Recognise the grievance, open a credible investigation, protect peaceful assembly, detect manipulated evidence, keep services running, avoid indiscriminate detention |
| 2 | Electoral Dispute | Open a transparent review, protect records and officials, publish verifiable information, separate mistakes from fraud, preserve lawful disagreement, stop intimidation |
| 3 | Information Storm | Protect independent journalism, verify recordings, expose undisclosed influence, correct false claims, stop threats, avoid censorship, communicate uncertainty honestly |

Six dimensions are tracked on the **Republic Pulse**: constitutional freedom, grievance resolution, public safety,
evidence accuracy, public trust and economic continuity. Final outcomes range from *Resilient Republic* to *Manipulated
Republic*, *Order without Trust*, *Free but Fragile*, *Institutionally Weakened* and *Economically Disrupted*.

Opponents (1–5, three difficulty levels): Grievance Exploiter, Provocateur, Disinformation Cell, Sabotage Network,
Overreaction Trap. All of them are local, deterministic and behaviour-based. Abstract "bug" glyphs represent fabricated
evidence and covert manipulation, never people.

Also included: a deterministic **daily challenge**, **friend challenges** that reproduce the identical game from a URL
(no backend), locally generated **share cards**, and a **persistent Republic** that evolves across sessions.

## Stack

React 19 · TypeScript · Vite 8 · PixiJS 8 (animated city) · Zustand · IndexedDB (`idb`) · Workbox service worker ·
Capacitor 8 (Android) · Vitest · Playwright. Design language: *Civic Cinematic* (`src/styles/tokens.css`).

## Develop

```bash
npm ci
npm run dev            # http://localhost:5173
npm run typecheck
npm test               # unit tests (engine determinism, scoring, evidence, opponents, persistence, share card)
npm run build          # production build → dist/
npm run test:e2e       # Playwright journeys, viewports, a11y, offline, persistence (uses dist/ via vite preview)
```

Release, rollback and Android instructions: `docs/RELEASE.md`, `docs/ROLLBACK.md`, `docs/ANDROID.md`.
Architecture and content authoring: `docs/ARCHITECTURE.md`. Privacy: `docs/PRIVACY.md`.

## Repository layout

```
src/engine      deterministic simulation, opponents, scoring, challenge/daily codecs (pure, serialisable)
src/content     the three scenario JSON files + JSON schema
src/map         PixiJS city scene, SVG fallback, accessible overlay
src/app         store, persistence, routing, game loop, settings effects
src/screens     one folder per screen
src/components  play / results / opponents / republic / ui / brand
src/share       result card renderer and native/web share
src/pwa         service worker, registration, update banner
android         Capacitor Android project (signing config reads android/keystore.properties)
tests           unit (Vitest) and e2e (Playwright) suites
```

## Licence

Source code © the author. Third-party licences are listed in-app under *About → Open-source attribution*.
