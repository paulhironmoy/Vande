/** Optional Android Unity-as-a-Library transport. Missing, incompatible or unresponsive native code fails closed. */
import {
  UNITY_PRACTICE_MAX_PACKET_BYTES,
  packedUnityPracticePacket,
  unpackUnityPracticePacket,
  type UnityPracticePacket,
} from '@/contracts';
import { NATIVE_TIMEOUT_MS, nativePlugin, settleWithin } from './capacitor';

export interface UnityPracticeAvailability {
  available: boolean;
  reason:
    | 'ready'
    | 'linked_unverified'
    | 'web'
    | 'plugin_missing'
    | 'unity_export_missing'
    | 'unsupported_native_abi'
    | 'unsupported_graphics_api'
    | 'low_memory_device'
    | 'version_mismatch'
    | 'unresponsive'
    | 'error';
  unityVersion: string | null;
  /** Android DisplayMetrics.density. WebGL reports 1. */
  pixelsPerDp?: number | null;
  /** Android Configuration.fontScale, validated independently from display density. WebGL reports 1. */
  systemTextScale?: number | null;
}

export interface UnityPracticeNativeError {
  code: string;
  detail: string;
  operationId: string | null;
}

interface NativeListenerHandle {
  remove(): Promise<void>;
}

interface NativeUnityPracticeEvents {
  message: { packet: string; operationId?: string };
  error: { code?: string; detail?: string; operationId?: string };
}

export interface NativeUnityPracticePlugin {
  availability(): Promise<UnityPracticeAvailability>;
  launch(options: { packet: string; operationId: string }): Promise<{ accepted: boolean }>;
  cancelLaunch(options: { operationId: string }): Promise<{ cancelled: boolean }>;
  send(options: { packet: string; operationId: string }): Promise<{ accepted: boolean }>;
  setVisible(options: { visible: boolean; operationId: string }): Promise<{ applied: boolean }>;
  setReadyVisible(options: { visible: boolean; hint: string; operationId: string }): Promise<{ applied: boolean }>;
  unload(options: { operationId: string }): Promise<{ unloaded: boolean }>;
  addListener<TEvent extends keyof NativeUnityPracticeEvents>(
    event: TEvent,
    listener: (event: NativeUnityPracticeEvents[TEvent]) => void,
  ): Promise<NativeListenerHandle>;
}

export interface UnityPracticeBridge {
  /** Browser Unity binds to the React-owned canvas; native bridges intentionally leave this absent. */
  attachCanvas?(canvas: HTMLCanvasElement): void;
  availability(): Promise<UnityPracticeAvailability>;
  /** Resolves true only after native reports that Unity validated initialize and emitted ready. */
  launch(packet: UnityPracticePacket): Promise<boolean>;
  /** Accepted means forwarded to the validated runtime; protocol-level bridge.ack remains authoritative. */
  send(packet: UnityPracticePacket): Promise<boolean>;
  /** Reveals Unity only for live/replay presentation; false restores the React surface without unloading. */
  setVisible(visible: boolean): Promise<boolean>;
  /** Reveals the scene before a ball with one localized, non-interactive teaching cue. */
  setReadyVisible?(visible: boolean, hint: string): Promise<boolean>;
  unload(): Promise<boolean>;
  onMessage(listener: (packet: UnityPracticePacket, receivedPerfMs: number) => void): Promise<() => Promise<void>>;
  onError(listener: (error: UnityPracticeNativeError) => void): Promise<() => Promise<void>>;
}

const UNAVAILABLE: UnityPracticeAvailability = {
  available: false,
  reason: 'plugin_missing',
  unityVersion: null,
  pixelsPerDp: null,
  systemTextScale: null,
};
/** Independent fail-safe cap; native owns a 30 s absolute operation deadline and the coordinator owns 40 s. */
const UNITY_LAUNCH_TIMEOUT_MS = 35_000;
const UNITY_UNLOAD_TIMEOUT_MS = 8_000;
// The packet body is itself a JSON string in the outer Capacitor event and may need almost 2× escaping headroom.
const MAX_NATIVE_EVENT_BYTES = UNITY_PRACTICE_MAX_PACKET_BYTES * 2 + 4 * 1024;

/** Low-memory native admission is the one reason that must bypass both Unity and retained WebGL for Classic. */
export function unityAvailabilityRequiresClassic(
  availability: UnityPracticeAvailability,
  webUnity: boolean,
): boolean {
  return !webUnity && !availability.available && availability.reason === 'low_memory_device';
}

function packetString(packet: UnityPracticePacket): string {
  return JSON.stringify(packet);
}

function operationId(): string {
  return globalThis.crypto.randomUUID?.() ?? `unity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function validatedPacket(value: string, sender: 'host' | 'unity'): Promise<UnityPracticePacket | null> {
  if (new TextEncoder().encode(value).byteLength > MAX_NATIVE_EVENT_BYTES) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<UnityPracticePacket>;
    if (Object.keys(candidate).length !== 2 || !Object.hasOwn(candidate, 'body') || !Object.hasOwn(candidate, 'sha256')) return null;
    if (typeof candidate.body !== 'string' || typeof candidate.sha256 !== 'string') return null;
    const packet = { body: candidate.body, sha256: candidate.sha256 };
    const message = await unpackUnityPracticePacket(packet);
    return message.sender === sender ? packet : null;
  } catch {
    return null;
  }
}

async function registerBoundedListener<TEvent extends keyof NativeUnityPracticeEvents>(
  plugin: NativeUnityPracticePlugin,
  event: TEvent,
  listener: (event: NativeUnityPracticeEvents[TEvent]) => void,
  timeoutMs: number,
): Promise<() => Promise<void>> {
  let active = true;
  let handle: NativeListenerHandle | null = null;
  const registration = plugin.addListener(event, (value) => {
    if (active) listener(value);
  }).then(
    async (registered) => {
      if (!active) await registered.remove().catch(() => undefined);
      else handle = registered;
      return registered;
    },
    () => null,
  );
  await settleWithin(registration, timeoutMs, null);
  if (handle === null) active = false;
  return async () => {
    active = false;
    const registered = handle;
    handle = null;
    if (registered) await settleWithin(registered.remove(), timeoutMs, undefined);
  };
}

/** A bounded adapter over the native plugin. It never treats native silence, attachment or unchecked bytes as ready. */
export function createUnityPracticeBridge(
  plugin: NativeUnityPracticePlugin | null,
  timeoutMs = NATIVE_TIMEOUT_MS,
  launchTimeoutMs = timeoutMs,
  unloadTimeoutMs = timeoutMs,
): UnityPracticeBridge {
  let activeOperationId: string | null = null;
  let pendingOperationId: string | null = null;
  let launchPending = false;
  let abortPendingLaunch = false;
  let unloadPending = false;
  // SHA-256 verification is asynchronous. Preserve native event order before handing packets to the strict
  // protocol sequence guard; independently-started hashes can otherwise invert ACK/ready or ACK/pong.
  let inboundTail: Promise<void> = Promise.resolve();
  const bounded = <T>(work: Promise<T>, fallback: T) => settleWithin(work, timeoutMs, fallback);

  const availability = async (): Promise<UnityPracticeAvailability> => {
    if (!plugin) return UNAVAILABLE;
    const result = await bounded(
      plugin.availability(),
      { available: false, reason: 'unresponsive', unityVersion: null } satisfies UnityPracticeAvailability,
    );
    const usableReason = result.reason === 'ready' || result.reason === 'linked_unverified';
    const density = result.pixelsPerDp;
    const usableDensity = typeof density === 'number' && Number.isFinite(density) && density >= 1 && density <= 8;
    const fontScale = result.systemTextScale;
    const usableFontScale = typeof fontScale === 'number' && Number.isFinite(fontScale) && fontScale >= 0.5 && fontScale <= 3;
    return result.available && usableReason && usableDensity && usableFontScale ? result : { ...result, available: false };
  };

  const teardownFailedLaunch = async (operation: string): Promise<boolean> => {
    if (!plugin || unloadPending) return false;
    unloadPending = true;
    try {
      // cancelLaunch rejects the unresolved launch call and starts host teardown; only unload's
      // onUnityPlayerUnloaded-backed receipt may release this generation for reuse.
      await bounded(plugin.cancelLaunch({ operationId: operation }), { cancelled: false });
      const result = await settleWithin(plugin.unload({ operationId: operation }), unloadTimeoutMs, { unloaded: false });
      if (result.unloaded) {
        if (activeOperationId === operation) activeOperationId = null;
        if (pendingOperationId === operation) pendingOperationId = null;
      }
      return result.unloaded;
    } finally {
      unloadPending = false;
    }
  };

  return {
    availability,

    async launch(packet) {
      if (!plugin || launchPending || pendingOperationId !== null || activeOperationId !== null || unloadPending) return false;
      // Reserve the launch slot before checksum validation or availability awaits. Two callers in one task must
      // never create competing UnityPlayer operations, and a timed-out operation remains reserved through native
      // cancellation so a retry cannot overlap teardown.
      launchPending = true;
      abortPendingLaunch = false;
      try {
        const message = await unpackUnityPracticePacket(packet).catch(() => null);
        if (abortPendingLaunch || !message || message.sender !== 'host' || message.type !== 'host.initialize') return false;
        const available = await availability();
        // Recheck the mutable lifecycle gates after the asynchronous native probe. A concurrently-started
        // unload cannot currently overlap launchPending, but keeping the validation adjacent to launch makes
        // that guarantee explicit and prevents future refactors from reviving a stale availability result.
        if (abortPendingLaunch || !available.available || activeOperationId !== null || unloadPending) return false;

        const nextOperationId = operationId();
        pendingOperationId = nextOperationId;
        let timedOut = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<{ accepted: false }>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve({ accepted: false });
          }, launchTimeoutMs);
        });
        const nativeLaunch = plugin.launch({ packet: packetString(packet), operationId: nextOperationId }).catch(() => ({ accepted: false }));
        const result = await Promise.race([nativeLaunch, timeout]);
        if (timer !== undefined) clearTimeout(timer);
        if (!result.accepted || timedOut || abortPendingLaunch) {
          await teardownFailedLaunch(nextOperationId);
          return false;
        }
        activeOperationId = nextOperationId;
        pendingOperationId = null;
        return true;
      } finally {
        launchPending = false;
        abortPendingLaunch = false;
      }
    },

    async send(packet) {
      if (!plugin || activeOperationId === null || unloadPending) return false;
      // A packet packUnityPracticeMessage made in this runtime is frozen and was validated as it was made (a 0.3 to 0.46 MB result
      // would otherwise be parsed, canonicalized and hashed again here); any other packet is unpacked.
      const message = packedUnityPracticePacket(packet) ?? await unpackUnityPracticePacket(packet).catch(() => null);
      if (!message || message.sender !== 'host' || message.type === 'host.initialize') return false;
      return (await bounded(plugin.send({ packet: packetString(packet), operationId: activeOperationId }), { accepted: false })).accepted;
    },

    async setVisible(visible) {
      if (!plugin || activeOperationId === null || unloadPending) return false;
      return (await bounded(plugin.setVisible({ visible, operationId: activeOperationId }), { applied: false })).applied;
    },

    async setReadyVisible(visible, hint) {
      if (!plugin || typeof plugin.setReadyVisible !== 'function' || activeOperationId === null || unloadPending ||
          typeof hint !== 'string' || hint.length < 1 || hint.length > 240) return false;
      return (await bounded(
        plugin.setReadyVisible({ visible, hint, operationId: activeOperationId }),
        { applied: false },
      )).applied;
    },

    async unload() {
      if (!plugin) return true;
      if (launchPending) {
        // A force-dispose can race packet validation or availability before an operation id exists. Abort that
        // generation and never claim physical unload; launch() rechecks this flag after every asynchronous boundary.
        abortPendingLaunch = true;
        return false;
      }
      if (unloadPending) return false;
      const current = activeOperationId ?? pendingOperationId;
      if (current === null) return true;
      unloadPending = true;
      const result = await settleWithin(plugin.unload({ operationId: current }), unloadTimeoutMs, { unloaded: false });
      unloadPending = false;
      if (result.unloaded) {
        if (activeOperationId === current) activeOperationId = null;
        if (pendingOperationId === current) pendingOperationId = null;
      }
      return result.unloaded;
    },

    async onMessage(listener) {
      if (!plugin) return async () => undefined;
      return registerBoundedListener(plugin, 'message', (event) => {
        const eventOperationId = event.operationId;
        if (typeof eventOperationId !== 'string' || (eventOperationId !== activeOperationId && eventOperationId !== pendingOperationId)) return;
        // Capture arrival before queued SHA-256 work; hashing delay must not bias the clock offset/RTT estimate.
        const receivedPerfMs = performance.now();
        inboundTail = inboundTail.then(async () => {
          const packet = await validatedPacket(event.packet, 'unity');
          // Validation may have outlived cancellation/unload; never deliver a late packet into a new generation.
          if (eventOperationId !== activeOperationId && eventOperationId !== pendingOperationId) return;
          if (packet) listener(packet, receivedPerfMs);
        }, async () => undefined);
      }, timeoutMs);
    },

    async onError(listener) {
      if (!plugin) return async () => undefined;
      return registerBoundedListener(plugin, 'error', (event) => {
        if (typeof event.operationId !== 'string' || (event.operationId !== activeOperationId && event.operationId !== pendingOperationId)) return;
        listener({
          code: typeof event.code === 'string' ? event.code : 'unity_runtime',
          detail: typeof event.detail === 'string' ? event.detail : 'Unity Practice reported an unspecified native error.',
          operationId: typeof event.operationId === 'string' ? event.operationId : null,
        });
      }, timeoutMs);
    },
  };
}

/** Native bridge when compiled into Android, otherwise the inert web/fallback implementation. */
export async function nativeUnityPracticeBridge(timeoutMs = NATIVE_TIMEOUT_MS): Promise<UnityPracticeBridge> {
  const boxed = await settleWithin(nativePlugin<NativeUnityPracticePlugin>('VandeUnityPractice'), timeoutMs, null);
  return createUnityPracticeBridge(boxed?.plugin ?? null, timeoutMs, UNITY_LAUNCH_TIMEOUT_MS, UNITY_UNLOAD_TIMEOUT_MS);
}
