import { vi } from 'vitest';
import {
  UnityPracticeProtocolGuard,
  makeUnityPracticeMessage,
  parseUnityPracticeMessage,
  type UnityPracticePacket,
  type UnityPracticeResolution,
} from '@/contracts';
import fixtureJson from '../../fixtures/unity-practice/practice-v3.json';

/**
 * Helpers for tests that run the Unity Practice resolution, packet and protocol-guard shortcuts on the seven shared
 * goldens (tests/fixtures/unity-practice/practice-v3.json): real 280 to 410 KB results, not small fixtures.
 */
export interface GoldenCase {
  id: string;
  wire: { replayDigest: string; packets: Record<'scene' | 'delivery' | 'result' | 'replay', UnityPracticePacket> };
}

export const goldens = (fixtureJson as unknown as { cases: GoldenCase[] }).cases;

/** A fresh deep copy of one golden (parsing the checked-in bodies again), so a test may change it freely. */
export function golden(item: GoldenCase) {
  const resultMessage = parseUnityPracticeMessage(item.wire.packets.result.body);
  const replayMessage = parseUnityPracticeMessage(item.wire.packets.replay.body);
  const sceneMessage = parseUnityPracticeMessage(item.wire.packets.scene.body);
  const deliveryMessage = parseUnityPracticeMessage(item.wire.packets.delivery.body);
  if (
    resultMessage.type !== 'host.result' ||
    replayMessage.type !== 'host.replay' ||
    sceneMessage.type !== 'host.scene' ||
    deliveryMessage.type !== 'host.delivery'
  ) {
    throw new Error(`golden packet narrowing failed for ${item.id}`);
  }
  return {
    record: resultMessage.payload.record,
    result: resultMessage.payload.result,
    score: resultMessage.payload.score,
    replayDigest: resultMessage.payload.replayDigest,
    scene: sceneMessage.payload,
    delivery: deliveryMessage.payload,
    fields: {
      buildId: resultMessage.buildId,
      sessionId: resultMessage.sessionId,
      deliveryId: resultMessage.deliveryId,
      messageId: resultMessage.messageId,
      sequence: resultMessage.sequence,
      sender: 'host' as const,
    },
    replayFields: {
      buildId: replayMessage.buildId,
      sessionId: replayMessage.sessionId,
      deliveryId: replayMessage.deliveryId,
      messageId: replayMessage.messageId,
      sequence: replayMessage.sequence,
      sender: 'host' as const,
    },
    replay: { speed: replayMessage.payload.speed, diagnostics: replayMessage.payload.diagnostics },
  };
}
export type Golden = ReturnType<typeof golden>;

export const hostResult = (g: Golden, resolution: UnityPracticeResolution) =>
  makeUnityPracticeMessage(g.fields, 'host.result', resolution);
export const hostReplay = (g: Golden, resolution: UnityPracticeResolution) =>
  makeUnityPracticeMessage(g.replayFields, 'host.replay', { resolution, ...g.replay });
export const handBuilt = (g: Golden): UnityPracticeResolution => ({
  record: g.record,
  result: g.result,
  score: g.score,
  replayDigest: g.replayDigest,
});

export const FALSE_DIGEST = 'f'.repeat(64);
export const digestSpy = () => vi.spyOn(globalThis.crypto.subtle, 'digest');

const guardFields = <TSender extends 'host' | 'unity'>(
  sender: TSender,
  sequence: number,
  messageId: string,
  deliveryId: string | null = null,
) => ({
  buildId: 'golden-guard-build',
  sessionId: 'golden-guard-session',
  deliveryId,
  messageId,
  sequence,
  sender,
});

export const GUARD_DELIVERY_ID = 'golden-guard-delivery';

/**
 * A real protocol guard brought to the delivery phase for the golden (the host messages are built from the golden's own
 * scene and delivery payloads), exactly where the coordinator has it when host.result is sent. Host sequences 0 to 8 are used.
 */
export function guardAtDelivery(g: Golden): UnityPracticeProtocolGuard {
  const guard = new UnityPracticeProtocolGuard();
  const accept = (message: Parameters<UnityPracticeProtocolGuard['accept']>[0]) => {
    const decision = guard.accept(message);
    if (decision !== 'accept') throw new Error(`guard setup: ${(message as { type: string }).type} was ${decision}`);
  };
  accept(
    makeUnityPracticeMessage(guardFields('host', 0, 'init'), 'host.initialize', {
      locale: 'en-IN',
      pixelsPerDp: 1,
      quality: 'standard',
      deviceTier: 'full',
      handedness: 'right',
      assistance: g.record.assist,
      reducedMotion: false,
      textScale: 1,
      highContrast: false,
      captions: true,
      audio: true,
      haptics: true,
      coordinateSystem: 'vande-striker-frame-v1',
      handednessPolicy: 'physics-right-handed-presentation-mirrors-once',
    }),
  );
  accept(
    makeUnityPracticeMessage(guardFields('unity', 0, 'ready'), 'unity.ready', {
      renderer: 'Vulkan',
      unityVersion: '6000.3.test',
    }),
  );
  for (let index = 0; index < 5; index += 1) {
    const hostSendPerfMs = 1_000 + index * 10;
    accept(
      makeUnityPracticeMessage(guardFields('host', index + 1, `ping-${index}`), 'host.clock_sync', {
        sampleId: `clock-${index}`,
        hostSendPerfMs,
      }),
    );
    accept(
      makeUnityPracticeMessage(guardFields('unity', index + 1, `pong-${index}`), 'unity.clock_sync', {
        sampleId: `clock-${index}`,
        hostSendPerfMs,
        unityReceiveMs: hostSendPerfMs - 48,
        unitySendMs: hostSendPerfMs - 47,
      }),
    );
  }
  accept(makeUnityPracticeMessage(guardFields('host', 6, 'selected'), 'host.clock_selected', { sampleId: 'clock-1' }));
  accept(makeUnityPracticeMessage(guardFields('host', 7, 'scene'), 'host.scene', g.scene));
  accept(makeUnityPracticeMessage(guardFields('host', 8, 'delivery', GUARD_DELIVERY_ID), 'host.delivery', g.delivery));
  return guard;
}

/** The host.result and host.replay messages the guard sees after guardAtDelivery (host sequences 9 and 10). */
export const guardResult = (resolution: UnityPracticeResolution) =>
  makeUnityPracticeMessage(guardFields('host', 9, 'result', GUARD_DELIVERY_ID), 'host.result', resolution);
export const guardReplay = (g: Golden, resolution: UnityPracticeResolution) =>
  makeUnityPracticeMessage(guardFields('host', 10, 'replay', GUARD_DELIVERY_ID), 'host.replay', {
    resolution,
    ...g.replay,
  });
