/**
 * Titles, descriptions and fixture labels of official highlights: fixed templates over player-chosen aliases only
 * (never a real name), the day, ranks and the public result. YouTube limits: title ≤ 100, description ≤ 5,000.
 */
import { checkAlias, checkGroupName } from '@/net/shared/alias';

const TITLE_MAX = 100;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** "Friend Duel", or "<cup name> · Final" / "· Group" with the cup name filtered like a group name. */
export function fixtureLabel(kind: 'duel' | 'cup', stage: string | null, cupName: string | null): string {
  if (kind === 'duel') return 'Friend Duel';
  const name = cupName && checkGroupName(cupName).ok ? cupName.trim() : 'Group Cup';
  return `${name} · ${stage === 'final' ? 'Final' : 'Group'}`;
}

/** A shown alias: the player's own when it still passes the filter, else a neutral stand-in. */
export function safeAlias(alias: string, seat: 0 | 1): string {
  return checkAlias(alias).ok ? alias : seat === 0 ? 'Home player' : 'Away player';
}

export function highlightTitle(a: { alias0: string; alias1: string; ranks: [number | null, number | null] }): string {
  const best = Math.min(...a.ranks.filter((r): r is number => r !== null));
  return clip(`${a.alias0} vs ${a.alias1} · Daily Top 100 #${best} | VANDE Cricket #Shorts`, TITLE_MAX);
}

export interface DescriptionInput {
  alias0: string;
  alias1: string;
  fixture: string;
  day: string;
  ranks: [number | null, number | null];
  /** Null when the result row is gone (the description then leaves the score line out). */
  score: { runs0: number; wickets0: number; runs1: number; wickets1: number; winner: 0 | 1 | null } | null;
  url: string;
}

export function highlightDescription(d: DescriptionInput): string {
  const rank = (alias: string, r: number | null) => (r === null ? null : `${alias} #${r}`);
  const ranked = [rank(d.alias0, d.ranks[0]), rank(d.alias1, d.ranks[1])].filter(Boolean).join(', ');
  const score = d.score;
  const result = score ? (score.winner === null ? 'Tied' : `${score.winner === 0 ? d.alias0 : d.alias1} won`) : '';
  return [
    `${d.fixture} · ${d.day}`,
    ...(score ? [`${d.alias0} ${score.runs0}/${score.wickets0} vs ${d.alias1} ${score.runs1}/${score.wickets1} · ${result}`] : []),
    `Daily Top 100: ${ranked}`,
    '',
    `Can you beat them? ${d.url}`,
    '',
    'VANDE Cricket is a one-over cricket strategy game: seal your over, bat ball by ball, reveal the rivalry.',
    'Rendered from the verified match replay. Players appear under the nicknames they chose, with their consent.',
    '',
    '#Shorts #cricket #VANDECricket',
  ].join('\n');
}
