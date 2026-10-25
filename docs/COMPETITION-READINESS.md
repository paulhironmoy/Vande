# Competition readiness: prizes, giveaways and public leaderboards

**Status: nothing prize-related is built.** No prizes, giveaways, cash, public leaderboards or public rankings of
Helper, Challenger or Insight points exist in the app or the backend. This page lists what must be true before any of
them is added. It is a planning checklist, not legal or tax advice.

## Decision summary

Keep the learning game prize-free, especially for children. If competitions are wanted later, run them as a separate,
adults-only league with free entry, published rules and skill-based prizes decided by server-verified results. Start
with recognition, not money, and take Indian legal and tax advice before anything with monetary value.

## Legal and tax

- **No money in, ever.** India's 2025 online gaming law bans real-money online games. Any entry fee, purchase or stake
  tied to a prize can put a game in that category. Prize play must be free, with no purchase necessary.
- **Skill, not chance.** Random-draw giveaways can count as lotteries. Lotteries and prize competitions are regulated
  by individual states, some more strictly than others. Prizes awarded for skill, with free entry, are the safer shape.
- **Tax.** Prizes above ₹10,000 attract tax deducted at source (TDS) under income-tax law, including prizes in kind.
  That means collecting winners' PAN, depositing the tax and keeping records for years.
- **Personal data.** Delivering a prize needs names, phone numbers, addresses and PAN. That breaks the app's
  "no accounts, no personal data" promise and brings in the Digital Personal Data Protection Act: notice, consent,
  purpose limits, retention limits and a grievance contact.
- **Children.** Under the data protection law, people under 18 need verifiable parental consent, and their behaviour
  must not be tracked or monitored. Minors cannot accept contest terms. Children plus cash prizes draws regulators.
- **Honest urgency.** The consumer regulator's dark-pattern rules ban false urgency and nagging. Real midnight
  deadlines are fine; anything exaggerated is not.
- **Store and advertising rules.** Google Play has contest and families policies. Advertising standards (ASCI) expect
  published official rules covering eligibility, how winners are chosen, dates and the sponsor.

## Integrity: prizes make cheating worth it

- **Scores are self-reported.** The device computes every score, so it can be forged with a little effort. Prize
  scores need the server to replay each submitted move log through the deterministic engine and check the score.
  `src/lite/replay.ts` already replays Lite paths purely, with a parity test against the store; nothing on the server
  does this yet.
- **All content ships in the app.** All 30 daily crises are in the bundle, so anyone can read future days today. A
  prize day needs its content released by the server at unlock time.
- **Solutions spread.** Everyone gets the same puzzle, so bots can find the best path offline, early players can post
  it in group chats, and top scores will tie. Breaking ties by speed hurts accessibility; breaking them by chance turns
  the contest into a lottery.
- **Many installs, many entries.** The app is anonymous, so giveaways invite multi-accounting. Stopping it needs
  identity checks or device attestation (Play Integrity), which works against the privacy stance.
- **Friend points are local.** Helper and Challenger points live on the device, and reply links carry only a checksum.
  They need server-graded, signed replies (the verified-dares design in `docs/LITE-INCENTIVES.md`) before they can
  count for anything. The twist answer key also ships in the app for offline play.
- **Outages.** An outage during a prize window becomes a fairness dispute and a support load.

## Guessing and the "why was this best?" gate (not built)

Insight points carry no penalty for a wrong answer. A pure guesser gets a four-option question right one time in
four, so five Boss questions in a row comes up about once in 1,024 tries. Across 10,000 players, about ten will guess
their way level with real experts.

The fix for any prize use is a one-tap "why was this best?" question after each answer: Insight counts toward a prize
only when the reason is right too. That cuts lucky guessers to almost none. It is not built, and prize scores would
also need the server replay above.

## Product risks

- **Prizes can crowd out learning.** Players stop asking why a move is right and start memorising. Prize-hunters
  churn when prizes stop, which distorts retention data.
- **Disputes over the "best" civic answer.** The content rules say no single ideology is correct. Once money rides on
  the best move, players will challenge it, so content review and an appeals process are needed.
- **Unequal footing.** Simple and Full modes, poor connectivity and English-only play all affect who can realistically
  win.
- **Perception.** A civic game handing out prizes near elections can look like influence or a government scheme.
  Sponsor transparency matters.
- **It costs more than the prizes.** Fulfilment, UPI payouts with identity checks, tax filings, fraud review, terms of
  service and a grievance officer usually cost more than the prizes themselves.

## Recommendation

1. Keep the learning game prize-free for children.
2. Run any contest as a separate, adults-only league with free entry and published rules. Award prizes for skill,
   decided by server-verified replays of daily content the server releases at unlock time, with identity checks only
   for winners.
3. Start with recognition prizes, such as certificates or featured names with consent, before any cash.
4. Take Indian legal and tax advice before launching anything with monetary value.

## Checklist before any prize, giveaway or public leaderboard

Every box must be ticked first. If any box cannot be ticked, the competition does not launch.

- [ ] Written Indian legal advice on the format: skill versus chance, the online gaming law, and state rules.
- [ ] Written tax advice and a process for TDS, PAN collection, deposits and record keeping.
- [ ] Adults only: an age gate and terms that minors cannot accept; the children's learning game stays prize-free.
- [ ] Free entry, no purchase necessary, and no link between spending and winning.
- [ ] Official rules published: eligibility, how winners are chosen, tie-breaks, dates, sponsor, and complaints.
- [ ] Privacy notice and data-protection review for winner data: what is collected, why, for how long, and who to
      contact; `docs/PRIVACY.md` updated before any new data flow.
- [ ] A named grievance contact and an appeals process for disputed "best" answers.
- [ ] Prize-day content released by the server at unlock time, not shipped in the app.
- [ ] Server replay verification of every prize score through the deterministic engine.
- [ ] Verified dares switched on and signature checks working before Helper or Challenger points count for anything.
- [ ] The "why was this best?" gate built for any prize use of Insight points.
- [ ] A multi-account policy, with identity checks only for winners.
- [ ] A tie-break rule that neither punishes accessibility settings nor becomes a lottery.
- [ ] An outage and dispute policy for the prize window.
- [ ] Sponsor disclosure, and a review of timing near elections.
- [ ] A budget covering fulfilment, payouts, tax filing, fraud review and support, not only the prizes.
- [ ] Google Play contest and families policy review, and ASCI-style rules review.
- [ ] A kill switch and rollback plan for the competition, separate from the game.
