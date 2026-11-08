import { describe, expect, it } from 'vitest';
import { PRACTICE_SIM_VERSION } from '@/contracts/practice';
import {
  UNITY_PRACTICE_CONTRACT_VERSION,
  UNITY_PRACTICE_TRACE_VERSION,
  canonicalUnityPracticeJson,
  unityPracticeSha256,
  unpackUnityPracticePacket,
  type UnityPracticeMessage,
  type UnityPracticePacket,
} from '@/contracts/unityPractice';
import { batAt } from '@/render3d/practice/frame';
import fixtureJson from '../../fixtures/unity-practice/practice-v3.json';

interface GoldenCase {
  id: string;
  intent: string;
  timingOffsetMs: number;
  input: {
    gesture: { samples: Array<{ t: number; x: number; y: number }> };
    swing: { kind: 'defend' | 'attack'; startT: number; directionDeg: number; power: number; elevation: number };
  };
  flight: { sampleCount: number; wouldHitStumps: boolean };
  result: {
    contact: { kind: string; timing: string; timingErrorMs: number | null };
    outcome: { runs: number; boundary: number | null; dismissal: string | null };
    eventClasses: Array<{ kind: string }>;
    batSampleCount: number;
    ballSampleCount: number;
    fielderPathCount: number;
    deadT: number;
  };
  digests: Record<string, string>;
  tracePlayback: {
    batterRootOffset: { x: number; z: number };
    batterBodyFrame: {
      stance: { x: number; z: number };
      torsoTop: { x: number; y: number; z: number };
      headCentre: { x: number; y: number; z: number };
    };
    batterPosture: { crouchM: number };
    batterMotion: null | { startT: number; contactT: number; endT: number };
    batProbes: Array<{
      t: number;
      bat: null | {
        grip: { x: number; y: number; z: number };
        toe: { x: number; y: number; z: number };
        face: { x: number; y: number; z: number };
      };
    }>;
  };
  wire: {
    replayDigest: string;
    packets: Record<'scene' | 'delivery' | 'result' | 'replay', UnityPracticePacket>;
  };
  replayMatchesResult: boolean;
}

interface GoldenFixture {
  schema: string;
  fixtureVersion: number;
  simulationVersion: number;
  canonicalization: string;
  payloadSha256: string;
  coverage: { intents: string[]; contacts: string[]; timings: string[]; allReplaysMatch: boolean };
  reachProxyEvidence: {
    schema: string;
    simulationVersion: number;
    passCount: number;
    corpus: { expected: number; completed: number; crashes: unknown[] };
    normalizedSummarySha256: string;
    gameplayHash: string;
    outcomeHash: string;
    sourceSha256: Record<string, string>;
    proxySelection: { ids: string[]; uncovered: string[] };
  };
  reachProxies: Array<{
    id: string;
    family: string;
    footwork: string;
    contactU: number;
    batterRootOffset: { x: number; z: number };
    batterBodyFrame: {
      stance: { x: number; z: number };
      torsoTop: { x: number; y: number; z: number };
      headCentre: { x: number; y: number; z: number };
    };
    batterPosture: { crouchM: number };
    batterMotion: { startT: number; contactT: number; endT: number };
    batProbes: Array<{ t: number; bat: null | { grip: object; toe: object; face: object } }>;
  }>;
  cases: GoldenCase[];
}

function fixture(): GoldenFixture {
  return fixtureJson as unknown as GoldenFixture;
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite golden number');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      if (input[key] !== undefined) out[key] = canonicalValue(input[key]);
    }
    return out;
  }
  throw new TypeError(`unsupported golden value: ${typeof value}`);
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalValue(value)));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The checked-in corpus was regenerated on the frozen simulation-v3 phase-5b build (2026-11-03T13:20Z freeze) and is
 * framed at the current contract, so every packet is checked exactly as written (its SHA-256, canonical JSON and
 * framing) and unpacked unchanged. The re-framing path below stays only for a corpus framed at an older contract.
 */
const GOLDEN_FRAMING_CONTRACT = UNITY_PRACTICE_CONTRACT_VERSION;

async function unpackGoldenPacket(packet: UnityPracticePacket, id: string): Promise<UnityPracticeMessage> {
  expect(await unityPracticeSha256(packet.body), `${id} packet integrity as written`).toBe(packet.sha256);
  const framed = JSON.parse(packet.body) as Record<string, unknown>;
  expect(canonicalUnityPracticeJson(framed), `${id} canonical as written`).toBe(packet.body);
  expect(framed.contractVersion, `${id} corpus framing`).toBe(GOLDEN_FRAMING_CONTRACT);
  if (framed.contractVersion === UNITY_PRACTICE_CONTRACT_VERSION) return unpackUnityPracticePacket(packet);
  const body = canonicalUnityPracticeJson({ ...framed, contractVersion: UNITY_PRACTICE_CONTRACT_VERSION });
  return unpackUnityPracticePacket({ body, sha256: await unityPracticeSha256(body) });
}

function byIntent(value: GoldenFixture, intent: string): GoldenCase {
  const found = value.cases.find((item) => item.intent === intent);
  if (!found) throw new Error(`missing Unity golden intent ${intent}`);
  return found;
}

describe('Practice Unity TypeScript-v3 golden fixture', () => {
  it('has a valid canonical payload digest and exact replay digests', async () => {
    const value = fixture();
    expect(value.schema).toBe('vande.practice.unity-golden');
    expect(value.fixtureVersion).toBe(3);
    expect(value.simulationVersion).toBe(PRACTICE_SIM_VERSION);
    expect(value.canonicalization).toBe('recursive-key-sort-json-sha256-v1');

    const { payloadSha256, ...payload } = value;
    expect(payloadSha256).toBe(await sha256(payload));
    expect(value.coverage.allReplaysMatch).toBe(true);
    expect(value.reachProxyEvidence).toMatchObject({
      schema: 'vande.practice.reach-proxies.v3',
      simulationVersion: PRACTICE_SIM_VERSION,
      passCount: 2,
      corpus: { expected: 7_560, completed: 7_560, crashes: [] },
      proxySelection: { uncovered: [] },
    });
    expect(value.reachProxyEvidence.normalizedSummarySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.values(value.reachProxyEvidence.sourceSha256)).not.toHaveLength(0);
    for (const digest of Object.values(value.reachProxyEvidence.sourceSha256)) {
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(value.reachProxies.length).toBeGreaterThan(0);
    expect(value.reachProxyEvidence.proxySelection.ids).toEqual(value.reachProxies.map((proxy) => proxy.id));
    expect(new Set(value.reachProxies.map((proxy) => proxy.id)).size).toBe(value.reachProxies.length);
    for (const proxy of value.reachProxies) {
      expect(proxy.batterMotion.startT, proxy.id).toBeLessThan(proxy.batterMotion.contactT);
      expect(proxy.batterMotion.contactT, proxy.id).toBeLessThan(proxy.batterMotion.endT);
      expect(proxy.batProbes.length, proxy.id).toBeGreaterThan(0);
    }
    expect(value.cases).toHaveLength(7);
    for (const item of value.cases) {
      expect(item.replayMatchesResult, item.id).toBe(true);
      expect(item.digests.resultSha256, item.id).toBe(item.digests.replaySha256);
      for (const digest of Object.values(item.digests)) expect(digest, item.id).toMatch(/^[0-9a-f]{64}$/);
      expect(item.flight.sampleCount, item.id).toBeGreaterThan(100);
      expect(item.result.fielderPathCount, item.id).toBe(11);
      expect(item.result.eventClasses[0], item.id).toEqual({ kind: 'release' });
      expect(item.result.eventClasses.at(-1), item.id).toEqual({ kind: 'dead' });
      const messages = await Promise.all([
        unpackGoldenPacket(item.wire.packets.scene, item.id),
        unpackGoldenPacket(item.wire.packets.delivery, item.id),
        unpackGoldenPacket(item.wire.packets.result, item.id),
        unpackGoldenPacket(item.wire.packets.replay, item.id),
      ]);
      expect(
        messages.map((message) => message.type),
        item.id,
      ).toEqual(['host.scene', 'host.delivery', 'host.result', 'host.replay']);
      const [scene, delivery, result, replay] = messages;
      expect(
        messages.every((message) => message.contractVersion === UNITY_PRACTICE_CONTRACT_VERSION),
        item.id,
      ).toBe(true);
      expect(
        messages.every((message) => message.simVersion === PRACTICE_SIM_VERSION),
        item.id,
      ).toBe(true);
      expect(scene.sequence, item.id).toBe(0);
      expect(delivery.sequence, item.id).toBe(1);
      expect(result.sequence, item.id).toBe(2);
      expect(replay.sequence, item.id).toBe(3);
      if (delivery.type !== 'host.delivery' || result.type !== 'host.result' || replay.type !== 'host.replay') {
        throw new Error(`golden packet narrowing failed for ${item.id}`);
      }
      expect(delivery.payload.flight.samples.length, item.id).toBe(item.flight.sampleCount);
      expect(result.payload.result.ball.length, item.id).toBe(item.result.ballSampleCount);
      expect(result.payload.result.bat.length, item.id).toBe(item.result.batSampleCount);
      expect(result.payload.result.fielders, item.id).toHaveLength(11);
      expect(result.payload.result.batterRootOffset, item.id).toEqual(item.tracePlayback.batterRootOffset);
      expect(result.payload.result.batterBodyFrame, item.id).toEqual(item.tracePlayback.batterBodyFrame);
      expect(result.payload.result.batterPosture, item.id).toEqual(item.tracePlayback.batterPosture);
      expect(result.payload.result.batterMotion, item.id).toEqual(item.tracePlayback.batterMotion);
      expect(result.payload.replayDigest, item.id).toBe(item.wire.replayDigest);
      expect(replay.payload.resolution, item.id).toEqual(result.payload);
      const contact = result.payload.result.events.find(
        (event) =>
          event.kind === 'contact' &&
          ['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge'].includes(event.contact ?? ''),
      );
      for (const probe of item.tracePlayback.batProbes) {
        expect(probe.t, `${item.id} probe lower domain`).toBeGreaterThanOrEqual(0);
        expect(probe.t, `${item.id} probe upper domain`).toBeLessThanOrEqual(item.result.deadT);
        const actual = batAt(
          result.payload.result.bat,
          probe.t,
          contact?.t ?? null,
          result.payload.result.batterMotion?.contactT ?? null,
        );
        if (probe.bat === null) expect(actual, `${item.id} probe ${probe.t}`).toBeNull();
        else {
          expect(actual, `${item.id} probe ${probe.t}`).not.toBeNull();
          expect(actual!.grip, `${item.id} probe ${probe.t} grip`).toEqual(probe.bat.grip);
          expect(actual!.toe, `${item.id} probe ${probe.t} toe`).toEqual(probe.bat.toe);
          expect(actual!.face, `${item.id} probe ${probe.t} face`).toEqual(probe.bat.face);
        }
      }
      for (let index = 1; index < item.input.gesture.samples.length; index++) {
        expect(item.input.gesture.samples[index].t, item.id).toBeGreaterThan(item.input.gesture.samples[index - 1].t);
      }
    }
    expect(UNITY_PRACTICE_TRACE_VERSION).toBe(2);
  });

  it('covers semantic input intent and canonical contact classes without rerolling outcomes', () => {
    const value = fixture();
    expect(value.coverage.intents).toEqual([
      'defensive_tap',
      'grounded_attack',
      'deliberate_loft',
      'early',
      'late',
      'edge',
      'miss',
    ]);

    const defence = byIntent(value, 'defensive_tap');
    expect(defence.input.swing).toMatchObject({ kind: 'defend', directionDeg: 0, elevation: 0 });

    const ground = byIntent(value, 'grounded_attack');
    expect(ground.input.swing.kind).toBe('attack');
    expect(ground.input.swing.elevation).toBe(0);
    expect(ground.result.contact.kind).toBe('middle');

    const loft = byIntent(value, 'deliberate_loft');
    expect(loft.input.swing.kind).toBe('attack');
    expect(loft.input.swing.elevation).toBeGreaterThan(0);
    expect(loft.result.contact.kind).toBe('middle');

    const early = byIntent(value, 'early');
    expect(early.timingOffsetMs).toBeLessThan(0);
    expect(early.result.contact.timingErrorMs).not.toBeNull();
    expect(early.result.contact.timingErrorMs!).toBeLessThan(0);

    const late = byIntent(value, 'late');
    expect(late.timingOffsetMs).toBeGreaterThan(0);
    expect(late.result.contact.timingErrorMs).not.toBeNull();
    expect(late.result.contact.timingErrorMs!).toBeGreaterThan(0);

    expect(byIntent(value, 'edge').result.contact.kind).toMatch(/_edge$/);
    expect(byIntent(value, 'miss').result.contact.kind).toBe('miss');
    expect(value.coverage.contacts).toEqual(expect.arrayContaining(['middle', 'miss', 'outside_edge']));
  });
});
