import type {
  EngineAdapter,
  EngineCallbacks,
  EngineCandidate,
  EngineCandidateInput,
  EngineRunOptions,
  EngineSession,
  EngineStats,
} from '@/core/types';
import { MGBA_DESCRIPTOR } from '../descriptors';
import { enginePrerequisiteBlockers } from '@/core/environment';
/**
 * Resolved by Vite at build time.
 *
 * The Emscripten glue would otherwise look for `mgba.wasm` next to its own
 * module URL, which in a bundled app points at a hashed chunk directory. Using
 * an explicit `?url` import keeps exactly one copy of the 1.8 MiB binary in the
 * build and works under any base path (GitHub Pages sub-sites included).
 */
import mgbaWasmUrl from '@thenick775/mgba-wasm/dist/mgba.wasm?url';

/**
 * mGBA-in-WebAssembly adapter (GBA / GB / GBC).
 *
 * The published Emscripten build owns its main loop, canvas blit, key bindings,
 * Web Audio and IDBFS persistence — that is the fastest path it has, so we wrap
 * it rather than re-drive it:
 *   • input through bindKey/buttonPress (documented API),
 *   • save states through the core's slot 0 plus explicit binary export,
 *   • SRAM through getSave() + saveDataUpdatedCallback,
 *   • FPS/frame time from the core's videoFrameEndedCallback.
 *
 * The ~2 MiB WASM payload is fetched lazily on first GBA launch.
 */

interface MgbaModule {
  FSInit(): Promise<void>;
  FSSync(): Promise<void>;
  filePaths(): {
    root: string;
    cheatsPath: string;
    gamePath: string;
    savePath: string;
    saveStatePath: string;
    screenshotsPath: string;
    patchPath: string;
    autosave: string;
  };
  loadGame(romPath: string, savePathOverride?: string): boolean;
  quitGame?(): void;
  pauseGame(): void;
  resumeGame(): void;
  setVolume(percent: number): void;
  setFastForwardMultiplier(multiplier: number): void;
  buttonPress(name: string): void;
  buttonUnpress(name: string): void;
  saveState(slot: number): boolean;
  loadState(slot: number): boolean;
  getSave(): Uint8Array | null;
  screenshot(fileName?: string): boolean;
  videoFrameEndedCallback: (() => void) | null;
  saveDataUpdatedCallback: (() => void) | null;
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    analyzePath(path: string): { exists: boolean };
  };
  canvas?: HTMLCanvasElement;
  gameName?: string;
  saveName?: string;
  version?: { projectName?: string; projectVersion?: string };
  getVolume?: () => number;
}

type MgbaFactory = (opts: {
  canvas: HTMLCanvasElement;
  locateFile?: (path: string) => string;
}) => Promise<MgbaModule>;

let factoryPromise: Promise<MgbaFactory> | null = null;

async function getFactory(): Promise<MgbaFactory> {
  if (!factoryPromise) {
    factoryPromise = import('@thenick775/mgba-wasm').then(
      (mod) => (mod as unknown as { default: MgbaFactory }).default,
    );
  }
  return factoryPromise;
}

const join = (dir: string, name: string) => `${dir.replace(/\/$/, '')}/${name}`;
const sanitize = (name: string) => name.replace(/[^\w.\- ]+/g, '_').slice(-96) || 'game.gba';
const baseName = (path: string) => path.split('/').pop() ?? path;

class MgbaSession implements EngineSession {
  readonly descriptor = MGBA_DESCRIPTOR;
  readonly raw: MgbaModule;
  private module: MgbaModule;
  private callbacks: EngineCallbacks;
  private canvas: HTMLCanvasElement;
  private raf = 0;
  private lastFrameAt = 0;
  private frames = 0;
  private framesInSecond = 0;
  private secondStart = performance.now();
  private measuredFps = 0;
  private frametimeMs = 0;
  private paused = false;
  private destroyed = false;
  private sramDirty = false;
  private ticks = 0;
  private ff = 1;
  private statePath: string | null = null;

  constructor(module: MgbaModule, options: EngineRunOptions, callbacks: EngineCallbacks) {
    this.module = module;
    this.raw = module;
    this.callbacks = callbacks;
    this.canvas = options.canvas;
    module.setVolume(Math.round(options.volume * 100));
    module.videoFrameEndedCallback = () => {
      const now = performance.now();
      this.frames++;
      this.framesInSecond++;
      if (this.lastFrameAt) this.frametimeMs = now - this.lastFrameAt;
      this.lastFrameAt = now;
      if (now - this.secondStart >= 1000) {
        this.measuredFps = (this.framesInSecond * 1000) / (now - this.secondStart);
        this.framesInSecond = 0;
        this.secondStart = now;
      }
      this.callbacks.onFrame?.({ at: now, frames: 1 });
    };
    module.saveDataUpdatedCallback = () => {
      this.sramDirty = true;
    };
  }

  async boot(rom: Uint8Array, fileName: string, savedSram: Uint8Array | null): Promise<boolean> {
    await this.module.FSInit();
    const paths = this.module.filePaths();
    const romName = sanitize(fileName);
    const romPath = join(paths.gamePath, romName);
    this.module.FS.writeFile(romPath, rom);
    if (savedSram && savedSram.length) {
      const savePath = join(paths.savePath, `${romName.replace(/\.[^.]+$/, '')}.sav`);
      try {
        this.module.FS.writeFile(savePath, savedSram);
      } catch (error) {
        this.callbacks.onLog?.('warn', `Could not seed SRAM: ${(error as Error).message}`);
      }
    }
    const loaded = this.module.loadGame(romPath);
    if (!loaded) return false;
    this.statePath = join(paths.saveStatePath, `${romName.replace(/\.[^.]+$/, '')}.ss0`);
    this.lastFrameAt = performance.now();
    return true;
  }

  startTimer(): void {
    const tick = () => {
      if (this.destroyed) return;
      this.raf = requestAnimationFrame(tick);
      this.ticks++;
      if (this.sramDirty) {
        this.sramDirty = false;
        const sram = this.module.getSave();
        if (sram && sram.length) this.callbacks.onSramChanged?.(new Uint8Array(sram));
      }
      if (this.ticks % 900 === 0) void this.module.FSSync().catch(() => undefined);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.module.pauseGame();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.module.resumeGame();
  }

  reset(): void {
    // The core restarts the loaded ROM; the Emscripten FS keeps SRAM intact.
    const gameName = this.module.gameName;
    if (gameName) {
      this.module.loadGame(gameName, this.module.saveName);
    }
  }

  setVolume(v: number): void {
    this.module.setVolume(Math.round(v * 100));
  }

  /**
   * mGBA expects capitalised key names ("A", "Start", "Up"). Recompa's logical
   * buttons are upper-case, so only the first letter is lowered for the rest.
   */
  setInput(_port: number, button: string, pressed: boolean): void {
    const name = button.length > 1 ? button.charAt(0) + button.slice(1).toLowerCase() : button;
    try {
      if (pressed) this.module.buttonPress(name);
      else this.module.buttonUnpress(name);
    } catch {
      /* unmapped button — ignore */
    }
  }

  setFastForward(multiplier: number): void {
    this.ff = multiplier;
    this.module.setFastForwardMultiplier(Math.max(1, multiplier));
  }

  async saveState(): Promise<Uint8Array | null> {
    try {
      if (!this.module.saveState(0) || !this.statePath) return null;
      if (!this.module.FS.analyzePath(this.statePath).exists) return null;
      return new Uint8Array(this.module.FS.readFile(this.statePath));
    } catch (error) {
      this.callbacks.onLog?.('error', `mGBA saveState failed: ${(error as Error).message}`);
      return null;
    }
  }

  async loadState(state: Uint8Array): Promise<boolean> {
    try {
      if (!this.statePath) return false;
      this.module.FS.writeFile(this.statePath, state);
      return this.module.loadState(0);
    } catch (error) {
      this.callbacks.onLog?.('error', `mGBA loadState failed: ${(error as Error).message}`);
      return false;
    }
  }

  async readSram(): Promise<Uint8Array | null> {
    const save = this.module.getSave();
    return save ? new Uint8Array(save) : null;
  }

  async writeSram(sram: Uint8Array): Promise<void> {
    const name = this.module.saveName;
    if (!name) return;
    this.module.FS.writeFile(name, sram);
    await this.module.FSSync();
  }

  async screenshot(): Promise<Blob | null> {
    const canvas = this.module.canvas ?? this.canvas;
    if (!('toBlob' in canvas)) return null;
    return new Promise((resolve) => canvas.toBlob((b: Blob | null) => resolve(b), 'image/png'));
  }

  stats(): EngineStats {
    return {
      fps: this.measuredFps,
      frameTimeMs: this.frametimeMs,
      audioSampleRate: 48000,
      audioLatencyMs: null,
      videoMode: `mGBA software blit · ${this.canvas.width}×${this.canvas.height}`,
      extra: {
        core: `${this.module.version?.projectName ?? 'mGBA'} ${this.module.version?.projectVersion ?? ''}`.trim(),
        volume: this.module.getVolume?.() ?? null,
        fastForward: this.ff,
        framesRendered: this.frames,
        gameFile: this.module.gameName ? baseName(this.module.gameName) : null,
      },
    };
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    try {
      this.module.pauseGame();
      this.module.quitGame?.();
      await this.module.FSSync();
    } catch {
      /* core already torn down */
    }
  }
}

export const MgbaAdapter: EngineAdapter = {
  descriptor: MGBA_DESCRIPTOR,

  canRun(input: EngineCandidateInput): EngineCandidate {
    const { report, environment } = input;
    const blockers: string[] = [];
    const notes: string[] = [];
    if (!environment.webAssembly) {
      blockers.push('WebAssembly is unavailable in this browser, so mGBA cannot run.');
      return { engineId: MGBA_DESCRIPTOR.id, runnable: false, blockers, notes };
    }
    const platform = report.platform?.id;
    if (platform !== 'gba' && platform !== 'gb' && platform !== 'gbc') {
      blockers.push('mGBA executes Game Boy Advance, Game Boy and Game Boy Color software only.');
    }
    const prereqs = enginePrerequisiteBlockers(environment, 'mgba-wasm');
    blockers.push(...prereqs.blockers);
    notes.push(...prereqs.notes);
    if (report.format && !['gba', 'gba-raw', 'gb'].includes(report.format.id)) {
      blockers.push(`Container "${report.format.label}" cannot be loaded by this mGBA build.`);
    }
    if ((environment.cores ?? 4) <= 2) {
      notes.push('Two or fewer CPU cores were detected — frame drops are likely.');
    }
    if (!environment.crossOriginIsolated) {
      notes.push('Cross-origin isolation is off inside the worker: audio uses a ScriptProcessor fallback.');
    }
    return { engineId: MGBA_DESCRIPTOR.id, runnable: blockers.length === 0, blockers, notes };
  },

  async create(options, callbacks) {
    const factory = await getFactory();
    const module = await factory({
      canvas: options.canvas,
      // Only the WASM binary needs redirecting; everything else the core asks
      // for is served from the same bundle.
      locateFile: (file: string) => (file.endsWith('.wasm') ? mgbaWasmUrl : file),
    });
    const session = new MgbaSession(module, options, callbacks);
    const ok = await session.boot(options.rom, options.fileName, options.savedSram ?? null);
    if (!ok) {
      await session.destroy();
      throw new Error(
        'mGBA rejected the ROM (loadGame returned false). The image may be trimmed, padded, or an unsupported cartridge type.',
      );
    }
    session.startTimer();
    callbacks.onLog?.('info', 'mGBA core initialised and ROM loaded.');
    return session;
  },
};

export { MgbaSession };
