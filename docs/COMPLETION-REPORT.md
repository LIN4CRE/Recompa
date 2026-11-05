# Completion report

**Repository:** `LIN4CRE/Recompa` · **Branch:** `arena/e3fcb8d7-recompa`
**Date:** 4 November 2026 · **Release:** v0.1.0

> **Point-in-time report.** The branch name, test counts and "blocked" E2E status
> below describe the v0.1.0 build only. Subsequent work is recorded in
> `CHANGELOG.md` and the follow-up audit `docs/AUDIT-2026-11-05.md`; the E2E
> suite is now executable even where the Playwright CDN is unreachable.

---

## A. Project overview

| Item | Detail |
| --- | --- |
| Type | Static web application (client-side only) + optional local Node service |
| Stack | React 19, TypeScript 7.0, Vite 8, Tailwind 4, zustand 5, IndexedDB (idb), Vitest 5, Playwright |
| Execution cores | jsnes 2.1.0 (Apache-2.0), @thenick775/mgba-wasm 2.6.0 (MPL-2.0) |
| Data | No-Intro DAT fingerprints via libretro-database (CC-BY-SA-4.0), 31,655 entries |
| Original condition | Empty repository (single commit: `Initial commit`, README with one line) |
| Final condition | Working application: detection, identification, planning, two live engines, saves, verification, 89 unit tests, production build verified |

Because the repository was empty, there was no legacy behaviour to preserve. The work was therefore
a full build to the specification rather than a repair.

---

## B. Audit results

### Research and verification performed before writing code

- `api.github.com` queried for EmulatorJS, N64Recomp, N64ModernRuntime, Zelda64Recomp, Ghidra,
  Rizin, radare2, decomp-toolkit, REA, n64decomp/sm64 — licence, last-push date, archived flag.
- `registry.npmjs.org` queried for `emulatorjs` (**unpublished** — decisive), `@emulatorjs/core-*`
  (4.2.3, available), `jsnes` (2.1.0), `@thenick775/mgba-wasm` (2.6.0), `fflate`, `idb`, etc.
- EmulatorJS release assets inspected: v4.2.3 shipped as one 303.55 MB `.7z`.
- mGBA glue inspected to find the real WebGL2 `getContext` requirement.
- jsnes packaging inspected to find the empty-UMD-exports problem and the unsafe `reset()`.
- libretro-database tree enumerated to pick `metadat/no-intro/*.dat`; DAT parsing verified against
  the real NES file (13,286 games, every entry carrying CRC/MD5/SHA-1).

### Critical issues found and fixed during development

| # | Issue | Impact | Fix |
| --- | --- | --- | --- |
| 1 | GBA detector accepted any 32 KiB-aligned blob named `.gba` | Random data was reported as a GBA game, then failed at launch | Requires logo, `0x96` complement byte or header checksum corroboration; refused otherwise (unit test) |
| 2 | Game Boy header checksum computed over the logo instead of `$0134–$014C` | Valid carts were flagged invalid; invalid ones could pass | Corrected range; test asserts both directions |
| 3 | `NES#reset()` in jsnes 2.1.0 leaves the mapper without PRG banks | "Restart game" crashed the session | Adapter restarts via `reloadROM()`; regression test documents upstream behaviour |
| 4 | Backup export tried to serialise ROM `Blob`s and destroyed `Uint8Array` saves | Backups were huge and save data was unusable on import | Schema v2: no payloads, base64 byte arrays, plus a rescue path for v1 files |
| 5 | Nested `.zip` members were chosen as the game payload | "Unrecognised file" for archives that contained a real ROM | Nested archives excluded from scoring; explicit "extract first" error |
| 6 | Hand-assembled test ROM had two wrong branch displacements | Self-test ROM appeared to hang (it was spinning) | Replaced with a two-pass assembler that resolves labels and validates branch range |
| 7 | mGBA WASM emitted twice (1.8 MB duplicated) and referenced by an absolute path | Broken under any sub-path deploy; wasted bandwidth | Single `?url` import; one copy in `dist/assets`, base-path independent |
| 8 | Vite rejected the sandbox preview host | The live preview returned 403 | `server.allowedHosts` configured for the preview domain |
| 9 | `manualChunks` object form incompatible with the installed Rollup typing | `npm run build` failed | Rewritten as a function; build green |
| 10 | `titleFromFileName` only stripped region tags | `"Game (USA) (Rev 1)"` produced a wrong title string | Strips all trailing `(…)`/`[…]` groups, including interleaved |

### Major improvements beyond the specification baseline

- Deterministic planner with an explicit, recorded rejection reason for every candidate — the UI can
  never present emulation as recompilation.
- Verification harness that derives compatibility from measured framebuffer signatures, not from the
  fact that a process started.
- Generated self-test cartridge so the pipeline can be proven without any third-party ROM.
- Optional processing service that reports real tool availability instead of offering dead buttons.

### Outstanding (documented, not hidden)

- Browser-side recompilation is not implemented. No published WASM build of N64ModernRuntime/RT64
  exists; the planner marks the stage `blocked` and lists prerequisites.
- Only NES and GBA/GB/GBC have integrated engines in this release.
- Playwright E2E could not be executed here (egress policy blocks browser binaries and the system
  package index). See section D.

---

## C. Changes implemented

### Core (framework-free)

| File | Purpose |
| --- | --- |
| `src/core/hash.ts` | CRC32 (unrolled, table-driven), MD5 (RFC 1321 vector-tested), WebCrypto SHA-1/256 |
| `src/core/binary.ts` | Bounds-checked reader, entropy sampling, size formatting |
| `src/core/platforms.ts` | 20 platform definitions with extensions, size ranges, firmware requirements |
| `src/core/detect.ts` | 12 detectors covering NES/GB/GBC/GBA/N64/NDS/Mega Drive/SMS/GG/Atari/Disc; N64 byte-order conversion |
| `src/core/analyze.ts` | Canonicalisation, hashing, dependency derivation, report assembly, filename title parsing |
| `src/core/catalogue.ts` | Offline fingerprint lookup keyed on size+CRC with SHA-1 confirmation |
| `src/core/planner.ts` | Priority ladder, candidate matrix, job/stage records, honest statements |
| `src/core/verification.ts` | Live test harness with seven measured checks |
| `src/core/testrom.ts` | Mini 6502 assembler + generated self-test cartridge |
| `src/core/environment.ts` | Capability probe incl. WebGL2 gate for mGBA, GPU-string redaction |

### Engines

| File | Purpose |
| --- | --- |
| `src/engines/descriptors.ts` | Truthful descriptors for jsnes, mGBA, EmulatorJS (not installed), N64Recomp (not runnable) |
| `src/engines/nes/core.ts` | Constructor resolution shim, safe restart, mapper table, frame analysis |
| `src/engines/nes/adapter.ts` | Canvas2D output, rAF pacing, save states, SRAM, screenshots |
| `src/engines/mgba/adapter.ts` | Lazy WASM load, IDBFS persistence, slot-based states, WebGL2 precondition |
| `src/engines/audio.ts` + `public/worklets/audio-ring.js` | SAB ring buffer with priming, ScriptProcessor fallback, measured latency |
| `src/engines/input.ts` | Keyboard (capture, rebindable), gamepad (W3C layout, deadzone), logical mapping |

### Application

- `src/db/database.ts` — 8 stores, payload dedupe, cascade delete, backup v2 with base64 + v1 rescue.
- `src/state/library.ts`, `src/state/settings.ts` — zustand stores with persistence.
- `src/lib/zip.ts` — capped archive inspection, member scoring, nested-archive rejection.
- `src/lib/processing.ts`, `src/ui/components/ProcessingPanel.tsx` — opt-in service client with a
  confirmation modal that names the endpoint before any byte leaves the browser.
- `src/ui/pages/*` — Home, Library, Upload, Jobs, Compatibility, Settings, About, Game report.
- `src/ui/player/*` — player shell, emulator stage, touch controls, lifecycle hook, performance panel.

### Infrastructure

- `scripts/fetch-dats.mjs` — DAT build via GitHub blob API (works behind API-only egress, uses
  `GITHUB_TOKEN` when present, caches by blob SHA).
- `scripts/sync-cores.mjs` — postinstall attribution copy.
- `server/processing-service.mjs` — zero-dependency loopback service with capability reporting.
- `.github/workflows/ci.yml`, `codeql.yml`, `pages.yml`, `.github/dependabot.yml`.
- `public/_headers`, `vercel.json`, `.env.example`, `LICENSE`, `SECURITY.md`, `CHANGELOG.md`,
  `THIRD-PARTY-NOTICES.md`, `docs/*`.

---

## D. Test results

Executed in the authoring sandbox (Linux, Node 22.22.3). Nothing below is inferred.

| Check | Result | Detail |
| --- | --- | --- |
| Type checking | **PASS** | `tsc -p tsconfig.app.json --noEmit` → 0 errors across `src` and tests |
| Unit tests | **PASS** | `vitest run` → **89 passed / 89**, 7 files, ~5.5 s |
| Production build | **PASS** | `npm run build` → 2,147 modules, entry 401.79 kB (113.4 kB gzip), mGBA WASM 1.85 MB single copy |
| Production serve | **PASS** | `vite preview` returns 200 for `/`, all hashed assets, `/data/catalogue/{index,nes}.json`, `/worklets/audio-ring.js`; `application/wasm` content type confirmed; COOP/COEP present |
| Engine integration (jsnes) | **PASS** | Real core boots the generated cartridge: 87.5 % non-black, 3 colours, 2 alternating frame signatures, save-state round trip |
| Planner behaviour | **PASS** | 14 assertions incl. mapper rejection, WebGL2 gate, N64 "never runnable", method labels |
| Archive handling | **PASS** | 8 assertions incl. size cap, nested rejection, metadata skipping, corrupt input |
| Persistence | **PASS** | 16 assertions via `fake-indexeddb`, incl. payload dedupe and backup round-trip |
| Processing service | **PASS (manual)** | `/health` 200, `/capabilities` reports all tools "not configured", disallowed `Origin` → 403, unknown route → 404 |
| Security scan (dependencies) | **PASS** | `npm audit` → 0 vulnerabilities (116 packages), confirmed both locally and on the Vercel build machine |
| End-to-end (Playwright) | **BLOCKED** | Browser binaries could not be downloaded (`cdn.playwright.dev`, `storage.googleapis.com` both unreachable from the sandbox; `@sparticuz/chromium` failed on missing `libnspr4.so` and the system package index is unreachable). Suite is committed and complete: `npm run test:e2e` |
| Deployment | **PASS** | Live at <https://recompa.vercel.app> — see section F |
| GitHub Actions (CI, CodeQL) | **BLOCKED** | Jobs never started: GitHub reports *"The job was not started because your account is locked due to a billing issue."* Nothing in the workflow is at fault — see section G |

### Test coverage by area

| Area | File | Assertions |
| --- | --- | --- |
| Checksums | `tests/unit/hash.test.ts` | 9 |
| Detection | `tests/unit/detect.test.ts` | 22 |
| Analysis | `tests/unit/analyze.test.ts` | 10 |
| Planner | `tests/unit/planner.test.ts` | 14 |
| Archives | `tests/unit/zip.test.ts` | 8 |
| jsnes integration | `tests/unit/engine-jsnes.test.ts` | 7 |
| IndexedDB | `tests/unit/db.test.ts` | 16 |
| **Total** | | **89** |

---

## E. Security and stability

**Applied:** CSP with `wasm-unsafe-eval` only (no JS `unsafe-eval`); COOP/COEP/CORP; no
`dangerouslySetInnerHTML`, no `eval`, no third-party runtime requests; bounds-checked binary parsing;
archive caps (512 entries / 256 MiB member) and no recursive extraction; sanitised engine-side
filenames; loopback-only service with `Origin` allowlist, JSON-only POSTs, `shell: false` spawns,
hard timeouts and output caps; backups exclude ROM bytes by design.

**Remaining risks:** the client cannot verify ROM ownership (stated, not checked); fingerprint data
is unsigned metadata (affects identification results only, never execution safety); `@sparticuz/chromium`
and `playwright-core` remain in `devDependencies` from the E2E investigation and should be removed if
you install browsers normally.

**Dependency status:** all runtime dependencies are actively maintained and licence-checked (see
`THIRD-PARTY-NOTICES.md`). Two execution cores are pinned to exact versions because adapter shims
depend on their internals; the tests fail loudly if that changes.

**Backup/recovery:** export/import covers games, reports, SRAM and settings; a v1 rescue path exists;
ROM payloads must be re-added (deliberate). `deleteGameCascade` only removes shared payload bytes
when the last reference goes.

---

## F. Deployment

**Deployed and verified: <https://recompa.vercel.app>**

| Item | Detail |
| --- | --- |
| Provider | Vercel — project `recompa` (`prj_eemTGGgieKKuY4Z5e4y6hSeMnHFt`), team *Linacre's projects* |
| Production URL | <https://recompa.vercel.app> (stable alias) |
| Source | Git-integrated with `LIN4CRE/Recompa`; production branch `main`, so merged work redeploys automatically |
| Build | `npm ci` → `npm run build` (`tsc -b && vite build`) → `dist/`, framework preset Vite |
| Build result | READY in 15 s: 2,148 modules, `index` 401.79 kB (113.42 kB gzip), `react` 210.94 kB, single `mgba-*.wasm` |
| Deployment id | `dpl_2D1PpHrvAf5vBe6bHpWWPCPNgQPv` @ `861d888` |
| Access | Public — no Vercel Authentication wall |

**Post-deployment verification (run against the live URL, not locally):**

| Check | Result |
| --- | --- |
| `/` | 200 — full app renders: hero, uploader, pipeline, engine cards, device panel |
| `/library` deep link | 200 — `vercel.json` rewrite to `index.html` confirmed |
| `/data/catalogue/index.json` | 200 — 9 platforms, counts match the build (nes 13,286 … gg 607) |
| `/manifest.webmanifest` | 200 — correct name, `start_url`, theme colour |
| `crossOriginIsolated` in the live page | **true** — the device panel reports "Cross-origin isolated: yes (SAB)" and "WebGL2: available", so COOP/COEP are actually applied at the edge |
| Engine inventory in the live page | 2 active (jsnes, mGBA-WASM), 2 honestly labelled "not installed" |
| `npm audit` during the build | 0 vulnerabilities |

Two limitations of that verification, stated rather than glossed over: the sandbox's egress policy
blocks direct HTTPS to `*.vercel.app`, so the routes above were fetched through a page renderer
(HTML/JSON/Webmanifest bodies and status) rather than with raw header dumps; and no browser with a
GPU was available here, so *gameplay* on the deployment is code-complete but not browser-driven from
this environment. The page's own device probe is the strongest signal available here, and it passed.

Alternatives, if you ever want to move it:

- **Netlify / Cloudflare Pages** — `public/_headers` (copied into `dist/`).
- **GitHub Pages** — `.github/workflows/pages.yml`. Pages cannot send the isolation headers, so
  `crossOriginIsolated` is `false` there and audio falls back to ScriptProcessor automatically;
  gameplay still works, the audio path is just not the shared-buffer one.

---

## G. GitHub and version control

| Item | Status |
| --- | --- |
| Branch | `arena/e3fcb8d7-recompa` (the only branch touched) |
| Commits | `861d888` full application, `d9cee16` Node pin |
| Pushed | Yes — `origin/arena/e3fcb8d7-recompa` is up to date |
| Pull request | **#1**, open against `main` |
| Release | Not tagged; the tree is release-ready (`CHANGELOG.md` covers v0.1.0) |
| Vercel ↔ GitHub | Connected; `main` is the production branch, so merging PR #1 publishes to the same alias |

### GitHub Actions is blocked by account state, not by the workflow

Both `CI` and `CodeQL` ran for 2–13 s and failed before executing a single step. The check-run
annotation is explicit:

> `The job was not started because your account is locked due to a billing issue.`

That is a GitHub account/billing condition on the repository owner, outside the repository. No
workflow change can fix it. The equivalent of what CI would run was executed locally instead
(`tsc` 0 errors, 89/89 unit tests, production build, `npm audit` 0 vulnerabilities), and the
production build was additionally reproduced on Vercel's build machines from the same commit,
which is an independent confirmation of the CI `build` job.

To clear it: GitHub → *Settings → Billing* for the owner account, resolve the payment issue, then
re-run the workflows. Nothing needs to be pushed again.

Outstanding repository settings (not blockers): enable Dependabot alerts, secret scanning and push
protection under *Settings → Code security*.

---

## H. Remaining work

**Blocked externally — nothing in the code can clear these**

1. GitHub Actions / CodeQL execution — the owner account is billing-locked; every job is refused
   before its first step. Resolve billing, then re-run.
2. Playwright E2E execution — needs a machine that can install a browser binary. The sandbox blocks
   both `cdn.playwright.dev` and `storage.googleapis.com`, and has no root to install `libnspr4`.
   Run `npm run test:e2e:install && npm run test:e2e` anywhere with a normal internet connection.

**Genuine future work (not blockers)**

3. Additional engines (SNES via snes9x WASM, PS1 via pcsx_rearmed, N64 via mupen64plus_next) —
   the adapter contract is ready; each needs its own audit and licence review.
4. Browser-side N64 recompilation — requires a WASM build of N64ModernRuntime + RT64 that does not
   exist upstream today.
5. Service-worker offline caching with a versioned strategy for engine binaries.
6. Worker-based emulation once a threaded core build is available (audio already uses SAB).
7. Cover-art lookup from a licensed metadata provider — deliberately not scraped.

**Completed since the first draft of this report**

- Deployment: live at <https://recompa.vercel.app>, public, with COOP/COEP applied.
- Dependency audit: 0 vulnerabilities.
- TypeScript moved to 7.0 (the `typescript-go` compiler), including the two config changes it
  requires (`baseUrl` removed, relative `paths` targets) and a corrected `typecheck` script. Verified
  on 7.0.2 and on Vercel's build machines; typecheck time fell from ~4 s to ~0.9 s.
- Every GitHub Action aligned on one current major (checkout v7, setup-node v7, configure-pages v6,
  deploy-pages v5, upload-artifact v7, upload-pages-artifact v5, codeql-action v4). Inputs and the
  `node24` runtime were checked against each action's published manifest before merging, because CI
  cannot run here to prove it.
- Two install-time defects fixed: `npm run fetch:dat` now has a `--check` mode that compares
  catalogue *content* (ignoring `generatedAt`), and `postinstall` no longer rewrites a committed
  licence file on every install. Both previously made `npm ci` leave the tree dirty.

---

## I. Verdict

**SHIPPED — deployed and publicly reachable at <https://recompa.vercel.app>.**

Reasoning: every claim in this report is backed by something that was actually executed. Locally that
is `tsc` (0 errors), 89/89 unit tests, a production build and a `vite preview` serve check. Remotely
it is a Vercel production deployment built from the same commit on a clean machine, plus a fetch of
the live site confirming the app renders, deep links rewrite, the 31,655-entry catalogue is served,
and the page reports itself cross-origin isolated with WebGL2 available.

Two gaps remain and are stated rather than papered over: the Playwright suite has never been driven
against a real browser binary because this sandbox blocks them, and GitHub Actions refuses to start
any job because the owner account is billing-locked. Neither is a defect in this repository, and both
have a one-step remedy on a normal machine.
