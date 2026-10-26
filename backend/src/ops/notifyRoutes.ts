/** Notification preferences: a global switch and quiet hours (IST). A partial body updates only what it names. */
import type { PushSettings } from '@/contracts';
import type { RequestContext } from '../http/context';
import { requireActor } from '../http/context';
import { fail } from '../http/errors';
import type { Reply } from '../http/router';
import { SQL } from '../storage/sql';
import { quietOf } from './notifyPolicy';
import { requireAccount } from '../profile/model';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export async function readSettings(ctx: RequestContext, uid: string): Promise<PushSettings> {
  const row = await ctx.env.DB.prepare(SQL.notifyPrefs).bind(uid).first<{ enabled: number; quiet_start: number | null; quiet_end: number | null }>();
  const quiet = quietOf(ctx.env, row);
  return { enabled: row ? row.enabled === 1 : true, quietHours: quiet ? { start: toHHMM(quiet.start), end: toHHMM(quiet.end) } : null };
}

export async function getPushSettings(ctx: RequestContext): Promise<Reply> {
  return { status: 200, body: await readSettings(ctx, requireActor(ctx).uid) };
}

export async function setPushSettings(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  // Writes only for an active account (an unexpired token of a deleted account recreates nothing).
  await requireAccount(ctx.env.DB, actor.uid);
  const b = (ctx.body ?? {}) as { enabled?: unknown; quietHours?: unknown };
  const current = await readSettings(ctx, actor.uid);
  let enabled = current.enabled;
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') fail('invalid', 'enabled must be true or false');
    enabled = b.enabled;
  }
  let start: number | null = current.quietHours ? toMinutes(current.quietHours.start) : -1;
  let end: number | null = current.quietHours ? toMinutes(current.quietHours.end) : -1;
  if (b.quietHours !== undefined) {
    if (b.quietHours === null) {
      start = -1;
      end = -1;
    } else {
      const q = b.quietHours as { start?: unknown; end?: unknown };
      if (typeof q.start !== 'string' || typeof q.end !== 'string' || !HHMM.test(q.start) || !HHMM.test(q.end) || q.start === q.end) fail('invalid', 'quietHours must be { start: "HH:MM", end: "HH:MM" } (IST) or null');
      start = toMinutes(q.start);
      end = toMinutes(q.end);
    }
  }
  await ctx.env.DB.prepare(SQL.upsertNotifyPrefs).bind(actor.uid, enabled ? 1 : 0, start, end, ctx.now).run();
  if (!enabled) ctx.deps.metrics.count('notify_dropped', ['opt_out_set']);
  return { status: 200, body: await readSettings(ctx, actor.uid) };
}
