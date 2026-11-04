import type { EngineDescriptor } from '@/core/types';

/**
 * Engine descriptors — the single source of truth for *what each engine is*.
 *
 * These strings are shown verbatim in the UI and the analysis report, so an
 * emulator can never be presented as a recompiler. Licence, version and
 * homepage fields are the real values verified during the project audit
 * (see docs/TECHNOLOGY-AUDIT.md for the retrieval dates and API output).
 */

export const JSNES_DESCRIPTOR: EngineDescriptor = {
  id: 'jsnes',
  name: 'jsnes (JavaScript NES core)',
  project: 'jsnes',
  version: '2.1.0',
  kind: 'js-emulator',
  licence: 'Apache-2.0',
  homepage: 'https://github.com/bfirsh/jsnes',
  platforms: ['nes'],
  accepts: ['nes'],
  needsFirmware: false,
  supports: {
    saveStates: true,
    sramSaves: true,
    screenshots: true,
    gamepad: true,
    touch: true,
    rewind: false,
    audio: true,
    worker: false,
    gpu: false,
    wasm: false,
  },
  performanceNotes:
    'Pure JavaScript CPU/PPU. Fast enough for NROM/MMC1 titles on desktop; frame pacing is measured at runtime. No WASM, so no separate core download.',
  available: true,
  limitations: [
    'Mapper coverage is a fixed table (0,1,2,3,4,7,10,11,13,21,22,23,66,140,180,240). Unsupported mappers are reported before launch.',
    'Runs on the main thread: heavy titles can contend with UI rendering.',
    'No PAL timing model; PAL carts run at NTSC speed.',
  ],
};

export const MGBA_DESCRIPTOR: EngineDescriptor = {
  id: 'mgba-wasm',
  name: 'mGBA 0.10 (WebAssembly)',
  project: 'mGBA (thenick775 WASM build)',
  version: '2.6.0 / mGBA 0.10.x',
  kind: 'wasm-emulator',
  licence: 'MPL-2.0',
  homepage: 'https://github.com/thenick775/mgba-wasm',
  platforms: ['gba', 'gb', 'gbc'],
  accepts: ['gba', 'agb', 'gb', 'gbc'],
  needsFirmware: false,
  supports: {
    saveStates: true,
    sramSaves: true,
    screenshots: true,
    gamepad: true,
    touch: true,
    rewind: true,
    audio: true,
    worker: false,
    gpu: false,
    wasm: true,
  },
  performanceNotes:
    'mGBA C core compiled with Emscripten. Renders via a 2D canvas; audio through Web Audio. Save states, SRAM and the emulator filesystem persist in IndexedDB.',
  available: true,
  limitations: [
    'The WASM build is single-threaded (no pthread build published), so it runs on the main thread.',
    'GBA BIOS HLE is used when no BIOS file is supplied; some titles show logo/intro differences.',
  ],
};

/**

EmulatorJS cores are hosted payloads. They are *not* bundled with Recompa: the
fetch script copies the GPL-3.0 build into `public/cores/emulatorjs` at setup
time so the licence and the binary stay together and the repository stays
free of redistributed copyleft binaries.
 */
export const EMULATORJS_DESCRIPTOR: EngineDescriptor = {
  id: 'emulatorjs-nes',
  name: 'EmulatorJS + FCEUmm (RetroArch WASM core)',
  project: 'EmulatorJS / FCEUmm',
  version: '4.2.3',
  kind: 'wasm-emulator',
  licence: 'GPL-3.0 (EmulatorJS) · GPL-2.0 (FCEUmm)',
  homepage: 'https://github.com/EmulatorJS/EmulatorJS',
  platforms: ['nes'],
  accepts: ['nes', 'unf', 'fds'],
  needsFirmware: false,
  supports: {
    saveStates: true,
    sramSaves: true,
    screenshots: true,
    gamepad: true,
    touch: true,
    rewind: true,
    audio: true,
    worker: false,
    gpu: true,
    wasm: true,
  },
  performanceNotes:
    'Libretro FCEUmm compiled to WebAssembly. Broader mapper coverage than jsnes and uses WebGL for presentation (NetPlay/RetroArch video path).',
  assetPath: '/cores/emulatorjs',
  installHint: 'npm run fetch:emulatorjs',
  available: false,
  unavailableReason:
    'Not installed in this deployment. Run `npm run fetch:emulatorjs` to download the pinned EmulatorJS build (GPL-3.0) into public/cores/emulatorjs.',
  limitations: [
    'Licensed GPL-3.0: if you serve it, you must offer the corresponding source (the fetch script records the exact upstream commit).',
    'Requires its own loader/data tree and cross-origin isolation is not required.',
  ],
};

export const N64RECOMP_DESCRIPTOR: EngineDescriptor = {
  id: 'n64recomp',
  name: 'N64Recomp (static recompiler, external toolchain)',
  project: 'N64Recomp',
  version: '1.x (rolling)',
  kind: 'static-recompilation',
  licence: 'MIT (tool) · GPL-3.0 (N64ModernRuntime) · RT64 renderer',
  homepage: 'https://github.com/N64Recomp/N64Recomp',
  platforms: ['n64'],
  accepts: ['z64', 'n64', 'v64'],
  needsFirmware: false,
  supports: {
    saveStates: false,
    sramSaves: true,
    screenshots: false,
    gamepad: true,
    touch: false,
    rewind: false,
    audio: true,
    worker: false,
    gpu: false,
    wasm: false,
  },
  performanceNotes:
    'Produces C code from MIPS functions using a symbol map. A browser build additionally needs the runtime (ultramodern/librecomp) plus a renderer such as RT64 compiled with Emscripten — a heavy native toolchain job that cannot run on the host.',
  available: false,
  unavailableReason:
    'Requires a native C++ toolchain, a per-game symbol map, and a WASM build of N64ModernRuntime + RT64. Recompa can audit compatibility and prepare the job, but will not pretend to have built it.',
  limitations: [
    'N64Recomp needs a function/symbol map: an unlabelled commercial ROM cannot be recompiled blindly.',
    'The runtime and renderer have no official WASM build, so a browser-native result is a research task, not a button.',
    'Recompiled output still requires the original ROM at runtime on PC; it is not a way to avoid owning the game.',
  ],
};

export const ALL_DESCRIPTORS: EngineDescriptor[] = [
  JSNES_DESCRIPTOR,
  MGBA_DESCRIPTOR,
  EMULATORJS_DESCRIPTOR,
  N64RECOMP_DESCRIPTOR,
];
