# VANDE growth architecture: the physics Sealed Over and what follows it

> **Stage 4–6, not active: paths in this document refer to code that is not built.** The owner's product sequence
> keeps these stages closed; see [VANDE-PRODUCT-SEQUENCE.md](../VANDE-PRODUCT-SEQUENCE.md) and the
> [docs index](../README.md).

> **Status: Stage 4–6 design, not authorized for build.**
>
> The owner's product sequence (`docs/VANDE-PRODUCT-SEQUENCE.md`, adopted 2026-10-26) puts:
> - asynchronous competition at **Stage 4**;
> - the daily ritual at **Stage 5**;
> - social growth at **Stage 6**.
>
> **All three are CLOSED.** No part of this design may be built, started or advanced until its stage opens, and each
> stage opens only when the one before it passes its exit gate with reproducible evidence. Building waits for those
> stage gates. Ideas from here enter the not-now register (§9 of the sequence) only through the lead.
>
> Written by the growth architect on 2026-10-25/26 from:
> - the brief `docs/prompts/VANDE-GROWTH-BRIEF.md`;
> - the owner's decisions "Physics Sealed Over" and "Practice first";
> - an audit of the working tree at `cricket-rebuild`, 38924bd plus uncommitted Practice work.

## Files

| File | Contents | Stages |
| --- | --- | --- |
| [CONTRACTS.md](CONTRACTS.md) | Proposed TypeScript: integer wire format, over definition, commitment, attempts, verdicts, reveal, Today's Over, rivalries, series, tournaments, clips, home action, rhythm, flags, `/v2` routes, ids, versioning rules | 4–6 |
| [VERIFICATION.md](VERIFICATION.md) | Determinism audit, authoritative model, golden vectors, ranked fairness policy, **measured CPU**, anti-cheat | 4 |
| [LINKS.md](LINKS.md) | URL formats, keys, App Links hosting options, web fallback, install referrer, previews, share texts (EN, HI, Hinglish) | 4, 6 |
| [LIFECYCLE.md](LIFECYCLE.md) | State machines and reveal rules: Sealed Over, rivalries and series, Today's Over, tournaments, highlights, rhythm, Coach Ball, identity, home action | 4–6 |
| [NOTIFICATIONS.md](NOTIFICATIONS.md) | Kinds, caps, quiet hours, permission timing, controls, disable and uninstall measurement | 5–6 |
| [BACKEND.md](BACKEND.md) | Durable Objects, D1 tables, API properties, operations, retention, deletion, **cost bands** | 4–6 |
| [ANALYTICS.md](ANALYTICS.md) | Taxonomy, anonymous counters, six funnels, dashboards, how every gate is computed | 4–6 |
| [MIGRATION.md](MIGRATION.md) | What each Sealed Six module becomes, flags, data migration (none on the server), deletion only after proof | 4 |
| [BUILD_PLAN.md](BUILD_PLAN.md) | Phases per stage, agent roster and file ownership, the brief's tests mapped, definition of done, independent evaluation | 4–6 |

## Key decisions

1. **Server-authoritative re-simulation.**
   - The Durable Object that owns an attempt re-simulates each submitted swing with the pinned physics. Its verdict is official.
   - The client resolves the same ball locally for instant feedback, and reconciles per ball.
2. **Per-ball delivery streaming with commit–reveal.**
   - Ball *i + 1*'s definition is released only after ball *i* is answered.
   - A signed commitment to the whole over comes at the start; the definition and salt come after the attempt.
3. **Integers only** for every number that reaches the physics or a hash.
4. **No new math library.**
   - `src/physics/vec.ts` already provides deterministic trigonometry, exp and log.
   - Equality is proven by golden vectors in Node, Chromium, WebKit, Firefox, Android WebView and workerd.
   - In the field, per-ball flight digests and a per-session self-test catch any engine that differs.
5. **Ranked fairness policy** (O2):
   - assistance pinned per challenge (default Play);
   - **zero device allowance in ranked**;
   - **mirror-fair handedness**: left-handers face the exact mirror image, which is bit-identical in the striker frame;
   - Super Over rules (6 balls, 2 wickets);
   - tie rule shown before play: runs, then wickets, then completion order. Completion times are never shown.
6. **Lifecycle:**
   - fixed 6/12/24/48 h deadlines, with no extension;
   - seats-based early reveal at a 5-minute slot, otherwise at the deadline + 2 min;
   - the initiator cannot cancel after the first join;
   - never-joined players do not count; joined players who do not finish are DNP;
   - late play is offline practice only;
   - rematch with the same or a new over.
7. **Links** are `/o/<code>` (50-bit, server-resolved, HMAC-backed) with no tokens in URLs. Web-to-app continuation uses the Play referrer (a public code) or a typed claim code.
8. **Today's Over [S5]:**
   - curated offline with a physics story validator;
   - sealed ahead with a signed commitment;
   - one ranked attempt via a day-and-player-derived attempt id;
   - boards behind privacy thresholds;
   - clock-time resets, never countdowns.
9. **Tournaments [S6]:** everyone bats the same over each round (a league with pairwise points, or a knockout of 1v1 ties), with exactly three share moments.
10. **Playable highlights [S6]:** rendered on the device (WebCodecs MP4, $0 server), plus `/b/` exact-ball links. Server rendering only for the opt-in publishing programme.
11. **Personal Coach Ball [S5]:** on the device only, chosen from local FormSamples and records, with evidence thresholds before any "improved from X% to Y%".
12. **Analytics:**
    - social-loop funnels from server aggregates;
    - gates for Practice and retention from **anonymous once-per-install counters** (O4);
    - PostHog stays opt-in.
13. **Backend:**
    - `OverDO` (challenge and Today modes), with `TournamentDO` from the CupDO patterns;
    - D1 for lists, boards and rivalries;
    - **no timers in Durable Objects** (duration billing).
14. **Migration:**
    - nothing is deployed on the server, so there is no data migration;
    - v2 is built beside v1 behind flags;
    - the Sealed Six engine, screens and backend are retired only after a proof list;
    - `prng`, `sha256` and `canonicalJson` are kept.

## Measured: simulation CPU per over

Re-simulating one full over (6 flights + 6 resolutions + the result), as process CPU time:

| Case | CPU |
| --- | --- |
| Warm, median (min 10.5, p95 26.3, max 39.6) | **15.4 ms** |
| Cold, first over in a fresh process | **117–149 ms** |
| Interpreter only (`--jitless`) | 169–221 ms |
| Resolves only, with flights cached | 6.5 ms |

**Conditions:**
- Apple M1 Pro (8P + 2E), 32 GB, Node v26.0.0;
- load average 120–165 (heavily loaded), so the figures are pessimistic;
- working tree at `PRACTICE_SIM_VERSION` 1, shot geometry partly landed.

**Platform limits:**
- 30 s CPU by default per Worker request, DO request or Queue consumer (Workers Paid); the free plan's 10 ms is not enough.
- Verifier bundle: 24.8 KB gzip.

Details in `VERIFICATION.md` §6. **Re-measure when version 2 lands.**

## Cost bands (estimates, `BACKEND.md` §6)

| MAU | 1,000 | 10,000 | 100,000 | 1,000,000 |
| --- | --- | --- | --- | --- |
| Monthly cost at DAU/MAU 0.3 (0.2) | ≈ $5 ($5) | ≈ $5.20 ($5.10) | ≈ $15 ($11) | ≈ $610 ($370) |

At 1M MAU the largest lines are DO rows written, D1 rows written and Worker requests. D1 needs sharding from about 300k MAU (size and write rate).

## Owner decisions needed

Each has options; the recommendation is in bold.

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| O1 | Web host for links and App Links | (a) Buy a domain on Cloudflare; (b) a `workers.dev` host; (c) `pages.dev`; (d) GitHub Pages user site | **(a), before the first Play release.** The App Links host is compiled into the APK. Use (b) only as staging. (d) cannot do per-link previews or security headers. |
| O2 | Ranked fairness | Device allowance: (a) zero in ranked; (b) the declared allowance, latched and shown; (c) Real-only ranked. Handedness: mirror-fair, or the same real bowler. | **(a) with Play pinned per challenge, plus mirror-fair.** Binding policy §7 still governs Practice. |
| O3 | Today's Over reset | (a) A global IST day, reset 00:00 IST, shown in local time; (b) local midnight per player; (c) UTC | **(a)** for an India-first launch. Revisit if more than 15% of daily players are outside UTC+4…+7. |
| O4 | Anonymous milestone counters | (a) On by default, disclosed, with a Settings switch, honouring DNT/GPC; (b) opt-in only (today); (c) server aggregates only | **(a), after a legal review.** Without it, the Practice and retention gates are measured on a biased subset. |
| O5 | Age and legal | 18+ for networked play; Practice before the age screen; a parental-consent design later | **Keep 18+** (DPDP s.9; its obligations commence May 2027). The Practice question stays with the existing open item. Update the privacy notice for the new data. |
| O6 | Challenge format | (a) Super Over (6 balls, 2 wickets); (b) one wicket ends it; (c) unlimited wickets with a penalty | **(a)** |
| O7 | Legacy features | Retire Cricket Rooms, Elo ratings, the Daily Top 100 and Daily Six, or keep them dormant | **Retire after Stage 4** (`MIGRATION.md` §4). Keep the YouTube pipeline dormant for opt-in publishing. |
| O8 | New dependencies when their stages open | An MP4 muxer for clips (Stage 6); `@capacitor/local-notifications` for the Coach Ball reminder (Stage 5) | **Approve the muxer at Stage 6. Skip local notifications** unless playtests ask for them. |
| O9 | Play Integrity | Now, later, or never | **Not now:** the web fallback cannot use it. Reconsider only for prize competitions, which are not planned. |
| O10 | Privacy defaults | Aliases on public boards; others' aliases in clips | **Both off by default (opt-in).** |
| O11 | Budget alerts | Thresholds | **Keep $25, $50 and $100, and add per-product usage alerts.** |

## Open questions for the build (not owner decisions)

| # | Question |
| --- | --- |
| Q1 | Is `BALL_LIVE_MS` (20 s) right on real Indian networks? Measure in Stage 4. |
| Q2 | Calibrate the story-validator thresholds (Stage 5). |
| Q3 | When and how to shard D1. |
| Q4 | Is WebCodecs H.264 available in Android 9–11 WebViews? Stage 6 device test. |
| Q5 | Does the Play referrer survive the WhatsApp in-app browser? (T-10) |
| Q6 | Do desktop keyboard and mouse have an advantage? Measure before splitting boards. |
| Q7 | Re-run the determinism scan and the CPU bench after `PRACTICE_SIM_VERSION` 2 lands. |
| Q8 | The ranked-session adapter interface, agreed with the Practice owners (assumption A8). |
| Q9 | Can Stage 3's chase UI carry the Sealed Over chase? The sequence requires reusing the proven batting system. |

## Biggest risks

| # | Risk |
| --- | --- |
| R1 | **Bots cannot be prevented** in a client-rendered reaction game: the client must know the ball to draw it. Only statistical flags (`VERIFICATION.md` §7.2) and the hold-and-review process exist. |
| R2 | **Version skew.** Android APKs freeze physics at install. Mitigations: multi-version bundles, refusal with "play in the browser", and the 95% support rule before a new version becomes current. |
| R3 | **Undiscovered cross-engine differences** while physics is still changing (shot geometry). Mitigations: golden vectors in five engines, flight digests and the runtime self-test. |
| R4 | **D1 limits at about 1M MAU** (10 GB, write rate) without sharding. |
| R5 | **Durable Object duration billing** if any object holds timers or connections: about $2,150 a month at 1M MAU. `docs/COST_MODEL.md` omits duration today. |
| R6 | **The App Links host baked into the APK.** Choosing the domain late strands links. |
| R7 | **WhatsApp previews.** Today `index.html` has a relative `og:image` and no `og:url`, so previews may be blank. The Meta docs do not cover caching or formats (unverified). |
| R8 | **A network round trip per ball** in ranked play on weak connections (hidden behind the run-up, but untested on real networks). |
| R9 | **Measurement.** With opt-in analytics only (O4b), the gates cannot be measured reliably. |
| R10 | **Moving ground.** Nine agents are changing Practice; contract assumptions A1–A8 must be re-checked when Stage 4 opens. |

## Audit findings worth acting on, each at its own stage

- `docs/COST_MODEL.md` has no line for Durable Object duration.
- `index.html`: the `og:image` is relative and `og:url` is missing.
- `backend/src/ops/notifyPolicy.ts` handles quiet hours in IST only.
- `generateOver` keys its RNG by sim version, so definitions must be stored, never regenerated.
- The device allowance comes from a client-cached assessment and cannot be trusted in ranked play.
- There is no cross-engine golden test and no scan for approximated `Math` calls.
- CI installs only Chromium.

## Sources

Checked 2026-10-25. The dates are each page's last-updated stamp.

**Cloudflare:**
- Workers limits, Oct 12 2026: https://developers.cloudflare.com/workers/platform/limits/
- Workers pricing, Oct 2 2026: https://developers.cloudflare.com/workers/platform/pricing/
- Durable Objects limits, Jun 1 2026: https://developers.cloudflare.com/durable-objects/platform/limits/
- Durable Objects pricing, Oct 18 2026: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Durable Object lifecycle, Oct 15 2026: https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- D1 pricing, Apr 21 2026: https://developers.cloudflare.com/d1/platform/pricing/
- D1 limits, Oct 24 2026: https://developers.cloudflare.com/d1/platform/limits/
- Queues pricing and limits, Apr 21 2026: https://developers.cloudflare.com/queues/platform/pricing/ and https://developers.cloudflare.com/queues/platform/limits/
- R2 pricing, Oct 1 2026: https://developers.cloudflare.com/r2/pricing/
- Analytics Engine pricing, Apr 23 2026: https://developers.cloudflare.com/analytics/analytics-engine/pricing/
- Workers Logs, Oct 12 2026: https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- Observability pricing, Oct 25 2026: https://developers.cloudflare.com/observability/pricing/
- Static assets billing, Apr 23 2026: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Routing (workers.dev is a Free website), Apr 23 2026: https://developers.cloudflare.com/workers/configuration/routing/
- Public Suffix List, version 2026-10-22: https://publicsuffix.org/list/public_suffix_list.dat

**Android and Google:**
- App Links: configure-assetlinks, add-applinks, verify-applinks, about, and the Android 12 behaviour changes, all 2026-10-23, under https://developer.android.com/training/app-links/
- Digital Asset Links, 2025-08-28: https://developers.google.com/digital-asset-links/v1/getting-started
- Install Referrer library, 2026-10-23: https://developer.android.com/google/play/installreferrer/library
- Install Referrer API, 2026-02-26
- Play Games user acquisition (the 512-character referrer limit), 2026-10-23
- Firebase Dynamic Links FAQ (shut down 2025-08-25), 2026-10-22: https://firebase.google.com/support/dynamic-links-faq
- Play Integrity overview (2026-04-20), setup (2026-10-16), verdicts (2026-10-23) and standard requests (2026-10-23), under https://developer.android.com/google/play/integrity/
- Notification permission, 2026-10-23: https://developer.android.com/develop/ui/views/notifications/notification-permission

**WhatsApp:** link previews (Meta, no date): https://developers.facebook.com/docs/whatsapp/link-previews/

**DPDP:**
- The Act (Gazette copy, 11 Aug 2023), via PRS India.
- Rules notified on 13 Nov 2025: the Digital India page (updated Oct 23 2026) and the PIB backgrounder (17 Nov 2025).

**Unverified:**
- WAF coverage and link reputation on workers.dev;
- whether the referrer survives the WhatsApp in-app browser;
- WhatsApp image formats and caching;
- domain prices;
- the DPDP Rules text, read from an unofficial copy (the official PDF could not be fetched).
