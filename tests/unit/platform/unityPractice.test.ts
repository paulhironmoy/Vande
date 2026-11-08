import { describe, expect, it, vi } from 'vitest';
import { makeUnityPracticeMessage, packUnityPracticeMessage, type UnityPracticePacket } from '@/contracts';
import type { NativeUnityPracticePlugin } from '@/platform/unityPractice';
import { createUnityPracticeBridge, unityAvailabilityRequiresClassic } from '@/platform/unityPractice';

async function hostPacket(type: 'host.initialize' | 'host.pause' = 'host.initialize'): Promise<UnityPracticePacket> {
  if (type === 'host.pause') {
    return packUnityPracticeMessage(
      makeUnityPracticeMessage(
        {
          buildId: 'test-build',
          sessionId: 'session-1',
          messageId: 'host-2',
          sequence: 1,
          sender: 'host',
        },
        type,
        { reason: 'player' },
      ),
    );
  }
  return packUnityPracticeMessage(
    makeUnityPracticeMessage(
      {
        buildId: 'test-build',
        sessionId: 'session-1',
        messageId: 'host-1',
        sequence: 0,
        sender: 'host',
      },
      type,
      {
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
      },
    ),
  );
}

async function unityPacket(): Promise<UnityPracticePacket> {
  return packUnityPracticeMessage(
    makeUnityPracticeMessage(
      {
        buildId: 'test-build',
        sessionId: 'session-1',
        messageId: 'unity-1',
        sequence: 0,
        sender: 'unity',
      },
      'unity.ready',
      { renderer: 'Vulkan', unityVersion: '6000.3.test' },
    ),
  );
}

async function unityStatsPacket(): Promise<UnityPracticePacket> {
  return packUnityPracticeMessage(
    makeUnityPracticeMessage(
      {
        buildId: 'test-build',
        sessionId: 'session-1',
        messageId: 'unity-2',
        sequence: 1,
        sender: 'unity',
      },
      'unity.stats',
      {
        quality: 'standard',
        sampleCount: 180,
        spikes: 2,
        fps: 60,
        avgFrameMs: 16.7,
        p95FrameMs: 18,
        p99FrameMs: 22,
        worstFrameMs: 28,
        inputToVisibleBatMs: 40,
        memoryMb: 256,
        thermalState: 'nominal',
      },
    ),
  );
}

function plugin(overrides: Partial<NativeUnityPracticePlugin> = {}): NativeUnityPracticePlugin {
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
    ...overrides,
  };
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await vi.advanceTimersByTimeAsync(0);
  }
  throw new Error('condition did not become true');
}

describe('Unity Practice platform bridge', () => {
  it('routes only native low-memory admission directly to Classic', () => {
    const lowMemory = { available: false, reason: 'low_memory_device' as const, unityVersion: null };
    expect(unityAvailabilityRequiresClassic(lowMemory, false)).toBe(true);
    expect(unityAvailabilityRequiresClassic(lowMemory, true)).toBe(false);
    for (const reason of ['unsupported_native_abi', 'unsupported_graphics_api', 'unity_export_missing'] as const) {
      expect(unityAvailabilityRequiresClassic({ available: false, reason, unityVersion: null }, false)).toBe(false);
    }
    expect(
      unityAvailabilityRequiresClassic(
        {
          available: true,
          reason: 'ready',
          unityVersion: '6000.3.test',
        },
        false,
      ),
    ).toBe(false);
  });

  it('is inert when the native plugin is absent', async () => {
    const packet = await hostPacket();
    const bridge = createUnityPracticeBridge(null, 10);
    expect(await bridge.availability()).toMatchObject({ available: false, reason: 'plugin_missing' });
    expect(await bridge.launch(packet)).toBe(false);
    expect(await bridge.send(packet)).toBe(false);
    expect(await bridge.setVisible(true)).toBe(false);
    expect(await bridge.setReadyVisible?.(true, 'Localized cue')).toBe(false);
    expect(await bridge.unload()).toBe(true);
  });

  it('keeps the retained renderer active when native reports a low-memory device', async () => {
    const native = plugin({
      availability: vi.fn(async () => ({
        available: false,
        reason: 'low_memory_device' as const,
        unityVersion: null,
      })),
    });
    const bridge = createUnityPracticeBridge(native, 50);

    expect(await bridge.availability()).toEqual({
      available: false,
      reason: 'low_memory_device',
      unityVersion: null,
    });
    expect(await bridge.launch(await hostPacket())).toBe(false);
    expect(native.launch).not.toHaveBeenCalled();
  });

  it('keeps the retained renderer active when the process cannot load the ARM64 Unity export', async () => {
    const native = plugin({
      availability: vi.fn(async () => ({
        available: false,
        reason: 'unsupported_native_abi' as const,
        unityVersion: null,
      })),
    });
    const bridge = createUnityPracticeBridge(native, 50);

    expect(await bridge.availability()).toEqual({
      available: false,
      reason: 'unsupported_native_abi',
      unityVersion: null,
    });
    expect(await bridge.launch(await hostPacket())).toBe(false);
    expect(native.launch).not.toHaveBeenCalled();
  });

  it('fails closed when native availability contradicts its memory reason', async () => {
    const native = plugin({
      availability: vi.fn(async () => ({
        available: true,
        reason: 'low_memory_device' as const,
        unityVersion: '6000.3.test',
      })),
    });
    const bridge = createUnityPracticeBridge(native, 50);

    expect(await bridge.availability()).toMatchObject({ available: false, reason: 'low_memory_device' });
    expect(await bridge.launch(await hostPacket())).toBe(false);
    expect(native.launch).not.toHaveBeenCalled();
  });

  it('fails availability closed without an authoritative bounded logical density', async () => {
    for (const pixelsPerDp of [undefined, 0.99, 8.01, Number.NaN]) {
      const native = plugin({
        availability: vi.fn(async () => ({
          available: true,
          reason: 'ready' as const,
          unityVersion: '6000.3.test',
          pixelsPerDp,
          systemTextScale: 1,
        })),
      });
      const bridge = createUnityPracticeBridge(native, 50);
      expect(await bridge.availability()).toMatchObject({ available: false, reason: 'ready' });
      expect(await bridge.launch(await hostPacket())).toBe(false);
      expect(native.launch).not.toHaveBeenCalled();
    }
  });

  it('fails availability closed without an authoritative bounded Android system font scale', async () => {
    for (const systemTextScale of [undefined, 0.49, 3.01, Number.NaN]) {
      const native = plugin({
        availability: vi.fn(async () => ({
          available: true,
          reason: 'ready' as const,
          unityVersion: '6000.3.test',
          pixelsPerDp: 3,
          systemTextScale,
        })),
      });
      const bridge = createUnityPracticeBridge(native, 50);
      expect(await bridge.availability()).toMatchObject({ available: false, reason: 'ready' });
      expect(await bridge.launch(await hostPacket())).toBe(false);
      expect(native.launch).not.toHaveBeenCalled();
    }
  });

  it('launches only a valid initialize, then sends valid host packets for the active operation', async () => {
    const initial = await hostPacket();
    const pause = await hostPacket('host.pause');
    const native = plugin();
    const bridge = createUnityPracticeBridge(native, 50);
    expect(await bridge.send(pause)).toBe(false);
    expect(await bridge.launch(initial)).toBe(true);
    expect(await bridge.send(pause)).toBe(true);
    expect(await bridge.setVisible(true)).toBe(true);
    expect(await bridge.setReadyVisible?.(true, 'Pull back · Watch · Flick forward')).toBe(true);
    expect(native.launch).toHaveBeenCalledWith(
      expect.objectContaining({ packet: JSON.stringify(initial), operationId: expect.any(String) }),
    );
    expect(native.send).toHaveBeenCalledWith(
      expect.objectContaining({ packet: JSON.stringify(pause), operationId: expect.any(String) }),
    );
    expect(native.setVisible).toHaveBeenCalledWith(
      expect.objectContaining({ visible: true, operationId: expect.any(String) }),
    );
    expect(native.setReadyVisible).toHaveBeenCalledWith(
      expect.objectContaining({
        visible: true,
        hint: 'Pull back · Watch · Flick forward',
        operationId: expect.any(String),
      }),
    );
    expect(await bridge.unload()).toBe(true);
  });

  it('cancels the matching native launch when readiness times out', async () => {
    const never = new Promise<{ accepted: boolean }>(() => undefined);
    const native = plugin({ launch: () => never });
    const bridge = createUnityPracticeBridge(native, 5);
    expect(await bridge.launch(await hostPacket())).toBe(false);
    expect(native.cancelLaunch).toHaveBeenCalledWith({ operationId: expect.any(String) });
  });

  it('accepts a deferred native launch just before its bounded deadline without cancelling it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const launchTimeoutMs = 15_000;
      let resolveLaunch: (value: { accepted: boolean }) => void = () => undefined;
      const native = plugin({
        launch: vi.fn(
          () =>
            new Promise<{ accepted: boolean }>((resolve) => {
              resolveLaunch = resolve;
            }),
        ),
      });
      const bridge = createUnityPracticeBridge(native, 50, launchTimeoutMs);

      const pending = bridge.launch(await hostPacket());
      await waitForCondition(() => vi.mocked(native.launch).mock.calls.length === 1);
      expect(native.launch).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(launchTimeoutMs - 1);
      resolveLaunch({ accepted: true });

      expect(await pending).toBe(true);
      expect(native.cancelLaunch).not.toHaveBeenCalled();
      expect(await bridge.send(await hostPacket('host.pause'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a timed-out operation owned until physical native unload completes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const launchTimeoutMs = 15_000;
      let resolveFirstLaunch: (value: { accepted: boolean }) => void = () => undefined;
      let resolveCancellation: (value: { cancelled: boolean }) => void = () => undefined;
      let resolvePhysicalUnload: (value: { unloaded: boolean }) => void = () => undefined;
      let launchCount = 0;
      const native = plugin({
        launch: vi.fn(() => {
          launchCount += 1;
          if (launchCount === 1) {
            return new Promise<{ accepted: boolean }>((resolve) => {
              resolveFirstLaunch = resolve;
            });
          }
          return Promise.resolve({ accepted: true });
        }),
        cancelLaunch: vi.fn(
          () =>
            new Promise<{ cancelled: boolean }>((resolve) => {
              resolveCancellation = resolve;
            }),
        ),
        unload: vi.fn(
          () =>
            new Promise<{ unloaded: boolean }>((resolve) => {
              resolvePhysicalUnload = resolve;
            }),
        ),
      });
      const bridge = createUnityPracticeBridge(native, 50, launchTimeoutMs);
      const packet = await hostPacket();

      const first = bridge.launch(packet);
      await waitForCondition(() => vi.mocked(native.launch).mock.calls.length === 1);
      expect(native.launch).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(launchTimeoutMs);
      await waitForCondition(() => vi.mocked(native.cancelLaunch).mock.calls.length === 1);
      expect(native.cancelLaunch).toHaveBeenCalledOnce();
      const firstOperationId = vi.mocked(native.launch).mock.calls[0]?.[0].operationId;

      // Cancellation is still pending, so retry cannot overlap the native operation being torn down.
      expect(await bridge.launch(packet)).toBe(false);
      expect(native.launch).toHaveBeenCalledOnce();

      resolveCancellation({ cancelled: true });
      await waitForCondition(() => vi.mocked(native.unload).mock.calls.length === 1);
      expect(native.unload).toHaveBeenCalledWith({ operationId: firstOperationId });
      // The bridge launch remains unresolved and the generation remains reserved until physical unload completes.
      expect(await bridge.launch(packet)).toBe(false);
      expect(native.launch).toHaveBeenCalledOnce();
      resolvePhysicalUnload({ unloaded: true });
      expect(await first).toBe(false);
      // A launch promise resolving after cancellation must not make its stale operation active.
      resolveFirstLaunch({ accepted: true });
      await Promise.resolve();
      expect(await bridge.send(await hostPacket('host.pause'))).toBe(false);

      expect(await bridge.launch(packet)).toBe(true);
      expect(native.launch).toHaveBeenCalledTimes(2);
      expect(vi.mocked(native.launch).mock.calls[1]?.[0].operationId).not.toBe(firstOperationId);
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes concurrent launches and keeps a cancelled generation reserved through physical unload', async () => {
    let availabilityRelease: () => void = () => {};
    const availabilityGate = new Promise<void>((resolve) => {
      availabilityRelease = () => resolve();
    });
    let cancelRelease: () => void = () => {};
    const cancelGate = new Promise<{ cancelled: boolean }>((resolve) => {
      cancelRelease = () => resolve({ cancelled: true });
    });
    let launches = 0;
    const native = plugin({
      availability: vi.fn(async () => {
        await availabilityGate;
        return {
          available: true,
          reason: 'linked_unverified' as const,
          unityVersion: '6000.3.test',
          pixelsPerDp: 3,
          systemTextScale: 1,
        };
      }),
      launch: vi.fn(async () => {
        launches += 1;
        if (launches === 1) return new Promise<{ accepted: boolean }>(() => undefined);
        return { accepted: true };
      }),
      cancelLaunch: vi.fn(() => cancelGate),
    });
    const bridge = createUnityPracticeBridge(native, 50, 5);
    const packet = await hostPacket();

    const first = bridge.launch(packet);
    expect(await bridge.launch(packet)).toBe(false);
    availabilityRelease();
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Timeout has fired, but native cancellation has not completed: retry remains locked out.
    expect(await bridge.launch(packet)).toBe(false);
    cancelRelease();
    expect(await first).toBe(false);
    expect(native.unload).toHaveBeenCalledOnce();
    expect(await bridge.launch(packet)).toBe(true);
    expect(native.launch).toHaveBeenCalledTimes(2);
  });

  it('aborts a launch disposed during availability without creating or certifying a native player', async () => {
    let releaseAvailability: () => void = () => undefined;
    const availabilityGate = new Promise<void>((resolve) => {
      releaseAvailability = resolve;
    });
    const native = plugin({
      availability: vi.fn(async () => {
        await availabilityGate;
        return {
          available: true,
          reason: 'linked_unverified' as const,
          unityVersion: '6000.3.test',
          pixelsPerDp: 3,
          systemTextScale: 1,
        };
      }),
    });
    const bridge = createUnityPracticeBridge(native, 50, 500);
    const packet = await hostPacket();

    const pending = bridge.launch(packet);
    for (let attempt = 0; attempt < 20 && vi.mocked(native.availability).mock.calls.length === 0; attempt += 1) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
    expect(native.availability).toHaveBeenCalledOnce();
    expect(await bridge.unload()).toBe(false);
    releaseAvailability();
    expect(await pending).toBe(false);
    expect(native.launch).not.toHaveBeenCalled();
    expect(native.cancelLaunch).not.toHaveBeenCalled();
    expect(native.unload).not.toHaveBeenCalled();

    expect(await bridge.launch(packet)).toBe(true);
    expect(native.launch).toHaveBeenCalledOnce();
  });

  it('verifies checksum, canonical body and Unity direction before dispatching native events', async () => {
    let emit: ((event: { packet: string; operationId?: string }) => void) | null = null;
    const remove = vi.fn(async () => undefined);
    const addListener = vi.fn(async (event: string, listener: (value: { packet: string }) => void) => {
      if (event === 'message') emit = listener;
      return { remove };
    }) as unknown as NativeUnityPracticePlugin['addListener'];
    const native = plugin({ addListener });
    const seen: UnityPracticePacket[] = [];
    const bridge = createUnityPracticeBridge(native, 50);
    const off = await bridge.onMessage((value) => seen.push(value));
    expect(await bridge.launch(await hostPacket())).toBe(true);
    const activeOperationId = (vi.mocked(native.launch).mock.calls[0]?.[0] as { operationId: string }).operationId;
    if (!emit) throw new Error('listener was not registered');
    const valid = await unityPacket();
    const host = await hostPacket();
    (emit as (event: { packet: string; operationId: string }) => void)({
      packet: 'not-json',
      operationId: activeOperationId,
    });
    (emit as (event: { packet: string; operationId: string }) => void)({
      packet: JSON.stringify({ ...valid, sha256: '0'.repeat(64) }),
      operationId: activeOperationId,
    });
    (emit as (event: { packet: string; operationId: string }) => void)({
      packet: JSON.stringify(host),
      operationId: activeOperationId,
    });
    (emit as (event: { packet: string; operationId: string }) => void)({
      packet: JSON.stringify(valid),
      operationId: 'stale-operation',
    });
    (emit as (event: { packet: string; operationId: string }) => void)({
      packet: JSON.stringify(valid),
      operationId: activeOperationId,
    });
    await vi.waitFor(() => expect(seen).toEqual([valid]));
    await off();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('provides a bounded, typed native error channel', async () => {
    let emit: ((event: { code?: string; detail?: string; operationId?: string }) => void) | null = null;
    const addListener = vi.fn(async (event: string, listener: (value: { code?: string; detail?: string }) => void) => {
      if (event === 'error') emit = listener;
      return { remove: vi.fn(async () => undefined) };
    }) as unknown as NativeUnityPracticePlugin['addListener'];
    const seen: unknown[] = [];
    const native = plugin({ addListener });
    const bridge = createUnityPracticeBridge(native, 50);
    await bridge.onError((error) => seen.push(error));
    expect(await bridge.launch(await hostPacket())).toBe(true);
    const activeOperationId = (vi.mocked(native.launch).mock.calls[0]?.[0] as { operationId: string }).operationId;
    if (!emit) throw new Error('listener was not registered');
    (emit as (event: { code?: string; detail?: string; operationId?: string }) => void)({
      code: 'lifecycle',
      detail: 'failed closed',
      operationId: activeOperationId,
    });
    expect(seen).toEqual([{ code: 'lifecycle', detail: 'failed closed', operationId: activeOperationId }]);
  });

  it('preserves native packet order while asynchronous checksum validation completes', async () => {
    let emit: ((event: { packet: string; operationId?: string }) => void) | null = null;
    const addListener = vi.fn(async (event: string, listener: (value: { packet: string }) => void) => {
      if (event === 'message') emit = listener;
      return { remove: vi.fn(async () => undefined) };
    }) as unknown as NativeUnityPracticePlugin['addListener'];
    const native = plugin({ addListener });
    const bridge = createUnityPracticeBridge(native, 100);
    const seen: Array<{ type: string; receivedPerfMs: number }> = [];
    await bridge.onMessage((packet, receivedPerfMs) =>
      seen.push({
        type: (JSON.parse(packet.body) as { type: string }).type,
        receivedPerfMs,
      }),
    );
    expect(await bridge.launch(await hostPacket())).toBe(true);
    const activeOperationId = (vi.mocked(native.launch).mock.calls[0]?.[0] as { operationId: string }).operationId;
    const first = await unityPacket();
    const second = await unityStatsPacket();
    if (!emit) throw new Error('listener was not registered');

    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValueOnce(101).mockReturnValueOnce(202);
    let validation = 0;
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(async (...args) => {
      validation += 1;
      if (validation === 1) await new Promise((resolve) => setTimeout(resolve, 15));
      return digest(...args);
    });
    try {
      (emit as (event: { packet: string; operationId: string }) => void)({
        packet: JSON.stringify(first),
        operationId: activeOperationId,
      });
      (emit as (event: { packet: string; operationId: string }) => void)({
        packet: JSON.stringify(second),
        operationId: activeOperationId,
      });
      await vi.waitFor(() =>
        expect(seen).toEqual([
          { type: 'unity.ready', receivedPerfMs: 101 },
          { type: 'unity.stats', receivedPerfMs: 202 },
        ]),
      );
    } finally {
      digestSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });
});
