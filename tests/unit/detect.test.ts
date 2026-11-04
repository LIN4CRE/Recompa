import { describe, expect, it } from 'vitest';
import { detectFormat, toBigEndianN64 } from '@/core/detect';
import { buildTestRom } from '@/core/testrom';

/** Build a synthetic iNES image with specific header bytes. */
function ines({ prg = 2, chr = 1, flags6 = 0, flags7 = 0, trainer = false } = {}): Uint8Array {
  // Bit 2 of flags6 announces a 512-byte trainer between header and PRG.
  const f6 = trainer ? flags6 | 0x04 : flags6;
  const header = [0x4e, 0x45, 0x53, 0x1a, prg, chr, f6, flags7, 0, 0, 0, 0, 0, 0, 0, 0];
  const trainerBytes = trainer ? 512 : 0;
  const total = 16 + trainerBytes + prg * 16384 + chr * 8192;
  const rom = new Uint8Array(total);
  rom.set(header, 0);
  return rom;
}

/** Minimal Game Boy header with a valid Nintendo logo and checksum. */
function gameBoy({ cgb = false, title = 'TESTGAME' } = {}): Uint8Array {
  const rom = new Uint8Array(0x8000);
  const logo = [
    0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b, 0x03, 0x73, 0x00, 0x83, 0x00, 0x0c, 0x00, 0x0d,
    0x00, 0x08, 0x11, 0x1f, 0x88, 0x89, 0x00, 0x0e, 0xdc, 0xcc, 0x6e, 0xe6, 0xdd, 0xdd, 0xd9, 0x99,
    0xbb, 0xbb, 0x67, 0x63, 0x6e, 0x0e, 0xec, 0xcc, 0xdd, 0xdc, 0x99, 0x9f, 0xbb, 0xb9, 0x33, 0x3e,
  ];
  rom.set(logo, 0x104);
  for (let i = 0; i < title.length; i++) rom[0x134 + i] = title.charCodeAt(i);
  rom[0x143] = cgb ? 0x80 : 0x00;
  rom[0x147] = 0x00; // ROM ONLY
  rom[0x148] = 0x00; // 32 KiB
  rom[0x149] = 0x00;
  rom[0x14a] = 0x01; // US
  rom[0x14b] = 0x33;
  rom[0x14c] = 0x00;
  // Header checksum over 0x134..0x14C.
  let sum = 0;
  for (let i = 0x134; i <= 0x14c; i++) sum = (sum - rom[i]! - 1) & 0xff;
  rom[0x14d] = sum;
  return rom;
}

function gba(): Uint8Array {
  const rom = new Uint8Array(0x20000);
  for (let i = 0; i < 156; i++) rom[0x04 + i] = [0, 0][0]!; // logo bytes zeroed below
  const title = 'TESTGBA';
  for (let i = 0; i < title.length; i++) rom[0xa0 + i] = title.charCodeAt(i);
  for (let i = 0; i < 4; i++) rom[0xac + i] = 'ABCD'.charCodeAt(i);
  for (let i = 0; i < 2; i++) rom[0xb0 + i] = '01'.charCodeAt(i);
  rom[0xb2] = 0x96;
  // Header checksum.
  let sum = 0;
  for (let i = 0xa0; i <= 0xbc; i++) sum += rom[i]!;
  rom[0xbd] = (-(sum + 0x19)) & 0xff;
  return rom;
}

function z64(): Uint8Array {
  const rom = new Uint8Array(8 * 1024 * 1024);
  rom.set([0x80, 0x37, 0x12, 0x40], 0);
  rom.set([0x00, 0x00, 0x00, 0x0f], 4); // clock rate
  const name = 'RECOMPA TEST';
  for (let i = 0; i < name.length; i++) rom[0x20 + i] = name.charCodeAt(i);
  rom.set([0x4e, 0x53, 0x4d, 0x45], 0x3b); // cart id
  rom[0x3e] = 0x45; // US
  return rom;
}

function smd(): Uint8Array {
  const blocks = 1;
  const rom = new Uint8Array(512 + blocks * 16384);
  rom.set([0xaa, 0xbb, 0x06, 0x00], 0);
  // Interleaved bytes: put "SEGA" at logical 0x100 which becomes de-interleaved.
  const body = rom.subarray(512);
  const logical = new Uint8Array(16384);
  logical.set([0x53, 0x45, 0x47, 0x41], 0x100);
  for (let i = 0; i < 8192; i++) {
    body[i] = logical[i * 2 + 1]!;
    body[i + 8192] = logical[i * 2]!;
  }
  return rom;
}

describe('detectFormat — NES', () => {
  it('identifies a valid iNES image with mapper details', () => {
    const result = detectFormat(ines({ prg: 4, chr: 2, flags6: 0x21, flags7: 0x10 }), 'game.nes');
    expect(result.platformId).toBe('nes');
    expect(result.platformConfidence).toBe('certain');
    expect(result.format?.id).toBe('ines');
    // flags6 0x21 → mapper low nibble 2; flags7 0x10 → high nibble 1 → mapper 18
    expect(result.header.fields.mapper).toBe(18);
    expect(result.header.fields.mapperBoard).toContain('Jaleco');
  });

  it('accounts for a 512-byte trainer when stripping the payload', () => {
    const result = detectFormat(ines({ trainer: true }), 'trainer.nes');
    // 16-byte header + 512-byte trainer must be excluded from the game payload.
    expect(result.header.strippedBytes).toBe(528);
    expect(result.header.fields.trainer).toBe('512 bytes at 0x10 (stripped on export)');
  });

  it('flags a size mismatch instead of silently accepting it', () => {
    const rom = ines({ prg: 2, chr: 1 });
    const truncated = rom.subarray(0, rom.length - 4096);
    const result = detectFormat(truncated, 'short.nes');
    expect(result.platformId).toBe('nes');
    expect(result.errors.some((e) => e.code === 'NES_SIZE_MISMATCH')).toBe(true);
  });

  it('flags dirty iNES headers (non-zero reserved bytes)', () => {
    const rom = ines();
    rom[7] = 0x44; // 'D' of a "DiskDude!" style header
    const result = detectFormat(rom, 'dirty.nes');
    expect(result.header.warnings.join(' ')).toMatch(/not zero/i);
  });

  it('recognises NES 2.0 identifiers', () => {
    const result = detectFormat(ines({ flags7: 0x08 }), 'nes20.nes');
    expect(result.format?.id).toBe('ines2');
  });

  it('reports a headerless NES image as probable, with an explanatory error', () => {
    const raw = new Uint8Array(32768);
    const result = detectFormat(raw, 'headerless.nes');
    expect(result.platformId).toBe('nes');
    expect(result.platformConfidence).toBe('probable');
    expect(result.errors.some((e) => e.code === 'NES_NO_HEADER')).toBe(true);
  });
});

describe('detectFormat — Game Boy family', () => {
  it('identifies a Game Boy cartridge and reads its title', () => {
    const result = detectFormat(gameBoy({ title: 'TETRIS' }), 'tetris.gb');
    expect(result.platformId).toBe('gb');
    expect(result.format?.confidence).toBe('certain');
    expect(result.embeddedTitle).toBe('TETRIS');
    expect(result.header.fields.headerChecksumOk).toBe(true);
  });

  it('detects Game Boy Color by the CGB flag', () => {
    const result = detectFormat(gameBoy({ cgb: true }), 'colour.gbc');
    expect(result.platformId).toBe('gbc');
  });

  it('warns when the header checksum is invalid', () => {
    const rom = gameBoy();
    rom[0x14d] = (rom[0x14d]! + 1) & 0xff;
    const result = detectFormat(rom, 'bad.gb');
    expect(result.errors.some((e) => e.code === 'GB_HEADER_CHECKSUM')).toBe(true);
  });
});

describe('detectFormat — GBA', () => {
  it('identifies a GBA cartridge from the complement byte and header checksum', () => {
    const result = detectFormat(gba(), 'game.gba');
    expect(result.platformId).toBe('gba');
    expect(result.header.fields.headerChecksumOk).toBe(true);
    expect(result.serial).toBe('ABCD-01');
  });

  it('never claims GBA for a random 128 KiB blob', () => {
    const blob = new Uint8Array(0x20000).fill(0x5a);
    const result = detectFormat(blob, 'random.gba');
    expect(result.platformId).not.toBe('gba');
  });
});

describe('detectFormat — N64', () => {
  it('identifies big-endian .z64 and reads the internal name', () => {
    const result = detectFormat(z64(), 'game.z64');
    expect(result.platformId).toBe('n64');
    expect(result.format?.id).toBe('n64-be');
    expect(result.embeddedTitle).toBe('RECOMPA TEST');
    expect(result.regionHint).toBe('US');
  });

  it('identifies byteswapped .v64 and little-endian .n64', () => {
    const be = z64();
    const v64 = new Uint8Array(be.length);
    for (let i = 0; i < be.length; i += 2) {
      v64[i] = be[i + 1]!;
      v64[i + 1] = be[i]!;
    }
    expect(detectFormat(v64, 'game.v64').format?.id).toBe('n64-v64');

    const n64 = new Uint8Array(be.length);
    for (let i = 0; i < be.length; i += 4) {
      n64[i] = be[i + 3]!;
      n64[i + 1] = be[i + 2]!;
      n64[i + 2] = be[i + 1]!;
      n64[i + 3] = be[i]!;
    }
    expect(detectFormat(n64, 'game.n64').format?.id).toBe('n64-le');
  });
});

describe('toBigEndianN64', () => {
  it('swaps 16-bit halves for .v64 input', () => {
    const input = new Uint8Array([0x37, 0x80, 0x40, 0x12]);
    expect(Array.from(toBigEndianN64(input, 'byteswapped'))).toEqual([0x80, 0x37, 0x12, 0x40]);
  });

  it('reverses 32-bit groups for .n64 input', () => {
    const input = new Uint8Array([0x40, 0x12, 0x37, 0x80]);
    expect(Array.from(toBigEndianN64(input, 'little'))).toEqual([0x80, 0x37, 0x12, 0x40]);
  });

  it('is a no-op for big-endian input', () => {
    const input = new Uint8Array([1, 2, 3, 4]);
    expect(toBigEndianN64(input, 'big')).toBe(input);
  });
});

describe('detectFormat — Sega', () => {
  it('de-interleaves SMD images and keeps the SEGA signature', () => {
    const result = detectFormat(smd(), 'game.smd');
    expect(result.platformId).toBe('genesis');
    expect(result.format?.id).toBe('smd');
    expect(result.header.strippedBytes).toBe(512);
    expect(result.payload.length).toBe(16384);
  });

  it('rejects a .bin that has neither a SEGA header nor a plausible layout', () => {
    const junk = new Uint8Array(4096).fill(0x33);
    const result = detectFormat(junk, 'clip.bin');
    expect(result.platformId).toBeNull();
  });
});

describe('detectFormat — unknown input', () => {
  it('returns a technical error with the first bytes as evidence', () => {
    const junk = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4, 5, 6, 7, 8]);
    const result = detectFormat(junk, 'mystery.dat');
    expect(result.platformId).toBeNull();
    expect(result.format).toBeNull();
    expect(result.errors[0]?.code).toBe('FORMAT_UNKNOWN');
    expect(result.errors[0]?.detail).toContain('de ad be ef');
  });

  it('never guesses a platform for a truncated file', () => {
    expect(detectFormat(new Uint8Array([0x4e, 0x45]), 'cut.nes').platformId).toBeNull();
  });
});

describe('Recompa self-test cartridge', () => {
  it('is a valid iNES image that the detector accepts as NROM', () => {
    const rom = buildTestRom();
    const result = detectFormat(rom, 'recompa-selftest.nes');
    expect(result.platformId).toBe('nes');
    expect(result.header.fields.mapper).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(rom.length).toBe(16 + 32768 + 8192);
  });
});
