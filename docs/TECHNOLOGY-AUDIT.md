# Technology audit

**Audit date:** 4 November 2026. Every row below was checked against the live APIs
(`api.github.com`, `registry.npmjs.org`) during this build; versions, licence identifiers and
"last pushed" timestamps are the values returned at that time. Where a package could not be
verified, that is stated rather than assumed.

Reproduce with:

```bash
curl -s https://api.github.com/repos/<owner>/<repo> | jq '{full_name, license: .license.spdx_id, pushed_at, archived}'
curl -s https://registry.npmjs.org/<package> | jq '.dist-tags, .<version>.license'
```

---

## 1. Decision summary

| Need | Chosen | Rejected alternatives | Why |
| --- | --- | --- | --- |
| NES execution | **jsnes 2.1.0** (Apache-2.0) | EmulatorJS+FCEUmm, WasmBoy (GB only), NES emulators in Rust | jsnes is the only permissively licensed, dependency-free NES core that is pure ESM and needs no WASM toolchain. EmulatorJS is GPL-3.0 and a large payload; it is offered as an *optional* extra. |
| GBA/GB/GBC execution | **@thenick775/mgba-wasm 2.6.0** (MPL-2.0) | mGBA native + Emscripten build from source, gbajs2, WasmBoy | Ships a maintained mGBA 0.10 build with save states, IDBFS persistence and a documented API. Building mGBA ourselves would add a heavy toolchain to every contributor's setup for no user-visible gain. |
| N64 execution | **None shipped** — audited and reported | N64Recomp, N64ModernRuntime, Zelda64Recomp | All are native C++/C projects. No published WebAssembly build of N64ModernRuntime or RT64 exists. Claiming otherwise would violate the project's core rule. |
| Fingerprinting data | **No-Intro DATs via libretro-database** (CC-BY-SA-4.0) | Redump (discs, CDN-blocked), MAME XML (arcade), openvgdb | Provides 31,655 cartridge fingerprints as plain DAT files with CRC32/MD5/SHA-1 and no game data. Redump's DATs are reachable but its disc data is much larger and not needed for the first release. |
| Archive intake | **fflate 0.8.3** (MIT) | JSZip, unzipit | fflate offers a filter callback, which is exactly what an uncompressed-size-capped inspection needs, and is ~8 kB. |
| Persistence | **IndexedDB via idb 8.0.4** (ISC) | localStorage, OPFS, sql.js | Blob storage for ROMs and save states, transactional, supported everywhere. OPFS would be faster but is unavailable in several target browsers. |
| State + UI | **React 19 + zustand 5 + Tailwind 4 + Vite 8** | Next.js, Redux, Vue | No SSR requirement, no server; Vite gives a static bundle with hashed assets. Two zustand stores cover the whole app. |
| Heavy static analysis | **Optional loopback Node service** | In-browser WASM Ghidra, cloud API | Ghidra is a JVM application and Rizin is a native C tool; neither runs in a browser tab. Isolating them behind an opt-in, loopback-only service keeps the client dependency-free. |

---

## 2. Emulation and recompilation, checked individually

### EmulatorJS / RetroArch cores

- Repository `EmulatorJS/EmulatorJS`, GPL-3.0, last push **2026-10-21**, 4.3k stars.
- **The npm package `emulatorjs` was unpublished** (registry metadata shows `unpublished` at
  2025-03-07). It therefore cannot be installed with `npm install emulatorjs`.
- The latest GitHub release is **v4.2.3**, distributed as a single `4.2.3.7z` asset (303.55 MB
  including all cores).
- Cores are published to npm as `@emulatorjs/core-<name>` **4.2.3** (e.g. `core-fceumm`,
  `core-snes9x`, `core-mgba`, `core-pcsx_rearmed`, `core-mupen64plus_next`).
- **Decision:** not bundled. GPL-3.0 redistribution would require shipping corresponding source and
  would change the licence obligations of the deployed site. `scripts/fetch-emulatorjs.mjs` installs
  it *by the operator* into `public/cores/emulatorjs` (git-ignored), pinned to v4.2.3, and the engine
  registry detects it at runtime with a HEAD probe. This keeps the default build permissive and
  leaves the choice — and the licence obligation — with the person deploying it.

### mGBA

- Upstream `mgba-emu/mgba` (MPL-2.0). The WASM build used here is
  `@thenick775/mgba-wasm` **2.6.0**, MPL-2.0, 2.5 MB unpacked (1.77 MB `.wasm` + 133 kB glue).
- Verified API surface from `dist/mgba.d.ts`: `loadGame`, `pauseGame/resumeGame`, `saveState(slot)`,
  `loadState(slot)`, `getSave`, `FSSync`, `FSInit`, `screenshot`, `setVolume`,
  `setFastForwardMultiplier`, `buttonPress/buttonUnpress`, `uploadRom`, `linkLocalStartSession`.
- **Verified constraint:** the Emscripten build calls `canvas.getContext("webgl2")` in its GL glue
  (grep against `dist/mgba.js`). Without WebGL2 the core cannot initialise video. `canRun()` now
  rejects it up-front with that exact reason instead of failing after the ROM is loaded.
- **Verified constraint:** the build is single-threaded (no `-pthread` worker build shipped), so it
  runs on the main thread. The adapter therefore lets the core own its own main loop rather than
  re-driving it, and reports `worker: false` in its descriptor.

### jsnes

- `jsnes` **2.1.0**, Apache-2.0, pure ESM (`exports.import → src/index.js`).
- **Verified packaging quirk:** the CommonJS `main` (`dist/jsnes.js`) is a webpack UMD bundle whose
  wrapper does not expose named exports — `Object.keys(require('jsnes'))` returns `[]`. The ESM entry
  does export `{ NES, Controller, GameGenie, Browser }`. `resolveNesConstructor()` tries the ESM
  namespace, then interop shapes, then the webpack module registry, and throws a clear error if none
  are found. A unit test covers this.
- **Verified behavioural bug:** `NES#reset()` rebuilds CPU/PPU but recreates the mapper without
  loading PRG banks. The next `frame()` throws
  `Game crashed, invalid opcode at address $1fd`. `reloadROM()` is the safe restart and is what the
  adapter uses. A regression test documents the upstream behaviour so a future version bump cannot
  silently reintroduce it.

### N64Recomp / N64ModernRuntime / Zelda64Recomp

- `N64Recomp/N64Recomp` — MIT, last push **2026-11-03**, 8.4k stars. Emits C from MIPS functions
  using a **symbol map**; an unlabelled commercial ROM cannot be recompiled blindly.
- `N64Recomp/N64ModernRuntime` — GPL-3.0, last push **2026-11-03**. Provides `ultramodern`
  (libultra reimplementation) and `librecomp` (overlay handling, PI DMA, EEPROM/SRAM/FlashRAM), and
  expects a renderer such as RT64 to be registered by the host application.
- `Zelda64Recomp/Zelda64Recomp` — GPL-3.0, last push **2026-09-25**. Its README states the releases
  contain no game assets and the original game is required.
- **Conclusion:** recompilation is a genuine, maintained route *on desktop*, and Recompa reports it
  as available-with-prerequisites for N64 titles. It is **not** a browser route today: there is no
  public WASM build of the runtime or renderer. Recompa therefore marks the `transpile` stage
  `blocked`, records the prerequisites verbatim, and can emit the exact local command line via the
  optional service. It never reports the job as completed.

### Rust/WASM emulators, other cores

- Looked for maintained Rust→WASM cores with permissive licences suitable for NES/GBA. None matched
  the combination of (a) published WASM artefact, (b) permissive licence, (c) save-state API. The
  two integrated cores above already cover the target platforms with verified behaviour, so no
  additional engine was added for its own sake.

---

## 3. Reverse-engineering tooling

| Tool | Verified status | Integration |
| --- | --- | --- |
| **REA** (`morluto/rea`) | MIT, TypeScript, last push **2026-11-04**, homepage `rea.tools`. Describes itself as "reverse engineer anything with agents, from app behavior down to native binaries". Topics include `agent-skills`, `mcp`, `ghidra`-adjacent workflows. | **Optional, assistant only.** Invoked by `server/processing-service.mjs` when `REA_CLI`, `REA_MODEL` and `REA_API_KEY` are all set. It is never presented as a ROM converter, and the service reports "not configured" otherwise. |
| **Ghidra** | Apache-2.0, `NationalSecurityAgency/ghidra`, last push **2026-11-03**. | Headless analyser endpoint in the optional service (`GHIDRA_HEADLESS`). JVM application — cannot run in a browser tab. |
| **Rizin** | LGPL-3.0, `rizinorg/rizin`, last push **2026-11-04**. | Primary structural analyser for the optional service (`RIZIN_BIN`), invoked as `rizin -q -c '<script>' file` with `shell: false` and a hard timeout. |
| **radare2** | NOASSERTION licence on GitHub, last push **2026-11-04**. | Not integrated. Rizin is a fork with a clearer LGPL-3.0 declaration, which matters for redistribution. |
| **decomp-toolkit** | Repository not found under the guessed path at audit time. | Not integrated; no verified source to cite. |

**Why browsers cannot do this natively:** Ghidra is JVM-based (Java), Rizin/radare2 are native C.
Neither has a maintained in-browser build. Recompa therefore keeps this work in an explicitly
opt-in service rather than shipping a fake progress bar.

---

## 4. Data sources

| Source | Licence | Size at audit | Use |
| --- | --- | --- | --- |
| libretro/libretro-database `metadat/no-intro/*.dat` | CC-BY-SA-4.0 | NES DAT 3.03 MB → 13,286 fingerprints | Game identification |
| No-Intro DAT versions | — | e.g. NES `2026.10.07` | Recorded in `public/data/catalogue/index.json` |

Selected platforms and resulting entry counts (actual output of `npm run fetch:dat`):

| Platform | DAT size | Fingerprints |
| --- | --- | --- |
| NES | 3,031 KiB | 13,286 |
| SNES | 841 KiB | 3,730 |
| Game Boy | 483 KiB | 2,115 |
| Game Boy Color | 611 KiB | 2,433 |
| Game Boy Advance | 941 KiB | 3,503 |
| Nintendo 64 | 568 KiB | 2,268 |
| Mega Drive / Genesis | 698 KiB | 2,656 |
| Master System | 235 KiB | 1,057 |
| Game Gear | 133 KiB | 607 |
| **Total** | | **31,655** |

**Licence handling:** the generated JSON files live in `public/data/catalogue/` and carry a
`source` block with repository, path, blob SHA, dataset name and CC-BY-SA-4.0 attribution. The About
page and Compatibility page surface it. The dataset is metadata only — it contains no ROM content,
so it does not create a game-data redistribution problem; it *does* mean derived catalogue files
inherit CC-BY-SA-4.0, which the notices state.

---

## 5. Test-ROM strategy

Commercial ROMs cannot be shipped, and the widely circulated test ROMs in `christopherpow/nes-test-roms`
(6.9 MB, 290 `.nes` files) do not carry a repository-level licence at audit time. Rather than assume
redistribution permission, Recompa generates its own cartridge:

- `src/core/testrom.ts` contains a **two-pass 6502 assembler** (labels, absolute fixups, relative
  branch range checking) and a small program that waits for vblank, uploads a palette, fills the
  nametable from CHR ROM, enables NMI, and cycles the background palette every frame.
- Verified output under the real jsnes core: 87.5 % non-black pixels, 3 distinct colours, and two
  alternating frame signatures over 90 frames, with the NMI counter reaching 79.
- This makes boot, PPU rendering, VRAM addressing, palette output and interrupt handling all
  observable — a far stronger signal than "the file opened".

During development the public test ROMs were used locally as *additional* fixtures for detector
tests (40/40 identified correctly as iNES) but are not committed.

---

## 6. Rejected for this release (with reasons)

| Candidate | Reason |
| --- | --- |
| `emulatorjs` npm package | Unpublished from npm; cannot be installed reproducibly. |
| `nes-test-roms` npm package | Does not exist on the registry. |
| Building mGBA with Emscripten in CI | Adds a full LLVM/WASM toolchain to every contributor's environment; the published build is maintained and pinned. |
| OPFS for ROM storage | Not available in all supported browsers; IndexedDB Blobs are adequate and universal. |
| WebGPU rendering for 2D cores | Both integrated cores output at 240p–256×240; a 2D canvas blit is faster than a GPU pipeline at that size and avoids driver quirks. The capability probe still reports WebGPU for future 3D cores. |
| Cloud processing for heavy analysis | Contradicts the local-first requirement and would introduce cost. The loopback service covers the need without either. |
| Service worker offline cache | Valuable, but adds cache-invalidation risk for engine binaries. Listed as future work with a versioned cache strategy rather than shipped half-done. |
