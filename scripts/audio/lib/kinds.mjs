/**
 * The sound kinds the owner can record or download (REGISTER.md §5, wedge §7.2), each with the game sounds it feeds
 * (src/audio/recordedManifest.ts keys) and, in plain words, what to record. The tests check this table against the
 * shipped manifest, so it cannot drift from what the game plays.
 */
export const KINDS = {
  1: { name: 'Middled tock', sounds: { sweet: 'the very best, cleanest hits off the middle of the bat', middle: 'normal good hits off the middle of the bat', mistimed: 'hits a little off the middle: a duller "thock"' } },
  2: { name: 'Thick edge', sounds: { edge_thick: 'hits on the thick inside edge of the bat' } },
  3: { name: 'Thin nick', sounds: { edge_thin: 'hits that just touch the outside edge' } },
  4: { name: 'Top of the bat', sounds: { top_edge: 'hits on the shoulder (the top of the blade, near the handle). The toe is not needed: the game has no toe contact' } },
  5: { name: 'Defensive block', sounds: { block: 'a dead-bat push: hold the bat loosely and let the ball hit it softly' } },
  6: { name: 'Pad', sounds: { pad: 'the ball thrown onto a batting pad (worn, or propped up)' } },
  7: { name: 'Glove or body', sounds: { body: 'the ball thrown onto a glove or a padded arm' } },
  8: { name: 'Play and miss', sounds: { swish: 'the bat swung hard through the air, no ball', gloves: "the ball caught in wicketkeeping gloves" } },
  9: { name: 'Pitch bounce', sounds: { bounce_hard: 'the ball bounced hard on a hard surface (concrete, a hard pitch)', bounce: 'bounced on a normal pitch or firm ground', bounce_green: 'bounced on soft grass', bounce_turning: 'bounced on dry, dusty ground' } },
  10: { name: 'Stumps and bails', sounds: { stumps: 'the ball rolled or thrown hard into the stumps', bails: 'the bails dropped onto the ground' } },
  11: { name: 'Boundary boards', sounds: { board: 'the ball hitting a boundary board or a wooden fence' } },
};

/** Kinds this tool does not take, and why (plain words). */
export const NOT_HERE = {
  12: 'crowd sounds are cut and shaped by the lead with the Track C tool (tools/process_takes.py); put them aside and tell the lead',
  13: 'the game has no bowler footsteps or grunts yet, so there is nothing to put them in',
  14: 'the game has no fielder calls or appeals yet, so there is nothing to put them in',
};

/** The longest a take may be (seconds), before its own decay ends it. */
export const MAX_SECONDS = { sweet: 0.6, middle: 0.5, mistimed: 0.4, edge_thick: 0.3, edge_thin: 0.25, top_edge: 0.35, block: 0.3, pad: 0.35, body: 0.3, swish: 0.45, gloves: 0.3, bounce_hard: 0.3, bounce: 0.3, bounce_green: 0.35, bounce_turning: 0.35, stumps: 0.5, bails: 0.8, board: 0.45 };

export const kindOf = (sound) => Number(Object.keys(KINDS).find((k) => sound in KINDS[k].sounds));
export const ALL_SOUNDS = Object.values(KINDS).flatMap((k) => Object.keys(k.sounds));
