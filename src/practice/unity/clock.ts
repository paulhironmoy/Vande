/**
 * Monotonic-clock calibration for the in-process Unity Practice boundary.
 *
 * This is the four-timestamp/NTP calculation, expressed only in monotonic milliseconds. Wall-clock time never
 * participates in batting timing. The lowest-round-trip sample is the least asymmetric observation we have, so it
 * is the single mapping used for all Unity input timestamps in a session.
 */

export const UNITY_PRACTICE_CLOCK_SAMPLE_COUNT = 5;
const UNITY_PRACTICE_CLOCK_READY_SAMPLES = 3;
/** Cross-runtime timestamp quantization can make a sub-millisecond trip appear slightly negative. */
const UNITY_PRACTICE_CLOCK_NEGATIVE_DELAY_TOLERANCE_MS = 2;

export interface UnityPracticeClockObservation {
  sampleId: string;
  hostSendPerfMs: number;
  unityReceiveMs: number;
  unitySendMs: number;
  hostReceivePerfMs: number;
}

export interface UnityPracticeClockEstimate extends UnityPracticeClockObservation {
  /** Network round trip with Unity's processing interval removed. */
  roundTripMs: number;
  /** Add this value to a Unity monotonic timestamp to obtain host performance.now() time. */
  hostMinusUnityMs: number;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

/** A bounded session-local estimator. It deliberately has no storage or wall-clock dependency. */
export class UnityPracticeClock {
  private readonly observations: UnityPracticeClockEstimate[] = [];
  private readonly sampleIds = new Set<string>();

  get sampleCount(): number {
    return this.observations.length;
  }

  get ready(): boolean {
    return this.sampleCount >= UNITY_PRACTICE_CLOCK_READY_SAMPLES;
  }

  get complete(): boolean {
    return this.sampleCount >= UNITY_PRACTICE_CLOCK_SAMPLE_COUNT;
  }

  get selected(): UnityPracticeClockEstimate | null {
    let best: UnityPracticeClockEstimate | null = null;
    for (const observation of this.observations) {
      if (best === null || observation.roundTripMs < best.roundTripMs) best = observation;
    }
    return best;
  }

  add(observation: UnityPracticeClockObservation): UnityPracticeClockEstimate {
    if (!observation.sampleId || this.sampleIds.has(observation.sampleId)) {
      throw new TypeError('Unity Practice clock sample id must be unique.');
    }
    if (
      !finite(observation.hostSendPerfMs) ||
      !finite(observation.unityReceiveMs) ||
      !finite(observation.unitySendMs) ||
      !finite(observation.hostReceivePerfMs)
    ) {
      throw new TypeError('Unity Practice clock timestamps must be finite.');
    }
    if (
      observation.hostReceivePerfMs < observation.hostSendPerfMs ||
      observation.unitySendMs < observation.unityReceiveMs
    ) {
      throw new RangeError('Unity Practice clock timestamps must be monotonic.');
    }
    const previous = this.observations.at(-1);
    if (
      previous &&
      (observation.hostSendPerfMs <= previous.hostSendPerfMs ||
        observation.hostReceivePerfMs < previous.hostReceivePerfMs ||
        observation.unityReceiveMs < previous.unityReceiveMs ||
        observation.unitySendMs < previous.unitySendMs)
    ) {
      throw new RangeError('Unity Practice clock samples must arrive in monotonic order.');
    }
    const measuredRoundTripMs =
      observation.hostReceivePerfMs -
      observation.hostSendPerfMs -
      (observation.unitySendMs - observation.unityReceiveMs);
    if (measuredRoundTripMs < -UNITY_PRACTICE_CLOCK_NEGATIVE_DELAY_TOLERANCE_MS) {
      throw new RangeError('Unity Practice clock processing cannot exceed the observed host round trip.');
    }
    // performance.now() and Unity's realtime clock are monotonic but do not
    // share a guaranteed resolution. NTP delay is physically non-negative;
    // clamp only the bounded quantization band and still reject impossible data.
    const roundTripMs = Math.max(0, measuredRoundTripMs);
    const hostMinusUnityMs =
      ((observation.hostSendPerfMs - observation.unityReceiveMs) +
        (observation.hostReceivePerfMs - observation.unitySendMs)) /
      2;
    const estimate = { ...observation, roundTripMs, hostMinusUnityMs };
    this.sampleIds.add(observation.sampleId);
    this.observations.push(estimate);
    return estimate;
  }

  has(sampleId: string): boolean {
    return this.sampleIds.has(sampleId);
  }

  toHostPerfMs(unityMs: number): number {
    if (!finite(unityMs)) throw new TypeError('Unity Practice timestamp must be finite.');
    const selected = this.selected;
    if (!selected) throw new Error('Unity Practice clock has not been synchronized.');
    return unityMs + selected.hostMinusUnityMs;
  }
}
