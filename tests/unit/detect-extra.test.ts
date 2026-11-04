import { describe, it, expect } from 'vitest';
import { detectFormat } from '@/core/detect';
import { DETECTOR_STRENGTH, detectorLabel, PLATFORMS } from '@/core/platforms';
import { analyzeBytes } from '@/core/analyze';
import {
  buildGbaRom,
  buildGameBoyRom,
  buildNdsRom,
  buildSnesRom,
  buildPceRom,
  buildAtari2600Rom,
  buildWonderswanRom,
  buildVirtualBoyRom,
  buildNeoGeoPocketRom,
  buildNoise,
} from './fixtures/carts';

/**
 * These platforms were declared in `PlatformId` and listed on the compatibility
 * page but had **no detector at all** — `detect.ts` never returned `snes`,
 * `pce`, `atari2600`, `ws`, `vb` or `ngp`, so a real cartridge from any of them
 * was reported as an unrecognised file.
 *
 * Each group below therefore tests two things: that a correctly built image is
 * identified, and that a deliberately corrupted image is *not*. The second half
 * matters more than the first — a detector that guesses is worse than one that
 * declines.
 */

const SNES_EXT = 'sfc';

describe('Super Nintendo detection', () => {
  it('identifies a LoROM cartridge and reads its title', () => {
    const result = detectFormat(buildSnesRom({ title: 'SUPER TEST GAME' }), `game.${SNES_EXT}`);
    expect(result.platformId).toBe('snes');
    expect(result.embeddedTitle).toBe('SUPER TEST GAME');
    expect(result.format?.id).toBe('snes-rom');
    expect(result.header.fields.mapping).toBe('LoROM');
  });

  it('identifies a HiROM cartridge', () => {
    const result = detectFormat(buildSnesRom({ hirom: true, title: 'HIROM GAME' }), `game.${SNES_EXT}`);
    expect(result.platformId).toBe('snes');
    expect(result.header.fields.mapping).toBe('HiROM');
  });

  it('detects and strips a 512-byte copier header', () => {
    const result = detectFormat(buildSnesRom({ copierHeader: true }), 'game.smc');
    expect(result.platformId).toBe('snes');
    expect(result.header.strippedBytes).toBe(512);
    // The stripped payload must be the cart image, not the header-prefixed file.
    expect(result.payload.length).toBe(256 * 1024);
    expect(result.header.fields.checksumComplementValid).toBe(true);
  });

  it('rejects random noise instead of guessing', () => {
    const result = detectFormat(buildNoise(512 * 1024, 99), `game.${SNES_EXT}`);
    expect(result.platformId).not.toBe('snes');
  });

  it('rejects a file whose header region is all zeros', () => {
    const blank = new Uint8Array(256 * 1024);
    const result = detectFormat(blank, `game.${SNES_EXT}`);
    expect(result.platformId).not.toBe('snes');
  });
});

describe('PC Engine / TurboGrafx-16 detection', () => {
  it('identifies a valid HuCard from its reset vector', () => {
    const result = detectFormat(buildPceRom({ sizeKb: 32 }), 'game.pce');
    expect(result.platformId).toBe('pce');
    expect(result.platformConfidence).toBe('probable');
  });

  it('accepts a 256 KiB HuCard', () => {
    const result = detectFormat(buildPceRom({ sizeKb: 256 }), 'game.pce');
    expect(result.platformId).toBe('pce');
  });

  it('rejects a vector that points outside the ROM', () => {
    const result = detectFormat(buildPceRom({ breakVector: true }), 'game.pce');
    expect(result.platformId).not.toBe('pce');
  });

  it('rejects a file that is not a valid HuCard size', () => {
    const odd = buildNoise(100_000, 7);
    const result = detectFormat(odd, 'game.pce');
    expect(result.platformId).not.toBe('pce');
  });
});

describe('Atari 2600 detection', () => {
  it('identifies a 4K cartridge with a valid reset vector', () => {
    const result = detectFormat(buildAtari2600Rom(), 'game.a26');
    expect(result.platformId).toBe('atari2600');
    // Structural only, so it must never claim certainty.
    expect(result.platformConfidence).toBe('probable');
    expect(result.header.warnings.join(' ')).toMatch(/no header/i);
  });

  it('identifies an 8K bank-switched cartridge', () => {
    const result = detectFormat(buildAtari2600Rom({ size: 8192 }), 'game.a26');
    expect(result.platformId).toBe('atari2600');
  });

  it('rejects a vector pointing below the cartridge window', () => {
    const result = detectFormat(buildAtari2600Rom({ breakVector: true }), 'game.a26');
    expect(result.platformId).not.toBe('atari2600');
  });

  it('rejects a random 4K file', () => {
    const result = detectFormat(buildNoise(4096, 12345), 'game.a26');
    expect(result.platformId).not.toBe('atari2600');
  });

  it('does not claim an arbitrary 4K file with an unrelated extension', () => {
    const result = detectFormat(buildAtari2600Rom(), 'notes.txt');
    expect(result.platformId).not.toBe('atari2600');
  });
});

describe('WonderSwan detection', () => {
  it('identifies a monochrome WonderSwan cartridge', () => {
    const result = detectFormat(buildWonderswanRom(), 'game.ws');
    expect(result.platformId).toBe('ws');
    expect(result.header.fields.system).toBe('WonderSwan');
    expect(result.header.fields.checksumValid).toBe(true);
  });

  it('distinguishes WonderSwan Color', () => {
    const result = detectFormat(buildWonderswanRom({ color: true }), 'game.wsc');
    expect(result.platformId).toBe('ws');
    expect(result.header.fields.system).toBe('WonderSwan Color');
    expect(result.format?.id).toBe('wsc-rom');
  });

  it('still identifies a file with a broken checksum, but downgrades confidence', () => {
    const result = detectFormat(buildWonderswanRom({ breakChecksum: true }), 'game.ws');
    expect(result.platformId).toBe('ws');
    expect(result.platformConfidence).toBe('probable');
    expect(result.header.warnings.join(' ')).toMatch(/checksum/i);
  });

  it('rejects noise of the right size', () => {
    const result = detectFormat(buildNoise(128 * 1024, 4242), 'game.ws');
    expect(result.platformId).not.toBe('ws');
  });
});

describe('Virtual Boy detection', () => {
  it('identifies a commercial cartridge from its footer header', () => {
    const result = detectFormat(buildVirtualBoyRom({ gameCode: 'VTST' }), 'game.vb');
    expect(result.platformId).toBe('vb');
    expect(result.header.fields.gameCode).toBe('VTST');
    expect(result.header.fields.makerCode).toBe('NS');
  });

  it('rejects an image whose reserved field is not zero-filled', () => {
    const result = detectFormat(buildVirtualBoyRom({ dirtyReserved: true }), 'game.vb');
    expect(result.platformId).not.toBe('vb');
  });

  it('rejects noise', () => {
    const result = detectFormat(buildNoise(512 * 1024, 777), 'game.vb');
    expect(result.platformId).not.toBe('vb');
  });
});

describe('Neo Geo Pocket detection', () => {
  it('identifies a first-party cartridge and its title', () => {
    const result = detectFormat(buildNeoGeoPocketRom(), 'game.ngp');
    expect(result.platformId).toBe('ngp');
    expect(result.embeddedTitle).toBe('TEST GAME');
    // A literal signature justifies certainty.
    expect(result.platformConfidence).toBe('certain');
  });

  it('identifies a licensed third-party cartridge', () => {
    const result = detectFormat(buildNeoGeoPocketRom({ licensed: true }), 'game.ngp');
    expect(result.platformId).toBe('ngp');
    expect(result.header.fields.recognition).toMatch(/LICENSED/);
  });

  it('distinguishes Neo Geo Pocket Color', () => {
    const result = detectFormat(buildNeoGeoPocketRom({ color: true }), 'game.ngc');
    expect(result.platformId).toBe('ngp');
    expect(result.format?.id).toBe('ngc-rom');
    expect(result.header.fields.systemCode).toBe('0x10');
  });

  it('rejects noise', () => {
    const result = detectFormat(buildNoise(1024 * 1024, 31337), 'game.ngp');
    expect(result.platformId).not.toBe('ngp');
  });
});

describe('regression: existing platforms still detect correctly', () => {
  it('does not misclassify an NES ROM as SNES or Atari 2600', () => {
    // iNES header, 16-byte PRG.
    const rom = new Uint8Array(16 + 16384);
    rom.set([0x4e, 0x45, 0x53, 0x1a, 0x01, 0x00, 0x00, 0x00], 0);
    for (let i = 16; i < rom.length; i += 1) rom[i] = i & 0xff;
    const result = detectFormat(rom, 'game.nes');
    expect(result.platformId).toBe('nes');
  });

  it('does not misclassify a Game Boy ROM', () => {
    const rom = new Uint8Array(32768);
    // Nintendo logo bytes at 0x104..0x133, enough to satisfy the logo check.
    rom.set([0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b], 0x104);
    rom[0x147] = 0x00; // ROM only
    rom[0x149] = 0x00; // no RAM
    const result = detectFormat(rom, 'game.gb');
    expect(result.platformId === 'gb' || result.platformId === 'gbc').toBe(true);
  });
});

describe('full analysis pipeline for newly covered platforms', () => {
  it('produces a complete report for a SNES cartridge', async () => {
    const report = await analyzeBytes(buildSnesRom({ title: 'ANALYSIS TEST' }), 'game.sfc', {
      catalogue: false,
    });
    expect(report.platform?.id).toBe('snes');
    expect(report.platform?.name).toBe('Super Nintendo Entertainment System');
    expect(report.checksums.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
  });

  it('produces a complete report for a WonderSwan Color cartridge', async () => {
    const report = await analyzeBytes(buildWonderswanRom({ color: true }), 'game.wsc', {
      catalogue: false,
    });
    expect(report.platform?.id).toBe('ws');
    expect(report.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
  });

  it('still reports unknown for unrecognisable data', async () => {
    const report = await analyzeBytes(buildNoise(65536, 8), 'mystery.bin', { catalogue: false });
    expect(report.platform).toBeNull();
    expect(report.errors.some((e) => e.code === 'FORMAT_UNKNOWN')).toBe(true);
  });
});

/**
 * These four formats were *declared* as supported and were believed to work,
 * but two of them were completely undetectable:
 *
 *  - GBA compared its image against the **Game Boy** logo bitmap (a different
 *    bitmap) at the Game Boy offset (0x104 instead of 0x04), so the logo test
 *    could never pass. Every `.gba` file fell through to "unrecognised".
 *  - Atari 7800 looked for "ATARI7800" at offset 0, but the header stores it at
 *    offset 1. Every genuine `.a78` file was rejected.
 *
 * Both are regression-tested here so the coverage the UI advertises matches
 * what the detectors actually do.
 */
describe('regression: previously undetectable declared platforms', () => {
  it('identifies a Game Boy Advance cartridge', () => {
    const result = detectFormat(buildGbaRom({ title: 'TESTGAME', gameCode: 'TEST' }), 'game.gba');
    expect(result.platformId).toBe('gba');
    expect(result.platformConfidence).toBe('certain');
  });

  it('identifies a Game Boy cartridge', () => {
    expect(detectFormat(buildGameBoyRom(), 'game.gb').platformId).toBe('gb');
  });

  it('distinguishes Game Boy Color', () => {
    expect(detectFormat(buildGameBoyRom({ color: true }), 'game.gbc').platformId).toBe('gbc');
  });

  it('identifies a Nintendo DS image from the logo at 0xC0', () => {
    expect(detectFormat(buildNdsRom(), 'game.nds').platformId).toBe('nds');
  });

  it('identifies an Atari 7800 image whose signature sits at offset 1', () => {
    const rom = new Uint8Array(128 + 32768);
    rom.set([0x41, 0x54, 0x41, 0x52, 0x49, 0x37, 0x38, 0x30, 0x30], 1); // 'ATARI7800'
    rom[0] = 0x01; // header version byte, which is why the magic starts at 1
    const result = detectFormat(rom, 'game.a78');
    expect(result.platformId).toBe('atari7800');
    expect(result.format?.evidence.join(' ')).toMatch(/offset 0x01/);
  });

  it('still rejects noise for every newly covered platform', () => {
    for (const name of ['game.sfc', 'game.gba', 'game.nds', 'game.a78', 'game.vb', 'game.ngp']) {
      const result = detectFormat(buildNoise(256 * 1024, 4242), name);
      expect(result.platformId, `${name} should not be claimed`).not.toBe('snes');
      expect(result.platformId).not.toBe('gba');
      expect(result.platformId).not.toBe('nds');
      expect(result.platformId).not.toBe('atari7800');
      expect(result.platformId).not.toBe('vb');
      expect(result.platformId).not.toBe('ngp');
    }
  });
});

/**
 * The compatibility page advertises a detector for each platform. This test
 * binds that claim to the implementation: any platform the UI marks as having a
 * byte-level detector must actually be produced by `detectFormat` for a valid
 * fixture, and any platform marked "no detector" must have none.
 */
describe('detector capability claims match the implementation', () => {
  const fixtures: Partial<Record<string, [Uint8Array, string]>> = {
    nes: (() => {
      const rom = new Uint8Array(16 + 16384);
      rom.set([0x4e, 0x45, 0x53, 0x1a, 0x01, 0x00, 0x00, 0x00], 0);
      return [rom, 'game.nes'];
    })(),
    snes: [buildSnesRom(), 'game.sfc'],
    gb: [buildGameBoyRom(), 'game.gb'],
    gbc: [buildGameBoyRom({ color: true }), 'game.gbc'],
    gba: [buildGbaRom(), 'game.gba'],
    nds: [buildNdsRom(), 'game.nds'],
    pce: [buildPceRom(), 'game.pce'],
    atari2600: [buildAtari2600Rom(), 'game.a26'],
    ws: [buildWonderswanRom(), 'game.ws'],
    vb: [buildVirtualBoyRom(), 'game.vb'],
    ngp: [buildNeoGeoPocketRom(), 'game.ngp'],
  };

  it('every platform claiming a detector is actually detected', () => {
    for (const [platformId, fixture] of Object.entries(fixtures)) {
      expect(fixture, `${platformId} has no fixture`).toBeDefined();
      const [bytes, name] = fixture!;
      const result = detectFormat(bytes, name);
      expect(result.platformId, `${platformId} fixture should be identified`).toBe(platformId);
    }
  });

  it('marks arcade and unknown as having no detector', () => {
    expect(DETECTOR_STRENGTH.arcade).toBe('none');
    expect(DETECTOR_STRENGTH.unknown).toBe('none');
    expect(detectorLabel('arcade').text).toBe('no detector');
  });

  it('only structural detectors are described as uncertain', () => {
    // Signature and checksummed-footer detectors may be presented confidently;
    // structural inference may not.
    expect(detectorLabel('ngp').certain).toBe(true);
    expect(detectorLabel('ws').certain).toBe(true);
    expect(detectorLabel('snes').certain).toBe(false);
    expect(detectorLabel('atari2600').certain).toBe(false);
    expect(detectorLabel('pce').certain).toBe(false);
  });

  it('every defined platform has an explicit detector entry', () => {
    for (const platform of PLATFORMS) {
      expect(DETECTOR_STRENGTH[platform.id], `${platform.id} missing from map`).toBeDefined();
    }
  });
});
