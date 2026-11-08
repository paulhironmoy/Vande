# Instructions for every agent working on VANDE

Read these first. They bind every agent and every task in this repository.

1. `docs/VANDE-PRODUCT-SEQUENCE.md`: the product constitution.
   - The active stage is at the top.
   - No agent may start, build or advance work for a later stage.
   - Send later-stage ideas to the lead for the not-now register (§9).
2. `docs/VANDE-EXPERIENCE-CONSTITUTION.md`: the ten experience laws, proportional feedback and the prohibited
   patterns.
3. `docs/prompts/VANDE-INTERFACE-ASSET-CONSTITUTION.md`: binding for every Practice screen and asset.
4. `docs/ARCHITECTURE.md`: module map and exclusive file ownership. Never edit another owner's files; route shared
   files (contracts, app shell, config, Android) through the lead.

## Working rules

- **Builders cannot certify their own work.**
  - Scores and gate decisions come only from the independent evaluators, using the locked rubrics:
    - `release/player-experience/ceiling-rubric.md`;
    - `release/player-experience/DUAL-CEILING-RUBRIC.md`;
    - `release/competitive-experience/COMPETITIVE-RUBRIC.md`.
  - Never edit a locked rubric.
- **Evidence:**
  - Every claim cites evidence: build id (`release/player-experience/tools/build-id.sh`), UTC time,
    device/browser, settings, method, expected, observed, pass/fail, path.
  - AI agents are evaluators, never players. Never state or estimate a human result.
- **Android size and India reach:**
  - Treat `docs/ANDROID_SIZE_AND_REACH.md` as the measurement contract for every Android-affecting change.
  - The hard end goals are at most **50,000,000 bytes** fresh-installed through the first playable ball and at least
    **90.0% India-weighted working reach**. Artifact size or a count of device models cannot certify either gate.
  - Report the measured size delta and affected compatibility cohorts. If representative Play/device evidence does
    not exist, mark the result **UNPROVEN**; never estimate it.
  - Run `npm run android:policy:test` for policy-tool changes and both Android preflights on every release artifact.
    A static pass never replaces fresh-installed, Play-split or physical-device evidence.
- **Never do any of these:**
  - commit, push, deploy, publish or purchase without the owner's explicit approval;
  - reset, stash, clean or discard other people's changes;
  - delete functioning code or tests to get green;
  - kill processes you did not start;
  - uninstall the Android app or wipe its data;
  - print or commit `android/keystore.properties` or `android/keystore/*`.
- **Use only original or properly licensed assets.**
- **Shared machine:**
  - Run long batch jobs under `nice -n 15` with at most 2 parallel workers, reusing one process rather than spawning
    one per case.
  - Keep bulk raw data in your scratch directory; put only summaries and selected captures under `release/`.
  - Record `uptime` with every timing measurement, and treat measurements taken at a 1-minute load above 20 as
    indicative only.
