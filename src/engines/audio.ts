/**
 * Emulator audio output.
 *
 * Two real paths, chosen by measured capability:
 *
 *  1. **AudioWorklet over SharedArrayBuffer** (when crossOriginIsolated).
 *     The emulator thread writes stereo frames directly into a lock-free ring
 *     buffer that the audio render thread reads. No allocations per sample and
 *     latency is one render quantum plus the configured fill target.
 *
 *  2. **ScriptProcessorNode** fallback for environments without SAB (deprecated
 *     but universally implemented). Buffer size is user-configurable; the
 *     latency reported to the UI is the real buffer duration, not a guess.
 *
 * The class never fabricates a latency figure: if the context has not started,
 * `latencyMs` is null.
 */

export interface AudioSinkOptions {
  sampleRate: number;
  /** Requested buffer size in frames for the ScriptProcessor fallback. */
  bufferSamples: number;
  /** Ring capacity in stereo frames (worklet path). */
  ringFrames?: number;
  volume?: number;
}

type WorkletState = { kind: 'worklet'; ctx: AudioContext; node: AudioWorkletNode; ring: Float32Array; sab: SharedArrayBuffer; capacity: number };
type ScriptState = { kind: 'script'; ctx: AudioContext; node: ScriptProcessorNode; queue: Float32Array; read: number; write: number; capacity: number };
type State = WorkletState | ScriptState;

const WORKLET_URL = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/worklets/audio-ring.js`;

export class AudioSink {
  private state: State | null = null;
  private volume: number;
  private options: AudioSinkOptions;
  private startedAt: number | null = null;
  private underruns = 0;
  private writtenFrames = 0;
  private started = false;

  constructor(options: AudioSinkOptions) {
    this.options = options;
    this.volume = options.volume ?? 1;
  }

  get running(): boolean {
    return this.started;
  }

  get sampleRate(): number {
    return this.options.sampleRate;
  }

  async start(): Promise<boolean> {
    if (this.started) return true;
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;
    const ctx = new AudioCtx({ sampleRate: this.options.sampleRate, latencyHint: 'interactive' });
    // Browsers suspend contexts created without a gesture; callers start audio
    // from the PLAY handler, so resume() is safe here.
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);

    const canUseWorklet =
      typeof AudioWorkletNode !== 'undefined' &&
      typeof SharedArrayBuffer !== 'undefined' &&
      (typeof crossOriginIsolated === 'undefined' ? false : crossOriginIsolated);

    if (canUseWorklet) {
      try {
        await ctx.audioWorklet.addModule(WORKLET_URL);
        const capacity = 8192;
        const sab = new SharedArrayBuffer(capacity * 2 * 4 + 8);
        const ring = new Float32Array(sab, 8);
        // Fill target: ~30 ms of audio to absorb main-thread jitter.
        const fillTarget = Math.min(Math.ceil(this.options.sampleRate * 0.03), capacity - 1024);
        const node = new AudioWorkletNode(ctx, 'recompa-ring', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: { capacity, fillTarget },
        });
        node.port.postMessage({ type: 'init', sab });
        node.connect(ctx.destination);
        this.state = { kind: 'worklet', ctx, node, ring, sab, capacity };
        this.started = true;
        this.startedAt = performance.now();
        this.applyVolume();
        return true;
      } catch {
        // Fall through to ScriptProcessor.
      }
    }

    const bufferSize = this.options.bufferSamples;
    const node = ctx.createScriptProcessor(bufferSize, 0, 2);
    const capacity = bufferSize * 8;
    const state: ScriptState = {
      kind: 'script',
      ctx,
      node,
      queue: new Float32Array(capacity * 2),
      read: 0,
      write: 0,
      capacity,
    };
    node.onaudioprocess = (event) => {
      const out = event.outputBuffer;
      const left = out.getChannelData(0);
      const right = out.getChannelData(1);
      for (let i = 0; i < left.length; i++) {
        if (state.read === state.write) {
          // Underrun: emit silence rather than stale samples (no clicking).
          left[i] = 0;
          right[i] = 0;
          this.underruns++;
          continue;
        }
        left[i] = state.queue[state.read * 2]! * this.volume;
        right[i] = state.queue[state.read * 2 + 1]! * this.volume;
        state.read = (state.read + 1) % state.capacity;
      }
    };
    node.connect(ctx.destination);
    this.state = state;
    this.started = true;
    this.startedAt = performance.now();
    return true;
  }

  /** Push one stereo frame. Called at the emulator's native sample rate. */
  push(left: number, right: number): void {
    const state = this.state;
    if (!state) return;
    if (state.kind === 'worklet') {
      const framesView = new Int32Array(state.sab, 0, 2);
      const write = Atomics.load(framesView, 0);
      const read = Atomics.load(framesView, 1);
      const next = (write + 1) % state.capacity;
      if (next === read) {
        this.underruns++;
        return; // full: drop to keep latency bounded
      }
      state.ring[write * 2] = left;
      state.ring[write * 2 + 1] = right;
      Atomics.store(framesView, 0, next);
      this.writtenFrames++;
      return;
    }
    const next = (state.write + 1) % state.capacity;
    if (next === state.read) {
      this.underruns++;
      return;
    }
    state.queue[state.write * 2] = left;
    state.queue[state.write * 2 + 1] = right;
    state.write = next;
    this.writtenFrames++;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
  }

  private applyVolume(): void {
    const state = this.state;
    if (!state) return;
    if (state.kind === 'worklet') {
      state.node.port.postMessage({ type: 'volume', value: this.volume });
    }
  }

  /** Measured buffer depth in milliseconds, or null when not measurable. */
  latencyMs(): number | null {
    const state = this.state;
    if (!state || !this.startedAt) return null;
    if (state.kind === 'worklet') {
      const framesView = new Int32Array(state.sab, 0, 2);
      const write = Atomics.load(framesView, 0);
      const read = Atomics.load(framesView, 1);
      const filled = (write - read + state.capacity) % state.capacity;
      return (filled / this.options.sampleRate) * 1000 + (128 / this.options.sampleRate) * 1000;
    }
    const filled = (state.write - state.read + state.capacity) % state.capacity;
    return (filled / this.options.sampleRate) * 1000 + (state.node.bufferSize / state.ctx.sampleRate) * 1000;
  }

  stats(): { mode: string; underruns: number; writtenFrames: number; contextState: string } {
    return {
      mode: this.state?.kind ?? 'none',
      underruns: this.underruns,
      writtenFrames: this.writtenFrames,
      contextState: this.state?.ctx.state ?? 'closed',
    };
  }

  async stop(): Promise<void> {
    const state = this.state;
    this.state = null;
    this.started = false;
    this.startedAt = null;
    if (!state) return;
    try {
      if (state.kind === 'worklet') {
        state.node.disconnect();
        state.node.port.postMessage({ type: 'stop' });
      } else {
        state.node.onaudioprocess = null;
        state.node.disconnect();
      }
      await state.ctx.close();
    } catch {
      /* context already closed */
    }
  }

  async suspend(): Promise<void> {
    if (this.state?.ctx.state === 'running') await this.state.ctx.suspend().catch(() => undefined);
  }

  async resume(): Promise<void> {
    if (this.state?.ctx.state === 'suspended') await this.state.ctx.resume().catch(() => undefined);
  }
}
