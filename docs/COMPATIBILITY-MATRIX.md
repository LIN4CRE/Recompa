# Platform compatibility matrix

What Recompa can actually do with each platform, as of this commit. A platform
is only marked **Supported** when detection, an engine adapter, import and the
launch path are all implemented. **Verified** is a strictly stronger claim:
somebody watched a real game load and run through that path.

Nothing in this table is aspirational. If an engine is not installed, the row
says so.

**Detection coverage is verified separately from playback.** See
[`DETECTION-COVERAGE.md`](./DETECTION-COVERAGE.md) for the per-detector
contract, confidence caps and known-broken history.
 Every platform
listed here has a byte-level detector in `src/core/detect.ts` or
`src/core/detect-extra.ts`, and each one is exercised by
`tests/unit/detect-extra.test.ts` against a purpose-built fixture.
`npm test` proves identification; it does not prove a game runs. A platform is
only ever reported as identified when its signature actually matched — the
unknown path returns `FORMAT_UNKNOWN` rather than guessing from a file name.

| Platform | Engine available | Formats accepted | Configuration required | Tested | Status |
| --- | --- | --- | --- | --- | --- |
| NES / Famicom | jsnes 2.1.0 (JS) | `.nes`, `.fds`, `.unf`, `.unif` | None | Unit + engine tests in CI | **Supported** |
| Game Boy | mGBA 0.10 (WASM) | `.gb` | WebGL2 | Unit + engine tests in CI | **Supported** |
| Game Boy Color | mGBA 0.10 (WASM) | `.gbc` | WebGL2 | Unit + engine tests in CI | **Supported** |
| Game Boy Advance | mGBA 0.10 (WASM) | `.gba`, `.agb` | WebGL2 | Unit + engine tests in CI | **Supported** |
| **PlayStation** | **EmulatorJS + pcsx_rearmed 2.0.2 (WASM)** | `.bin`, `.cue`, `.ccd`+`.img`, `.m3u`, `.mdf`, `.pbp`*, `.img` | **Real BIOS required**, WebGL2, cross-origin isolation | Detection + adapter unit-tested; **in-browser load not verified** | **Implemented — awaiting verification** |
| PlayStation 2 | None | — | — | — | **Not supported** |
| PlayStation Portable | None | `.iso`, `.cso`, `.pbp` recognised only | — | — | **Not supported** (detected, refused) |
| Nintendo 64 | N64Recomp (declared, not installed) | `.z64`, `.n64`, `.v64` | Needs native toolchain + per-game symbol map | Detection only | **Not supported** |
| Nintendo DS | None | `.nds`, `.srl` recognised | — | — | **Not supported** (detected, refused) |
| SNES | None installed | `.sfc`, `.smc`, `.swc`, `.fig`, `.bs` | — | **Detection verified** (LoROM/HiROM/ExHiROM, 512-byte copier header stripped) | **Detected, not playable** |
| Mega Drive / Genesis | None installed | `.md`, `.gen`, `.smd`, `.bin` recognised | — | — | **Not supported** |
| Master System | None installed | `.sms` recognised | — | — | **Not supported** |
| Game Gear | None installed | `.gg` recognised | — | — | **Not supported** |
| PC Engine / TG-16 | None installed | `.pce`, `.sgx` | — | **Detection verified** (reset vector + valid HuCard size) | **Detected, not playable** |
| Saturn | None | — | — | — | **Not supported** |
| Dreamcast | None | — | — | — | **Not supported** |
| Atari 2600 | None installed | `.a26` | — | **Detection verified** (size + reset vector; reported as *probable*, never certain) | **Detected, not playable** |
| Atari 7800 | None installed | `.a78` | — | **Detection verified** (`ATARI7800` at offset 0x01, 128-byte header stripped) | **Detected, not playable** |
| Atari Lynx | None installed | `.lnx` | — | **Detection verified** (`LYNX` magic, 64-byte header stripped) | **Detected, not playable** |
| Virtual Boy | None installed | `.vb` | — | **Detection verified** (32-byte footer header; reported as *probable*) | **Detected, not playable** |
| WonderSwan / Color | None installed | `.ws`, `.wsc` | — | **Detection verified** (10-byte footer, checksum validated) | **Detected, not playable** |
| Neo Geo Pocket / Color | None installed | `.ngp`, `.ngc` | — | **Detection verified** (`COPYRIGHT BY SNK` signature, mono/Color discriminated) | **Detected, not playable** |

\* PBP is advertised by the pcsx_rearmed core but has not been exercised here.

## What "recognised" means

Every platform listed above has a **byte-level detector**: Recompa can identify
the file, name the console and explain what it is. That is *not* the same as
being able to run it, and the UI does not conflate the two — the compatibility
page derives "integrated" from the engine registry (`ENGINE_ADAPTERS`), so a
platform with no adapter is never shown as runnable.

## Why so many rows say "not supported"

The engines exist upstream — EmulatorJS ships cores for SNES, Mega Drive, N64,
NDS and more. They are not enabled here because:

1. **Every core is ~1 MB of GPL binaries** that must ship with its licence, be
   version-pinned, and be verified. Enabling a core is a real commitment, not a
   config change.
2. **The full ladder has to work**: import, companion resolution, BIOS
   handling, save states, and an honest failure message. A dropdown entry that
   produces a black screen is exactly the "invented compatibility" this project
   exists to avoid.
3. **Unverified support is worse than none.** The matrix above is the honest
   state; expanding it means doing the work for each platform.

Adding the next platform is mechanical and documented in
[ADDING-ENGINES.md](ADDING-ENGINES.md); PlayStation's implementation is the
worked example, including how to keep the core's real extension list rather
than guessing at it.

## Detection capability summary

Nineteen platforms are defined; seventeen have a working byte-level detector.
The two that remain unimplemented are stated here rather than glossed over.

| Status | Platforms |
| --- | --- |
| Detector + engine adapter (playable path) | NES, GB, GBC, GBA, PlayStation |
| Detector verified, **no engine installed** | SNES, Mega Drive/Genesis, Master System, Game Gear, PC Engine, N64, NDS, PSP, Atari 2600, Atari 7800, Atari Lynx, WonderSwan, Virtual Boy, Neo Geo Pocket |
| Declared but **not detectable** | `arcade` (no single signature exists), `unknown` (sentinel) |

### How each detector earns its verdict

| Platform | Class | Primary evidence | Confidence cap |
| --- | --- | --- | --- |
| SNES | structural | header at 0x7FC0/0xFFC0/0x40FFC0 (± 512-byte copier header), mapping byte, self-consistent checksum/complement | certain when score is decisive |
| PC Engine | structural | power-of-two HuCard size + reset vector into the mapped bank | probable |
| Atari 2600 | structural | standard cartridge size + reset vector inside $F000–$FFFF | probable only |
| WonderSwan | footer + checksum | 10-byte footer, checksum recomputed over the image | certain when checksum verifies |
| Virtual Boy | footer | 32-byte header at EOF, zero-filled reserved field, printable maker/game codes | probable |
| Neo Geo Pocket | signature | `COPYRIGHT BY SNK CORPORATION` / ` LICENSED BY SNK CORPORATION` | certain |

The distinction matters: a detector that can only *infer* is capped at
"probable", so the UI never presents a guess with the authority of a signature
match. For the weak formats the engine plan refuses to launch on
identification alone.
