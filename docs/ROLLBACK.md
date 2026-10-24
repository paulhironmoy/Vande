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
