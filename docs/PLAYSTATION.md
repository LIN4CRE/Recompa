# PlayStation 1 support

Emulated by **EmulatorJS 4.2.3** running the **pcsx_rearmed** libretro core, both
GPL. This document records what is genuinely implemented, what is verified, and
what is deliberately *not* claimed.

## Status summary

| Area | State |
| --- | --- |
| Disc detection (raw 2352 / 2048 / 2336) | Implemented, unit-tested |
| BIN/CUE companion resolution | Implemented, unit-tested |
| Multi-file packaging for the emulator | Implemented, unit-tested |
| Engine adapter + pre-flight gating | Implemented, unit-tested |
| BIOS requirement surfaced to the user | Implemented, unit-tested |
| In-browser load / execute of a real game | **Not verified in this environment** |

The last row is the honest one. The integration is complete and every part
around it is tested, but this repository's CI has no browser, so nobody has
watched a real PlayStation title reach the title screen here. Treat "supported"
as *"implemented and ready to verify"*, not *"observed working"*.

## Image formats

The accepted list is not an opinion — it is the `extensions` array from the
core's own manifest (`core.json`, extracted from `pcsx_rearmed-wasm.data`):

```
bin, cue, img, mdf, pbp, toc, cbn, m3u, ccd
```

| Format | Standalone? | Notes |
| --- | --- | --- |
| `.cue` | No | Names its tracks. Always import with them. |
| `.bin` | Sometimes | Single-track discs work alone; multi-track discs need the cue. |
| `.img` | Sometimes | With `.ccd`. CDI images are also `.img`. |
| `.ccd` | No | Needs its `.img`, usually a `.sub`. |
| `.m3u` | No | Playlist of cue sheets, for multi-disc games. |
| `.mdf` | Yes | Alcohol 120% image. |
| `.pbp` | Yes | PS1 Classics packages. Claimed by the core, **untested here**. |
| `.toc`, `.cbn` | Varies | Rare rips; support is the core's, not something we verified. |
| `.chd` | — | **Not supported.** Absent from the core manifest. Convert to BIN/CUE. |
| `.iso` | — | **Not claimed.** See below. |

### Why `.iso` is not advertised

`iso` is absent from the core manifest. A cooked 2048-byte `.iso` is a real
thing and pcsx_rearmed will often read one, but "will often" is not a
foundation for a compatibility claim, so it is not listed. A `.bin` holding a
2048-byte-per-sector disc is detected correctly and passes through; that path
is exercised by tests.

### Why `.chd` is refused

CHD is a container, and supporting it requires the *emulator* to understand
CHD. pcsx_rearmed does not. The detector identifies CHD files and says exactly
what to do (convert to BIN/CUE) instead of pretending. `mednafen_psx_hw` does
advertise `chd`, so it is the obvious core to add if CHD support is wanted
later — it is not wired up today.

## BIOS

A real PlayStation BIOS is **required**. It is never bundled and never
substituted with an HLE or unofficial image, because that silently changes
which games work.

- Recommended dumps: `scph5500` (Japan), `scph5501` (North America),
  `scph5502` (Europe), 512 KiB each.
- **Installing it:** Settings → **Firmware** → *Add BIOS file*. The image is
  validated (exactly 512 KiB), hashed, and stored in the `bios` object store of
  this browser's IndexedDB. Nothing is uploaded.
- **Before that:** the engine shows a blocker, so the game page asks for the
  file instead of failing opaquely at boot.
- **At launch:** `Player.tsx` reads the stored image and passes it through
  `useEmulator` to the adapter, which hands it to the core as a blob URL
  (`EJS_biosUrl`). It never leaves the browser.
- **What is *not* verified:** the image contents cannot be authenticated
  offline. Recompa checks the size and reports the bytes it received; it does
  not claim to identify the exact revision or that a given disc will boot. A
  correct filename is a hint, never proof.

> **Fixed in this release:** earlier versions surfaced the BIOS dependency but
> never let anyone satisfy it — nothing populated `suppliedBy`, so
> `EmulatorJsPsxAdapter.canRun()` reported *BIOS required* forever and **no
> PlayStation game could start**. Firmware installation now feeds the engine
> plan directly, and `tests/unit/bios-folderscan.test.ts` locks the behaviour
> in.

Dump your own console's BIOS. Downloading one is copyright infringement in most
jurisdictions and Recompa cannot help with it.

## How a disc set becomes a launchable game

1. Dropped files are grouped into **disc sets** (`src/core/discset.ts`).
   A `.cue` owns the tracks it names; `.m3u` owns its sheets; `.ccd` owns its
   `.img`/`.sub`. A bare `.bin` is paired with a matching `.cue` by basename.
2. Missing companions produce a named error ("`game.cue` references
   `game (Track 1).bin`, which was not included") rather than a silent failure.
3. Multi-file sets are repackaged into a **single ZIP in the browser**
   (`src/engines/psx/discArchive.ts`), cue at the root. EmulatorJS accepts one
   game file, and pcsx_rearmed is in its `disableCue` list — it will not
   synthesise a cue for a lone `.bin` — so this step is what makes multi-track
   discs work at all.
4. The ZIP is what gets stored in IndexedDB and handed to the core.

Original files are never modified; the ZIP is an additive copy.

## Runtime layout

EmulatorJS is not a normal dependency. `npm i @emulatorjs/emulatorjs` pulls
`@emulatorjs/cores`, a meta-package that installs every core (~400 MB) and
brought 52 high-severity advisories. Instead, two tarballs are pinned by the
npm registry's own SHA-1 and unpacked by `scripts/setup-emulatorjs.mjs`:

```
public/cores/emulatorjs/data/loader.js
public/cores/emulatorjs/data/src/*.js          ← loaded individually (see below)
public/cores/emulatorjs/data/cores/pcsx_rearmed-wasm.data
public/cores/emulatorjs/data/cores/reports/pcsx_rearmed.json
```

`npm run build` runs that script with `--optional`, so a checkout with no
vendor tarball still builds; the script fetches from npm and verifies the
SHA-1, and if anything fails the build continues and the UI honestly reports
the engine as unavailable.

### No CDN, and no `emulator.min.js`

The npm package ships no `emulator.min.js`. EmulatorJS's loader falls back to
the CDN — a path its own source labels "NOT OFFICIALLY SUPPORTED. USE AT YOUR
OWN RISK" — so instead the adapter sets `EJS_DEBUG_XX = true`, which makes the
loader pull the individual `src/*.js` files from our own origin. Nothing is
fetched from `cdn.emulatorjs.org`.

## Why an iframe

EmulatorJS takes over the document: it injects `emulator.css` into `<head>` and
builds its own player DOM. Running it inside Recompa's page would let a 2 MB
third-party stylesheet and its virtual gamepad collide with the app's layout
and keyboard handling. The adapter writes a small same-origin bootstrap page
into an iframe, sets the `EJS_*` globals in *that* document, and starts the
loader only after its own message listener is attached — `doc.write` executes
scripts synchronously, so the naive ordering races the `ready` event.

## Licensing

EmulatorJS is GPL-3.0; pcsx_rearmed is GPL-2.0. Shipping them makes a
deployment a distributor of those binaries, which is why:

- the tarballs live in `vendor/`, which is **git-ignored**;
- the licence text is unpacked next to the binary it covers;
- `public/cores/emulatorjs-installed.json` records the exact versions, SHA-1s
  and source URLs for each shipped artefact.

If you deploy this, you must be able to offer the corresponding source.
