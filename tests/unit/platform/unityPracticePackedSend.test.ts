import { describe, expect, it, vi } from 'vitest';
import {
  makeUnityPracticeMessage,
  makeUnityPracticeResolution,
  packUnityPracticeMessage,
  type UnityPracticePacket,
} from '@/contracts';
import type { NativeUnityPracticePlugin } from '@/platform/unityPractice';
import { createUnityPracticeBridge } from '@/platform/unityPractice';
import { FALSE_DIGEST, digestSpy, golden, goldens, hostReplay, hostResult } from '../contracts/goldenResolutions';

/**
 * send() forwards a packet that packUnityPracticeMessage made in this runtime without unpacking it again (it is frozen and was
 * validated as it was made); any other packet is unpacked exactly as before.
 */
function plugin(): NativeUnityPracticePlugin {
  const addListener = vi.fn(async () => ({
    remove: vi.fn(async () => undefined),
  })) as unknown as NativeUnityPracticePlugin['addListener'];
  return {
    availability: vi.fn(async () => ({
      available: true,
      reason: 'linked_unverified' as const,
      unityVersion: '6000.3.test',
      pixelsPerDp: 3,
      systemTextScale: 1,
    })),
    launch: vi.fn(async () => ({ accepted: true })),
    cancelLaunch: vi.fn(async () => ({ cancelled: true })),
    send: vi.fn(async () => ({ accepted: true })),
    setVisible: vi.fn(async () => ({ applied: true })),
    setReadyVisible: vi.fn(async () => ({ applied: true })),
    unload: vi.fn(async () => ({ unloaded: true })),
    addListener,
  };
}

const fields = <TSender extends 'host' | 'unity'>(sender: TSender, sequence: number, messageId: string) => ({
  buildId: 'packed-send-build',
  sessionId: 'packed-send-session',
  messageId,
  sequence,
  sender,
});

const initializePacket = () =>
  packUnityPracticeMessage(
    makeUnityPracticeMessage(fields('host', 0, 'host-0'), 'host.initialize', {
      locale: 'en-IN',
      pixelsPerDp: 3,
      quality: 'standard',
      deviceTier: 'full',
      handedness: 'right',
      assistance: 'play',
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

const pausePacket = () =>
  packUnityPracticeMessage(makeUnityPracticeMessage(fields('host', 1, 'host-1'), 'host.pause', { reason: 'player' }));
const unityReadyPacket = () =>
  packUnityPracticeMessage(
    makeUnityPracticeMessage(fields('unity', 0, 'unity-0'), 'unity.ready', {
      renderer: 'Vulkan',
      unityVersion: '6000.3.test',
    }),
  );

async function launched() {
  const native = plugin();
  const bridge = createUnityPracticeBridge(native, 50);
  expect(await bridge.launch(await initializePacket())).toBe(true);
  return { native, bridge };
}

async function goldenPackets(index: number): Promise<{ result: UnityPracticePacket; replay: UnityPracticePacket }> {
  const g = golden(goldens[index]);
  const made = await makeUnityPracticeResolution(g.record, g.result, g.score);
  return {
    result: await packUnityPracticeMessage(hostResult(g, made)),
    replay: await packUnityPracticeMessage(hostReplay(g, made)),
  };
}

describe('Unity Practice native bridge send of packed packets', () => {
  it('forwards a result and its replay it packed without digesting or unpacking them again', async () => {
    const { result, replay } = await goldenPackets(0);
    const { native, bridge } = await launched();
    const digest = digestSpy();

    expect(await bridge.send(result)).toBe(true);
    expect(await bridge.send(replay)).toBe(true);

    expect(digest).not.toHaveBeenCalled();
    expect(native.send).toHaveBeenNthCalledWith(1, { packet: JSON.stringify(result), operationId: expect.any(String) });
    expect(native.send).toHaveBeenNthCalledWith(2, { packet: JSON.stringify(replay), operationId: expect.any(String) });
  });

  it('forwards a small packed host packet the same way', async () => {
    const pause = await pausePacket();
    const { native, bridge } = await launched();
    const digest = digestSpy();
    expect(await bridge.send(pause)).toBe(true);
    expect(digest).not.toHaveBeenCalled();
    expect(native.send).toHaveBeenCalledWith({ packet: JSON.stringify(pause), operationId: expect.any(String) });
  });

  it('unpacks a copy of the same packet, as before: checksum and replay identity are recomputed', async () => {
    const { result } = await goldenPackets(1);
    const { native, bridge } = await launched();
    const digest = digestSpy();

    expect(await bridge.send({ ...result })).toBe(true);

    expect(digest, 'the checksum and the replay identity').toHaveBeenCalledTimes(2);
    expect(native.send).toHaveBeenCalledWith({ packet: JSON.stringify(result), operationId: expect.any(String) });
  });

  it('refuses an altered copy of a packed packet', async () => {
    const { result } = await goldenPackets(2);
    const { native, bridge } = await launched();

    expect(await bridge.send({ ...result, sha256: FALSE_DIGEST })).toBe(false);
    expect(
      await bridge.send({ body: result.body.replace('"sender":"host"', '"sender":"hosx"'), sha256: result.sha256 }),
    ).toBe(false);
    expect(native.send).not.toHaveBeenCalled();
  });

  it('refuses a packed packet of the other sender and a packed initialize, as an unpacked one is refused', async () => {
    const { native, bridge } = await launched();
    expect(await bridge.send(await unityReadyPacket())).toBe(false);
    expect(await bridge.send(await initializePacket())).toBe(false);
    expect(native.send).not.toHaveBeenCalled();
  });

  it('still refuses every send before launch and after unload', async () => {
    const pause = await pausePacket();
    const native = plugin();
    const bridge = createUnityPracticeBridge(native, 50);
    expect(await bridge.send(pause)).toBe(false);
    expect(await bridge.launch(await initializePacket())).toBe(true);
    expect(await bridge.send(pause)).toBe(true);
    expect(await bridge.unload()).toBe(true);
    expect(await bridge.send(pause)).toBe(false);
    expect(native.send).toHaveBeenCalledTimes(1);
  });
});
