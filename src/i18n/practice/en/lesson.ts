/**
 * English: the first-ball lesson (ball 1 only, for the active input type): the ghost gesture words, the try-out card, the
 * three things the start of a swing decides, early and late feedback in proportion, and the screen-reader text.
 * Keys start with `practice.lesson.`. Owner: COPY. The size bands for early and late (small, medium, large) are
 * LESSON's, from the simulation's own timing data; these lines only word them. Skipping reuses
 * `practice.intro.skip` and `practice.intro.skip_all`.
 */
export const lessonEn = {
  'practice.lesson.title': 'Your first ball',

  // ---- the ghost gesture, step 1 (load) and step 2 (strike), for each input type
  'practice.lesson.touch.load': 'Press and pull back',
  'practice.lesson.touch.strike': 'Flick forward',
  'practice.lesson.mouse.load': 'Hold the button and drag back',
  'practice.lesson.mouse.strike': 'Push forward',
  'practice.lesson.pen.load': 'Press the pen down and pull back',
  'practice.lesson.pen.strike': 'Flick forward',
  'practice.lesson.keyboard.load': 'Watch the ball come',
  'practice.lesson.keyboard.strike': 'Press an arrow key to hit',
  'practice.lesson.keyboard.defend': 'Space to defend',
  'practice.lesson.keyboard.loft': 'Hold Shift to loft it',
  'practice.lesson.camera.load': 'Raise your hands and bring them back',
  'practice.lesson.camera.strike': 'Bring them forward and down',

  // ---- what the start of the swing decides (three short words, with a line each for the curious)
  'practice.lesson.sets.direction': 'Direction',
  'practice.lesson.sets.power': 'Power',
  'practice.lesson.sets.loft': 'Loft',
  'practice.lesson.sets.direction_hint': 'Where you flick is where it goes.',
  'practice.lesson.sets.power_hint': 'A faster flick hits harder.',
  'practice.lesson.sets.loft_hint': 'Pull back farther to hit it higher.',

  // ---- the card before ball 1: the player may try the move on the real batting area; nothing is bowled until they choose
  'practice.lesson.try': 'Now you try. Do it here. No ball is bowled yet.',
  'practice.lesson.after': 'Try it again, or bowl the first ball.',
  'practice.lesson.bowl': 'Bowl the first ball',
  'practice.lesson.idle': 'Take your time. The ball waits for you.',
  'practice.lesson.leave': 'Not sure? Do nothing and the ball is left.',

  // ---- plain notes when the try-out is not a hit yet (nothing is lost; the card stays)
  'practice.lesson.note.tap': 'A quick tap defends. To hit, pull back first, then flick forward.',
  'practice.lesson.note.pull': 'You pulled back. Now flick forward to hit. Doing nothing leaves the ball.',
  'practice.lesson.note.key_defend': 'Space defends. Press an arrow key to hit.',
  'practice.lesson.note.camera': 'Your arms are not in view yet. Step back a little.',
  'practice.lesson.note.watch': 'This one is only to watch. You try next.',

  // ---- acting at the wrong moment: said plainly, no penalty, try again
  'practice.lesson.too_soon': 'Too soon. Wait for the ball, then play.',
  'practice.lesson.try_again': 'No problem. Try again.',

  // ---- timing, in proportion to the error (the numbers are practice.timing.ms_early and ms_late)
  'practice.lesson.timing.on_time': 'Right on time',
  'practice.lesson.timing.early.small': 'A touch early',
  'practice.lesson.timing.early.medium': 'Early',
  'practice.lesson.timing.early.large': 'Much too early',
  'practice.lesson.timing.late.small': 'A touch late',
  'practice.lesson.timing.late.medium': 'Late',
  'practice.lesson.timing.late.large': 'Much too late',
  'practice.lesson.timing.try_later': 'Next time, start a little later.',
  'practice.lesson.timing.try_sooner': 'Next time, start a little sooner.',

  // ---- screen readers: the whole lesson as text
  'practice.lesson.announce.touch':
    'First ball. Press the batting area and pull back, then flick forward. The start of the flick sets direction, power and loft. The bowler waits for you.',
  'practice.lesson.announce.mouse':
    'First ball. Hold the mouse button on the batting area and drag back, then push forward. The start of the push sets direction, power and loft. The bowler waits for you.',
  'practice.lesson.announce.pen':
    'First ball. Press the pen down on the batting area and pull back, then flick forward. The start of the flick sets direction, power and loft. The bowler waits for you.',
  'practice.lesson.announce.keyboard':
    'First ball. Press an arrow key to hit, or Space to defend. Hold Shift to loft it. The bowler waits for you.',
  'practice.lesson.announce.camera':
    'First ball. Raise your hands and bring them back, then bring them forward and down. The start of that move sets direction, power and loft. The bowler waits for you.',

  // ---- the still picture used instead of the moving ghost (reduced motion), described for screen readers
  'practice.lesson.ghost.touch': 'A finger presses, pulls back, then flicks forward.',
  'practice.lesson.ghost.mouse': 'A mouse pointer holds, drags back, then pushes forward.',
  'practice.lesson.ghost.pen': 'A pen presses down, pulls back, then flicks forward.',
  'practice.lesson.ghost.keyboard': 'An arrow key is pressed to hit, or Space to defend.',
  'practice.lesson.ghost.camera': 'Two hands rise and come back, then move forward and down.',
} as const;
