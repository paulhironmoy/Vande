/**
 * Practice copy: every key the UI builds at runtime exists in English (so nothing ever falls back to a humanised key),
 * every translation parses and keeps English's placeholders, and Hindi and Hinglish are complete.
 */
import { describe, expect, it } from 'vitest';
import { parseMessage } from '@/i18n/format';
import { practiceEn } from '@/i18n/practice/en';
import { PERF_REASONS } from '@/perf';

const files = import.meta.glob(['../../../../src/i18n/practice/*.ts', '!../../../../src/i18n/practice/index.ts', '!../../../../src/i18n/practice/en.ts'], { eager: true }) as Record<string, Record<string, unknown>>;
const catalogs: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(files).map(([path, mod]) => [path.replace(/^.*\/|\.ts$/g, ''), (mod.default ?? Object.values(mod)[0]) as Record<string, string>]),
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

const FAMILIES: Record<string, readonly string[]> = {
  'practice.zone': ['third_man', 'point', 'cover', 'mid_off', 'mid_on', 'midwicket', 'square_leg', 'fine_leg', 'straight', 'behind'],
  'practice.area': ['third_man', 'point', 'cover', 'mid_off', 'mid_on', 'midwicket', 'square_leg', 'fine_leg', 'straight', 'behind'],
  'practice.fielder': ['keeper', 'bowler', 'slip', 'gully', 'point', 'backward_point', 'cover', 'extra_cover', 'mid_off', 'mid_on', 'midwicket', 'square_leg', 'fine_leg', 'third_man', 'deep_point', 'deep_cover', 'long_off', 'long_on', 'deep_midwicket', 'deep_square', 'short_leg', 'silly_point', 'leg_slip'],
  'practice.coach': [
    'found_the_gap', 'hit_to_fielder', 'cleared_the_rope', 'beat_the_field', 'caught_in_the_deep', 'caught_in_the_ring', 'edged_behind', 'edged_to_slip', 'too_early', 'too_late', 'beaten_by_swing', 'beaten_by_seam', 'beaten_by_turn', 'beaten_by_pace', 'beaten_by_bounce', 'played_across_the_line', 'missed_straight_ball', 'left_well', 'left_and_bowled', 'pad_in_line', 'solid_defence', 'mistimed_lofted',
    'found_the_gap_any', 'hit_to_fielder_any', 'cleared_the_rope_any', 'beat_the_field_any', 'caught_in_the_deep_any', 'caught_in_the_ring_any',
  ],
  'practice.coach.head': ['perfect', 'solid', 'early', 'late', 'left', 'beaten', 'pad'],
  'practice.contact': ['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge', 'pad', 'body', 'miss', 'leave'],
  'practice.why.contact': ['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge', 'pad', 'body', 'miss', 'leave'],
  'practice.result': ['bowled', 'caught', 'caught_behind', 'lbw', 'dot', 'four', 'six', 'runs'],
  'practice.why.wicket': ['bowled', 'caught', 'caught_behind', 'lbw'],
  'practice.var': ['stock', 'outswing', 'inswing', 'seam', 'cutter', 'slower', 'bouncer', 'yorker', 'flighted', 'quicker', 'topspinner', 'arm_ball', 'wrong_un_wrist', 'wrong_un_finger'].flatMap((v) => [v, `${v}_hint`]),
  'practice.length': ['yorker', 'full', 'good', 'short', 'bouncer'],
  'practice.lineband': ['down_leg', 'leg_stump', 'middle', 'off_stump', 'outside_off', 'wide_outside_off'],
  'practice.pitch': ['balanced', 'green', 'hard', 'turning'].flatMap((v) => [v, `${v}_hint`]),
  'practice.timing': ['perfect', 'solid', 'mistimed', 'missed', 'none'],
  'practice.settings.device': ['full', 'assisted', 'below', 'none'],
  'practice.settings.assist': ['learn', 'play', 'real'].flatMap((v) => [v, `${v}_hint`]),
  'practice.settings.quality': ['auto', 'high', 'standard', 'lite', 'classic'],
  'practice.build.band': ['controlled', 'fast', 'express'].flatMap((v) => [v, `${v}_hint`]),
  'practice.build.spin': ['finger', 'wrist'].flatMap((v) => [v, `${v}_hint`]),
  'practice.lbw': ['pitched_outside_leg', 'impact_outside_leg', 'impact_outside_off', 'missing', 'high', 'out'],
  'practice.why': ['air', 'drift', 'seam', 'turn'].flatMap((m) => [`${m}_away`, `${m}_in`]),
};

describe('Practice copy', () => {
  it('has every key the screens build at runtime', () => {
    const missing: string[] = [];
    for (const [prefix, keys] of Object.entries(FAMILIES)) for (const k of keys) if (!(`${prefix}.${k}` in en)) missing.push(`${prefix}.${k}`);
    // The compatibility reasons shown for a device below the cutoff.
    for (const r of ['no_webgl2', 'software_renderer', 'context_lost_repeated', 'fps_below_cutoff', 'input_latency_severe', 'no_frames']) {
      expect(PERF_REASONS).toContain(r);
      if (!(`practice.compat.reason.${r}` in en)) missing.push(`practice.compat.reason.${r}`);
    }
    expect(missing).toEqual([]);
  });

  it('keys start with practice. and every English line parses', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(k.startsWith('practice.')).toBe(true);
      expect(() => parseMessage(v)).not.toThrow();
    }
  });

  it('Hindi and Hinglish are complete', () => {
    for (const locale of ['hi', 'hi-Latn']) {
      const c = catalogs[locale];
      expect(c, locale).toBeDefined();
      const missing = Object.keys(en).filter((k) => !(k in c));
      expect(missing, locale).toEqual([]);
    }
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
