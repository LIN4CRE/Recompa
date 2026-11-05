# Follow-up audit — settings wiring, resilience and accessibility

**Repository:** `LIN4CRE/Recompa` · **Branch:** `arena/0bf459c4-recompa`
**Baseline commit:** `0dcb657` (merge of PR #14; the tree already deployed at <https://recompa.vercel.app>)

This is the third independent pass over the repository. The first
(`docs/COMPLETION-REPORT.md`) built the application; the second
(`docs/AUDIT-2026-11-05.md`) fixed PlayStation playback, engine planning and the
stuck player. Both are point-in-time records and are left as written.

This pass was run on the assumption that the previous reports might be wrong. The
baseline was re-measured before any edit, including the Playwright suite that the
first report recorded as permanently blocked.

---

## A. Baseline, re-measured before any edit

| Check | Command | Result |
| --- | --- | --- |
| Install | `npm ci` | PASS — 110 packages, 0 vulnerabilities |
| Typecheck | `npm run typecheck` | PASS — `tsc -b`, 0 errors |
| Unit tests | `npm test` | PASS — **249 / 249 in 19 files** |
| Production build | `npm run build` | PASS — 2,157 modules, entry 452.09 kB (129.05 kB gzip) |
| End-to-end | `npm run test:e2e` with a supplied Chromium | PASS — **6 / 6**, Chromium 153.0.8010.0 |
| Dependency audit | `npm audit`, `npm audit --omit=dev` | PASS — 0 and 0 |
| Live deployment | Vercel project `recompa` | READY / PROMOTED from `0dcb657` |

The E2E suite is genuinely executable: a Chromium binary was obtained from the
npm registry (`@sparticuz/chromium@153.0.0`), its shared libraries extracted
locally, and the suite driven with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` exactly as `docs/DEPLOYMENT.md §1`
documents. Nothing in this report is inferred from a previous report.

---

## B. Findings

### P1 — High

| # | Problem | Location | Why it matters | Fix | Verification |
| --- | --- | --- | --- | --- | --- |
| 1 | **Eleven settings were dead controls.** `storePayloads`, `storeStates`, `autoAnalyze`, `showFps`, `videoScale`, `audioBufferSamples`, `autoFullscreen`, `keepScreenAwake`, `performanceMode`, `theme` and `telemetry` were declared, persisted and — for eight of them — rendered as working switches, sliders and selectors. No code read them. Toggling "Store ROM bytes after analysis" off still stored ROM bytes; "Analyse immediately when a file is dropped" changed nothing; the scaling selector's value was consumed as `settings.videoScale === '1x' ? 1 : settings.videoScale === '2x' ? 1 : 1`, i.e. always `1`. | `src/state/settings.ts`, `src/core/types.ts`, `src/ui/player/Player.tsx`, `src/ui/pages/SettingsPage.tsx` | This is the failure mode the project explicitly forbids: a control that claims behaviour it does not have, including a privacy-relevant claim about not storing ROMs. | Wired every setting that describes a real, implementable behaviour (see section C). Removed the three that described nothing (`theme` — a single-valued enum with no UI; `performanceMode`; `telemetry`). | New `settings-wiring` test proves every declared key is read outside the store and outside the settings screen, and the test's own detector is self-tested so it cannot silently stop matching. New E2E tests toggle two switches and assert the app behaves differently. New ingest test drives the real `addReport` path with the setting on and off. |
| 2 | **No render-error boundary.** Nothing in `src/` caught a render error. A thrown error anywhere — a corrupt IndexedDB record, an adapter failing while the player mounted — unmounted the entire tree and left a blank page with no route back. For an app whose whole premise is "your library is safe on this device", a white screen is the worst possible failure. | `src/main.tsx` | Availability of the only user-facing surface. | `ErrorBoundary` class component outside `StrictMode`, showing the error name/message, a reload action, a route home, and an explicit statement that stored games survive a reload. | jsdom test renders a throwing child, asserts the recovery UI and the `main.tsx` wiring order. |

### P2 — Medium

| # | Problem | Location | Fix |
| --- | --- | --- | --- |
| 3 | Four dialogs declared `role="dialog" aria-modal="true"` but had no Escape handler, no focus move and no focus trap — the declaration promised keyboard operability the app did not provide, and keyboard users could tab into the inert page behind the overlay. | `CoverArt.tsx`, `LibraryPage.tsx`, `ProcessingPanel.tsx`, `Player.tsx` | New `useModal()` hook (Escape, focus move, Tab wrap, focus restore); each dialog extracted into its own component so the hook only runs while mounted; each dialog gains `aria-labelledby`/`aria-label` and `tabIndex={-1}`. |
| 4 | Storage quota failures surfaced as raw `QuotaExceededError` text. Storing ROM and disc images is the app's normal workload, so running out of origin quota is a realistic path, not an edge case. | `Uploader.tsx`, `Player.tsx` | New `describeStorageError()` maps quota failures to an actionable message naming the three real remedies; unrelated errors keep their own message. |
| 5 | `putPayload()` copied the entire file before writing it (`bytes.slice().buffer`), doubling peak memory for a large disc image. | `src/db/database.ts` | `new Blob([bytes])` — Blob copies the view's own range, no extra ArrayBuffer. |
| 6 | The `aspect: 'auto'` branch resolved to `'4:3'` for every platform (`game.platformId === 'gba' ? '4:3' : '4:3'`), so Game Boy games were stretched to a television ratio. | `Player.tsx` | Per-platform table in `layout.ts`: NES/PSX 4:3, GB/GBC/GBA native. |
| 7 | No skip link; keyboard users tabbed through the whole navigation on every page. | `layout.tsx` | "Skip to content" link, visible on focus, targeting `<main id="main-content">`. |

### P3 — Low

| # | Problem | Fix |
| --- | --- | --- |
| 8 | Setting descriptions overstated what the control does (FPS "drawn on the video surface", audio buffer implied to govern both audio paths, folder scanning appeared to obey the confirm gate). | Descriptions now state exactly what happens, including that the audio buffer applies to the ScriptProcessor fallback and that choosing "Scan a folder" is itself the confirmation. |
| 9 | `videoScale` accepted unused `'1x' | '2x' | '3x'` values that no UI offered. | Type narrowed to the three values the UI exposes; all three are implemented. |

### Checked and found sound

Authentication (there is none, by design and by documentation), CSP and isolation
headers (still mirrored between `vercel.json`, `public/_headers` and the tests),
the optional loopback processing service (origin allowlist, `shell: false`,
body/job limits, honest capability reporting), focus-visible styling,
`prefers-reduced-motion`, the dependency tree, and the archive caps. No change was
made where none was warranted.

---

## C. What was implemented, not just removed

The settings are the substance of this pass, so each one now has a real code path:

| Setting | Now actually does |
| --- | --- |
| `storePayloads` | `addReport()` writes the report and plan but skips the payload blob when off; the game page shows a disabled **File not kept** button with the reason instead of a Play button that is guaranteed to fail. |
| `storeStates` | `doSaveState()` refuses to write and explains where to re-enable it. |
| `autoAnalyze` | Dropped, pasted, picked and folder-selected files are parked in a confirmation panel; nothing is read until the user confirms. |
| `showFps` | Gates the measured fps and frame time in the player status line. |
| `videoScale` | `auto` fits the stage, `native` is one canvas pixel per CSS pixel, `pixel-perfect` takes the largest integer multiple that fits (via `computeStageSize()`). |
| `aspect` | `auto` now resolves per platform. |
| `audioBufferSamples` | Plumbed through `EngineRunOptions` into `AudioSink`'s ScriptProcessor buffer. |
| `autoFullscreen` | Requests fullscreen when the session becomes ready, with a silent fallback where the browser needs a fresh gesture. |
| `keepScreenAwake` | Holds a Screen Wake Lock while a game runs, releases it on unmount/exit, re-acquires on visibility change (also exposed in the player panel). |

---

## D. Test results

| Check | Result |
| --- | --- |
| Typecheck | **PASS** — 0 errors |
| Unit tests | **PASS — 283 / 283 in 25 files** (baseline 249 in 19) |
| Production build | **PASS** — 2,157 modules, entry 460.38 kB / 131.63 kB gzip |
| E2E (Chromium 153.0.8010.0) | **PASS — 8 / 8** (baseline 6 / 6; two new tests cover the settings gates) |
| `npm audit` / `--omit=dev` | **PASS** — 0 / 0 |

New unit coverage: `player-layout` (11), `storage-errors` (6), `use-modal` (6),
`error-boundary` (4), `settings-wiring` (4), `library-storage-setting` (3).
New E2E: the confirm-before-hashing gate and the "analyse without keeping the
file" path, both driven through the real settings UI and the real file input.

The `settings-wiring` guard was mutation-tested: adding a `someUnwiredSetting`
key to `AppSettings` makes it fail with that key named, and reverting restores
green.
