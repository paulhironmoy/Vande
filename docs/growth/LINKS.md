# Links, App Links, the web fallback and sharing

> **Stage 4–6, not active: paths in this document refer to code that is not built.** The owner's product sequence
> keeps these stages closed; see [VANDE-PRODUCT-SEQUENCE.md](../VANDE-PRODUCT-SEQUENCE.md) and the
> [docs index](../README.md).

> **Status: Stage 4–6 design, not authorized for build.** Building waits for the stage gates in
> `docs/VANDE-PRODUCT-SEQUENCE.md`. Entry by a clean link or code is Stage 4. Link previews, share cards, clip links
> and invitation texts are Stage 6 (the not-now register puts "WhatsApp invitations and link previews" at 4 and 6).
> WhatsApp is never a database or a notification channel (Stage 4 prohibition).

## 1. URL formats (decision)

`<host>` is the web origin chosen in §3.

| Object | URL | Stage | What the path carries |
| --- | --- | --- | --- |
| Sealed Over challenge | `https://<host>/o/<code>` | 4 | 10 base32 characters (50 random bits). The server maps the code to the challenge id and an HMAC-signed invite token. |
| Group tournament | `https://<host>/g/<code>` | 6 | Same |
| Today's Over | `https://<host>/t`, or `https://<host>/t/<YYYY-MM-DD>` for a day's result card | 5 / 6 | The day only |
| Playable ball (clip) | `https://<host>/b/<code>` | 6 | `[a-z0-9]{8}` |
| Custom scheme | `vandecricket://o/<code>` and so on | 4 | For the install-referrer handoff only |
| Legacy (feature-flagged until retired) | `/i/`, `/m/`, `/c/`, `/h/`, `/s/` | — | Unchanged (`src/platform/deepLinks.ts`) |

Rules:
- **No authentication token, session, account id, alias or score in any URL.** The code is a public capability: it
  lets anyone see the preview and ask to join. Joining needs a session sent as a bearer header, never in the URL.
- **Short, and signed behind the scenes.** As with `invite_codes` today:
  - The code is random. The server stores it beside a compact signed token, which is re-verified on every use: a 38-byte payload with kind byte 3 = over and 4 = tournament, an `o` or `t` id, a 128-bit nonce and the expiry, plus a 16-byte HMAC from `TOKEN_KEYS` purpose `invite`.
  - If D1 cannot take the code, the link carries the 74-character token instead (`/o/<payload>.<mac>`), and it still works.
- **Forgery protection.** Guessing a live code means hitting one in 2^50 under per-network rate limits. Unknown,
  mistyped, forged, expired and revoked codes all get one identical answer (same status, body and work), so codes
  cannot be enumerated. Preview content always comes from the server; nothing in the URL is trusted.

Rejected alternatives:
- **Self-verifying tokens in every link.** About 75 characters, which is long in WhatsApp.
- **Sequential ids.** Enumerable.
- **Putting the target or name in the URL.** Forgeable, and private.

## 2. Key rotation (existing keyring)

**`TOKEN_KEYS` (`kid:base64url,…`; the first entry signs, every entry verifies):**
1. Prepend the new kid and deploy.
2. Remove the old kid only after the longest-lived invite it signed has expired: deadline (≤ 48 h) + reveal + 7 days for rematch links. In practice that is 10 days.

The compact invite token carries no kid, so verification tries every key in the ring. That is the existing `verifyInviteToken` behaviour.

**`SIGNING_KEY` (P-256, over-definition commitments):** put the new key and add the old public key to
`RETIRED_SIGNING_KEYS`. Old commitments stay verifiable at `GET /v1/keys`.

**`DATA_KEYS` (AES-GCM for definitions at rest):** prepend a new key. Never remove a key while a sealed definition that uses it is alive (the longest is a Today's Over sealed 14 days ahead).

## 3. Where the links and `assetlinks.json` can live (owner decision O1)

Facts, checked 2026-10-25 (sources in `README.md`):
- `assetlinks.json` must be at `https://<host>/.well-known/assetlinks.json`, at the **host root**. It must be served
  as `application/json` over HTTPS with **no redirects**, and any non-200 answer is an error.
- Android 12 and later verify each host separately. An unverified host opens in the browser.
- Android 14 and lower verify only the scheme and host; manifest paths still choose which URLs open the app.
- `github.io`, `workers.dev` and `pages.dev` are all on the Public Suffix List.
- `workers.dev` "is treated as a Free website", and zone WAF rules do not cover it (unverified). The Rate Limiting
  bindings still work there.
- Workers static-asset requests are free and unlimited.

| Option | App Links | Dynamic WhatsApp preview (per-challenge `og:` tags) | Security headers | Consequences |
| --- | --- | --- | --- | --- |
| **A. Buy a domain on Cloudflare (recommended before the first Play release)** | Yes | Yes (the Worker renders the HTML head) | Yes | Brand trust in previews. Zone WAF rules. One origin for app, API and links. About $10–30 a year (unverified estimate). Resolves four existing launch blockers. |
| B. `<name>.workers.dev`: the Worker serves `/.well-known/assetlinks.json`, the OG HTML and the app as static assets | Yes | Yes | Yes | No WAF on workers.dev (rate-limit bindings only). Link-reputation risk on a shared platform domain (unverified). Free. A good **pre-launch staging host**. |
| C. Cloudflare Pages `*.pages.dev` with Functions | Yes | Yes (Functions) | Yes (`_headers` honoured) | Same reputation caveat as B. Two products to operate. |
| D. GitHub Pages user site (`paulhironmoy.github.io` repository with `.well-known/` and `.nojekyll`) | Yes, for `/Vande/...` paths | **No**: static files only, so every link shows the same generic card | **No** (the existing launch blocker) | The origin is shared with all the owner's Pages sites, and the SPA fallback answers 404. Not recommended. |

**The App Links host is compiled into the APK** (`appLinksHost` / `appLinksBasePath` in `android/app/build.gradle`).
Changing it later strands old installs until they update. **Choose the final host before the first Play release.** If
a staging host is used first, keep it serving `assetlinks.json` and keep it in the intent filters for at least two releases.

Root will need these Android changes when Stage 4 opens:
- add `pathPrefix` entries `${appLinksBasePath}/o/`, `/g/`, `/b/` and `/t` to the `autoVerify` intent filter;
- update the release guard in `build.gradle`.

**Existing preview bug, found in this audit.** `index.html` uses a *relative* `og:image` (`%BASE_URL%og/og-card.png`)
and has no `og:url`. Meta's WhatsApp documentation requires a non-empty `og:url` and an absolute image URL, so
previews of today's links may be blank. Owner of the fix: root, at its stage.

## 4. Playable mobile-web fallback [S4]

The flow is: open the link, understand it in seconds, play, see the reveal, then rematch or share.

1. `GET https://<host>/o/<code>` returns **server-rendered HTML** of about 10 KB: the preview, with no JS needed to read it.
   - Text: "Arjun scored 18 off 6 · beat it to win · ties: fewer wickets, then whoever finished first · green pitch · right-arm fast · 6 balls, 2 wickets · ends 9:30 pm tomorrow".
   - The tie rule is disclosed before play (sequence doc, Stage 4). The deadline is a clock time, not a ticking countdown.
   - Two buttons: **Play now** (primary) and **Get the app**.
2. **Play now** loads the SPA route.
   - First the neutral age screen (18+, existing policy), then a silent guest sign-up (`POST /v1/auth/guest`).
   - Then the Practice stage chunks and the device check ("Preparing the pitch", about 1.4 s), then `join`, then the first `bowl`.
   - **Budget:** first delivery within 30 seconds of the link opening on 4G. Measured as in `ANALYTICS.md` §4, first playable delivery.
3. A device that is Below the cutoff plays **Classic** (2D, same physics), with the tier recorded.
4. Already a participant on this device? The link opens the challenge view (my attempt, or the reveal).
5. After the deadline:
   - **participants** see the reveal (signed in);
   - **anyone else** sees "This challenge has ended", with **Play this over for practice** (offline, unranked, nothing sent) and **Play Today's Over**;
   - nothing about the results is shown to non-participants.

## 5. Play Install Referrer and restoring the challenge after install [S4]

The **Get the app** link is `https://play.google.com/store/apps/details?id=in.vande.cricket&referrer=vc_o%3D<code>`.
- The referrer value is URL-encoded and must be ≤ 512 characters (stated on Google's Play Games page).
- It carries only the public challenge code. For tournaments it is `vc_g`, for clips `vc_b`.
- It extends `playStoreUrl()` and `parseInstallReferrer()` in `src/platform/installReferrer.ts`.

**On first launch:**
1. The `VandeInstallReferrer` plugin (already built) returns the referrer once. It is available for 90 days and changes only on reinstall.
2. The app turns it into `vandecricket://o/<code>` and opens the preview.
3. The player joins as a new app guest. Nothing is transferred, because nothing secret is needed.
4. The install is counted against the challenge (aggregate only, `POST /v1/attribution`-style counters).

**Not verified:** whether the referrer survives when WhatsApp's in-app browser opens the Play web page instead of the
Play app. A device test is needed (`BUILD_PLAN.md` test T-10). Firebase Dynamic Links shut down on 2025-08-25, and
there is no Google replacement for deferred deep links; App Links plus the referrer is the path.

## 6. Expired and revoked links, block and report, rate limits

- **Expired or ended:** handled as in §4, item 5.
- **Revoked:** the setter can revoke the link before anyone joins (`POST /v2/challenges/:id/revoke`). The preview then answers like an unknown code, and the challenge becomes `void`. After the first join the challenge cannot be cancelled: the initiator never blocks the reveal.
- **Block:**
  - Blocking the setter (`POST /v1/blocks/:playerId`) means their links show "not available" to you.
  - Their rematches, series games and nudges never reach you.
  - Joins between blocked players are refused with the neutral `not_available`.
- **Report:** `POST /v1/report` (abusive alias, cheating, other) feeds the existing admin report queue. A "Report" item is in every challenge and reveal menu.
- **Rate limits.** The existing bindings and caps are reused; the new daily caps are D1-fallback variables in `wrangler.toml`.

  | Action | Limit |
  | --- | --- |
  | Preview `GET /v2/c/:code` and the OG HTML | `RL_INVITE` (60 per minute per network; IPv6 /56) |
  | Join | 30 per player per day (`JOINS_PER_PLAYER_PER_DAY`) |
  | Challenge creation, rematches included | 40 per player per day (`CHALLENGES_PER_PLAYER_PER_DAY`) |
  | Claim-code redemption | 5 tries per 10 minutes per network |
  | Clip creation | 20 per day |
  | Global ceilings | Unchanged (`RL_GLOBAL_ANON`, `RL_GLOBAL`) |

## 7. WhatsApp link previews (Open Graph) [S6]

Requirements from Meta's WhatsApp link-preview page:
- `og:title`, `og:description` and `og:url` are required, non-empty, and inside `<head>`;
- `<head>` must fall within the first 300 KB of the HTML;
- the `og:image` URL must be absolute, the image under 600 KB, at least 300 px wide, with an aspect ratio of 4:1 or less;
- the crawler's user agent is `WhatsApp/2.x.x.x`.

**Approach (decision):**
- The Worker renders a tiny HTML head for `/o/<code>`, `/g/<code>`, `/b/<code>` and `/t/<day>`:
  - per-link `og:title`, for example "Arjun scored 18 off 6. Can you beat it?";
  - `og:description`, for example "Same six balls · Green pitch · Ends 9:30 pm Tue";
  - `og:url`;
  - `og:image` pointing at a **pre-rendered template image**. One per pitch (4) × bowler family (2) × locale (3) = 24 JPEGs of 1200 × 630 px, under 100 KB each, served as static assets (free).
- `cache-control: public, max-age=300`.
- Personal data in previews: only the setter's chosen alias and their own score, which the setter shares by tapping. Nothing about the recipients.

**Cost:**
- one Worker request per preview fetch. The preview is built on the sender's device, so this happens once per share, not per recipient;
- the images are free.

**Rejected alternatives:**
- **Per-challenge rendered images** (SVG → PNG in the Worker with resvg-wasm). A large WASM bundle, CPU per image, and storage, for little gain over text in `og:title`.
- **Cloudflare Images.** Paid, and unnecessary.

## 8. Web-to-Android continuation without tokens in URLs [S4]

- **Installed before playing** (the common path): §5. Nothing to transfer.
- **Played on the web, then installed the app:**
  - The browser shows **Continue in the app**, with a claim code (`XXXX-XXXX`: 40 bits, 10 minutes, single use, 5 tries per 10 minutes).
  - The player types it in the app's "Played in your browser?" screen.
  - Redeeming it moves the web guest's seats and rivalries into the app account (`POST /v2/claims/redeem`). It is a typed code, never part of a URL.
- **Durable alternative:** link Google on both (existing `POST /v1/auth/link/google`). Offered at the moments in `LIFECYCLE.md` §8.

## 9. Share texts: English, Hindi, Hinglish [S6, invitations S4]

Rules:
- Calm, no emoji, matching `src/platform/shareMoments.ts`.
- `{alias}` is the sharer's own alias; nothing about anyone else.
- Placeholders are filled by the app; clock times are shown in the recipient-neutral form "<weekday> <time> IST".

| Moment | English | Hindi | Hinglish |
| --- | --- | --- | --- |
| Invitation | `{alias} scored {runs} off 6 balls in VANDE Cricket. Same six balls for you: beat it to win. Ends {when}. {url}` | `{alias} ने VANDE Cricket में 6 गेंदों पर {runs} रन बनाए। वही छह गेंदें आपके लिए हैं: ज़्यादा रन बनाइए और जीतिए। {when} तक। {url}` | `{alias} ne VANDE Cricket mein 6 balls pe {runs} banaye. Wahi chhe balls tumhare liye: zyada banao aur jeeto. {when} tak. {url}` |
| Reminder (one, only if you have not played) | `Our VANDE Cricket over is waiting. If you haven't played yet, play by {when}. {url}` | `हमारा VANDE Cricket ओवर इंतज़ार कर रहा है। अगर आपने अभी तक नहीं खेला है, तो {when} तक खेल लें। {url}` | `Hamara VANDE Cricket over wait kar raha hai. Agar abhi tak nahi khela, to {when} tak khel lo. {url}` |
| Final result | `{winner} won our VANDE Cricket over, {score}. Rematch? {url}` | `{winner} ने हमारा VANDE Cricket ओवर जीता, {score}। फिर से? {url}` | `{winner} ne hamara VANDE Cricket over jeeta, {score}. Rematch? {url}` |
| Group invitation [S6] | `{alias} started {name}, a VANDE Cricket group of up to {n}. Join before {when}. {url}` | `{alias} ने {name} शुरू किया है, VANDE Cricket का एक ग्रुप जिसमें {n} तक खिलाड़ी हो सकते हैं। {when} से पहले जुड़ें। {url}` | `{alias} ne {name} start kiya hai, VANDE Cricket ka group, {n} tak players. {when} se pehle join karo. {url}` |
| Today's Over card [S6] | `Today's Over {day}: {runs} ({wickets} wkt). {strip} {url}` | `आज का ओवर {day}: {runs} ({wickets} विकेट)। {strip} {url}` | `Aaj ka Over {day}: {runs} ({wickets} wkt). {strip} {url}` |

- `{strip}` is the six outcomes as text (`1 · 4 · W · 0 · 6 · 2`): outcomes only, never the delivery types.
- The final-result text names other players only once the reveal has shown them to the sharer, and only by alias. It is shared only from that player's tap.
- **Translation status:** the Hindi and Hinglish strings are first drafts written by the architect and need a native review before Stage 6 (as in `src/i18n/STATUS.md`).

## 10. Sharing only on an explicit tap

- The share sheet (Capacitor Share, or `navigator.share`) or `https://wa.me/?text=` opens **only from a button the player tapped**.
- Nothing is sent automatically. Contacts are never read and no contact upload exists. The app never knows who received a link.
- **Server share cap** (`POST /v2/moments`, as today's `share_moments`), per player per scope:
  - a challenge: invite, reminder and final;
  - a tournament: invite, reveal and final (Stage 6: exactly three group-share moments).
- No automatic posting into WhatsApp groups, ever.
