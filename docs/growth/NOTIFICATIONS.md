# Notifications

> **Stage 4–6, not active: paths in this document refer to code that is not built.** The owner's product sequence
> keeps these stages closed; see [VANDE-PRODUCT-SEQUENCE.md](../VANDE-PRODUCT-SEQUENCE.md) and the
> [docs index](../README.md).

> **Status: Stage 4–6 design, not authorized for build.** Building waits for the stage gates in
> `docs/VANDE-PRODUCT-SEQUENCE.md`. The not-now register places notifications of any kind at Stages 5–6. Stage 4
> ships with **no pushes**: players learn of turns and reveals in the app and through links they shared themselves.

## 1. Principles

- **Event-driven only.** Every push is caused by a real event in a challenge, series or tournament the player joined, or a setting they turned on.
- **Default marketing frequency: zero.** There is no marketing kind at all.
- **No repeated countdown reminders.** At most one deadline reminder per player per scope, and only if they have not played.
- **Group activity is digested.** Never one push per event.
- **No WhatsApp notifications.** The app never sends WhatsApp messages; only the player's own tap opens the share sheet.
- **Reuse `backend/src/ops/notifyPolicy.ts`** and the notify queue, the FCM adapter and the dead-letter handling, extended as below.

## 2. Kinds

| Kind | Trigger | Important? | Limit |
| --- | --- | --- | --- |
| `your_turn` | A rival's rematch or series game, or a tournament round opening, for a player already in the app. Never for WhatsApp invitees. | Yes | 1 per scope |
| `reveal_ready` | The challenge or round revealed, at its reveal slot | Yes | 1 per scope |
| `rematch_requested` | The rival asked for a rematch | Routine | 1 per offer |
| `series_game` | The next series game is waiting (the rival set it) | Routine | 1 per game |
| `tournament_closing` | 2 h before a round's deadline, only to joined members who have not played | Important | **1 per round** |
| `tournament_digest` | At most one a day, at the player's digest hour: "3 friends played today in Office Cup" | Routine | 1 per day across all tournaments |
| `nudge` | A member's private reminder (`LIFECYCLE.md` §4) | Routine | 1 per round per target, 1 per day per sender |
| `cricket_moment` | An opt-in Today's Over scenario note | Routine, **off by default** | At most 1 a week |
| Coach Ball reminder | A **local** notification, on the device, opt-in, off by default, at the time the player chose | — | 1 a day; never from the server, which knows nothing about weaknesses (owner decision O8: needs the local-notifications plugin) |

## 3. Policy

These extend `notifyPolicy.ts`. They are applied in the queue consumer to every message, in this order:
1. Global opt-out, then the per-kind toggles (`NotifyPrefsV2.kinds`).
2. Block list: nothing from a blocked player's actions, nudges included.
3. **Quiet hours in the player's own timezone.** Today the policy is IST-only (`istMinuteOfDay`). V2 uses the IANA zone the device reports (`timeZone`), with a default of 22:00–08:00 local.
   - Routine pushes are dropped.
   - Important ones are held until the quiet hours end, at most 12 h. If they would arrive after the scope's deadline, they are dropped.
4. **Caps** per local day:
   - routine: 2;
   - total: 4.
   
   Today's caps are 4 routine and 8 total; the new defaults are tighter.
5. Collapse keys are per scope and kind and never carry the account id (existing rule).

## 4. Asking for permission

- **Never at first launch, and never before value.**
- **The first ask** comes after the player has **created their first challenge** or **seen their first reveal**, in context: "Get a note when Arjun has played and the reveal is ready?"
  - **Yes** opens Android's runtime dialog (`POST_NOTIFICATIONS`, API 33+).
  - **Not now** means no system dialog.
- **Ask once.** After a "Not now" or a system denial, the only way back is Settings → Notifications. There are no repeated prompts. Android stops showing the dialog after denials, and the app respects that rather than working around it.
- **Web:** no push in Stages 5–6. The web fallback relies on the player returning to the link.

## 5. Granular controls

Settings → Notifications offers:
- **All notifications** (on or off);
- quiet hours;
- per kind: **Your turn**, **Reveals**, **Rematches and series**, **Group reminders**, **Group digest** (with its hour), **Nudges from group members**, **Cricket moments** (off), **Coach Ball reminder** (off, local).

The settings sync to the server (`/v2/notify`) and apply on every device.

## 6. Measuring disables and uninstalls

All of these are aggregate only, with no ids (Analytics Engine counters; `ANALYTICS.md` §1).

- **Permission state on every app open** (granted, denied, or disabled at the system level), counted against the push volume the device received in the last 7 days, in buckets of 0, 1–2, 3–5 and 6+. The device keeps its own received-push count locally.
- **In-app toggles turned off,** counted by kind.
- **Uninstall proxy.** FCM answering `UNREGISTERED` for a token means the app was uninstalled or its data cleared. The consumer counts it with the **kind of the last push sent to that token**, which is stored hashed with the token row and deleted with it.

**Dashboard** (in the admin console):
- disable rate and uninstall proxy per 1,000 pushes, by kind;
- pushes per active player per week.

**Alerts:**
- the weekly disable rate goes above 5%;
- any kind's uninstall proxy goes above twice the average.
