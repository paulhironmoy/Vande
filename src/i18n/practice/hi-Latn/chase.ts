/**
 * Practice copy, Hinglish (tum register, Latin script): Target Chase. Mirrors ../en/chase.ts key for key.
 * AI-authored, native-speaker review recommended (listed in the COPY review sheet). Cricket words stay English.
 */
export const chaseHiLatn: Record<string, string> = {
  // ---- the Practice home
  'practice.chase.home.title': 'Chase',
  'practice.chase.home.sub': '{balls} balls mein target paao. Bas ek wicket.',
  'practice.chase.home.resume_title': 'Chase chal raha hai',
  'practice.chase.home.resume_body': '{balls, plural, one {# ball} other {# balls}} mein {runs} chahiye',
  'practice.chase.home.new_confirm_body': 'Isse tumhara chase khatam hoga. Result save nahi hoga.',

  // ---- the setup card before ball 1
  'practice.chase.setup.title': 'Chase',
  'practice.chase.setup.rules': '{overs, plural, one {# over} other {# overs}}, ek wicket. Jeetne ke liye target paao.',
  'practice.chase.setup.target': 'Target {target}',
  'practice.chase.setup.fixed': 'Target pehli ball se pehle tay hota hai aur kabhi nahi badalta.',
  'practice.chase.setup.no_practice':
    'Chase mein “Yeh ball practice karo” band hai. Baad mein deciding ball practice karo.',
  'practice.chase.setup.level': 'Difficulty: {level}',
  'practice.chase.level.easy': 'Easy',
  'practice.chase.level.standard': 'Standard',
  'practice.chase.level.hard': 'Hard',

  // ---- the rail during play
  'practice.chase.need': '{balls, plural, one {# ball} other {# balls}} mein {runs} chahiye',
  'practice.chase.need_short': '{balls, plural, one {# ball} other {# balls}} mein {runs}',
  'practice.chase.rate': '{rate} per over',
  'practice.chase.hud_label':
    'Chase. {balls, plural, one {# ball} other {# balls}} mein {runs, plural, one {# run} other {# runs}} chahiye. Zaroori rate: har over {rate} run.',
  'practice.chase.status': 'Chase',
  'practice.chase.ball_of': 'Ball {n} / {total}',

  // ---- polite screen-reader announcements
  'practice.chase.announce_start': 'Chase. {balls, plural, one {# ball} other {# balls}} mein {runs} chahiye.',
  'practice.chase.announce': '{balls, plural, one {# ball} other {# balls}} mein {runs} chahiye.',
  'practice.chase.announce_last': 'Aakhri ball. Jeetne ke liye {runs, plural, one {# run} other {# runs}} chahiye.',
  'practice.chase.announce_won': 'Target paa liya. {balls, plural, one {# ball} other {# balls}} mein {runs} run.',
  'practice.chase.announce_lost': 'Chase haara. {short, plural, one {1 run kam} other {# runs kam}}.',

  // ---- the dead-ball card inside a chase
  'practice.chase.card.next_over': 'Agla over',
  'practice.chase.card.see_result': 'Result dekho',
  'practice.chase.card.no_practice': 'Chase mein “Yeh ball practice karo” off hai.',
  // The coach's lines in a chase are about THIS ball, never a plan for the chase (R-44 item 5): the green tick's action,
  // and the tag of the first alternative shot.
  'practice.chase.card.confirm': 'is ball ke liye coach ka yahi chunav tha',
  'practice.chase.option.recommended': 'Is ball ke liye coach ki pasand',

  // ---- the win and loss screens
  'practice.chase.won.title': 'Target paa liya',
  'practice.chase.won.line':
    'Tumne {balls, plural, one {# ball} other {# balls}} mein {runs} run banaye. Target {target} tha.',
  'practice.chase.won.spare': '{left, plural, =0 {Aakhri ball pe jeet.} one {1 ball baaki.} other {# balls baaki.}}',
  'practice.chase.lost.title': '{short, plural, one {1 run kam} other {# runs kam}}',
  'practice.chase.lost.line':
    'Tumne {balls, plural, one {# ball} other {# balls}} mein {runs} run banaye. Target {target} tha.',
  'practice.chase.result.last': 'Pichhli baar: {balls, plural, one {# ball} other {# balls}} mein {runs} run',

  // ---- fair attribution
  'practice.chase.why.wicket': 'Out: {how}. {reason}.',
  'practice.chase.why.wicket_timing': 'Out: {how}. {reason}, {timing}.',
  'practice.chase.why.short.timing': 'Jin {dots} balls pe run nahi bana, unme se {n} mein shot jaldi ya der se laga.',
  'practice.chase.why.short.bowler': 'Jin {dots} balls pe run nahi bana, unme se {n} pe bowler ne bat ko chakma diya.',
  'practice.chase.why.short.line':
    'Jin {dots} balls pe run nahi bana, unme se {n} mein bat chook gaya ya ball pad pe lagi.',
  'practice.chase.why.short.field': 'Jin {dots} balls pe run nahi bana, unme se {n} seedhi fielder ke paas gayi.',
  'practice.chase.why.short.defence':
    'Jin {dots} balls pe run nahi bana, unme se {n} pe tumne defend kiya ya ball chhodi.',
  'practice.chase.why.short.plain': '{balls} mein se {dots} balls pe koi run nahi bana.',

  // ---- actions and the deciding ball
  'practice.chase.again': 'Yahi chase phir khelo',
  'practice.chase.back': 'Practice pe wapas',
  'practice.chase.watch': 'Deciding ball dekho',
  'practice.chase.practise': 'Deciding ball practice karo',
  'practice.chase.practise_note': 'Sirf practice. Tumhara chase result waisa hi rahega.',
  'practice.chase.replay_title': 'Deciding ball',

  // ---- leaving a chase from the pause screen
  'practice.chase.pause.leave_title': 'Yeh chase chhodein?',
  'practice.chase.pause.leave_body': 'Tumhara chase isi device pe safe rahega. Practice se kabhi bhi continue karo.',
};
