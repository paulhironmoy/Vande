/**
 * Turns engine ids into readable, localised text: commentary events, tactical explanations and result lines.
 * Engine params are ids (player index, shot, variant, zone...); they are resolved to names before formatting.
 */
import type { BallOutcome, MatchEvent, MatchEventLog, MatchResult } from '@/contracts';
import type { MessageKey, Translator } from '@/i18n';

type Params = Record<string, string | number | undefined>;

export function resolveParams(params: Params | undefined, log: MatchEventLog, t: Translator): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!params) return out;
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if ((k === 'batter' || k === 'bowler' || k === 'winner' || k === 'player') && (v === 0 || v === 1)) out[k] = log.players[v].alias;
    else if (k === 'shot') out[k] = t.t(`shot.${v}` as MessageKey);
    else if (k === 'variant') out[k] = t.t(`variant.${v}` as MessageKey);
    else if (k === 'zone' || k === 'fielder') out[k] = t.t(`zone.${v}` as MessageKey);
    else if (k === 'wicket') out[k] = t.t(`wicket.${v}` as MessageKey);
    else if (k === 'field') out[k] = t.t(`field.${v}` as MessageKey);
    else if (k === 'pitch') out[k] = t.t(`pitch.${v}` as MessageKey);
    else if (k === 'weather') out[k] = t.t(`weather.${v}` as MessageKey);
    else if (k === 'speed' || k === 'distance') out[k] = Math.round(Number(v));
    else out[k] = v;
  }
  return out;
}

/** Commentary line for an event, with a safe generic fallback for keys this catalog does not know yet. */
export function commentaryText(e: Extract<MatchEvent, { t: 'commentary' }>, log: MatchEventLog, t: Translator): string {
  const params = resolveParams(e.params as Params, log, t);
  return t.tk(e.key, params, '');
}

/** One-line tactical explanation for a ball. */
export function explainText(o: BallOutcome, t: Translator): string {
  const key = o.factors.explainKey;
  const generic = t.t('reveal.explain_generic', {
    shot: t.t(`shot.${o.shot}` as MessageKey),
    variant: t.t(`variant.${o.delivery.variant}` as MessageKey).toLowerCase(),
    timing: t.t(`timing.${o.timing}` as MessageKey).toLowerCase(),
    execution: t.t(`execution.${o.executionGrade}` as MessageKey).toLowerCase(),
  });
  if (!key) return generic;
  // Matchup keys (explain.<variant>_vs_<shot>) fall back to a templated sentence.
  const m = /^explain\.(\w+?)_vs_(\w+)$/.exec(key);
  if (m && !t.has(key)) {
    const good = o.factors.matchup >= 0;
    return t.t(good ? 'reveal.explain_matchup_favoured' : 'reveal.explain_matchup_against', {
      shot: t.t(`shot.${m[2]}` as MessageKey),
      variant: t.t(`variant.${m[1]}` as MessageKey).toLowerCase(),
    });
  }
  return t.tk(key, undefined, generic);
}

/**
 * The result line. `names` are the display names in log.players order: the match-time aliases by default; the
 * highlight composer passes the moderated current names from its render input instead.
 */
export function resultText(r: MatchResult, log: MatchEventLog, t: Translator, names: readonly [string, string] = [log.players[0].alias, log.players[1].alias]): string {
  // Daily Six is solo: the result is the attempt's score, never a tie or a winner.
  if (log.kind === 'daily') {
    const inn = log.innings[0];
    return t.tk('commentary.daily_score', { score: r.dailyScore ?? inn.runs, runs: inn.runs, wickets: inn.wickets });
  }
  if (r.tie || r.winner === null) return t.t('reveal.tie');
  const name = names[r.winner];
  switch (r.decidedBy) {
    case 'runs':
      return t.t('reveal.won_by_runs', { name, count: r.marginRuns });
    case 'super_ball':
      return t.t('reveal.won_super_ball', { name });
    case 'wickets_lost':
      return t.t('reveal.won_wickets_lost', { name });
    case 'boundaries':
      return t.t('reveal.won_boundaries', { name });
    default:
      return t.t('reveal.won_by_runs', { name, count: r.marginRuns });
  }
}

export function outcomeText(o: BallOutcome, t: Translator): string {
  if (o.wicket) return t.t(`wicket.${o.wicket}` as MessageKey);
  if (o.runs === 6) return t.t('outcome.six');
  if (o.runs === 4) return t.t('outcome.four');
  if (o.runs === 0) return t.t('outcome.dot');
  return t.t('outcome.runs', { runs: o.runs });
}
