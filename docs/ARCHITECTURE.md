# Architecture

Recompa is a static single-page application. There is no application server: the only optional
server component is the loopback processing service described at the end.

```
┌──────────────────────────── browser (single origin, cross-origin isolated) ────────────────────────────┐
│                                                                                                        │
│  ui/            React components, pages, player shell                                                  │
│    │  reads/writes                                                                                     │
│  state/         zustand stores (library, settings)  ──────────────►  db/   IndexedDB (idb)             │
│    │  calls                                                                     ▲                      │
│  core/          detect → analyze → planner → verification                       │  payloads, sram,     │
│    │  asks adapters                                                             │  states, tests       │
│  engines/       adapters (jsnes, mGBA)  ──── create EngineSession ──►  canvas, Web Audio, gamepad      │
│                                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                        │ optional, opt-in, loopback only
                                                        ▼
                              server/processing-service.mjs  (Node, zero deps)
                                   ├─ rizin / ghidra (native tools, data-only reads)
                                   └─ n64recomp command preparation
```

## Module contracts

### `core/detect.ts`

`detectFormat(bytes, fileName) → DetectionResult`

Pure, synchronous, no DOM. Returns the platform it could **prove**, the container format, the
canonical payload (headers stripped), structured header fields, and any technical errors with
evidence. Detectors are ordered cheapest-first and must return `null` rather than guess. A detector
that cannot corroborate its hypothesis returns `null`; the analyser then emits `FORMAT_UNKNOWN` with
the first sixteen bytes as evidence.

### `core/analyze.ts`

`analyzeBytes(bytes, fileName, opts) → AnalysisReport`

Canonicalises (strips iNES trainer, de-interleaves SMD, converts N64 to big-endian), hashes, consults
the fingerprint catalogue, derives dependencies, and assembles the report. It never invents a title:
`identification.titleSource` is one of `database | header | filename | none`.

### `core/catalogue.ts`

Fingerprint lookup. Tables are keyed `size:crc32` for O(1) matching; SHA-1 confirms. Missing DAT
files degrade to "not installed" and the report says so.

### `core/planner.ts`

`plan({ report, environment, installedEngines }) → { plan, engine }`

Deterministic and side-effect free. It:

1. collects game-specific recompilation/port projects known for the platform,
2. asks every registered adapter `canRun()`,
3. checks optional installed payloads (EmulatorJS) by presence,
4. sorts by `EXECUTION_PRIORITY`, selects the best accepted candidate,
5. marks each job stage with what really happened.

The returned `executionStatement` is what the UI prints next to PLAY, so a method can never be
misrepresented.

### `engines/*/adapter.ts`

```ts
interface EngineAdapter {
  descriptor: EngineDescriptor;          // what it is: kind, licence, version, limits
  canRun(input): EngineCandidate;        // cheap pre-flight, no allocation
  create(options, callbacks): Promise<EngineSession>;
}
```

`EngineSession` is the only interface the player knows: `pause/resume/reset/setVolume/setInput/
saveState/loadState/readSram/writeSram/screenshot/setFastForward/stats/destroy`. Adding a platform
means adding a directory and registering it in `src/engines/index.ts` — see
[ADDING-ENGINES.md](./ADDING-ENGINES.md).

### `core/verification.ts`

Runs against a live session and produces a `TestRun` whose checks each carry a **measured** value:

| check | measurement |
| --- | --- |
| `video` | peak/mean non-black ratio and distinct colour count from framebuffer sampling |
| `animation` | count of distinct FNV-1a frame signatures over the window |
| `audio` | number of observed buffered-audio samples (or `skip` if not measurable) |
| `input` | whether the engine accepted injected button edges |
| `timing` | measured FPS and frame time |
| `savestate` | whether a produced state was accepted on reload |
| `sram` | whether battery RAM is readable |

`compatible` requires video+animation to pass, timing ≥ 45 fps, and at least three passing checks.

---

## Storage schema (IndexedDB `recompa`, version 1)

| Store | Key | Indexes | Contents |
| --- | --- | --- | --- |
| `payloads` | `sha256` | — | Canonical ROM bytes as a `Blob` |
| `games` | `id` | `by-updated`, `by-platform` | Library records, cover, play stats |
| `reports` | `id` | `by-created` | Full `AnalysisReport` JSON |
| `jobs` | `id` | `by-created`, `by-report` | Planner output + stage history |
| `sram` | `gameId` | — | Battery save bytes per game |
| `states` | `id` | `by-game` | Save states with thumbnails |
| `tests` | `id` | `by-game`, `by-started` | Verification runs |
| `meta` | key | — | Settings |

Payload deduplication is by SHA-256, and `deleteGameCascade` only removes the payload when no other
game references it.

**Backup format v2** deliberately excludes `payloads`. Byte arrays are base64 so they survive JSON
(`JSON.stringify(new Uint8Array([1]))` becomes `{"0":1}` — a real bug the tests caught).

---

## Threading and performance

- Emulation currently runs on the main thread because both integrated cores are single-threaded
  builds. The planner records `worker: false` in each descriptor so this is visible, not implied.
- Audio uses an `AudioWorklet` ring buffer over `SharedArrayBuffer` when `crossOriginIsolated` is
  true. The header (`write`,`read` Int32 atomics) lives at byte offset 0 and samples start at offset
  8. Priming (30 ms) absorbs main-thread jitter; underruns emit silence and re-prime rather than
  looping stale samples.
- WASM and the mGBA glue are dynamically imported, so first paint never waits on 1.8 MB of binary.
- The NES renderer writes into a reusable `ImageData` and does one `putImageData` per frame; no
  per-frame allocation.

## Cross-origin isolation

`COOP: same-origin` + `COEP: require-corp` are required for `SharedArrayBuffer`. Every asset is
same-origin, so `require-corp` costs nothing. Vite dev/preview set the headers; `public/_headers`
and `vercel.json` mirror them in production. On hosts without header control (GitHub Pages) the
capability probe reports `crossOriginIsolated: false` and audio falls back automatically.

## Optional processing service

`server/processing-service.mjs` (Node, no dependencies):

| Route | Purpose |
| --- | --- |
| `GET /health` | liveness |
| `GET /capabilities` | which native tools are actually installed, with versions |
| `POST /jobs/analyse-structure` | Rizin analysis of a supplied image (32 MiB body cap, hard timeout) |
| `POST /jobs/n64recomp-plan` | exact local command + prerequisites; never claims to have run it |

Security: binds `127.0.0.1` unless `RECOMPA_ALLOW_REMOTE=1`; validates `Origin`; requires
`application/json`; deletes temporary files; `spawn(…, { shell: false })`; output capped at 512 kB.
The client refuses to send anything until the user confirms in a modal that names the endpoint.
