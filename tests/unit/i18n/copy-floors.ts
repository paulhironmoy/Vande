/**
 * The layout floors for the Chase, first-ball lesson and camera copy (owner: COPY). Every new visible line has a cap in
 * characters after its parameters are filled with the worst values the screens can pass. The caps come from the
 * builders' own layouts at 200% text on a 640 x 360 phone (CHASE-UI-1 and LESSON-3 requests: `KEY_CAPS`) or, for a key
 * they did not size, from its class (`CAPS`). The same caps hold in English, Hindi and Hinglish: a translation is
 * written to fit, never given extra room. Lines meant for screen readers only (announcements, labels, picture
 * descriptions) are not drawn and have only a sanity cap. Kept free of imports so a script can read it too.
 */
export type CopyClass = 'chip' | 'hud' | 'hud_wide' | 'title' | 'button' | 'line' | 'body' | 'sr';

export const CAPS: Readonly<Record<CopyClass, number>> = {
  /** A chip (CAMERA-UX and CONTROLS): "Camera on", "You are in frame", "Batting: Keyboard". */
  chip: 18,
  /** A short rail line: "Target 72", "36.0 an over". */
  hud: 24,
  /** The one rail line that carries two numbers and a unit: "Need 72 off 12 balls". */
  hud_wide: 28,
  /** A heading. */
  title: 34,
  /** A button label (buttons wrap, but should not need to): "Bat with mouse", "Open in Chrome". */
  button: 22,
  /** One visible sentence or phrase. */
  line: 90,
  /** A visible paragraph of up to two sentences. */
  body: 170,
  /** Screen readers only: not drawn, so no layout cap, but kept short enough to be heard once. */
  sr: 280,
};

/** The worst values the screens can pass (a target is at most 72, a chase is 12 balls, the rate is at most 36.0). */
export const SAMPLE_PARAMS: Readonly<Record<string, string | number>> = {
  runs: 72,
  balls: 12,
  wickets: 1,
  target: 72,
  overs: 2,
  rate: '36.0',
  n: 12,
  left: 11,
  short: 72,
  need: 36,
  made: 72,
  dots: 11,
  count: 11,
  done: '99.9',
  total: '99.9',
  max: 3,
  control: 'Keyboard',
  level: 'Standard',
  input: 'Keyboard',
  how: 'Caught behind',
  reason: 'Caught in the deep by Mid-off',
  timing: '120 ms late',
  mb: 12.5,
  pct: 100,
  near: 1.5,
  far: 2.5,
  ms: 120,
};

/** Caps the builders asked for, by exact key (CHASE-UI-1-to-COPY.md, LESSON-3-to-COPY.md). */
export const KEY_CAPS: Readonly<Record<string, number>> = {
  'practice.chase.home.title': 14,
  'practice.chase.home.sub': 44,
  'practice.chase.home.resume_title': 24,
  'practice.chase.home.resume_body': 40,
  'practice.chase.home.new_confirm_body': 70,
  'practice.chase.setup.title': 14,
  'practice.chase.setup.rules': 56,
  'practice.chase.setup.no_practice': 90,
  'practice.chase.setup.level': 34,
  'practice.chase.level.easy': 14,
  'practice.chase.level.standard': 14,
  'practice.chase.level.hard': 14,
  'practice.chase.need': 28,
  /** The one short rail line in Delivery Quiet Mode ("72 off 12"): the rail may not grow while a ball is bowled. */
  'practice.chase.need_short': 24,
  'practice.chase.rate': 14,
  'practice.chase.status': 10,
  'practice.chase.announce_start': 60,
  'practice.chase.announce': 50,
  'practice.chase.card.next_over': 14,
  'practice.chase.card.see_result': 14,
  'practice.chase.card.no_practice': 44,
  /** The tip's action when the coach's choice was played (a fragment after "<fact>: ") and the first alternative's tag. */
  'practice.chase.card.confirm': 50,
  'practice.chase.option.recommended': 32,
  'practice.chase.won.title': 24,
  'practice.chase.won.line': 70,
  'practice.chase.won.spare': 40,
  'practice.chase.lost.title': 22,
  'practice.chase.lost.line': 70,
  'practice.chase.result.last': 40,
  'practice.chase.why.wicket': 80,
  'practice.chase.why.wicket_timing': 90,
  'practice.chase.why.short.timing': 80,
  'practice.chase.why.short.bowler': 80,
  'practice.chase.why.short.line': 90,
  'practice.chase.why.short.field': 80,
  'practice.chase.why.short.defence': 80,
  'practice.chase.why.short.plain': 50,
  'practice.chase.again': 22,
  'practice.chase.back': 18,
  'practice.chase.watch': 26,
  'practice.chase.practise': 28,
  'practice.chase.practise_note': 52,
  'practice.chase.replay_title': 16,
  'practice.chase.announce_won': 60,
  'practice.chase.announce_lost': 50,
  'practice.lesson.title': 24,
  'practice.lesson.try': 56,
  'practice.lesson.after': 40,
  'practice.lesson.bowl': 22,
  'practice.lesson.note.tap': 70,
  'practice.lesson.note.pull': 76,
  'practice.lesson.note.key_defend': 44,
  'practice.lesson.note.camera': 64,
  'practice.lesson.note.watch': 52,
};

/** Class of every key by name; the test fails for a key that has none, so a new line must choose a class. */
export function classOf(key: string): CopyClass | null {
  // Screen readers only: announcements, labels, still-picture descriptions, the live-region status words.
  if (/\.(announce(_[a-z]+)?(\.[a-z_]+)?|[a-z_]*label|ghost\.[a-z]+|a11y\.[a-z]+|lesson\.still_[a-z]+)$/.test(key))
    return 'sr';
  if (
    key === 'practice.chase.hud_label' ||
    key === 'practice.camera.ready.announce' ||
    key === 'practice.controls.group'
  )
    return 'sr';
  if (key === 'practice.chase.need') return 'hud_wide';
  // Chips: the camera status chips, the in-frame indicator, the controls chip, the download counter, the input names.
  if (
    /^practice\.camera\.(chip|frame)\.[a-z]+$/.test(key) ||
    /^practice\.camera\.(download\.(progress|percent)|ready\.ok)$/.test(key) ||
    /^practice\.(controls\.(chip|default_tag)|input\.[a-z]+)$/.test(key) ||
    key === 'practice.cal.input.camera'
  )
    return 'chip';
  if (/^practice\.(chase\.(rate|ball_of|status)|status\.chase)$/.test(key)) return 'hud';
  if (/^practice\.lesson\.sets\.(direction|power|loft)$/.test(key)) return 'hud';
  if (/\.title$/.test(key)) return 'title';
  if (
    /^practice\.chase\.(again|back|watch|practise)$/.test(key) ||
    /^practice\.lesson\.bowl$/.test(key) ||
    /^practice\.camera\.(switch\.(mouse|touch)|setting\.use|consent\.allow|guide\.done|lost\.(retry|help)|stop)$/.test(
      key,
    ) ||
    /^practice\.camera\.trouble\.(inapp\.(open|copy)|blocked\.open_settings)$/.test(key) ||
    /^practice\.controls\.(start|start_camera|change)$/.test(key)
  )
    return 'button';
  if (
    /^practice\.lesson\.(touch|mouse|pen|keyboard|camera)\.(load|strike|defend|loft)$/.test(key) ||
    /^practice\.lesson\.timing\.(on_time|early\.[a-z]+|late\.[a-z]+)$/.test(key)
  )
    return 'line';
  // Paragraphs: a sentence or two that wraps (the setup and troubleshooting steps, consent, long hints).
  if (
    /^practice\.chase\.(setup\.fixed|pause\.leave_body)$/.test(key) ||
    /^practice\.camera\.(consent\.(what|privacy|download)|permission\.[a-z]+|guide\.(laptop|phone|arms_out)|ready\.line)$/.test(
      key,
    ) ||
    /^practice\.camera\.trouble\.[a-z]+\.(body|chrome|edge|firefox|safari|android|android_browser|other|shutter|toggle)$/.test(
      key,
    ) ||
    /^practice\.camera\.download\.(failed|offline|space|stalled|ready)$/.test(key)
  )
    return 'body';
  if (/^practice\.(chase|lesson|camera|controls|cal)\./.test(key)) return 'line';
  return null;
}

/** The cap that applies to a key: the builder's own, else its class's (null for screen-reader lines). */
export function capOf(key: string): number | null {
  const own = KEY_CAPS[key];
  if (own !== undefined) return own;
  const cls = classOf(key);
  return cls === null || cls === 'sr' ? null : CAPS[cls];
}
