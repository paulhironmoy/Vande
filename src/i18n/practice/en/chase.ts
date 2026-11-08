/**
 * English: Target Chase (the Practice home entry, the setup card, the rail, the dead-ball card, the polite
 * announcements, the win and loss screens, fair attribution, the deciding ball). Keys start with `practice.chase.`.
 * Owner: COPY. Names follow CHASE-UI's request (S/chase/requests/CHASE-UI-1-to-COPY.md). Counts are passed as numbers;
 * `rate` as a string from `t.number(x, { minimumFractionDigits: 1, maximumFractionDigits: 1 })`.
 * Copy rules: honest numbers only, no fake urgency, no exclamation marks, never blame the player.
 */
export const chaseEn = {
  // ---- the Practice home (a third entry beside Predefined Over and Random Over)
  'practice.chase.home.title': 'Chase',
  'practice.chase.home.sub': 'Reach a target in {balls} balls. One wicket.',
  'practice.chase.home.resume_title': 'Chase in progress',
  'practice.chase.home.resume_body': 'Need {runs} off {balls, plural, one {# ball} other {# balls}}',
  'practice.chase.home.new_confirm_body': 'This ends your chase. It will not be kept as a result.',

  // ---- the setup card before ball 1 (the Play button is practice.setup.play)
  'practice.chase.setup.title': 'Chase',
  'practice.chase.setup.rules': '{overs, plural, one {# over} other {# overs}}, one wicket. Reach the target to win.',
  'practice.chase.setup.target': 'Target {target}',
  'practice.chase.setup.fixed': 'The target is set before the first ball and never changes.',
  'practice.chase.setup.no_practice':
    'Practice this ball is off in a chase. When it ends you can practise the deciding ball.',
  'practice.chase.setup.level': 'Difficulty: {level}',
  'practice.chase.level.easy': 'Easy',
  'practice.chase.level.standard': 'Standard',
  'practice.chase.level.hard': 'Hard',

  // ---- the rail during play (next to the ball marks)
  'practice.chase.need': 'Need {runs} off {balls, plural, one {# ball} other {# balls}}',
  'practice.chase.need_short': '{runs} off {balls}',
  'practice.chase.rate': '{rate} an over',
  'practice.chase.hud_label':
    'Chase. Need {runs, plural, one {# run} other {# runs}} from {balls, plural, one {# ball} other {# balls}}. Required rate {rate} runs an over.',
  'practice.chase.status': 'Chase',
  'practice.chase.ball_of': 'Ball {n} of {total}',

  // ---- polite screen-reader announcements
  'practice.chase.announce_start': 'Chase. Need {runs} off {balls, plural, one {# ball} other {# balls}}.',
  'practice.chase.announce': 'Need {runs} off {balls, plural, one {# ball} other {# balls}}.',
  'practice.chase.announce_last': 'Last ball. Need {runs, plural, one {# run} other {# runs}} to win.',
  'practice.chase.announce_won': 'Target reached. {runs} off {balls, plural, one {# ball} other {# balls}}.',
  'practice.chase.announce_lost': 'Chase lost. {short, plural, one {1 run short} other {# runs short}}.',

  // ---- the dead-ball card inside a chase
  'practice.chase.card.next_over': 'Next over',
  'practice.chase.card.see_result': 'See result',
  'practice.chase.card.no_practice': 'Practice this ball is off in a chase.',
  // The coach's lines in a chase are about THIS ball, never a plan for the chase (R-44 item 5): the green tick's action,
  // and the tag of the first alternative shot.
  'practice.chase.card.confirm': 'that was the coach’s choice for this ball',
  'practice.chase.option.recommended': 'Coach’s pick for this ball',

  // ---- the win and loss screens
  'practice.chase.won.title': 'Target reached',
  'practice.chase.won.line':
    'You scored {runs} off {balls, plural, one {# ball} other {# balls}}. The target was {target}.',
  'practice.chase.won.spare':
    '{left, plural, =0 {Won on the last ball.} one {1 ball to spare.} other {# balls to spare.}}',
  'practice.chase.lost.title': '{short, plural, one {1 run short} other {# runs short}}',
  'practice.chase.lost.line':
    'You scored {runs} off {balls, plural, one {# ball} other {# balls}}. The target was {target}.',
  'practice.chase.result.last': 'Last try: {runs} off {balls, plural, one {# ball} other {# balls}}',

  // ---- fair attribution: one plain sentence, built only from what the simulation recorded
  'practice.chase.why.wicket': 'Out: {how}. {reason}.',
  'practice.chase.why.wicket_timing': 'Out: {how}. {reason}, {timing}.',
  'practice.chase.why.short.timing': '{n} of the {dots} balls that scored nothing were played early or late.',
  'practice.chase.why.short.bowler': 'The bowler beat the bat on {n} of the {dots} balls that scored nothing.',
  'practice.chase.why.short.line': '{n} of the {dots} balls that scored nothing were missed or hit the pad.',
  'practice.chase.why.short.field': '{n} of the {dots} balls that scored nothing went to a fielder.',
  'practice.chase.why.short.defence': 'You defended or left {n} of the {dots} balls that scored nothing.',
  'practice.chase.why.short.plain': '{dots} of your {balls} balls scored nothing.',

  // ---- actions and the deciding ball
  'practice.chase.again': 'Try this chase again',
  'practice.chase.back': 'Back to Practice',
  'practice.chase.watch': 'Watch the deciding ball',
  'practice.chase.practise': 'Practise the deciding ball',
  'practice.chase.practise_note': 'Practice only. Your chase result stays as it was.',
  'practice.chase.replay_title': 'Deciding ball',

  // ---- leaving a chase from the pause screen
  'practice.chase.pause.leave_title': 'Leave this chase?',
  'practice.chase.pause.leave_body': 'Your chase stays saved on this device. Continue it any time from Practice.',
} as const;
