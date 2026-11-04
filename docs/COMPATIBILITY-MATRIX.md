# Platform compatibility matrix

What Recompa can actually do with each platform, as of this commit. A platform
is only marked **Supported** when detection, an engine adapter, import and the
launch path are all implemented. **Verified** is a strictly stronger claim:
somebody watched a real game load and run through that path.

Nothing in this table is aspirational. If an engine is not installed, the row
says so.

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
| SNES | None installed | `.sfc`, `.smc`, `.swc`, `.fig`, `.bs` recognised | — | — | **Not supported** |
| Mega Drive / Genesis | None installed | `.md`, `.gen`, `.smd`, `.bin` recognised | — | — | **Not supported** |
| Master System | None installed | `.sms` recognised | — | — | **Not supported** |
| Game Gear | None installed | `.gg` recognised | — | — | **Not supported** |
| PC Engine / TG-16 | None installed | `.pce`, `.sgx` recognised | — | — | **Not supported** |
| Saturn | None | — | — | — | **Not supported** |
| Dreamcast | None | — | — | — | **Not supported** |
| Atari 2600 / 7800 / Lynx | None installed | `.a26`, `.a78`, `.lnx` recognised | — | — | **Not supported** |
| Virtual Boy | None installed | `.vb` recognised | — | — | **Not supported** |
| WonderSwan / Color | None installed | `.ws`, `.wsc` recognised | — | — | **Not supported** |
| Neo Geo Pocket / Color | None installed | `.ngp`, `.ngc` recognised | — | — | **Not supported** |

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
