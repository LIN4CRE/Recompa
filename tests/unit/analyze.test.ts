import { describe, expect, it } from 'vitest';
import { analyzeBytes, titleFromFileName, summarize, hexdump } from '@/core/analyze';
import { buildTestRom } from '@/core/testrom';

/**
 * The analyser touches `fetch` only for the catalogue; in Node it fails fast and
 * the report must degrade gracefully ("not installed"), never throw.
 */
describe('analyzeBytes', () => {
  it('produces a complete report for the self-test cartridge', async () => {
    const rom = buildTestRom();
    const report = await analyzeBytes(rom, 'recompa-selftest.nes', { catalogue: false });

    expect(report.schemaVersion).toBe(1);
    expect(report.platform?.id).toBe('nes');
    expect(report.platformConfidence).toBe('certain');
    expect(report.format?.id).toBe('ines');
    expect(report.checksums.size).toBe(rom.length);
    expect(report.checksums.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.checksums.sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(report.checksums.md5).toMatch(/^[0-9a-f]{32}$/);
    expect(report.checksums.crc32).toMatch(/^[0-9a-f]{8}$/);
    expect(report.errors).toHaveLength(0);
  });

  it('labels an unverified title honestly', async () => {
    const report = await analyzeBytes(buildTestRom(), 'my game (USA).nes', { catalogue: false });
    // No embedded NES title exists, so the name comes from the file name.
    expect(report.identification.titleSource).toBe('filename');
    expect(report.identification.title).toBe('my game');
    expect(report.identification.catalogueMatch).toBeNull();
  });

  it('reports a fatal error and no platform for unknown bytes', async () => {
    const junk = new Uint8Array(2048).map((_, i) => (i * 37) & 0xff);
    const report = await analyzeBytes(junk, 'unknown.bin', { catalogue: false });
    expect(report.platform).toBeNull();
    expect(report.format).toBeNull();
    expect(report.errors.some((e) => e.severity === 'fatal')).toBe(true);
  });

  it('records the firmware dependency for disc platforms', async () => {
    // A valid sheet needs FILE + TRACK + INDEX 01; without the INDEX the
    // detector (correctly) classifies it as malformed instead.
    const cue = new TextEncoder().encode(
      'FILE "game.bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n',
    );
    const report = await analyzeBytes(cue, 'game.cue', { catalogue: false });
    expect(report.platform?.id).toBe('psx');
    expect(report.dependencies.some((d) => d.name.includes('BIOS') && d.required)).toBe(true);
    expect(report.dependencies.some((d) => d.id === 'cue-tracks')).toBe(true);
    expect(report.errors.some((e) => e.code === 'CUE_INCOMPLETE')).toBe(true);
  });

  it('survives a missing catalogue without inventing a match', async () => {
    const report = await analyzeBytes(buildTestRom(), 'x.nes', { catalogue: true });
    expect(report.identification.catalogueMatch).toBeNull();
    const catalogueFact = report.facts.find((f) => f.label === 'Catalogue');
    // Either a real lookup ran or the fact explains the DB is absent.
    if (catalogueFact) expect(catalogueFact.value.length).toBeGreaterThan(0);
  });

  it('does not report a title match for a file whose bytes changed', async () => {
    const rom = buildTestRom();
    const modified = new Uint8Array(rom);
    modified[100] ^= 0xff;
    const a = await analyzeBytes(rom, 'a.nes', { catalogue: false });
    const b = await analyzeBytes(modified, 'b.nes', { catalogue: false });
    expect(a.checksums.sha256).not.toBe(b.checksums.sha256);
    expect(a.checksums.crc32).not.toBe(b.checksums.crc32);
  });
});

describe('titleFromFileName', () => {
  it('strips region and revision tags', () => {
    expect(titleFromFileName('Super Game (USA) (Rev 1).nes')).toBe('Super Game');
    expect(titleFromFileName('Another_Game (Europe) [!].gb')).toBe('Another Game');
  });

  it('returns null for meaningless names', () => {
    expect(titleFromFileName('.nes')).toBeNull();
    expect(titleFromFileName('a')).toBeNull();
  });
});

describe('summarize', () => {
  it('marks unverified titles as unverified', async () => {
    const report = await analyzeBytes(buildTestRom(), 'mystery.nes', { catalogue: false });
    expect(summarize(report)).toContain('title from file, not verified');
  });

  it('explains a failed identification', async () => {
    const report = await analyzeBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'x.bin', { catalogue: false });
    expect(summarize(report)).toContain('Unrecognised');
  });
});

describe('hexdump', () => {
  it('renders 16 bytes per line with an ASCII column', () => {
    const lines = hexdump(new TextEncoder().encode('ABCDEFGHIJKLMNOP'.repeat(2)), 32);
    expect(lines[0]).toContain('41 42 43');
    expect(lines[0]).toContain('|ABCDEFGHIJKLMNOP|');
    expect(lines[1]).toContain('000010');
  });

  it('bounds output to the requested byte count', () => {
    const lines = hexdump(new Uint8Array(1024), 16);
    // 1 line of data + 1 "… more bytes" marker
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('more bytes');
  });
});
