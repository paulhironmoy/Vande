/**
 * A recording fake of the Web Audio API for jsdom (tests only): every node, connection, scheduled start and AudioParam
 * automation is kept, so tests can assert what the mix does without a browser. getOutputTimestamp reports a fixed
 * output latency, so the audio clock can be mapped to performance.now() as on a device.
 */

export interface ParamEvent {
  type: 'set' | 'target' | 'linear' | 'exp' | 'cancel';
  value: number;
  time: number;
  tau?: number;
}

export class FakeParam {
  value: number;
  events: ParamEvent[] = [];
  constructor(v = 0) {
    this.value = v;
  }
  setValueAtTime(value: number, time: number) {
    this.events.push({ type: 'set', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number, tau: number) {
    this.events.push({ type: 'target', value, time, tau });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ type: 'linear', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.events.push({ type: 'exp', value, time });
    return this;
  }
  cancelScheduledValues(time: number) {
    this.events.push({ type: 'cancel', value: 0, time });
    return this;
  }
}

export class FakeNode {
  outputs: FakeNode[] = [];
  constructor(
    public kind: string,
    public ctx: FakeContext,
  ) {
    ctx.nodes.push(this);
  }
  connect<T>(n: T): T {
    this.outputs.push(n as unknown as FakeNode);
    return n;
  }
  disconnect() {
    this.outputs = [];
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
  gain = new FakeParam(0);
}

export class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
}

export class FakeSource extends FakeNode {
  starts: Array<{ when: number; offset?: number; duration?: number }> = [];
  stops: number[] = [];
  buffer: FakeBuffer | null = null;
  loop = false;
  playbackRate = new FakeParam(1);
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
  type = 'sine';
  onended: (() => void) | null = null;
  start(when = 0, offset?: number, duration?: number) {
    this.starts.push({ when, offset, duration });
  }
  stop(when?: number) {
    this.stops.push(when ?? this.ctx.currentTime);
  }
}

export class FakeBuffer {
  private data: Float32Array[];
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number) {
    return this.data[c];
  }
}

export class FakeContext {
  static made: FakeContext[] = [];
  nodes: FakeNode[] = [];
  currentTime = 0;
  sampleRate: number;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination: FakeNode;
  baseLatency = 0.005;
  outputLatency = 0.02;
  log: string[] = [];
  constructor(opts?: { sampleRate?: number } | number, length?: number, sampleRate?: number) {
    this.sampleRate = typeof opts === 'number' ? (sampleRate ?? 48000) : (opts?.sampleRate ?? 48000);
    this.length = typeof opts === 'number' ? (length ?? 0) : 0;
    this.destination = new FakeNode('destination', this);
    FakeContext.made.push(this);
  }
  length: number;
  createGain() {
    return new FakeGain('gain', this);
  }
  createBiquadFilter() {
    return new FakeFilter('filter', this);
  }
  createDynamicsCompressor() {
    return new FakeCompressor('compressor', this);
  }
  createOscillator() {
    return new FakeSource('oscillator', this);
  }
  createBufferSource() {
    return new FakeSource('buffer', this);
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(channels, length, sampleRate);
  }
  resume() {
    this.log.push('resume');
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.log.push('suspend');
    this.state = 'suspended';
    return Promise.resolve();
  }
  /** The sample now being rendered left the speaker `outputLatency` ago (contextTime lags currentTime). */
  getOutputTimestamp() {
    return { contextTime: this.currentTime - this.outputLatency, performanceTime: performance.now() };
  }
  startRendering() {
    return Promise.resolve(new FakeBuffer(1, this.length, this.sampleRate));
  }
  sources() {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
  }
}

/** Installs the fakes on window and globalThis (AudioContext and OfflineAudioContext). */
export function installFakeAudio(): void {
  FakeContext.made = [];
  const w = window as unknown as Record<string, unknown>;
  w.AudioContext = FakeContext;
  w.OfflineAudioContext = FakeContext;
  (globalThis as Record<string, unknown>).OfflineAudioContext = FakeContext;
}

/** Every node reachable downstream from `n`. */
export function downstream(n: FakeNode, seen = new Set<FakeNode>()): Set<FakeNode> {
  for (const o of n.outputs) {
    if (!seen.has(o)) {
      seen.add(o);
      downstream(o, seen);
    }
  }
  return seen;
}
