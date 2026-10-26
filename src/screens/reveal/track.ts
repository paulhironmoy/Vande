/**
 * A neutral progress track for the reveal's scrubber. A replay's real length gives the result away: a Super Ball
 * (so a tie) makes it longer, an innings that ended early makes it shorter. The track instead lays every match out
 * the same way (intro, six slots per innings, a Super Ball zone that is always there "if needed", the result), each
 * slot a fixed width, so the thumb's position and the marks say nothing about what is still to come. Slots a replay
 * does not play (balls left out of Key Moments, dead balls, an unneeded Super Ball) are passed over only when playback
 * reaches them, which is when the viewer learns it anyway.
 */
import type { Timeline } from '@/render3d/core/timeline';
import { locate } from '@/render3d/core/timeline';

export interface Track {
  /** 0–1 position of a replay time on the track. */
  pos(time: number): number;
  /** Replay time for a 0–1 track position (a slot this replay does not play snaps to the next one that it does). */
  time(pos: number): number;
  /** Where the second innings and the Super Ball zone begin (0–1), for the dividers. */
  zones: number[];
}

const W = { intro: 1.5, start: 1, ball: 2.2, end: 1, superStart: 1, super: 2.2, result: 2.5 } as const;

export function neutralTrack(tl: Timeline, opts: { innings: 1 | 2; superBall: boolean }): Track {
  const slots: Array<{ key: string; w: number }> = [{ key: 'intro', w: W.intro }];
  const zones: string[] = [];
  for (let i = 0; i < opts.innings; i++) {
    if (i > 0) zones.push(`start:${i}`);
    slots.push({ key: `start:${i}`, w: W.start });
    for (let k = 0; k < 6; k++) slots.push({ key: `ball:${i}:${k}`, w: W.ball });
    slots.push({ key: `end:${i}`, w: W.end });
  }
  if (opts.superBall) {
    zones.push('superStart');
    slots.push({ key: 'superStart', w: W.superStart }, { key: 'super:0', w: W.super }, { key: 'super:1', w: W.super });
  }
  slots.push({ key: 'result', w: W.result });

  const index = new Map(slots.map((s, i) => [s.key, i]));
  const starts: number[] = [];
  let total = 0;
  for (const s of slots) {
    starts.push(total);
    total += s.w;
  }

  // Each timeline segment's slot (a slot the replay plays once at most; extras share it).
  let supers = 0;
  let lastSlot = 0;
  const slotOf: number[] = tl.segments.map((seg) => {
    let key: string;
    if (seg.kind === 'intro') key = 'intro';
    else if (seg.kind === 'result') key = 'result';
    else if (seg.kind === 'super_start') key = 'superStart';
    else if (seg.kind === 'innings_start') key = `start:${seg.innings}`;
    else if (seg.kind === 'innings_end') key = `end:${seg.innings}`;
    else if (seg.innings === 'super') key = `super:${Math.min(1, supers++)}`;
    else key = `ball:${seg.innings}:${seg.ball ?? 0}`;
    const i = index.get(key);
    lastSlot = i ?? lastSlot;
    return lastSlot;
  });
  // Segments sharing a slot split it in order.
  const share = new Map<number, number[]>();
  slotOf.forEach((slot, segIndex) => share.set(slot, [...(share.get(slot) ?? []), segIndex]));

  const pos = (time: number): number => {
    if (tl.segments.length === 0) return 0;
    if (time >= tl.duration) return 1;
    const at = locate(tl, time);
    const slot = slotOf[at.index];
    const group = share.get(slot) ?? [at.index];
    const part = slots[slot].w / group.length;
    const within = group.indexOf(at.index);
    const frac = at.seg.dur > 0 ? Math.min(1, Math.max(0, at.local / at.seg.dur)) : 0;
    return (starts[slot] + part * (within + frac)) / total;
  };

  const time = (p: number): number => {
    const target = Math.min(1, Math.max(0, p)) * total;
    let slot = slots.length - 1;
    for (let i = 0; i < slots.length; i++) {
      if (target < starts[i] + slots[i].w) {
        slot = i;
        break;
      }
    }
    const group = share.get(slot);
    if (group && group.length > 0) {
      const part = slots[slot].w / group.length;
      const k = Math.min(group.length - 1, Math.floor((target - starts[slot]) / part));
      const seg = tl.segments[group[k]];
      const frac = (target - starts[slot] - part * k) / part;
      return seg.t0 + Math.min(1, Math.max(0, frac)) * seg.dur;
    }
    // Not played in this replay: the next slot that is.
    const next = slotOf.findIndex((s) => s > slot);
    return next >= 0 ? tl.segments[next].t0 : tl.duration;
  };

  return { pos, time, zones: zones.map((k) => starts[index.get(k) ?? 0] / total) };
}

export type TickKind = 'ball' | 'four' | 'six' | 'wicket';
export interface TickIn {
  /** 0–1 on the track. */
  pos: number;
  kind: TickKind;
}
export interface TickOut extends TickIn {
  /** Draw the labelled marker (4, 6, W); otherwise a slim tick in the outcome's colour. */
  label: boolean;
}

const PRIORITY: Record<TickKind, number> = { ball: 0, four: 1, six: 2, wicket: 3 };

/**
 * Keeps labelled markers from overlapping when balls sit close together on a narrow scrubber ("4 4W4 4"): of two
 * labels closer than `labelPx`, the more telling one keeps its label (W over 6 over 4, the later on a tie) and the
 * other becomes a slim tick in its colour, so nothing is hidden and nothing is stacked into a smudge.
 */
export function layoutTicks(ticks: readonly TickIn[], widthPx: number, labelPx = 17): TickOut[] {
  const out: TickOut[] = ticks.map((t) => ({ ...t, label: t.kind !== 'ball' }));
  const gap = labelPx / Math.max(1, widthPx);
  let kept = -1;
  const order = out.map((_, i) => i).sort((a, b) => out[a].pos - out[b].pos);
  for (const i of order) {
    if (!out[i].label) continue;
    if (kept >= 0 && out[i].pos - out[kept].pos < gap) {
      if (PRIORITY[out[i].kind] >= PRIORITY[out[kept].kind]) {
        out[kept].label = false;
        kept = i;
      } else out[i].label = false;
    } else kept = i;
  }
  return out;
}
