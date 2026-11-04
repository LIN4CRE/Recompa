import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { inspectArchive, MAX_MEMBER_BYTES } from '@/lib/zip';
import { buildTestRom } from '@/core/testrom';

describe('inspectArchive', () => {
  it('picks the ROM and ignores metadata files', () => {
    const rom = buildTestRom();
    const zip = zipSync({
      'readme.txt': strToU8('notes'),
      'boxart.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      'game.nes': rom,
    });
    return inspectArchive(zip).then((result) => {
      expect(result.entries).toHaveLength(3);
      expect(result.selectedIndex).not.toBeNull();
      expect(result.entries[result.selectedIndex!]?.name).toBe('game.nes');
      expect(result.selectedBytes?.length).toBe(rom.length);
      expect(result.errors).toHaveLength(0);
    });
  });

  it('skips __MACOSX resource forks and .DS_Store', async () => {
    const rom = buildTestRom();
    const zip = zipSync({
      '__MACOSX/._game.nes': new Uint8Array(200),
      '.DS_Store': new Uint8Array(50),
      'game.nes': rom,
    });
    const result = await inspectArchive(zip);
    expect(result.entries[result.selectedIndex!]?.name).toBe('game.nes');
  });

  it('accepts a nested directory layout and still extracts the member by full path', async () => {
    const rom = buildTestRom();
    const zip = zipSync({ 'Roms/Nintendo/game.nes': rom });
    const result = await inspectArchive(zip);
    expect(result.selectedIndex).toBe(0);
    expect(result.selectedBytes?.length).toBe(rom.length);
  });

  it('reports when no member looks like a game image', async () => {
    const zip = zipSync({ 'notes.txt': strToU8('hello'), 'art.jpg': new Uint8Array(10) });
    const result = await inspectArchive(zip);
    expect(result.selectedIndex).toBeNull();
    expect(result.errors[0]).toMatch(/supported game image/i);
  });

  it('detects nested archives and tells the user to extract first', async () => {
    const inner = zipSync({ 'game.nes': buildTestRom() });
    const outer = zipSync({ 'inner.zip': inner });
    const result = await inspectArchive(outer);
    expect(result.errors.join(' ')).toMatch(/nested archives/i);
  });

  it('refuses members above the safety limit', async () => {
    // Use a highly compressible large member: 300 MiB of zeros compresses to
    // almost nothing, so this stays fast while exercising the size guard.
    const big = new Uint8Array(MAX_MEMBER_BYTES + 1024);
    const zip = zipSync({ 'huge.nes': big }, { level: 1 });
    const result = await inspectArchive(zip);
    expect(result.selectedIndex).toBeNull();
    expect(result.entries[0]?.skippedReason).toMatch(/safety limit/);
  });

  it('prefers a cartridge over a .cue sheet in the same archive', async () => {
    const rom = buildTestRom();
    const zip = zipSync({ 'disc.cue': strToU8('FILE "disc.bin" BINARY'), 'game.nes': rom });
    const result = await inspectArchive(zip);
    expect(result.entries[result.selectedIndex!]?.name).toBe('game.nes');
  });

  it('does not throw on a corrupt zip', async () => {
    const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 1, 2, 3, 4, 5]);
    await expect(inspectArchive(corrupt)).rejects.toThrow();
  });
});
