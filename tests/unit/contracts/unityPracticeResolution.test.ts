import { describe, expect, it } from 'vitest';
import {
  PRACTICE_SIM_VERSION,
  UnityPracticeContractError,
  canonicalUnityPracticeJson,
  canonicalizeUnityPracticeResolution,
  hasValidUnityPracticeResolutionIdentity,
  isUnchangedUnityPracticeResolution,
  makeUnityPracticeMessage,
  makeUnityPracticeResolution,
  packUnityPracticeMessage,
  packedUnityPracticePacket,
  parseUnityPracticeMessage,
  unityPracticeReplayDigest,
  unityPracticeSha256,
  unpackUnityPracticePacket,
} from '@/contracts';
import type { DeliveryRecord, DeliveryResult, UnityPracticeResolution } from '@/contracts';
import {
  FALSE_DIGEST,
  digestSpy,
  golden,
  goldens,
  guardAtDelivery,
  guardReplay,
  guardResult,
  handBuilt,
  hostReplay,
  hostResult,
  type Golden,
} from './goldenResolutions';
import { countLargeStringifies } from './largeStringifies';

/**
 * The resolution is canonicalized and digested once, where the host makes it (makeUnityPracticeResolution), and the
 * identity checks and the packet that follow reuse that. These tests pin that the reuse changes no byte, that a
 * resolution changed after its digest is never trusted, and that anything the host did not make is recomputed.
 */

describe('Unity Practice resolution made once', () => {
  it('has the seven shared goldens to check against', () => {
    expect(goldens).toHaveLength(7);
  });

  it('digests every golden exactly as the former whole-document canonicalization did', async () => {
    for (const item of goldens) {
      const g = golden(item);
      const former = await unityPracticeSha256(
        canonicalUnityPracticeJson({ simVersion: PRACTICE_SIM_VERSION, record: g.record, result: g.result }),
      );
      expect(former, `${item.id} the former hash is the golden's own digest`).toBe(item.wire.replayDigest);
      expect(former, item.id).toBe(g.replayDigest);

      const canonical = await canonicalizeUnityPracticeResolution(g.record, g.result);
      expect(canonical.replayDigest, item.id).toBe(former);
      expect(canonical.record.json === canonicalUnityPracticeJson(g.record), `${item.id} record text`).toBe(true);
      expect(canonical.result.json === canonicalUnityPracticeJson(g.result), `${item.id} result text`).toBe(true);
      expect(await unityPracticeReplayDigest(g.record, g.result), item.id).toBe(former);

      const made = await makeUnityPracticeResolution(g.record, g.result, g.score);
      expect(made.replayDigest, item.id).toBe(former);
      expect(made.record, item.id).toBe(g.record);
      expect(made.result, item.id).toBe(g.result);
      expect(made.score, item.id).toBe(g.score);
    }
  });

  it('writes a fragment into a larger document exactly as the whole value would have been written', async () => {
    const g = golden(goldens[0]);
    const canonical = await canonicalizeUnityPracticeResolution(g.record, g.result);
    // Integer-like keys are listed in numeric order by every JavaScript engine; the fragment must not change that.
    const withFragments = { '10': canonical.record, '9': 1, a: [canonical.result, null, 'x', -0], b: { nested: canonical.record } };
    const withValues = { '10': g.record, '9': 1, a: [g.result, null, 'x', -0], b: { nested: g.record } };
    expect(canonicalUnityPracticeJson(withFragments) === canonicalUnityPracticeJson(withValues)).toBe(true);
    expect(canonicalUnityPracticeJson(canonical.result) === canonicalUnityPracticeJson(g.result)).toBe(true);
    expect(canonicalUnityPracticeJson({ simVersion: PRACTICE_SIM_VERSION, record: canonical.record, result: canonical.result }))
      .toBe(`{"record":${canonical.record.json},"result":${canonical.result.json},"simVersion":${PRACTICE_SIM_VERSION}}`);
    // Documents without a fragment are written as before.
    expect(canonicalUnityPracticeJson({ b: [2, { d: 1, c: -0 }], a: 'é"' })).toBe('{"a":"é\\"","b":[2,{"c":0,"d":1}]}');
  });

  it('packs a made resolution into the byte-identical golden packets', async () => {
    for (const item of goldens) {
      const g = golden(item);
      const made = await makeUnityPracticeResolution(g.record, g.result, g.score);

      const resultPacket = await packUnityPracticeMessage(hostResult(g, made));
      expect(resultPacket.sha256, `${item.id} result sha256`).toBe(item.wire.packets.result.sha256);
      expect(resultPacket.body === item.wire.packets.result.body, `${item.id} result body`).toBe(true);

      const replayPacket = await packUnityPracticeMessage(hostReplay(g, made));
      expect(replayPacket.sha256, `${item.id} replay sha256`).toBe(item.wire.packets.replay.sha256);
      expect(replayPacket.body === item.wire.packets.replay.body, `${item.id} replay body`).toBe(true);

      // The hand-built route packs the same bytes.
      const byHand = await packUnityPracticeMessage(hostResult(g, handBuilt(g)));
      expect(byHand.sha256, `${item.id} hand-built sha256`).toBe(resultPacket.sha256);
      expect(byHand.body === resultPacket.body, `${item.id} hand-built body`).toBe(true);
    }
  });

  it('verifies and packs a made resolution without digesting its record and result again', async () => {
    const g = golden(goldens[2]);
    const digest = digestSpy();

    const made = await makeUnityPracticeResolution(g.record, g.result, g.score);
    expect(digest, 'making digests once').toHaveBeenCalledTimes(1);

    digest.mockClear();
    expect(await hasValidUnityPracticeResolutionIdentity(made)).toBe(true);
    expect(digest, 'the identity check of a made resolution').not.toHaveBeenCalled();

    const madePacket = await packUnityPracticeMessage(hostResult(g, made));
    expect(digest, 'packing a made resolution digests the body alone').toHaveBeenCalledTimes(1);
    const replayPacket = await packUnityPracticeMessage(hostReplay(g, made));
    expect(digest, 'and so does its replay').toHaveBeenCalledTimes(2);
    expect(replayPacket.sha256).toBe(goldens[2].wire.packets.replay.sha256);

    // The same resolution built by hand is recomputed first, then packed: one more digest, the same bytes.
    digest.mockClear();
    const byHandPacket = await packUnityPracticeMessage(hostResult(g, handBuilt(g)));
    expect(digest, 'a hand-built resolution is verified by recomputation').toHaveBeenCalledTimes(2);
    expect(byHandPacket.sha256).toBe(madePacket.sha256);
    expect(byHandPacket.body === madePacket.body).toBe(true);
  });

  it('packs a made demonstration resolution into the bytes of a hand-built one', async () => {
    const g = golden(goldens[1]);
    const score = { runs: g.result.outcome.runs, wickets: (g.result.outcome.dismissal === null ? 0 : 1) as 0 | 1, balls: 1, maxOvers: 10 as const };
    const delivery = parseUnityPracticeMessage(goldens[1].wire.packets.delivery.body);
    if (delivery.type !== 'host.delivery') throw new Error('golden delivery narrowing failed');
    const demonstration = (resolution: UnityPracticeResolution) => makeUnityPracticeMessage(
      { ...g.fields, deliveryId: 'demonstration-1', messageId: 'demonstration-message-1' },
      'host.demonstration',
      { delivery: delivery.payload, resolution, speed: 1 },
    );
    const made = await makeUnityPracticeResolution(g.record, g.result, score);
    const byHand: UnityPracticeResolution = { record: g.record, result: g.result, score, replayDigest: made.replayDigest };
    const digest = digestSpy();
    const madePacket = await packUnityPracticeMessage(demonstration(made));
    expect(digest).toHaveBeenCalledTimes(1);
    digest.mockClear();
    const byHandPacket = await packUnityPracticeMessage(demonstration(byHand));
    expect(digest).toHaveBeenCalledTimes(2);
    expect(byHandPacket.sha256).toBe(madePacket.sha256);
    expect(byHandPacket.body === madePacket.body).toBe(true);
    // The packet is a complete, checksummed demonstration whose resolution round-trips.
    const received = await unpackUnityPracticePacket(madePacket);
    expect(received.type).toBe('host.demonstration');
  });
});

describe('Unity Practice resolution changed after it was made', () => {
  // Each change is made in place on the very record or result the resolution holds.
  const changes: Array<[string, (g: Golden) => void]> = [
    ['a ball sample appended', (g) => { g.result.ball.push({ ...g.result.ball[g.result.ball.length - 1] }); }],
    ['a ball sample removed', (g) => { g.result.ball.pop(); }],
    ['a ball sample rewritten', (g) => { g.result.ball[7].p.y += 0.001; }],
    ['every ball sample mirrored (an even number of sign flips)', (g) => { for (const s of g.result.ball) { s.p.x = -s.p.x; s.v.x = -s.v.x; } }],
    ['the ball trace sorted in place', (g) => { g.result.ball.reverse(); }],
    ['a flight sample rewritten', (g) => { g.result.flight.samples[2].v.z += 1e-9; }],
    ['the bat trace replaced by a copy with one value moved', (g) => { g.result.bat = g.result.bat.map((s, i) => (i === 3 ? { ...s, grip: { ...s.grip, y: s.grip.y + 1e-6 } } : s)); }],
    ['a fielder sample rewritten', (g) => { g.result.fielders[3].samples[1].x += 0.01; }],
    ['a fielder action rewritten', (g) => { g.result.fielders[0].samples[0].action = 'idle'; }],
    ['two events swapped', (g) => { const e = g.result.events; [e[1], e[2]] = [e[2], e[1]]; }],
    ['the outcome rewritten', (g) => { g.result.outcome = { ...g.result.outcome, runs: g.result.outcome.runs === 4 ? 6 : 4 }; }],
    ['the dead time rewritten', (g) => { g.result.deadT += 0.5; }],
    ['a member added to the result', (g) => { (g.result as unknown as Record<string, unknown>).extra = 1; }],
    ['the record rewritten', (g) => { g.record.tierToleranceMs += 1; }],
    ['the record field changed', (g) => { g.record.field = { ...g.record.field, id: `${g.record.field.id}-moved` }; }],
  ];

  it.each(changes)('is not trusted after %s', async (_name, change) => {
    const g = golden(goldens[0]);
    const made = await makeUnityPracticeResolution(g.record, g.result, g.score);
    expect(await hasValidUnityPracticeResolutionIdentity(made)).toBe(true);
    expect(isUnchangedUnityPracticeResolution(made)).toBe(true);
    change(g);
    expect(isUnchangedUnityPracticeResolution(made)).toBe(false);
    expect(await hasValidUnityPracticeResolutionIdentity(made)).toBe(false);
    await expect(packUnityPracticeMessage(hostResult(g, made))).rejects.toBeInstanceOf(UnityPracticeContractError);
    await expect(packUnityPracticeMessage(hostReplay(g, made))).rejects.toBeInstanceOf(UnityPracticeContractError);
  });

  it('refuses a rewritten sample with an integrity error, not only a shape error', async () => {
    const g = golden(goldens[0]);
    const made = await makeUnityPracticeResolution(g.record, g.result, g.score);
    g.result.ball[7].p.y += 0.001;
    await expect(packUnityPracticeMessage(hostResult(g, made))).rejects.toMatchObject({ code: 'integrity' });
  });

  it('trusts the resolution again once the change is undone', async () => {
    const g = golden(goldens[0]);
    const made = await makeUnityPracticeResolution(g.record, g.result, g.score);
    const original = g.result.ball[7].p.y;
    g.result.ball[7].p.y = original + 0.001;
    expect(await hasValidUnityPracticeResolutionIdentity(made)).toBe(false);
    g.result.ball[7].p.y = original;
    expect(isUnchangedUnityPracticeResolution(made)).toBe(true);
    const digest = digestSpy();
    expect(await hasValidUnityPracticeResolutionIdentity(made)).toBe(true);
    expect(digest).not.toHaveBeenCalled();
    const packet = await packUnityPracticeMessage(hostResult(g, made));
    expect(packet.sha256).toBe(goldens[0].wire.packets.result.sha256);
  });

  it('recomputes, and accepts, a change that left the canonical text as it was', async () => {
    const g = golden(goldens[0]);
    const made = await makeUnityPracticeResolution(g.record, g.result, g.score);
    // Canonical JSON writes -0 as 0: the bits differ, the bytes do not.
    expect(g.result.ball[0].t).toBe(0);
    g.result.ball[0].t = -0;
    const digest = digestSpy();
    expect(await hasValidUnityPracticeResolutionIdentity(made)).toBe(true);
    expect(digest, 'recomputed').toHaveBeenCalledTimes(1);
    const packet = await packUnityPracticeMessage(hostResult(g, made));
    expect(packet.sha256).toBe(goldens[0].wire.packets.result.sha256);
    expect(packet.body === goldens[0].wire.packets.result.body).toBe(true);
  });

  it('does not let a made digest vouch for a changed digest field or a swapped record or result', async () => {
    const g = golden(goldens[0]);
    const made = await makeUnityPracticeResolution(g.record, g.result, g.score);
    expect(await hasValidUnityPracticeResolutionIdentity({ ...made, replayDigest: FALSE_DIGEST })).toBe(false);
    // An equal copy of the record is another object: recomputed, found equal.
    const copy = golden(goldens[0]);
    const digest = digestSpy();
    expect(await hasValidUnityPracticeResolutionIdentity({ ...made, record: copy.record })).toBe(true);
    expect(digest).toHaveBeenCalledTimes(1);
    // A different result under the made digest is refused.
    const other = golden(goldens[1]);
    expect(await hasValidUnityPracticeResolutionIdentity({ ...made, result: other.result })).toBe(false);
    // The same fields changed on the made object itself.
    made.replayDigest = FALSE_DIGEST;
    expect(await hasValidUnityPracticeResolutionIdentity(made)).toBe(false);
    await expect(packUnityPracticeMessage(hostResult(g, made))).rejects.toMatchObject({ code: 'integrity' });
  });
});

describe('Unity Practice resolution the host did not make', () => {
  it('is verified by recomputation, hand built, copied or received', async () => {
    const item = goldens[3];
    const g = golden(item);
    const digest = digestSpy();

    expect(await hasValidUnityPracticeResolutionIdentity(handBuilt(g)), 'hand built').toBe(true);
    expect(digest).toHaveBeenCalledTimes(1);
    expect(isUnchangedUnityPracticeResolution(handBuilt(g)), 'a hand-built resolution is never "unchanged"').toBe(false);

    digest.mockClear();
    expect(await hasValidUnityPracticeResolutionIdentity({ ...handBuilt(g), replayDigest: FALSE_DIGEST }), 'false digest').toBe(false);
    expect(digest).toHaveBeenCalledTimes(1);

    digest.mockClear();
    const made = await makeUnityPracticeResolution(g.record, g.result, g.score);
    digest.mockClear();
    expect(await hasValidUnityPracticeResolutionIdentity({ ...made }), 'a copy of a made resolution').toBe(true);
    expect(digest).toHaveBeenCalledTimes(1);
    expect(isUnchangedUnityPracticeResolution({ ...made }), 'nor is a copy of a made one').toBe(false);

    // A packet received from Unity or the network: the packet checksum and then the replay identity, always.
    digest.mockClear();
    const received = await unpackUnityPracticePacket(item.wire.packets.result);
    expect(received.type).toBe('host.result');
    expect(digest).toHaveBeenCalledTimes(2);

    // A hand-built resolution with a false digest is refused when packed, as it always was.
    await expect(packUnityPracticeMessage(hostResult(g, { ...handBuilt(g), replayDigest: FALSE_DIGEST })))
      .rejects.toMatchObject({ code: 'integrity' });
  });

  it('is refused when a received packet carries a digest that is not its own', async () => {
    const item = goldens[4];
    const g = golden(item);
    const forged = makeUnityPracticeMessage(g.fields, 'host.result', { ...handBuilt(g), replayDigest: FALSE_DIGEST });
    const body = canonicalUnityPracticeJson(forged);
    await expect(unpackUnityPracticePacket({ body, sha256: await unityPracticeSha256(body) }))
      .rejects.toMatchObject({ code: 'integrity' });
  });
});

describe('Unity Practice resolution types', () => {
  it('makes a resolution of the contract shape', async () => {
    const g = golden(goldens[5]);
    const made: UnityPracticeResolution = await makeUnityPracticeResolution(g.record as DeliveryRecord, g.result as DeliveryResult, g.score);
    expect(Object.keys(made).sort()).toEqual(['record', 'replayDigest', 'result', 'score']);
  });
});

describe('Unity Practice packets made once', () => {
  const unityReady = () => makeUnityPracticeMessage(
    { buildId: 'packet-test', sessionId: 'packet-session', messageId: 'unity-1', sequence: 0, sender: 'unity' },
    'unity.ready',
    { renderer: 'Vulkan', unityVersion: '6000.3.test' },
  );

  it('freezes the packet it makes, in the golden key order, and remembers the sender and type inside it', async () => {
    const item = goldens[0];
    const g = golden(item);
    const made = await makeUnityPracticeResolution(g.record, g.result, g.score);
    const result = await packUnityPracticeMessage(hostResult(g, made));
    const replay = await packUnityPracticeMessage(hostReplay(g, made));
    for (const packet of [result, replay]) {
      expect(Object.isFrozen(packet)).toBe(true);
      expect(Object.keys(packet)).toEqual(['body', 'sha256']);
      expect(() => { (packet as { body: string }).body = 'changed'; }).toThrow(TypeError);
      expect(() => { (packet as { sha256: string }).sha256 = FALSE_DIGEST; }).toThrow(TypeError);
      expect(() => { (packet as unknown as { extra: number }).extra = 1; }).toThrow(TypeError);
    }
    expect(packedUnityPracticePacket(result)).toEqual({ sender: 'host', type: 'host.result' });
    expect(packedUnityPracticePacket(replay)).toEqual({ sender: 'host', type: 'host.replay' });
    const golden0 = item.wire.packets.result;
    expect(JSON.stringify(result) === JSON.stringify({ body: golden0.body, sha256: golden0.sha256 })).toBe(true);
  });

  it('remembers a packet of any sender, small or large', async () => {
    const ready = await packUnityPracticeMessage(unityReady());
    expect(packedUnityPracticePacket(ready)).toEqual({ sender: 'unity', type: 'unity.ready' });
    const pause = await packUnityPracticeMessage(makeUnityPracticeMessage(
      { buildId: 'packet-test', sessionId: 'packet-session', messageId: 'host-1', sequence: 1, sender: 'host' },
      'host.pause',
      { reason: 'player' },
    ));
    expect(packedUnityPracticePacket(pause)).toEqual({ sender: 'host', type: 'host.pause' });
  });

  it('does not know a packet it did not make: copied, altered, received or hand built', async () => {
    const item = goldens[1];
    const g = golden(item);
    const made = await makeUnityPracticeResolution(g.record, g.result, g.score);
    const packet = await packUnityPracticeMessage(hostResult(g, made));
    expect(packedUnityPracticePacket({ ...packet }), 'a copy').toBeNull();
    expect(packedUnityPracticePacket({ body: packet.body, sha256: packet.sha256 }), 'an equal hand-built packet').toBeNull();
    expect(packedUnityPracticePacket({ ...packet, sha256: FALSE_DIGEST }), 'an altered copy').toBeNull();
    expect(packedUnityPracticePacket(item.wire.packets.result), 'a packet of the checked-in goldens').toBeNull();
    expect(packedUnityPracticePacket(JSON.parse(JSON.stringify(packet))), 'a packet that went through JSON').toBeNull();
    expect(packedUnityPracticePacket(null as unknown as typeof packet)).toBeNull();
    expect(packedUnityPracticePacket(undefined as unknown as typeof packet)).toBeNull();
  });

  it('is still unpacked as before when something unpacks it: checksum checked, identity recomputed', async () => {
    const item = goldens[3];
    const g = golden(item);
    const made = await makeUnityPracticeResolution(g.record, g.result, g.score);
    const packet = await packUnityPracticeMessage(hostResult(g, made));
    const digest = digestSpy();
    const message = await unpackUnityPracticePacket(packet);
    expect(digest, 'unpack still checks the checksum and recomputes the identity of what it receives').toHaveBeenCalledTimes(2);
    expect(message.type).toBe('host.result');
    expect(canonicalUnityPracticeJson(message) === packet.body).toBe(true);
    expect(parseUnityPracticeMessage(packet.body)).toEqual(message);
  });
});

describe('Unity Practice protocol guard replay check', () => {
  const bigAs = (g: Golden) => Math.floor(canonicalUnityPracticeJson(g.result).length * 0.9);

  async function acceptedResult(g: Golden, resolution: UnityPracticeResolution) {
    const guard = guardAtDelivery(g);
    expect(guard.accept(guardResult(resolution))).toBe('accept');
    return guard;
  }

  it('accepts the replay of the made resolution it accepted without canonicalizing a resolution', async () => {
    const g = golden(goldens[2]);
    const made = await makeUnityPracticeResolution(g.record, g.result, g.score);
    const guard = await acceptedResult(g, made);
    let decision = '';
    const big = await countLargeStringifies(bigAs(g), () => { decision = guard.accept(guardReplay(g, made)); });
    expect(decision).toBe('accept');
    expect(big).toBe(0);
    expect(guard.phase).toBe('replaying');
  });

  it('canonicalizes both resolutions, as always, when the same resolution was built by hand', async () => {
    const g = golden(goldens[2]);
    const byHand = handBuilt(g);
    const guard = await acceptedResult(g, byHand);
    let decision = '';
    const big = await countLargeStringifies(bigAs(g), () => { decision = guard.accept(guardReplay(g, byHand)); });
    expect(decision).toBe('accept');
    expect(big, 'two full canonicalizations').toBeGreaterThanOrEqual(2);
  });

  it('accepts the replay of another made resolution with the same content, still without canonicalizing', async () => {
    const g = golden(goldens[4]);
    const copy = golden(goldens[4]);
    const accepted = await makeUnityPracticeResolution(g.record, g.result, g.score);
    const replayed = await makeUnityPracticeResolution(copy.record, copy.result, copy.score);
    expect(replayed).not.toBe(accepted);
    const guard = await acceptedResult(g, accepted);
    let decision = '';
    const big = await countLargeStringifies(bigAs(g), () => { decision = guard.accept(guardReplay(copy, replayed)); });
    expect(decision).toBe('accept');
    expect(big).toBe(0);
  });

  it('refuses the replay of a made resolution that differs in anything but its record and result, without canonicalizing them', async () => {
    const g = golden(goldens[5]);
    const copy = golden(goldens[5]);
    const accepted = await makeUnityPracticeResolution(g.record, g.result, g.score);
    const other = await makeUnityPracticeResolution(copy.record, copy.result, { ...copy.score, runs: copy.score.runs + 1 });
    const guard = await acceptedResult(g, accepted);
    let decision = '';
    const big = await countLargeStringifies(bigAs(g), () => { decision = guard.accept(guardReplay(copy, other)); });
    expect(decision).toBe('replay_mismatch');
    expect(big).toBe(0);
  });

  it('decides as it always did when a resolution changed after it was made', async () => {
    // The replayed resolution changed after it was made: its text no longer matches, so it is canonicalized, found different and refused.
    const g = golden(goldens[6]);
    const copy = golden(goldens[6]);
    const accepted = await makeUnityPracticeResolution(g.record, g.result, g.score);
    const replayed = await makeUnityPracticeResolution(copy.record, copy.result, copy.score);
    copy.result.ball[5].p.y += 0.001;
    const guard = await acceptedResult(g, accepted);
    let decision = '';
    const big = await countLargeStringifies(bigAs(g), () => { decision = guard.accept(guardReplay(copy, replayed)); });
    expect(decision).toBe('replay_mismatch');
    expect(big, 'the fallback canonicalizes').toBeGreaterThanOrEqual(2);

    // The accepted resolution changed after it was made and accepted: the same.
    const g2 = golden(goldens[6]);
    const copy2 = golden(goldens[6]);
    const accepted2 = await makeUnityPracticeResolution(g2.record, g2.result, g2.score);
    const replayed2 = await makeUnityPracticeResolution(copy2.record, copy2.result, copy2.score);
    const guard2 = await acceptedResult(g2, accepted2);
    g2.result.ball[5].p.y += 0.001;
    expect(guard2.accept(guardReplay(copy2, replayed2))).toBe('replay_mismatch');
  });

  it('keeps refusing a replay with another digest before it compares anything', async () => {
    const g = golden(goldens[0]);
    const made = await makeUnityPracticeResolution(g.record, g.result, g.score);
    const guard = await acceptedResult(g, made);
    const forged = { ...made, replayDigest: FALSE_DIGEST };
    let decision = '';
    const big = await countLargeStringifies(bigAs(g), () => { decision = guard.accept(guardReplay(g, forged)); });
    expect(decision).toBe('replay_mismatch');
    expect(big).toBe(0);
  });
});
