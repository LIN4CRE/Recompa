import type {
  EngineAdapter,
  EngineCallbacks,
  EngineCandidate,
  EngineCandidateInput,
  EngineRunOptions,
  EngineSession,
  EngineStats,
} from '@/core/types';
import { JSNES_DESCRIPTOR } from '../descriptors';
import { enginePrerequisiteBlockers } from '@/core/environment';
import {
  NES_HEIGHT,
  NES_WIDTH,
  readBatteryRam,
  resolveNesConstructor,
  analyseFrame,
  restartNes,
  writeBatteryRam,
  mapperSupport,
  type JsnesNES,
} from './core';
import { AudioSink } from '../audio';

/**
 * jsnes engine adapter.
 *
 * Rendering: 256×240 NES framebuffer -> offscreen ImageData -> canvas2d with
 * nearest-neighbour scaling and integer-friendly aspect ratio. We deliberately
 * do not route this through WebGL: for one 256×240 blit per frame the 2D path
 * is faster and has fewer driver quirks.
 *
 * Pacing: requestAnimationFrame drives `frame()`. jsnes' internal CPU/PPU
 * timing is cycle-aware, so one call == one video frame; we throttle to the
 * measured refresh rate to avoid running at 2x on 120 Hz displays.
 */

const MAX_FRAME_BUFFER = NES_WIDTH * NES_HEIGHT;

class JsnesSession implements EngineSession {
  readonly descriptor = JSNES_DESCRIPTOR;
  readonly raw: JsnesNES;

  private nes: JsnesNES;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData;
  private pixels: Uint32Array;
  private audio: AudioSink | null = null;
  private callbacks: EngineCallbacks;
  private raf = 0;
  private running = false;
  private paused = false;
  private speed = 1;
  private lastFrameAt = 0;
  private framesThisSecond = 0;
  private secondStartedAt = performance.now();
  private measuredFps = 0;
  private lastFrameDurationMs = 0;
  private volume: number;
  private onSram: (() => void) | null = null;
  private destroyed = false;
  private samplesSinceReport = 0;
  private lastAudioReport = 0;
  private framesEmulated = 0;

  constructor(
    options: EngineRunOptions,
    callbacks: EngineCallbacks,
    private readonly romBytes: Uint8Array,
  ) {
    this.callbacks = callbacks;
    this.volume = options.volume;
    const canvas = options.canvas;
    canvas.width = NES_WIDTH;
    canvas.height = NES_HEIGHT;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable — cannot render NES video.');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.imageData = this.ctx.createImageData(NES_WIDTH, NES_HEIGHT);
    this.pixels = new Uint32Array(this.imageData.data.buffer);

    const NesCtor = resolveNesConstructor();
    this.nes = new NesCtor({
      onFrame: (buffer) => {
        // jsnes writes 0xRRGGBB values; ImageData expects little-endian ABGR.
        const px = this.pixels;
        const n = Math.min(buffer.length, MAX_FRAME_BUFFER);
        for (let i = 0; i < n; i++) {
          const rgb = buffer[i]!;
          px[i] = 0xff000000 | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff);
        }
        this.ctx.putImageData(this.imageData, 0, 0);
        this.framesEmulated++;
      },
      onAudioSample: (left, right) => {
        this.audio?.push(left, right);
        this.samplesSinceReport++;
      },
      sampleRate: 44100,
      emulateSound: options.audio,
    });
    this.raw = this.nes;

    // Load ROM (jsnes wants a binary string).
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < this.romBytes.length; i += chunk) {
      binary += String.fromCharCode.apply(
        null,
        Array.from(this.romBytes.subarray(i, i + chunk)) as unknown as number[],
      );
    }
    this.nes.loadROM(binary);

    if (options.savedSram && options.savedSram.length) {
      if (!writeBatteryRam(this.nes, options.savedSram)) {
        callbacks.onLog?.(
          'warn',
          `Battery save is ${options.savedSram.length} bytes but this cartridge exposes no matching battery RAM.`,
        );
      }
    }
    this.onSram = () => {
      const sram = readBatteryRam(this.nes);
      if (sram) callbacks.onSramChanged?.(sram);
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    if (this.audioAllowed) {
      this.audio = new AudioSink({ sampleRate: 44100, bufferSamples: 1024, volume: this.volume });
      const ok = await this.audio.start();
      if (!ok) {
        this.audio = null;
        this.callbacks.onLog?.('warn', 'Web Audio is unavailable — running without sound.');
      }
    }
    this.lastFrameAt = performance.now();
    this.loop();
  }

  private audioAllowed = true;

  private loop = (): void => {
    if (!this.running || this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.paused) return;

    const now = performance.now();
    const targetInterval = 1000 / (60.0988 * this.speed);
    const elapsed = now - this.lastFrameAt;
    if (elapsed < targetInterval - 1.2) return; // under one frame: skip this rAF
    this.lastFrameAt = now;

    // Catch-up is capped so a slow device does not spiral into a spiral of death.
    const behind = Math.min(Math.floor(elapsed / targetInterval), 3);
    const frames = Math.max(1, behind);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) this.nes.frame();
    this.lastFrameDurationMs = (performance.now() - t0) / frames;

    this.framesThisSecond += frames;
    if (now - this.secondStartedAt >= 1000) {
      this.measuredFps = (this.framesThisSecond * 1000) / (now - this.secondStartedAt);
      this.framesThisSecond = 0;
      this.secondStartedAt = now;
      this.onSram?.();
    }
    this.callbacks.onFrame?.({ at: now, frames });
    if (this.audio && now - this.lastAudioReport > 500) {
      this.lastAudioReport = now;
      this.callbacks.onAudio?.(this.audio.latencyMs() ?? 0);
    }
  };

  pause(): void {
    this.paused = true;
    void this.audio?.suspend();
  }

  resume(): void {
    this.paused = false;
    this.lastFrameAt = performance.now();
    void this.audio?.resume();
  }

  reset(): void {
    // `NES#reset()` is not a safe restart in jsnes 2.1.0 (the mapper loses its
    // PRG banks). `reloadROM()` re-runs the complete load path instead.
    restartNes(this.nes, (message) => this.callbacks.onLog?.('warn', message));
  }

  setVolume(v: number): void {
    this.volume = v;
    this.audio?.setVolume(v);
  }

  setAudioEnabled(enabled: boolean): void {
    this.audioAllowed = enabled;
  }

  setInput(port: number, button: string, pressed: boolean): void {
    const p = port === 2 ? 2 : 1;
    try {
      if (pressed) this.nes.buttonDown(p, button);
      else this.nes.buttonUp(p, button);
    } catch (error) {
      // Unknown button names must not crash the session.
      this.callbacks.onLog?.('warn', `jsnes rejected button "${button}": ${(error as Error).message}`);
    }
  }

  setFastForward(multiplier: number): void {
    this.speed = Math.max(0.25, Math.min(multiplier, 4));
  }

  async saveState(): Promise<Uint8Array | null> {
    try {
      const json = JSON.stringify(this.nes.toJSON());
      return new TextEncoder().encode(json);
    } catch (error) {
      this.callbacks.onLog?.('warn', `Save state failed: ${(error as Error).message}`);
      return null;
    }
  }

  async loadState(state: Uint8Array): Promise<boolean> {
    try {
      const json = new TextDecoder().decode(state);
      this.nes.fromJSON(JSON.parse(json));
      return true;
    } catch (error) {
      this.callbacks.onLog?.('error', `Load state failed: ${(error as Error).message}`);
      return false;
    }
  }

  async readSram(): Promise<Uint8Array | null> {
    return readBatteryRam(this.nes);
  }

  async writeSram(sram: Uint8Array): Promise<void> {
    writeBatteryRam(this.nes, sram);
  }

  async screenshot(): Promise<Blob | null> {
    const canvas = this.ctx.canvas;
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  }

  /** Measured PPU output check used by the verification pipeline. */
  sampleScreen(): { nonBlackRatio: number; distinctColours: number; signature: number } {
    return analyseFrame(this.pixels);
  }

  stats(): EngineStats {
    return {
      fps: this.measuredFps,
      frameTimeMs: this.lastFrameDurationMs,
      audioSampleRate: this.audio ? 44100 : null,
      audioLatencyMs: this.audio?.latencyMs() ?? null,
      videoMode: 'Canvas 2D · 256×240 · nearest',
      extra: {
        framesEmulated: this.framesEmulated,
        audioMode: this.audio?.stats().mode ?? 'off',
        audioUnderruns: this.audio?.stats().underruns ?? null,
        speed: this.speed,
      },
    };
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    await this.audio?.stop();
    this.audio = null;
  }
}

export const JsnesAdapter: EngineAdapter = {
  descriptor: JSNES_DESCRIPTOR,

  canRun(input: EngineCandidateInput): EngineCandidate {
    const { report } = input;
    const blockers: string[] = [];
    const notes: string[] = [];

    if (report.platform?.id !== 'nes') {
      blockers.push('jsnes only executes NES (Famicom) software.');
    }
    if (!report.format || !['ines', 'ines2', 'fds', 'unif', 'nes-raw'].includes(report.format.id)) {
      blockers.push(`Container "${report.format?.label ?? 'unknown'}" is not supported by jsnes.`);
    }
    if (report.format?.id === 'unif') {
      blockers.push('jsnes cannot read UNIF board definitions.');
    }
    if (report.format?.id === 'fds') {
      blockers.push('jsnes does not implement the Famicom Disk System mapper.');
    }
    if (report.format?.id === 'nes-raw') {
      blockers.push('Headerless NES images have no mapper information; jsnes requires a valid iNES header.');
    }

    const { supported, mapper } = mapperSupport(report.format, report.header);
    if (mapper !== null && !supported) {
      blockers.push(
        `iNES mapper ${mapper} is not implemented by jsnes. Use the EmulatorJS (FCEUmm) core for broader mapper coverage.`,
      );
    }
    if (report.header.warnings.some((w) => w.includes('declares') && w.includes('file is'))) {
      notes.push('iNES header size does not match the file — boot may fail or graphics may be corrupt.');
    }
    if (report.format?.id === 'ines' || report.format?.id === 'ines2') {
      notes.push('PAL timing is not modelled: PAL titles run at NTSC 60.0988 Hz.');
    }
    const prereqs = enginePrerequisiteBlockers(input.environment, 'jsnes');
    notes.push(...prereqs.notes);
    blockers.push(...prereqs.blockers);
    if (report.header.fields.battery) {
      notes.push('Cartridge has battery-backed save RAM; SRAM is persisted locally per game.');
    }
    return { engineId: JSNES_DESCRIPTOR.id, runnable: blockers.length === 0, blockers, notes };
  },

  async create(options, callbacks) {
    const session = new JsnesSession(options, callbacks, options.rom);
    await session.start();
    return session;
  },
};

export type { JsnesSession };
