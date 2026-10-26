# Store listing (Google Play)

Draft copy and form answers for the Play Console. Every claim here has to stay true of the shipped build. Re-check
it against `docs/PRIVACY_AND_CONSENT.md`, `docs/GAME_RULES.md` and the release notes before each submission. Nothing
here mentions prizes, rewards for money, real players, teams, leagues or broadcasters. VANDE Cricket is independent
and uses no official cricket marks.

## Main listing

**App name** (25/30): VANDE Cricket: Sealed Six

**Short description** (77/80): Lock your over. Reveal the rivalry. One-over cricket duels with your friends.

**Full description**

> Cricket rivalry, one over at a time.
>
> In VANDE Cricket you and a friend each plan a secret over (six deliveries plus a Super Ball) and seal it. Then you
> bat against each other's plan. Nobody sees a run, a wicket or the other plan until both innings are done. Then
> comes the reveal.
>
> **Plan like a captain.** Choose yorkers, bouncers, slower balls, swing and spin. Set your field and spend a limited
> energy budget across the over. Read the pitch, green, hard or slow, and set traps.
>
> **Bat on instinct.** Time your shot with one tap and pick your gap with a swipe. Defend, rotate, drive, cut, sweep
> or go big. You only feel the contact; the scoreboard stays sealed.
>
> **The reveal.** Watch both overs play out ball by ball in a cinematic replay. See the turning point, the Player of
> the Match and exactly why each ball went the way it did.
>
> **Play your way:**
> • Training: learn bowling and batting in a few minutes.
> • Daily Six: three attempts a day at the same sealed over everyone faces.
> • Friend Duel: send a link on WhatsApp; your friend can play in the browser without installing.
> • Group Cup: 3–10 friends, with fixtures, a table and a final, and nobody has to be online at the same time.
> • Practice Ghosts: play original AI rivals with their own styles, even offline.
> • Cricket Rooms: reactions and quick banter for every rivalry, spoiler-free.
>
> **Fair by design.** Every over is sealed with a cryptographic commitment before batting starts, and every result is
> worked out on the server by a published, deterministic rules engine. Spending money can never buy a better
> batter, a better bowler, a result or a leaderboard place.
>
> **Made for India.** Available in English, हिन्दी and Hinglish (more Indian languages coming). It is light on data,
> works on everyday phones, and has a 2D mode for low-end devices.
>
> Play as a guest with just a nickname: no real name, no contacts and no location needed. For players aged 18 and over.

**Category**: Games → Sports. **Tags**: Cricket, Sports, Strategy, Casual, Multiplayer.
**Contact**: a support email and website chosen by the owner (not in this repository).
**Privacy policy URL**: `https://<domain>/privacy.html` (built from `privacy.html`; linked in the app's Settings and first run).
**Account deletion URL** (Data safety): `https://<domain>/delete-account.html` (`delete-account.html`: in-app deletion, recovery for linked accounts, and a request path for guest accounts).

## Graphics

| Asset | Spec | Source |
| --- | --- | --- |
| App icon | 512×512 PNG, 32-bit | `public/icons/icon-512.png` |
| Feature graphic | 1024×500 PNG/JPG, no essential text near edges | `store-assets/feature-graphic.png` |
| Phone screenshots | 1080×1920 (9:16), 4–8 | Training, planner, batting, reveal, Group Cup table, Cricket Room, Daily Six; captured from the release build, localized sets for `hi` later |
| Short video (optional) | YouTube URL | an official highlight, only once publishing is live |

Screenshots must show real gameplay from the build, with no mock-up devices that misrepresent the UI. The Top 100
YouTube programme can be described only after the channel and quota are approved.

## Data safety (draft answers, verify against PRIVACY_AND_CONSENT.md)

* **Data collected**
  * Personal info → *Name*: the player's nickname (alias). Required for multiplayer; a generated default is offered.
    Purpose: app functionality. Shown to opponents, group members and, only with explicit consent, in official
    highlights.
  * Personal info → *Other info*: optional self-declared city, college and company groups (leaderboards). No
    device location is used.
  * App activity → *In-app actions*: matches, plans and inputs (needed to compute results), reactions and preset banter.
  * Device or other IDs: push token (only after the player turns notifications on; Firebase auto-init is off until then).
  * User IDs: the random player id the game assigns (no email or phone), used for the account and leaderboards.
  * App activity → *App interactions* (analytics): **only with opt-in consent** and when analytics is configured. It uses
    a random identifier that rotates monthly and is never linked to the account.
  * Account: an optional Google sign-in link for recovery (verified server-side; see PRIVACY_AND_CONSENT.md for
    exactly what is stored).
* **Not collected**: contacts, precise or approximate device location, photos or files, messages, financial info,
  health, web history.
* **Sharing**: none with third parties for advertising or analytics brokers. Official YouTube highlights publish
  the alias and match replay only after every participant gives explicit consent, and it can be withdrawn.
* **Security**: encrypted in transit (HTTPS). Sealed plans are encrypted at rest.
* **Deletion**: in-app *Delete my account* removes the account and its personal data at once; the web page
  `delete-account.html` explains it and gives a request path for players who lost their device.

## Content rating (IARC questionnaire, expected answers)

* Violence, fear, sexuality, language, controlled substances: none.
* Gambling or simulated gambling: none. No loot boxes, no real-money or prize play.
* User interaction: yes. Players interact through preset banter phrases and reactions. Free-text room chat is
  off at launch. There is reporting and blocking.
* Shares user location: no. Digital purchases: none at launch.

## Target audience and ads

* Target age group **18+ only** (a neutral year-of-birth screen at first run; the server refuses accounts without the
  18+ confirmation). This is a conservative default under India's DPDP Act pending the owner's legal review
  (`docs/LAUNCH_BLOCKERS.md`). Not in the Families programme. Highlight consent repeats the 18+ confirmation.
* Contains ads: **No** (the ads adapter is disabled and never interrupts an innings if enabled later).
* In-app purchases: **No** at launch (cosmetic-only billing is built but disabled).
