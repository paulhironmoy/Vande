/** Account rows ↔ the Profile and PlayerRef contracts. */
import type { GroupKind, KitSpec, LocaleId, PlayerRef, Profile } from '@/contracts';
import type { D1Like } from '../env';
import { fail } from '../http/errors';
import { SQL } from '../storage/sql';

export interface AccountRow {
  uid: string;
  player_id: string;
  status: string;
  alias: string;
  avatar_seed: string;
  kit_json: string;
  locale: string;
  city: string | null;
  adult_confirmed: number;
  unlocks_json: string;
  badges_json: string;
  rating: number;
  created_day: string;
  /** Until when a moderator paused this account's social features (ms), or null (0008). */
  social_suspended_until?: number | null;
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function activeAccount(db: D1Like, uid: string): Promise<AccountRow | null> {
  const row = await db.prepare(SQL.accountByUid).bind(uid).first<AccountRow>();
  return row && row.status === 'active' ? row : null;
}

/** The signed-in player's account, or 401 when it was deleted since the access token was issued. */
export async function requireAccount(db: D1Like, uid: string): Promise<AccountRow> {
  const row = await activeAccount(db, uid);
  if (!row) fail('unauthorized', 'account not active');
  return row;
}

/**
 * Social features (posting in Cricket Rooms, creating or joining cups and groups, changing the name) need an account
 * no moderator has paused (admin/reports.ts). Matches and Daily Six keep working during a suspension.
 */
export function requireSocial(row: AccountRow, now: number): void {
  const until = row.social_suspended_until ?? null;
  if (until !== null && until > now) {
    fail('forbidden', `A moderator paused posting, cups, groups and name changes on this account until ${new Date(until).toISOString().slice(0, 10)}. Matches and Daily Six still work.`);
  }
}

export function kitOf(row: AccountRow): KitSpec {
  return parseJson<KitSpec>(row.kit_json, { id: 'starter', primary: '#1E2A78', secondary: '#00B8D9', pattern: 'plain' });
}

export function unlocksOf(row: AccountRow): string[] {
  const u = parseJson<unknown>(row.unlocks_json, []);
  return Array.isArray(u) ? u.filter((x): x is string => typeof x === 'string') : [];
}

export function playerRefOf(row: AccountRow): PlayerRef {
  return { id: row.player_id, alias: row.alias, avatar: { seed: row.avatar_seed }, kit: kitOf(row), kind: 'human' };
}

export async function profileOf(db: D1Like, row: AccountRow): Promise<Profile> {
  const [groups, identities] = await Promise.all([
    db.prepare(SQL.membershipsOfUid).bind(row.uid).all<{ group_id: string; kind: GroupKind; name: string }>(),
    db.prepare(SQL.identitiesOfUid).bind(row.uid).all<{ provider: string }>(),
  ]);
  const providers = new Set(identities.results.map((r) => r.provider));
  const badges = parseJson<unknown>(row.badges_json, []);
  return {
    playerId: row.player_id,
    alias: row.alias,
    avatar: { seed: row.avatar_seed },
    kit: kitOf(row),
    locale: row.locale as LocaleId,
    city: row.city,
    groups: groups.results.map((g) => ({ groupId: g.group_id, kind: g.kind, name: g.name })),
    badges: Array.isArray(badges) ? badges.filter((x): x is string => typeof x === 'string') : [],
    unlocks: unlocksOf(row),
    rating: row.rating,
    createdDay: row.created_day,
    adultConfirmed: row.adult_confirmed === 1,
    linked: { google: providers.has('google'), passkey: providers.has('passkey') },
  };
}

/** Stand-in for a player who deleted their account (their id and alias are gone from every match). */
export const DELETED_PLAYER: PlayerRef = {
  id: 'p-deleted',
  alias: 'Deleted player',
  avatar: { seed: 'deleted0' },
  kit: { id: 'starter', primary: '#14161F', secondary: '#F5F5F0', pattern: 'plain' },
  kind: 'human',
};
