# Adding an execution engine or platform

Adding support for a platform means adding an **adapter**. Nothing in `core/`, `ui/` or `db/` needs
to change: the planner discovers adapters from the registry and the UI renders whatever the planner
returns.

## 1. Before you write code

Create `docs/audits/<engine>.md` with these answers. A missing answer means the engine is not ready.

| Question | Why it matters |
| --- | --- |
| Repository URL, licence SPDX id, last commit date | Recompa ships attribution and must not redistribute incompatible code |
| Published artefact (npm, release asset, CDN)? Reproducible install? | An engine that needs a bespoke build pipeline is a maintenance trap |
| Does it expose **save states**, **battery SRAM**, **screenshots**? Which API? | These drive the player UI and the verification checks |
| Threading model (main thread / worker / pthread) | Determines `supports.worker` and whether audio can use SAB |
| GPU requirement (2D canvas / WebGL1 / WebGL2 / WebGPU) | Must be checked in `canRun()` before the user presses play |
| Firmware required? | Must surface in the report as a user-supplied dependency |
| Verified limitations | Goes into `descriptor.limitations` and the compatibility database |

Verify each claim by reading the package's `dist` files or API reference — not the README's marketing.
For example, mGBA's WebGL2 requirement was found by grepping the Emscripten glue for
`getContext("webgl2")`.

## 2. Write the descriptor

`src/engines/descriptors.ts`:

```ts
export const MY_DESCRIPTOR: EngineDescriptor = {
  id: 'my-engine',
  name: 'MyEngine (WebAssembly)',
  project: 'MyEngine',
  version: '1.2.3',                    // exact version you integrated
  kind: 'wasm-emulator',               // NEVER 'static-recompilation' unless it compiles ahead of time
  licence: 'MIT',
  homepage: 'https://…',
  platforms: ['snes'],
  accepts: ['sfc', 'smc'],
  needsFirmware: false,
  supports: { saveStates: true, sramSaves: true, screenshots: true, gamepad: true, touch: true,
              rewind: false, audio: true, worker: false, gpu: false, wasm: true },
  performanceNotes: '…measured or documented…',
  available: false,                    // true only once the payload ships with the build
  unavailableReason: 'Run `npm run fetch:myengine`…',
  limitations: ['…verified…'],
};
```

Rules:

- `kind` is a legal statement. Emulation is `wasm-emulator` or `js-emulator`.
- `version` and `licence` are displayed verbatim in the UI and the report.
- `limitations` must contain only things you verified.

## 3. Implement the adapter

```ts
export const MyAdapter: EngineAdapter = {
  descriptor: MY_DESCRIPTOR,

  canRun({ report, environment }) {
    const blockers: string[] = [];
    const notes: string[] = [];
    if (report.platform?.id !== 'snes') blockers.push('Executes SNES software only.');
    if (!environment.webgl2) blockers.push('Requires WebGL2 for video output.');
    if (report.format && !['sfc', 'smc'].includes(report.format.id))
      blockers.push(`Container "${report.format.label}" is not supported.`);
    return { engineId: MY_DESCRIPTOR.id, runnable: blockers.length === 0, blockers, notes };
  },

  async create(options, callbacks) {
    const module = await loadCoreLazy();            // dynamic import: never block first paint
    const session = new MySession(module, options, callbacks);
    await session.boot(options.rom, options.fileName, options.savedSram ?? null);
    return session;
  },
};
```

`EngineSession` requirements:

| Method | Notes |
| --- | --- |
| `pause/resume` | Must be idempotent; the player calls them on visibility change |
| `reset` | Must produce a clean boot. If the core's own reset is broken, reload the ROM (see jsnes) |
| `setInput(port, button, pressed)` | `button` is a logical name (`A`, `START`, `UP`…). Map internally |
| `saveState/loadState` | Return `null` / `false` when unsupported rather than throwing |
| `readSram/writeSram` | Battery save; the library persists it per game and engine |
| `screenshot` | A `Blob` of the current frame, or `null` |
| `setFastForward` | Best effort; report the actual multiplier in `stats().extra` |
| `stats()` | Real numbers only. `fps`, `frameTimeMs`, `audioLatencyMs`; `null` where unmeasurable |
| `destroy` | Release the canvas, audio context, timers and any worker |

Never fabricate `stats()` values. The performance panel labels the block "measured" and the tests
assert that FPS is derived from a real frame callback.

## 4. Register it

```ts
// src/engines/index.ts
export const ENGINE_ADAPTERS: EngineAdapter[] = [JsnesAdapter, MgbaAdapter, MyAdapter];
```

If the engine needs a runtime payload that is not bundled, add it to `PLANNED_ENGINES` and probe it
in `src/engines/install-check.ts` so the planner only offers it when it is really present.

## 5. Test checklist

Add to `tests/unit/`:

- [ ] `canRun()` rejects the wrong platform, wrong container, and every missing capability, each with
      a specific message.
- [ ] `canRun()` accepts a valid file and returns no blockers.
- [ ] The engine boots your fixture ROM and produces a non-black frame.
- [ ] Two consecutive frames differ (animation), or the test documents why the fixture is static.
- [ ] Save-state round trip works, or the test asserts `null` and the descriptor says `saveStates:false`.
- [ ] `stats()` returns finite numbers after N frames.
- [ ] `destroy()` can be called twice without throwing.

Add to `tests/e2e/`:

- [ ] Launch from the library, wait for a nonzero measured FPS.
- [ ] Capture a screenshot and assert the download filename.
- [ ] Run verification and assert a `TestRun` record appears.

## 6. Fixtures

Do not commit commercial ROMs or third-party test ROMs without a clear licence. Generate a fixture
instead: `src/core/testrom.ts` shows how (a mini assembler plus a tiny program). For platforms
without a generator, use a public-domain homebrew title and record its provenance and licence in
`tests/fixtures/PROVENANCE.md`.

## 7. Documentation

- Add the engine to `docs/TECHNOLOGY-AUDIT.md` with the verified metadata.
- Add the platform's fingerprints to `scripts/fetch-dats.mjs` (`PLATFORM_DATS`) and regenerate.
- Add the platform to `src/core/platforms.ts` with its extensions, size range, and any firmware
  requirement.
- Update the capability tables in `README.md` and `docs/COMPLETION-REPORT.md`.
