# Changelog

All notable changes to Recompa are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Settings wiring, resilience and accessibility — 5 November 2026 (third pass)

Full findings, measurements and verification: `docs/AUDIT-2026-11-05-followup.md`.

#### Fixed

- **Eleven settings were dead controls.** `storePayloads`, `storeStates`,
  `autoAnalyze`, `showFps`, `videoScale`, `audioBufferSamples`, `autoFullscreen`,
  `keepScreenAwake`, `performanceMode`, `theme` and `telemetry` were persisted
  and (for eight of them) rendered as working controls, but no code read them.
  Turning "Store ROM bytes after analysis" off still stored ROM bytes, and the
  scaling selector was consumed as
  `settings.videoScale === '1x' ? 1 : settings.videoScale === '2x' ? 1 : 1` — a
  constant. Every setting that describes real behaviour is now implemented:
  payload and save-state storage are honoured (the game page says "File not kept"
  rather than offering a launch that must fail), "analyse immediately" holds
  files in a confirmation panel before anything is read, the FPS toggle gates the
  status line, scaling applies native/pixel-perfect sizing, `auto` aspect now
  resolves per platform (GB is no longer stretched to 4:3), the audio buffer
  reaches the ScriptProcessor path, fullscreen-on-launch and the Screen Wake Lock
  are wired. `theme`, `performanceMode` and `telemetry` described nothing and
  were removed. Guarded by `tests/unit/settings-wiring.test.ts`, which fails if
  any `AppSettings` key is not read outside the store and the settings screen.
- A render error anywhere unmounted the entire tree and left a blank page. A
  top-level `ErrorBoundary` now shows the error and offers reload/home, and says
  plainly that stored games survive a reload.
- Storage quota failures showed the raw `QuotaExceededError`. They now explain
  that the device is out of space and name the three remedies.
- `putPayload()` copied the whole file before writing it; large disc images no
  longer double their peak memory.
- Dialogs declared `aria-modal` without any keyboard behaviour. New `useModal()`
  adds Escape, focus move, Tab trapping and focus restore to the cover picker,
  the delete confirmation, the processing consent dialog and the screenshot
  preview.
- Keyboard users had to tab through the full navigation on every page; a "Skip to
  content" link is now the first focus stop.

#### Added

- `docs/AUDIT-2026-11-05-followup.md` — audit, measurements and verification for
  this pass.
- `src/ui/player/layout.ts` (testable aspect and scaling maths),
  `src/lib/use-modal.ts`, `src/lib/storage-errors.ts`,
  `src/ui/components/ErrorBoundary.tsx`.
- Tests: `player-layout` (11), `storage-errors` (6), `use-modal` (6),
  `error-boundary` (4), `settings-wiring` (4), `library-storage-setting` (3), plus
  two Playwright tests that drive the new settings gates in a real browser.


Audit and hardening pass, 5 November 2026. See `docs/AUDIT-2026-11-05.md` for
the full findings, priorities, deployment record and verification results.

Deployed through the existing GitHub-linked Vercel project from this branch:
preview `dpl_3XrgLa7gEW5S5imPqgWNJQthKPso`, then production
`dpl_rDhcGZGpgxjqG279d1mX6EHSchBR` (READY / PROMOTED, alias
<https://recompa.vercel.app>). The live app, SPA rewrite, catalogue, manifest,
hashed JS bundle, GPL core payload and licence texts were smoke-tested after
promotion. `main` was not modified.

### Fixed

- **PlayStation playback could not start.** The EmulatorJS adapter read
  `iframe.contentDocument` before the frame was inserted into the document.
  Chromium returns `null` for a detached iframe, so every launch threw
  *"Could not create the emulator frame"*. `mountBootstrapFrame()` now connects
  the frame first, restores the canvas and lets the caller revoke blob URLs on
  failure. Guarded by a fake-DOM unit test and a real-browser Playwright test.
- **The planner could choose an engine that does not exist.** `install-check.ts`
  treated EmulatorJS `loader.js` as proof of an NES/FCEUmm core, so every NES
  ROM was planned against `emulatorjs-nes` — an engine with no adapter, no
  payload and no code path. PLAY then failed with *"Engine … is not installed in
  this build"*. Discovery now probes the actual `pcsx_rearmed` core payload (or
  the install manifest's `cores` array), always reports the two compiled-in
  adapters, and never reports `emulatorjs-nes`. The planner additionally rejects
  any accepted candidate without a registered adapter. Descriptor and
  compatibility text no longer claim an FCEUmm payload is installed.
- **The player could get stuck on "Loading core…" with status `stopped`.**
  `useEmulator()` returns a fresh object on every render, but three `Player.tsx`
  effects depended on that whole object — so the teardown effect (which calls
  `stop()`) ran on *every* render and aborted the session immediately after it
  was created. React 19 StrictMode's simulated remount made it deterministic.
  Effects now depend on the hook's stable `start`/`stop`/`actions` members, and
  the boot effect resets its guard in cleanup so a StrictMode remount can boot
  again. The full Playwright flow now runs a real jsnes session at measured fps.
- `npm run fetch:testroms` pointed at a file that did not exist. Removed; the
  generated cartridge in `src/core/testrom.ts` is the supported path. A new
  `repo-integrity` test now fails CI if any `package.json` script references a
  missing `.mjs` file or the README documents an undefined npm command.
- Four download handlers revoked their blob URL synchronously after `a.click()`,
  which can abort downloads in Firefox/Safari. All local downloads now go
  through one `downloadBlob()` helper that waits before revoking.
- Screenshot previews leaked a `blob:` URL on every capture and on unmount; the
  preview URL is now revoked on replacement, on close and on unmount.
- `useSettings.reset()` no longer lets a pending 250 ms debounced write restore
  the pre-reset values.
- `docs/DEPLOYMENT.md` published an outdated CSP that did not match
  `vercel.json`; the two are now identical and the README no longer hardcodes a
  unit-test count.

### Hardened

- The PlayStation bootstrap posts status messages to the explicit deployment
  origin instead of `'*'` (the parent still verifies `event.source`), and
  `__recompaBoot()` is idempotent.
- The processing client now refuses non-loopback endpoints. This matches the
  deployed `connect-src`, makes the confirmation dialog's privacy promise true,
  and prevents a mistyped endpoint from sending ROM bytes to another machine.
- Removed the phantom `rea` capability from `GET /capabilities` and the unused
  `REA_*` variables from `.env.example`. No endpoint ever consumed them, so the
  service could report "configured" for a tool with no code path. Attribution and
  the audit note now state plainly that REA is researched, not integrated.
  `.env.example` gains the two real variables it was missing
  (`RECOMPA_JOB_TIMEOUT_MS`, `N64RECOMP_BIN`).
- `playwright.config.ts` accepts `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and
  `PLAYWRIGHT_CHROMIUM_ARGS`, so the E2E suite can run where the Playwright CDN
  is blocked. Documented in `docs/DEPLOYMENT.md §1`.
- All third-party GitHub Actions are now pinned to immutable commit SHAs, with
  the resolved table and refresh procedure in `SECURITY.md`. Workflows already
  used explicit least-privilege `permissions:` and
  `persist-credentials: false`; a new repo-integrity test enforces both plus the
  SHA pinning, and `SECURITY.md` documents the exact account-level settings that
  cannot be expressed in a file.
- `SECURITY.md` now publishes the deployed CSP verbatim instead of an outdated
  copy, with the `unsafe-eval` / `wasm-unsafe-eval` trade-off explained.
- `.gitignore` excludes Playwright's generated `test-results/`,
  `playwright-report/` and `blob-report/` directories.

### Tests added

- `tests/unit/psx-frame.test.ts`, `tests/unit/install-check.test.ts`,
  `tests/unit/player-lifecycle.test.ts`, `tests/unit/repo-integrity.test.ts`,
  `tests/unit/processing.test.ts`, `tests/unit/processing-service.test.ts`
  (the last starts the real loopback service on an ephemeral port),
  `tests/e2e/psx-frame.spec.ts`.
- `tests/e2e/smoke.spec.ts` was repaired rather than weakened: each test now
  seeds its own IndexedDB state through the app's real self-test intake (Playwright
  gives every test a fresh context), the stale `jsnes` locator became the visible
  `JS emulation` badge, the screenshot preview is closed before the next control,
  measured results are produced by a real verification run, and the unknown-file
  case asserts the diagnostics actually rendered. fps, canvas, screenshot and
  save-state assertions are intact.

## [0.1.0] — 2026-11-04

First working release, and the first one that is **live**: <https://recompa.vercel.app>.

### Deployed

- Production deployment on Vercel (project `recompa`), built from this repository with
  `npm ci` → `npm run build`, output `dist/`.
- `vercel.json` serves COOP/COEP/CORP, immutable cache headers for `/assets/*`, and the SPA rewrite,
  so the live page reports `crossOriginIsolated === true` and audio gets `SharedArrayBuffer`.
- Verified live: app renders, `/library` deep link rewrites, `/data/catalogue/index.json` serves
  9 platforms / 31,655 entries, `/manifest.webmanifest` correct.

Scope was deliberately limited to what could be verified end-to-end.

### Added

**Analysis**

- Byte-level format detectors: iNES/NES 2.0/UNIF/FDS, Game Boy/GBC/GBA (with logo and header
  checksums), N64 (big-endian / little-endian / byteswapped), NDS, Mega Drive (including SMD
  de-interleaving), Master System/Game Gear, Atari 7800/Lynx, ISO 9660 and CUE disc images.
- Canonicalisation pipeline: copier headers stripped, N64 images normalised to `.z64` order before
  hashing, so identical games hash identically regardless of container quirks.
- CRC32 and MD5 implemented in TypeScript (verified against published vectors); SHA-1 and SHA-256
  via WebCrypto.
- Offline fingerprint catalogue: 31,655 No-Intro entries across 9 platforms, generated by
  `scripts/fetch-dats.mjs` from libretro-database (CC-BY-SA-4.0). Titles are only claimed on a
  hash match; otherwise the report says the title came from the header or the file name.
- Technical report per file: evidence, header fields, checksums, dependencies (firmware, cue tracks),
  warnings and actionable errors.

**Planning**

- Deterministic execution ladder: browser-native recompilation → static recompilation → WASM source
  port → WASM emulator → JS emulator.
- Candidate matrix records every option considered with its exact rejection reason.
- Job records with real stage outcomes (`done`/`skipped`/`blocked`), never estimated percentages.

**Execution**

- jsnes 2.1.0 adapter: Canvas2D nearest-neighbour output, rAF pacing with measured FPS, save states
  via `toJSON/fromJSON`, battery SRAM extraction, screenshots, gamepad (W3C layout) and touch.
- mGBA (WASM) adapter: WebGL2 requirement checked before launch, IDBFS save persistence, core save
  states, fast-forward, volume.
- Audio output with an AudioWorklet ring buffer over `SharedArrayBuffer` when cross-origin isolated,
  ScriptProcessor fallback otherwise; measured latency is reported, never estimated.
- Player UI: fullscreen, aspect/filter/scale settings, speed control, pause/resume, restart,
  screenshot (also offered as cover art), save-state manager with thumbnails, live performance panel.

**Verification**

- Test harness that samples the framebuffer twice per second, hashes frame signatures, injects real
  input edges, measures FPS and performs a save-state round trip. Compatibility is only marked
  `compatible` when those checks pass on the device.
- Generated self-test cartridge (`src/core/testrom.ts`) assembled by a local two-pass 6502 assembler,
  so the pipeline can be proven without any third-party ROM.

**Platform**

- IndexedDB library with payload deduplication by SHA-256, favourites, play time, covers.
- Backup export/import (schema v2) that deliberately excludes ROM bytes and base64-encodes saves.
- Optional loopback processing service (zero dependencies) for Rizin/Ghidra/N64Recomp preparation,
  with honest "not configured" reporting.
- Capability probe surfaced in the UI: WASM, SIMD, threads, SAB, WebGPU, WebGL2, AudioWorklet,
  IndexedDB, OffscreenCanvas, cores, memory, GPU model (redacted).

### Fixed during development

- GBA detector no longer accepts a random 32 KiB-aligned blob that merely had a `.gba` extension.
- Game Boy header checksum now covers the documented `$0134–$014C` range.
- `NES#reset()` in jsnes 2.1.0 leaves the mapper unloaded (subsequent frames crash); the adapter
  restarts through `reloadROM()` and a regression test documents the upstream behaviour.
- Backup export previously attempted to serialise ROM `Blob`s and corrupted `Uint8Array` saves;
  replaced with a versioned format.
- Nested `.zip` members are no longer selected as game payloads.
- `titleFromFileName` now strips all trailing `(…)/[…]` tags rather than only region tags.
- mGBA WASM is imported as a Vite asset URL: one copy in the build, correct under any base path.

### Known limitations

- No browser-side recompilation: N64ModernRuntime and RT64 have no published WebAssembly build.
- Only NES and GBA/GB/GBC have integrated execution cores in this release.
- PAL timing is not modelled by the NES core.
- Playwright end-to-end suite is committed but was not executable in the authoring sandbox
  (browser binary download blocked); see `docs/COMPLETION-REPORT.md`.
