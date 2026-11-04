import type {
  EngineAdapter,
  EngineCallbacks,
  EngineCandidate,
  EngineCandidateInput,
  EngineRunOptions,
  EngineSession,
  EngineStats,
} from '@/core/types';
import { EMULATORJS_PSX_DESCRIPTOR } from '../descriptors';
import { enginePrerequisiteBlockers } from '@/core/environment';

/**
 * PlayStation 1 via EmulatorJS + pcsx_rearmed.
 *
 * ── Why an iframe ─────────────────────────────────────────────────────────
 * EmulatorJS is designed to be dropped into a page by `loader.js`: it reads a
 * pile of `window.EJS_*` globals, injects `emulator.css` into `document.head`
 * and creates its own player element. Doing that in Recompa's own document
 * would let a 2 MB third-party stylesheet and its virtual gamepad collide with
 * the app's layout and keyboard handling.
 *
 * Instead we create a same-origin iframe pointing at a small bootstrap page we
 * generate, set the globals inside *that* document, and import the emulator's
 * own scripts. This gives us a clean canvas, an isolated DOM, and — crucially
 * — it does not need `loader.js`'s CDN fallback: with `EJS_DEBUG_XX = true`
 * the loader loads the individual `src/*.js` files from our own origin, which
 * is the only path that works with the npm package (it ships no
 * `emulator.min.js`).
 *
 * ── Why a ZIP ─────────────────────────────────────────────────────────────
 * EmulatorJS accepts a single game file. A disc set is a `.cue` plus one
 * `.bin` per track, and pcsx_rearmed is in EmulatorJS's `disableCue` list, so
 * the runtime will not synthesise a cue for a bare `.bin`. Multi-file sets are
 * therefore repackaged in-browser (see discArchive.ts).
 *
 * ── BIOS ──────────────────────────────────────────────────────────────────
 * The real PlayStation BIOS is required and is never bundled. The user must
 * supply their own dump; it is passed to the core via `EJS_biosUrl` as a blob
 * URL and never leaves the browser. HLE-style partial BIOSes are not
 * substituted, because that would silently change compatibility.
 */

const DATA_PATH = '/cores/emulatorjs/data/';

/**
 * Build the bootstrap page for one game.
 *
 * The config is inlined into the document rather than handed over through a
 * global afterwards: `doc.write` executes scripts synchronously, so anything
 * set on the window after writing would arrive too late.
 */
function bootstrapHtml(config: {
  gameName: string;
  gameUrl: string;
  biosUrl: string;
  dataPath: string;
  volume: number;
}): string {
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden; }
    #game { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="game"></div>
  <script>
    (function () {
      var cfg = ${json};
      // EmulatorJS reads these off the *iframe's* window.
      window.EJS_player = '#game';
      window.EJS_core = 'psx';
      window.EJS_gameName = cfg.gameName;
      window.EJS_gameUrl = cfg.gameUrl;
      window.EJS_biosUrl = cfg.biosUrl || '';
      window.EJS_pathtodata = cfg.dataPath;
      // The npm package ships no emulator.min.js, so the individual sources are
      // the only loadable form. This is also why no CDN is ever contacted.
      window.EJS_DEBUG_XX = true;
      window.EJS_startOnLoaded = true;
      window.EJS_language = 'en-US';
      window.EJS_disableDatabases = true;
      window.EJS_volume = cfg.volume;

      window.EJS_ready = function () { parent.postMessage({ recompaPsx: 'ready' }, '*'); };
      window.EJS_onGameStart = function () { parent.postMessage({ recompaPsx: 'start' }, '*'); };

      // Hand control back to the host, which attaches its listeners and then
      // calls window.__recompaBoot() once the session exists.
      parent.postMessage({ recompaPsx: 'booted' }, '*');
      window.__recompaBoot = function () {
        var s = document.createElement('script');
        s.src = cfg.dataPath + 'loader.js';
        s.onerror = function () { parent.postMessage({ recompaPsx: 'loaderror' }, '*'); };
        document.head.appendChild(s);
      };
    })();
  </script>
</body>
</html>`;
}

/** File extensions pcsx_rearmed advertises in its own core.json. */
const ACCEPTED = new Set(EMULATORJS_PSX_DESCRIPTOR.accepts);

class EmulatorJsPsxSession implements EngineSession {
  readonly descriptor = EMULATORJS_PSX_DESCRIPTOR;
  readonly raw: HTMLIFrameElement;

  private frame: HTMLIFrameElement;
  private objectUrls: string[] = [];
  private callbacks: EngineCallbacks;
  private started = false;
  private destroyed = false;
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private volume: number;

  constructor(
    frame: HTMLIFrameElement,
    callbacks: EngineCallbacks,
    objectUrls: string[],
    volume: number,
  ) {
    this.frame = frame;
    this.raw = frame;
    this.callbacks = callbacks;
    this.objectUrls = objectUrls;
    this.volume = volume;

    this.messageHandler = (event: MessageEvent) => {
      // Same-origin only; reject anything else outright.
      if (event.source !== this.frame.contentWindow) return;
      const kind = (event.data as { recompaPsx?: string } | null)?.recompaPsx;
      if (kind === 'booted') {
        // Listeners are attached now, so it is safe to pull in the runtime.
        const boot = (this.frame.contentWindow as Window & { __recompaBoot?: () => void } | null)
          ?.__recompaBoot;
        boot?.();
      } else if (kind === 'start') {
        this.started = true;
        this.callbacks.onLog?.('info', 'PlayStation core started');
      } else if (kind === 'loaderror') {
        this.callbacks.onError?.(new Error('EmulatorJS loader failed to load'));
      }
    };
    window.addEventListener('message', this.messageHandler);
  }

  private emulator(): EjsEmulatorLike | null {
    const win = this.frame.contentWindow as (Window & { EJS_emulator?: EjsEmulatorLike }) | null;
    return win?.EJS_emulator ?? null;
  }

  pause(): void {
    // EmulatorJS exposes pause through its canvas/gamepad handling; the
    // documented hook is the emulator's own `pause` event path.
    const emu = this.emulator();
    emu?.pause?.();
  }

  resume(): void {
    const emu = this.emulator();
    emu?.play?.();
  }

  reset(): void {
    const emu = this.emulator();
    emu?.restart?.();
  }

  setVolume(v: number): void {
    this.volume = v;
    const emu = this.emulator();
    emu?.setVolume?.(v);
  }

  setInput(_port: number, _button: string, pressed: boolean): void {
    // Keyboard and gamepad are handled inside the EmulatorJS frame, which owns
    // the focusable canvas. Synthesising input from outside would fight the
    // runtime's own input state; Recompa's touch controls are rendered by
    // EmulatorJS itself (`supports.touch`).
    void _port;
    void _button;
    void pressed;
  }

  async saveState(): Promise<Uint8Array | null> {
    const emu = this.emulator();
    const gm = emu?.gameManager;
    if (!gm?.getState) return null;
    try {
      const state = gm.getState();
      return state instanceof Uint8Array ? state : null;
    } catch (error) {
      this.callbacks.onLog?.('warn', `saveState failed: ${String(error)}`);
      return null;
    }
  }

  async loadState(state: Uint8Array): Promise<boolean> {
    const gm = this.emulator()?.gameManager;
    if (!gm?.loadState) return false;
    try {
      gm.loadState(state);
      return true;
    } catch (error) {
      this.callbacks.onLog?.('warn', `loadState failed: ${String(error)}`);
      return false;
    }
  }

  async readSram(): Promise<Uint8Array | null> {
    const gm = this.emulator()?.gameManager;
    // pcsx_rearmed writes .srm memory cards; only available once the game has
    // actually mounted its filesystem.
    if (!gm?.getSaveFile) return null;
    try {
      const file = gm.getSaveFile();
      return file instanceof Uint8Array ? file : null;
    } catch {
      return null;
    }
  }

  async writeSram(sram: Uint8Array): Promise<void> {
    const gm = this.emulator()?.gameManager;
    gm?.writeSaveFile?.(sram);
  }

  async screenshot(): Promise<Blob | null> {
    const doc = this.frame.contentDocument;
    const canvas = doc?.querySelector('canvas');
    if (!canvas) return null;
    return new Promise((resolve) => {
      try {
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      } catch {
        resolve(null);
      }
    });
  }

  setFastForward(multiplier: number): void {
    const emu = this.emulator();
    if (multiplier > 1) emu?.setFastForward?.(multiplier);
    else emu?.setFastForward?.(1);
  }

  stats(): EngineStats {
    const emu = this.emulator();
    return {
      fps: emu?.fps ?? 0,
      frameTimeMs: emu?.frameTimeMs ?? 0,
      audioSampleRate: null,
      audioLatencyMs: null,
      videoMode: 'WebGL2 (EmulatorJS)',
      extra: {
        core: 'pcsx_rearmed',
        started: this.started ? 1 : 0,
        volume: this.volume,
      },
    };
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.messageHandler) window.removeEventListener('message', this.messageHandler);
    try {
      this.emulator()?.callEvent?.('exit');
    } catch {
      /* best-effort teardown */
    }
    this.frame.remove();
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
  }
}

/** The subset of the EmulatorJS instance Recompa relies on. */
interface EjsEmulatorLike {
  on?: (event: string, fn: (data?: unknown) => void) => void;
  callEvent?: (event: string) => void;
  pause?: () => void;
  play?: () => void;
  restart?: () => void;
  setVolume?: (v: number) => void;
  setFastForward?: (n: number) => void;
  fps?: number;
  frameTimeMs?: number;
  gameManager?: {
    getState?: () => Uint8Array;
    loadState?: (state: Uint8Array) => void;
    getSaveFile?: () => Uint8Array;
    writeSaveFile?: (data: Uint8Array) => void;
  };
}

export const EmulatorJsPsxAdapter: EngineAdapter = {
  descriptor: EMULATORJS_PSX_DESCRIPTOR,

  canRun(input: EngineCandidateInput): EngineCandidate {
    const { report, platform, environment } = input;
    const blockers: string[] = [];
    const notes: string[] = [];

    if (platform?.id !== 'psx') {
      blockers.push('Not a PlayStation image.');
    }

    const formatId = report.format?.id ?? '';
    const ext = formatId === 'cue' ? 'cue' : formatId === 'psx-raw' ? 'bin' : formatId;
    if (formatId === 'chd') {
      blockers.push(
        'CHD is not supported by pcsx_rearmed. Convert the image to BIN/CUE — the CHD itself is fine and does not need altering.',
      );
    } else if (formatId === 'pbp' || ext === 'pbp') {
      notes.push('PBP support is claimed by the core but untested in Recompa; BIN/CUE is the verified path.');
    } else if (ACCEPTED.size > 0 && ext && !ACCEPTED.has(ext) && formatId !== 'iso9660' && formatId !== 'psx-raw') {
      notes.push(`Container "${formatId}" is not in the core's advertised list (${[...ACCEPTED].join(', ')}).`);
    }

    // Environment gates that this core genuinely requires.
    const prereq = enginePrerequisiteBlockers(environment, EMULATORJS_PSX_DESCRIPTOR.id);
    blockers.push(...prereq.blockers);
    notes.push(...prereq.notes);

    // BIOS: a real dependency. `biosInstalled` is supplied by the caller, which
    // can read IndexedDB; canRun() is synchronous and cannot. When the caller
    // cannot tell us, we keep the blocker — refusing to start is correct, and
    // silently assuming firmware exists would produce a black screen.
    if (input.biosInstalled !== true) {
      blockers.push(
        'PlayStation BIOS not installed — add your own dump (scph5500/5501/5502, 512 KiB) in Settings. It is never bundled or downloaded.',
      );
    }

    if (environment.userAgentClass === 'mobile') {
      notes.push('pcsx_rearmed is frame-rate dependent; phones may not reach full speed.');
    }

    return {
      engineId: EMULATORJS_PSX_DESCRIPTOR.id,
      runnable: blockers.length === 0,
      blockers,
      notes,
    };
  },

  async create(options: EngineRunOptions, callbacks: EngineCallbacks): Promise<EngineSession> {
    const objectUrls: string[] = [];

    // `options.rom` is already the complete, launchable payload: when a disc
    // set has companions, analysis stores it as a single ZIP (discArchive.ts).
    const gameBlob = new Blob([options.rom.slice().buffer as ArrayBuffer], {
      type: 'application/octet-stream',
    });
    const gameName = options.fileName.replace(/\.[^.]+$/, '');
    const gameUrl = URL.createObjectURL(gameBlob);
    objectUrls.push(gameUrl);

    let biosUrl = '';
    const bios = options.dependencies?.bios;
    if (bios) {
      // The core looks for a known filename in its system directory, so the
      // blob keeps the user's own file name via EJS_biosUrl.
      biosUrl = URL.createObjectURL(
        new Blob([bios.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' }),
      );
      objectUrls.push(biosUrl);
    }

    const frame = document.createElement('iframe');
    frame.setAttribute('title', 'PlayStation emulator');
    frame.setAttribute('allow', 'autoplay; gamepad; fullscreen');
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#000;';
    frame.src = 'about:blank';

    const doc = frame.contentDocument;
    if (!doc) {
      for (const url of objectUrls) URL.revokeObjectURL(url);
      throw new Error('Could not create the emulator frame');
    }
    doc.open();
    doc.write(
      bootstrapHtml({ gameName, gameUrl, biosUrl, dataPath: DATA_PATH, volume: options.volume }),
    );
    doc.close();

    // Replace the caller's canvas with the isolated frame.
    const host = options.canvas.parentElement ?? document.body;
    options.canvas.replaceWith(frame);
    if (!frame.isConnected) host.appendChild(frame);

    const session = new EmulatorJsPsxSession(frame, callbacks, objectUrls, options.volume);
    callbacks.onLog?.('info', `PlayStation core starting (${gameName})`);
    return session;
  },
};
