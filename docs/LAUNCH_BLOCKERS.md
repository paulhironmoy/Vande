# Launch blockers

Only external credentials, approvals or publishing actions may remain here. Each item names who must act and the exact
activation step. (Kept current as the build progresses.)

| Blocker | Owner action | Status |
| --- | --- | --- |
| Production web domain for invites and App Links | Choose a dedicated domain (not a shared `*.github.io` origin, which other sites on the account share and which cannot send headers); host `/.well-known/assetlinks.json`; build Android with `-PappLinksHost=<domain> -PappLinksBasePath=` (empty at the domain root) | Open |
| Web hosting with security headers | Serve the web app from that origin on a host that sends response headers (e.g. Cloudflare Pages or Workers static assets): `Content-Security-Policy` including `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options` (`public/_headers` lists them; GitHub Pages ignores that file, so `scripts/deploy-pages.mjs` is for previews only) | Open |
| Cloudflare account resources | Create D1, R2, Queues, Durable Objects, Rate Limiting namespaces and secrets; deploy the Worker | Open (deploy not authorised) |
| YouTube channel, OAuth client and quota extension | Create the channel and an OAuth client (server-side, offline access); store the refresh token as a secret; request a quota extension to about 250,000 units a day for 100 uploads plus headroom (the default allows about 5 uploads a day); procedure in `docs/YOUTUBE_OPERATIONS.md` | Open |
| YouTube API compliance audit | Pass the YouTube API Services audit; until it passes, API uploads from an unverified project are locked private, so the pipeline keeps running against the mock adapter | Open |
| Admin console access | Put `admin.html` and `/v1/admin/*` behind Cloudflare Access (team domain and audience in Worker config); `ADMIN_TOKEN` works outside production only | Open |
| Highlight render job | Deploy `render-service/` as a Cloud Run job with a scheduler; set `RENDER_KEYS` on both sides; create the `vande-media` queue and the R2 lifecycle rule for temporary MP4s | Open (deploy not authorised) |
| Daily Six secret | Set `DAILY_SALT_KEY` (Daily Six stays off, failing closed, without it) | Open |
| D1 migrations | Apply `backend/migrations/0001`–`0008` (and any later ones) to the production D1 database before the first Worker deploy, in order | Open (deploy not authorised) |
| Product analytics (optional) | Only if analytics is wanted: create the PostHog project (EU or US region), enable "Discard client IP data", then set `VITE_ANALYTICS_PROVIDER`, `VITE_POSTHOG_HOST`, `VITE_POSTHOG_KEY`; analytics stays off without them | Optional |
| Legal review: age policy and privacy notice | The app ships 18+ only (neutral age screen, server-enforced) as a conservative default under India's DPDP Act. A lawyer should confirm it, or design verifiable parental consent before admitting 13–17. Also review `privacy.html` (grievance contact, data locations) and decide on a Hindi translation of the policy | Open (owner and legal) |
| Operator name and support address | Set `VITE_OPERATOR_NAME` and `VITE_SUPPORT_EMAIL` for the web and Android builds (the privacy and deletion pages show them), and use the same address in Play Console | Open |
| Privacy and deletion pages hosted | Deploy the web build so `https://<domain>/privacy.html` and `https://<domain>/delete-account.html` are live; enter both in Play Console | Open (deploy not authorised) |
| Worker web origin | Set `PUBLIC_WEB_ORIGIN` in `backend/wrangler.toml` to the chosen domain (it is a placeholder) | Open |
| Physical Android measurements | Measure frame rate, first paint and memory on real low-, mid- and high-tier Android phones (only emulators and throttled desktop profiles were measured), and carry out Practice's physical-device test plan (docs/PRACTICE.md §9): timing fairness on real touchscreens, the 45 fps cutoff and tier choice, landscape lock, and an Android 9 (API 28) device, which no emulator image here covered | Open |
| Practice before the age screen | Practice opens from the launch choice with no account and no age question: it runs on the device, sends nothing, and analytics consent is never asked before onboarding. Include this in the legal review of the 18+ policy; if the reviewer wants Practice behind the age screen too, gate `onPractice` in src/App.tsx on the age answer | Open (owner and legal) |
| Firebase project for Android push | Create the project; add `google-services.json`; set the FCM server credential as a Worker secret | Open |
| Google sign-in client ids | Create web and Android OAuth client ids | Open |
| Google Play Console | Create the app `in.vande.cricket`, data-safety form, content rating, store listing, upload the AAB | Open (publishing not authorised) |
