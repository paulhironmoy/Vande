# VANDE — Rollback Guide

Every production surface can be reverted in minutes without any backend work.

## Web (GitHub Pages)

Each deploy is a commit on the `gh-pages` branch, so rolling back is pushing an older commit to that branch.

```bash
git fetch origin gh-pages
git log --oneline origin/gh-pages | head          # find the last good deploy, e.g. "Deploy v1.0.0 from 3f2a1c9"
git push origin <good-sha>:gh-pages --force       # GitHub Pages republishes in 1–3 minutes
curl -s https://paulhironmoy.github.io/Vande/VERSION.txt   # confirm the version/source commit
```

To roll back the *source* as well: `git revert <bad-commit>` on `main` (or `git checkout <good-sha> -- .`), commit,
then `npm run deploy:pages` to publish a fresh build from the reverted source.

## Web (Cloudflare Pages)

Dashboard → *Workers & Pages → vande → Deployments* → pick the previous deployment → **Rollback to this deployment**
(instant). With direct uploads: `npx wrangler pages deploy <previous dist>` or rebuild from the good commit.

## PWA clients

Installed PWAs keep running the cached build until the next online load, when the service worker fetches the newly
deployed (rolled-back) assets. Players then see the "new version is ready" banner and update, or get the new build on
the following launch. To force an immediate switch for a specific device: open the app online, accept the update
banner, or clear site data (browser Settings → Site data → delete) and reopen. Nothing server-side needs to change:
the precache manifest is content-hashed, so a rolled-back deploy is simply "another new version" to clients.

## Android

* **Play Console:** *Release → Production (or the testing track) → Releases*. If a release is partially rolled out,
  **Halt rollout** immediately. Then create a new release with the previous good `.aab` (keep every shipped AAB in
  `release/` and in the release notes). `versionCode` must increase, so rebuild the good commit with a higher
  `versionCode` if the previous artefact's code is lower than the bad one. Users cannot be downgraded automatically;
  the new (higher-code) build with the old behaviour is the rollback.
* **Side-loaded testing APKs:** `adb uninstall in.vande.republic && adb install release/<previous>.apk`.
* Game data is stored on the device in IndexedDB; a rollback does not delete it. If a release changed the data format
  in an incompatible way, bump the persistence version so the app migrates or resets safely.

## Keystore loss

The upload keystore (`android/keystore/vande-upload.jks`) and its password (`android/keystore.properties`) are **not**
in git. If they are lost: with Play App Signing enabled, request an upload-key reset in Play Console (identity
verification, ~2 days) — the app signing key is retained by Google and existing installs keep updating. Without Play
App Signing, a lost key means the package can never be updated; a new package name would be required. Back the files up
to an encrypted location now.

## Verification after any rollback

1. `curl -sI <url> | head -1` returns `200`; `VERSION.txt` shows the expected version.
2. Open in a private window: launch → home → start a chapter → make one decision.
3. Open the installed PWA once online so it picks up the rolled-back build.
4. On Android, install the rolled-back APK on a test device and play one decision.

## Backend and content rollback

* Worker: `cd backend && npx wrangler rollback` (or `npx wrangler deploy` of the previous commit). To retire a table,
  write a new migration rather than editing old ones.
* **Migration `0004` is not additive.** It rebuilds `rate_buckets`, `lite_attempts` and `lite_goal`. A Worker from
  before it still serves daily results, because those tables did not change. Its verified-dare endpoints would fail on
  the new `lite_attempts` (500), and apps would fall back to local play. To go fully back, restore the database to a
  moment before the migration and roll back the Worker with it:

  ```bash
  npx wrangler d1 time-travel restore vande-community --timestamp=<before the migration>
  ```

  Otherwise, roll forward.
* Rate Limiting bindings: removing a `[[ratelimits]]` binding, or a binding that fails, sends that limit to the D1
  fallback. Limits still apply, but each check then writes rows (`docs/COST.md`).
* Logs: Workers Logs stay off (`[observability]` in `wrangler.toml`). Switching them on is a privacy change, not a
  rollback step: see `docs/BACKEND.md`, "Logs and observability".
* Disable without redeploying the app: remove the Worker route (dashboard) or raise `MIN_COHORT`; clients queue and
  then drop submissions, statistics show "Not enough results yet".
* Content: revert the day file(s), keep `schedule.pinned` intact, bump `contentVersion`, run `node scripts/validate-daily.mjs`.
* Analytics: revoke the PostHog project key; clients fail silently.

## Verified dares (Lite)

Switching them off never affects play: every client call falls back to the local twist and an unsigned reply.

1. **Instant, no redeploy:** `cd backend && npx wrangler secret delete DARE_SIGNING_KEY`. Start and grade answer
   `503 service not configured`; the goal endpoint keeps serving its counts.
2. **Without removing the key:** set `KILL_LITE_DARES = "1"` in `backend/wrangler.toml` `[vars]` and
   `npx wrangler deploy` (or edit the variable in the dashboard).
3. **Stop clients asking:** rebuild the app without `VITE_LITE_VERIFIED_DARES` (or without any public key) and
   redeploy the site; installed PWAs switch on their next online load.
4. **CPU trouble with replay:** set `LITE_VERIFY_REPLAY = "0"`; new attempts are signed `t` (twist verified) and
   skip the replay entirely.
5. **Compromised signing key:**
   1. Delete the secret.
   2. Print a new pair with `node scripts/lite-dare-keys.mjs` and install the new private key.
   3. Rebuild the app with **only** the new public key in `VITE_DARE_PUBLIC_KEYS`. Drop the old key, so that anything
      signed with it stops verifying.

   Replies signed with the old key then count as ordinary local replies in updated apps. No data needs repairing.
6. **Data:** `lite_attempts` rows disappear after 7 days by themselves; to empty them at once,
   `npx wrangler d1 execute vande-community --remote --command "DELETE FROM lite_attempts"`. Migration `0003` is
   additive; to retire the tables, write a new migration rather than editing it.

Verify afterwards: open a dare link in a build with verified dares, answer it and confirm the twist still appears
(local draw) and the reply still sends.

### Rotating the signing key (planned, no compromise)

Each signature names its key by a key id: 8 hex, the first 8 characters of the fingerprint the key script prints. An
app build can trust several keys. So a rotation never breaks replies already out:

1. `node scripts/lite-dare-keys.mjs` prints a new pair. Note its key id.
2. Rebuild and deploy the app with both public keys: `VITE_DARE_PUBLIC_KEYS=<old key>,<new key>`. Wait until
   installed apps have updated: PWAs on their next online load, Android after the store update, in practice a week
   or two.
3. Put the new private key in the Worker:

   ```bash
   cd backend && npx wrangler secret put DARE_SIGNING_KEY
   ```

   New replies carry the new key id, and replies signed earlier keep verifying with the old key.
4. About 30 days later, when replies signed with the old key are long past their deadlines, rebuild the app without
   the old key.

If the new private key was pasted wrong, nothing breaks. Either the dare endpoints answer 503 (an unusable key), or the
apps reject signatures whose key id they do not know and send unsigned replies. Paste the right key again. Cloudflare
secrets cannot be read back, and the old private key was never stored anywhere else, so going back means running
through these steps again with a fresh pair.
