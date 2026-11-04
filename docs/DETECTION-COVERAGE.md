# Detection coverage

Recompa identifies a platform **only when bytes justify it**. This document
records what each detector reads, how confident it is allowed to be, and what it
refuses to do.

## The contract

`detectFormat(payload, fileName)` returns `platformId: null` and a
`FORMAT_UNKNOWN` error when nothing matches. No detector may fall back to a file
extension alone — a name is not evidence, and a wrong identification is worse
than an honest "unrecognised" because it sends the user down a path that cannot
work.

Detection confidence has three levels, and the engine plan treats them
differently:

| Confidence | Meaning | May launch? |
| --- | --- | --- |
| `certain` | A literal signature, or a checksummed footer, matched | Yes, if an engine exists |
| `probable` | Structural inference from size/vectors | Reported; engine plan refuses to launch on it alone |
| `unknown` | Nothing matched | No |

## Coverage table

| Platform | Evidence read | Confidence cap | Notes |
| --- | --- | --- | --- |
| NES / Famicom | `NES\x1A`, `UNIF`, `FDS\x1A` magic | certain | iNES 2.0 and mapper names decoded |
| SNES | Header at 0x7FC0 (LoROM), 0xFFC0 (HiROM), 0x40FFC0 (ExHiROM), ±0x200 copier header | certain | Scored on mapping byte, ROM-size code and the checksum/complement pair |
| Game Boy | Nintendo logo **at 0x104** + cartridge-type byte | certain | Logo is the GB bitmap, not the GBA one |
| Game Boy Color | Same, CGB flag at 0x143 | certain | |
| Game Boy Advance | Nintendo logo **at 0x04** + 0x96 complement + header checksum | certain | Uses the GBA bitmap; the two logos are different bitmaps |
| Nintendo 64 | Magic (`0x80371240` etc.) for z64/n64/v64 | certain | Byte order normalised to big-endian |
| Nintendo DS | Nintendo logo **at 0xC0**, game code, header CRC16 | certain | |
| Mega Drive / Genesis | `SEGA` at 0x100, plus region/name fields | certain | Headerless fallback removed: it claimed random data |
| Master System | `TMR SEGA` footer | certain | |
| Game Gear | Same footer with a GG region nibble | certain | |
| PC Engine / TG-16 | Power-of-two HuCard size + reset vector into the mapped bank | probable | Headerless format |
| PlayStation | ISO 9660 PVD across five sector geometries (2352/2048/2336/2324) | certain | MODE2 subheader offset handled |
| PlayStation Portable | `\0PBP` and PSP-specific ISO volume labels | certain | Detected, refused for play |
| Atari 2600 | Standard size (2/4/8/12/16/32 KiB) + reset vector in $F000–$FFFF | probable | Headerless; never claims certainty |
| Atari 7800 | `ATARI7800` **at offset 0x01**, 128-byte header stripped | certain | Offset 0 is the header version byte |
| Atari Lynx | `LYNX` magic, 64-byte header stripped | certain | |
| WonderSwan / Color | 10-byte footer at EOF, checksum recomputed | certain | Mono vs Color from the system byte |
| Virtual Boy | 32-byte footer, zero-filled reserved, printable codes | probable | Commercial dumps carry no "VB" magic |
| Neo Geo Pocket / Color | `COPYRIGHT BY SNK CORPORATION` / ` LICENSED BY SNK CORPORATION` | certain | 0x23 distinguishes Color |
| Arcade | — | none | No single signature exists; not claimed |

## What was broken before 2026-11

The compatibility page listed all of these as supported, and the platform table
labelled every row "byte level". Neither claim matched the code:

- **Six platforms had no detector whatsoever** — `snes`, `pce`, `atari2600`,
  `ws`, `vb` and `ngp` never appeared in `detect.ts`. A real cartridge from any
  of them was reported as an unrecognised file.
- **Game Boy Advance was undetectable.** `detectGba` compared the image against
  the *Game Boy* logo bitmap (a different bitmap) at the Game Boy offset
  (0x104 instead of 0x04). The condition could never be satisfied.
- **Atari 7800 was undetectable.** The magic was sought at offset 0, but the
  A78 header stores `ATARI7800` at offset 1.
- **The Genesis fallback over-matched**, reporting random 32 KiB-aligned data as
  a Mega Drive cartridge.
- **The WonderSwan system byte was a 1-in-256 guess** with no checksum check.

Each fix is covered by a test in `tests/unit/detect-extra.test.ts`, including
negative tests that feed noise to every detector and assert it declines.

## Adding another platform

1. Add the id to `PlatformId` and an entry to `PLATFORMS` in
   `src/core/platforms.ts`.
2. Add it to `DETECTOR_STRENGTH` — the compatibility page reads this, and a test
   fails if a platform is missing from it.
3. Write the detector in `src/core/detect-extra.ts` (or `detect.ts` when it uses
   the shared reader heavily). Return `null` liberally.
4. Add a fixture builder in `tests/unit/fixtures/carts.ts` **and** a negative
   test asserting the fixture's corruption is rejected.
5. Do not wire an engine adapter until the detector is proven. Detected but not
   playable is an honest state; playable but undetectable is not.
