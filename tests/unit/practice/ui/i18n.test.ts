/**
 * Practice copy: every key the UI builds at runtime exists in English (so nothing ever falls back to a humanised key),
 * every translation parses and keeps English's placeholders, Hindi and Hinglish are complete, and no line is typed in
 * capitals (capitals are a style, reserved for FOUR, SIX and OUT).
 */
import { describe, expect, it } from 'vitest';
import { parseMessage } from '@/i18n/format';
import { practiceEn } from '@/i18n/practice/en';
import { CAPTION_KEYS } from '@/audio';
import {
  TESTER_ANSWERS,
  TESTER_COHORTS,
  TESTER_EXPLAINED,
  TESTER_EXPLOITS,
  TESTER_MARKER_REASONS,
  TESTER_TASKS,
} from '@/practice/store';

const files = import.meta.glob(
  [
    '../../../../src/i18n/practice/*.ts',
    '!../../../../src/i18n/practice/index.ts',
    '!../../../../src/i18n/practice/en.ts',
  ],
  { eager: true },
) as Record<string, Record<string, unknown>>;
const catalogs: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(files).map(([path, mod]) => [
    path.replace(/^.*\/|\.ts$/g, ''),
    (mod.default ?? Object.values(mod)[0]) as Record<string, string>,
  ]),
);
const en = practiceEn as Record<string, string>;

type Node = ReturnType<typeof parseMessage>[number];
function args(nodes: Node[], out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.k === 'arg') out.add(n.name);
    if (n.k === 'plural' || n.k === 'select') {
      out.add(n.name);
      for (const opt of Object.values(n.options)) args(opt, out);
    }
  }
  return out;
}
const argsOf = (p: string) => [...args(parseMessage(p))].sort().join(',');

const ROLES = [
  'keeper',
  'bowler',
  'slip',
  'gully',
  'point',
  'backward_point',
  'cover',
  'extra_cover',
  'mid_off',
  'mid_on',
  'midwicket',
  'square_leg',
  'fine_leg',
  'third_man',
  'deep_point',
  'deep_cover',
  'long_off',
  'long_on',
  'deep_midwicket',
  'deep_square',
  'short_leg',
  'silly_point',
  'leg_slip',
];
const REGIONS = [
  'third_man',
  'point',
  'cover',
  'mid_off',
  'mid_on',
  'midwicket',
  'square_leg',
  'fine_leg',
  'straight',
  'behind',
];
const INTENTIONS = [
  'attack_outside_off',
  'attack_the_stumps',
  'short_ball_trap',
  'yorker_and_boundaries',
  'spin_close_catchers',
  'save_singles',
  'protect_boundaries',
];
const REC = [
  'repeat_it',
  'leave_outside_off',
  'leave_down_leg',
  'leave_over_the_top',
  'play_at_the_stumps',
  'defend_forward',
  'defend_back',
  'attack_the_gap',
  'get_forward',
  'get_back',
  'play_later',
  'play_earlier',
  'play_straighter',
  'aim_for_the_gap',
  'keep_it_down',
  'attack_the_gap_lofted',
  'aim_for_the_gap_lofted',
];
/** Every caption src/audio can emit (its own closed list, so a new one can never show a raw key). */
const CAPTIONS: readonly string[] = CAPTION_KEYS;
const CHANGES = [
  'timing_closer',
  'timing_further',
  'footwork_right_now',
  'footwork_wrong_now',
  'decision_right_now',
  'decision_wrong_now',
  'clean_contact_now',
  'contact_worse',
  'survived_now',
  'out_now',
  'more_runs',
  'fewer_runs',
  'same_again',
];
const SKILLS = [
  'line_length',
  'pace_timing',
  'swing_seam',
  'cut',
  'spin_reading',
  'short_ball',
  'footwork',
  'timing',
  'bat_face',
  'off_side_placement',
  'direction',
  'field',
  'running',
];

/** Every key family the screens build at runtime (from the engines' closed vocabularies). */
const FAMILIES: Record<string, readonly string[]> = {
  'practice.zone': REGIONS,
  // A region by its role in a sentence (src/practice/coach tip.ts zonePhrases), 'any' when none is named.
  'practice.zone.to': [...REGIONS, 'any'],
  'practice.zone.towards': [...REGIONS, 'any'],
  'practice.zone.gap': [...REGIONS, 'any'],
  'practice.fielder': ROLES,
  'practice.pos': ROLES,
  'practice.coach': [
    'found_the_gap',
    'hit_to_fielder',
    'cleared_the_rope',
    'beat_the_field',
    'caught_in_the_deep',
    'caught_in_the_ring',
    'edged_behind',
    'edged_to_slip',
    'too_early',
    'too_late',
    'beaten_by_swing',
    'beaten_by_seam',
    'beaten_by_turn',
    'beaten_by_pace',
    'beaten_by_bounce',
    'played_across_the_line',
    'missed_straight_ball',
    'left_well',
    'left_and_bowled',
    'played_on',
    'pad_in_line',
    'solid_defence',
    'mistimed_lofted',
    'found_the_gap_any',
    'hit_to_fielder_any',
    'cleared_the_rope_any',
    'beat_the_field_any',
    'caught_in_the_deep_any',
    'caught_in_the_ring_any',
  ],
  'practice.rec': REC,
  'practice.compare': CHANGES,
  'practice.compare.verdict': ['better', 'worse', 'same'],
  'practice.risk': ['into_protected_region', 'can_be_caught', 'can_edge', 'can_be_bowled', 'can_be_lbw'],
  'practice.form': SKILLS,
  'practice.intent': INTENTIONS,
  'practice.intent.short': INTENTIONS,
  'practice.caption': CAPTIONS,
  'practice.contact': [
    'middle',
    'inside_edge',
    'outside_edge',
    'top_edge',
    'leading_edge',
    'pad',
    'body',
    'miss',
    'leave',
  ],
  'practice.result': ['bowled', 'caught', 'caught_behind', 'lbw', 'dot', 'four', 'six', 'runs', 'out'],
  'practice.var': [
    'stock',
    'outswing',
    'inswing',
    'seam',
    'cutter',
    'slower',
    'bouncer',
    'yorker',
    'flighted',
    'quicker',
    'topspinner',
    'arm_ball',
    'wrong_un_wrist',
    'wrong_un_finger',
  ].flatMap((v) => [v, `${v}_hint`]),
  'practice.length': ['yorker', 'full', 'good', 'short', 'bouncer'],
  'practice.lineband': ['down_leg', 'leg_stump', 'middle', 'off_stump', 'outside_off', 'wide_outside_off'],
  'practice.pitch': ['balanced', 'green', 'hard', 'turning'].flatMap((v) => [v, `${v}_behaviour`]),
  'practice.ball': ['white_new', 'white_worn', 'red_new', 'red_worn', 'new_hint', 'worn_hint'],
  'practice.ball.short': ['white_new', 'white_worn', 'red_new', 'red_worn'],
  'practice.difficulty': ['beginner', 'club', 'expert'].flatMap((v) => [v, `${v}_hint`]),
  'practice.bowling': ['any', 'pace', 'spin'],
  'practice.setup.kind': ['random', 'reference', 'built'],
  'practice.objective': [
    'leave_or_drive_late',
    'play_straight',
    'get_behind_it',
    'soft_hands',
    'sway_or_hook',
    'dig_it_out',
    'random',
    'reference',
    'built',
  ],
  'practice.ref.name': ['ref-1', 'ref-2', 'ref-3', 'ref-4', 'ref-5', 'ref-6'],
  'practice.pattern.line': ['stumps', 'off_stump', 'outside_off', 'leg_side'],
  'practice.pattern.swing': ['away', 'in', 'both'],
  'practice.pattern.turn': ['away', 'in', 'both'],
  'practice.notice': [
    'classic',
    'balanced',
    'help_changed',
    'help_less',
    'interrupted',
    'resumed_leave',
    'updated',
    'unreadable',
  ],
  'practice.decision': ['leave', 'defend', 'attack'],
  'practice.footwork': ['forward', 'back', 'across', 'down_track'],
  'practice.option.kind': ['recommended', 'safest', 'higher_scoring'],
  'practice.coachmode.stage': ['1', '2', '3', '4'],
  'practice.coachmode.event': ['stage_up', 'mastered'],
  'practice.read.line': ['right', 'wrong'],
  'practice.read.length': ['right', 'wrong'],
  'practice.read.pace': ['right', 'wrong'],
  'practice.read.movement': ['right', 'wrong'],
  'practice.read.bounce': ['right', 'wrong'],
  'practice.why': ['air', 'drift', 'seam', 'turn'].flatMap((m) => [`${m}_away`, `${m}_in`]),
  'practice.why.height': ['low', 'knee', 'waist', 'chest', 'head'],
  'practice.lbw': ['pitched_outside_leg', 'impact_outside_leg', 'impact_outside_off', 'missing', 'high', 'out'],
  'practice.settings.assist': ['learn', 'play', 'real'].flatMap((v) => [v, `${v}_hint`]),
  'practice.settings.quality': ['auto', 'premium', 'balanced', 'classic'],
  'practice.settings.motion': ['system', 'on', 'off'],
  'practice.settings': ['effects', 'crowd', 'music'],
  'practice.build.band': ['controlled', 'fast', 'express'],
  'practice.build.spin': ['finger', 'wrist'].flatMap((v) => [v, `${v}_hint`]),
  'practice.build.arm': ['right', 'left'],
  'practice.bowler': ['pace', 'spin'],
  'practice.tester.q': Object.keys(TESTER_ANSWERS),
  'practice.tester.cohort': [...TESTER_COHORTS],
  'practice.tester.hand': ['right', 'left', 'unknown'],
  'practice.tester.marker': [
    'help',
    'confusion',
    'exploit',
    'explained',
    'task',
    'prompted',
    'asked_to_continue',
    'end_session',
  ],
  'practice.tester.reason': [...TESTER_MARKER_REASONS],
  'practice.tester.exploit': [...TESTER_EXPLOITS],
  'practice.tester.explained': [...TESTER_EXPLAINED],
  'practice.tester.task': [...TESTER_TASKS],
  'practice.tester.result': ['pass', 'fail'],
  'practice.tester': ['shared', 'downloaded'],
  'practice.dx.lock': ['native', 'web', 'none'],
};

describe('Practice copy', () => {
  it('has every key the screens build at runtime', () => {
    const missing: string[] = [];
    for (const [prefix, keys] of Object.entries(FAMILIES))
      for (const k of keys) if (!(`${prefix}.${k}` in en)) missing.push(`${prefix}.${k}`);
    expect(missing).toEqual([]);
  });

  it('every tester answer has words (a rating shows its number)', () => {
    const missing: string[] = [];
    for (const [q, options] of Object.entries(TESTER_ANSWERS) as Array<[string, readonly string[]]>) {
      if (options.length === 10) continue;
      for (const a of options)
        if (!(`practice.tester.a.${q}.${a}` in en) && !(`practice.tester.a.${a}` in en)) missing.push(`${q}.${a}`);
    }
    expect(missing).toEqual([]);
  });

  it('no technical device words in player-facing copy (F8; the hidden diagnostics screen excepted)', () => {
    const technical =
      /\b(tiers?|fps|frame rates?|gpu|webgl|renderer|software graphics|benchmark|shader|msaa|assisted|lite)\b/i;
    for (const [locale, c] of Object.entries({ en, ...catalogs })) {
      // Placeholder names ({tier}) are never shown; the words they are replaced with are checked where they are defined.
      const found = Object.entries(c).filter(
        ([k, v]) => !k.startsWith('practice.dx.') && technical.test(v.replace(/\{\w+\}/g, '')),
      );
      expect(found.map(([k]) => `${locale}: ${k}`)).toEqual([]);
    }
  });

  it('keys start with practice. and every English line parses', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(k.startsWith('practice.')).toBe(true);
      expect(() => parseMessage(v)).not.toThrow();
    }
  });

  it('no copy is typed in capitals (VANDE, LBW and units excepted)', () => {
    const shouting = Object.entries(en).filter(([, v]) => /\b[A-Z]{4,}\b/.test(v.replace(/VANDE|JSON/g, '')));
    expect(shouting.map(([k]) => k)).toEqual([]);
  });

  it('Hindi and Hinglish are complete', () => {
    for (const locale of ['hi', 'hi-Latn']) {
      const c = catalogs[locale];
      expect(c, locale).toBeDefined();
      const missing = Object.keys(en).filter((k) => !(k in c));
      expect(missing, locale).toEqual([]);
    }
  });

  it('the ready cue explains the leave action in every launch locale', () => {
    expect(en['practice.live.hint']).toContain('Do nothing to leave');
    expect(catalogs.hi['practice.live.hint']).toContain('छोड़ने के लिए कुछ न करें');
    expect(catalogs['hi-Latn']['practice.live.hint']).toContain('leave ke liye kuch mat karo');
  });

  it('translations use exactly the English placeholders, and no unknown keys', () => {
    for (const [locale, c] of Object.entries(catalogs)) {
      for (const [k, v] of Object.entries(c)) {
        expect(k in en, `${locale}: unknown key ${k}`).toBe(true);
        expect(argsOf(v), `${locale}: ${k}`).toBe(argsOf(en[k]));
      }
    }
  });
});
