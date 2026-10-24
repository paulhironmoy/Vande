# VANDE: Republic Under Pressure — Release 1.0.0

Release date: 2026-10-24 · versionCode 1 · Source: `main` on https://github.com/paulhironmoy/Vande

## Deliverables

| Deliverable | Location | Status |
| --- | --- | --- |
| Public web game (PWA, offline) | https://paulhironmoy.github.io/Vande/ | Live (GitHub Pages, `gh-pages` branch) |
| Android release APK (testing) | `release/vande-1.0.0-1-release.apk` (6.6 MB) | Installed and launched on emulator |
| Android App Bundle (Play upload) | `release/vande-1.0.0-1-release.aab` (6.5 MB) | Signed with the upload key |
| Checksums | `release/SHA256SUMS-1.0.0-1.txt` | — |
| Release / rollback / Android guides | `docs/RELEASE.md`, `docs/ROLLBACK.md`, `docs/ANDROID.md` | — |
| Privacy, disclosure, accessibility, attribution, support, version | In-app **About** pages; `docs/PRIVACY.md` | — |

Signing: upload key `CN=VANDE Upload Key, O=VANDE, C=IN`, RSA-2048, SHA-256 fingerprint
`26:B1:3E:5A:0C:4D:2F:CB:05:5B:CD:FE:2B:D4:10:45:82:EA:1B:11:A3:9A:27:48:0E:16:98:2F:66:7B:85:A0`.
Keystore and passwords live only in `android/keystore/` and `android/keystore.properties` (gitignored). **Back them up.**

## Scope shipped

* Three chapters (Examination Crisis, Electoral Dispute, Information Storm), about 3 minutes each, ~10-minute campaign.
* 1–5 selectable rule-based adaptive opponents at three difficulty levels, deterministic from the seed.
* Animated PixiJS city map with an accessible district overlay and live captions; SVG fallback without WebGL.
* Evidence investigation (inspect, compare, preserve, mark unresolved) with five confidence states; false accusations
  and disproportionate enforcement visibly penalised.
* Republic Pulse (six dimensions, balance, momentum, instability, direction) with tap/focus/hover values.
* Rights moments inside the flow with plain-language principles, official-source links and the educational disclaimer.
* Chapter resolutions, six final Republic outcomes, most consequential decision, missed evidence, personal bests.
* Daily challenge (deterministic per local day, simulated comparison band labelled as such), friend challenges via URL
  (identical game reproduced with no backend), locally rendered share cards and native/web sharing.
* Persistent Republic with a living city, history of earlier crises, export, reset and delete.
* Settings: reduced motion, high contrast, text size to 200 %, colour-blind-safe palette, sound, haptics, captions,
  timer pace, always-show values. Pause/resume at any time.

## Play styles

* **Simple** (default for new players): plain words a confident eight-year-old can read, kid-friendly names for the
  five opponents (The Anger Stirrer, The Trouble Starter, The Rumour Bug, The Wrecker, The Big Hammer), "Clues" instead
  of evidence with states True / Backed up / Not checked yet / Fake / Can't tell, a city-mood label on the Pulse, bigger
  buttons (56 px) and text (nothing under 15 px), a slower clock that **waits whenever something new needs an answer**,
  "Fair play moments" instead of legal citations (official-source links are kept "for grown-ups"), and star ratings.
* **Full**: the complete strategist presentation with legal references and a real-time clock. Chosen on the intro
  screen or in Settings; the simulation, seeds and challenge codes are identical in both styles.

## Verification summary

| Check | Result |
| --- | --- |
| TypeScript (app + node configs) | clean |
| Vitest unit tests | 115 passed (engine determinism, scoring, evidence, opponents, persistence, share card, balance) |
| Playwright e2e (production build) | 38 passed: full campaign, opponents, challenge reproduction, daily, share, controls, persistence/refresh, offline, 7 viewports, keyboard, axe WCAG 2.2 AA, reduced motion, settings modes, redirects, navigation |
| Cross-strategy balance | principled 76–86 (Resilient), suppressive 15–19, inaction 29–32, reckless 33–59 |
| Lighthouse (mobile, slow 4G, 4× CPU) | Performance 96 (`/`) / 94 (`/home`), Accessibility 100, Best practices 100, CLS 0, TBT ≤ 10 ms |
| Lighthouse (desktop) | 100 / 100 / 100 |
| Initial transfer | 239 kB gzip (budget 2 MB); offline precache ≈ 1.2 MB |
| Live smoke (GitHub Pages) | loads < 1 s, service worker active, deep links via 404 fallback, `?c=` challenge routing, no console errors, no cross-origin requests |
| Android (API 36 emulator) | installs, launches, renders map and gameplay, hardware Back verified, no crashes/ANR/JS errors |

## Known limitations

* Screen-reader behaviour verified with automated tooling and keyboard only; a manual TalkBack/VoiceOver pass is
  recommended before store listing claims.
* Software-GL emulators (SwiftShader) show WebView tile-memory artefacts; real devices and host-GPU emulation do not.
* Settings writes are issued immediately but not awaited on an instant page unload (sub-100 ms window).
* Scenario JSON (≈60 kB compressed) ships in the entry bundle; splitting it per chapter is the next performance step.

## Rollback

Web: `git push origin <previous-gh-pages-sha>:gh-pages --force` (see `docs/ROLLBACK.md`). Android: halt the staged
rollout in Play Console and promote the previous AAB.
