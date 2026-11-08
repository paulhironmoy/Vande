<!-- Encodes AGENTS.md. Delete a line only when it does not apply and say why. -->

## What and why

<!-- One or two sentences: what changes and why. Name the active stage (docs/VANDE-PRODUCT-SEQUENCE.md); work for a later stage does not belong here. -->

## Evidence

<!-- One row per claim. A claim without a row is not made. AI agents are evaluators, never players: no human result is stated or estimated. -->

| Claim | Build id (`scripts/build-id.sh`) | UTC time | Device or browser | Settings | Method | Expected | Observed | Pass or fail | Path |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |  |

## Tests run

<!-- Commands and results, for example `npm run typecheck:all`, `npm run lint`, `npm run format:check`, `npm run scripts:test`, `npx vitest run <files>`. A test that failed stays visible: nothing is deleted, skipped or loosened to get green. -->

## Checklist

- [ ] Scores and gate decisions come from the independent evaluators with the locked rubrics; no locked rubric is edited, and the builder does not certify its own work.
- [ ] Frozen files untouched: `npm run frozen:check` prints `25 of 25 OK` (or the change is the lead's, with the owner's approval stated here).
- [ ] Android: the measured size delta and the affected compatibility cohorts are below, or the result is marked **UNPROVEN** (`docs/ANDROID_SIZE_AND_REACH.md`; an artifact size or a count of device models certifies neither gate). `npm run android:policy:test` ran for a policy-tool change, and both Android preflights ran for a release artifact.
- [ ] Assets are original or properly licensed and free (no paid software, services, assets or APIs); each has its row in `docs/ASSET_REGISTER.md`.
- [ ] No keystore, `android/keystore.properties` or `android/keystore/*` is printed, committed or quoted.
- [ ] Files owned by someone else (`docs/ARCHITECTURE.md`) are not edited; shared files went through the lead.
- [ ] Nothing was committed, pushed, deployed, published or purchased without the owner's explicit approval, and no process or device state that I did not create was touched.

## Android size delta and cohorts

<!-- Bytes fresh-installed through the first playable ball (goal: at most 50,000,000) and the India-weighted working reach (goal: at least 90.0%), with the evidence. "UNPROVEN" when there is no representative Play or device evidence; never an estimate. -->
