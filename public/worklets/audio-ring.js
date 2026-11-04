/**
 * Recompa audio render thread.
 *
 * Reads stereo frames from a SharedArrayBuffer ring written by the emulator.
 * The ring header is two Int32 atomics at byte offset 0: [writeIndex, readIndex].
 * Samples begin at byte offset 8 (does not collide with the header).
 *
 * A configurable fill target delays playback start so short main-thread stalls
 * (GC, layout, save-state capture) do not produce underruns. When the buffer
 * runs empty we output silence and report it, rather than looping stale audio.
 */
class RecompaRingProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions ?? {};
    this.capacity = opts.capacity ?? 8192;
    this.fillTarget = opts.fillTarget ?? 1024;
    this.volume = 1;
    this.frames = null;
    this.ring = null;
    this.priming = true;
    this.underruns = 0;
    this.silenceRun = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data?.type === 'init' && data.sab) {
        this.frames = new Int32Array(data.sab, 0, 2);
        this.ring = new Float32Array(data.sab, 8);
      } else if (data?.type === 'volume') {
        this.volume = data.value;
      } else if (data?.type === 'stop') {
        this.frames = null;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out.length > 1 ? out[1] : out[0];
    if (!this.frames || !this.ring) {
      left.fill(0);
      if (right !== left) right.fill(0);
      return true;
    }

    const cap = this.capacity;
    let write = Atomics.load(this.frames, 0);
    let read = Atomics.load(this.frames, 1);
    const filled = (write - read + cap) % cap;

    if (this.priming) {
      if (filled < this.fillTarget) {
        left.fill(0);
        if (right !== left) right.fill(0);
        return true;
      }
      this.priming = false;
    }

    for (let i = 0; i < left.length; i++) {
      if (read === write) {
        // Underrun: silence + restart priming so we rebuild the buffer.
        left[i] = 0;
        right[i] = 0;
        this.underruns++;
        this.priming = true;
        continue;
      }
      left[i] = this.ring[read * 2] * this.volume;
      right[i] = this.ring[read * 2 + 1] * this.volume;
      read = (read + 1) % cap;
    }
    Atomics.store(this.frames, 1, read);
    return true;
  }
}

registerProcessor('recompa-ring', RecompaRingProcessor);
