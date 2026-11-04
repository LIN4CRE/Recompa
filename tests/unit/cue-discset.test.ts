import { describe, it, expect } from 'vitest';
import { parseCue, normaliseCuePath, referencedFiles, isMultiTrack, msfToSectors } from '@/core/cue';
import { resolveDiscSets, discSetFor, stemOf, type DroppedFile } from '@/core/discset';

/** Helper: describe a dropped file the way the uploader will. */
function file(name: string, opts: { size?: number; text?: string; relativePath?: string } = {}): DroppedFile {
  const dot = name.lastIndexOf('.');
  return {
    name,
    size: opts.size ?? 1024,
    ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
    relativePath: opts.relativePath,
    textContent: opts.text,
  };
}

describe('CUE parsing', () => {
  it('parses a single-track sheet', () => {
    const sheet = parseCue(
      ['FILE "Digimon World 3 (Track 1).bin" BINARY', '  TRACK 01 MODE2/2352', '    INDEX 01 00:00:00'].join('\n'),
    );
    expect(sheet.errors).toHaveLength(0);
    expect(sheet.files).toHaveLength(1);
    expect(sheet.files[0]!.name).toBe('Digimon World 3 (Track 1).bin');
    expect(sheet.files[0]!.type).toBe('BINARY');
    expect(sheet.files[0]!.tracks[0]!.mode).toBe('MODE2/2352');
    expect(referencedFiles(sheet)).toEqual(['Digimon World 3 (Track 1).bin']);
  });

  it('parses multi-track sheets with an audio track and pregap index', () => {
    const sheet = parseCue(
      [
        'FILE "game.bin" BINARY',
        '  TRACK 01 MODE2/2352',
        '    INDEX 01 00:00:00',
        '  TRACK 02 AUDIO',
        '    INDEX 00 10:00:00',
        '    INDEX 01 10:02:00',
      ].join('\n'),
    );
    expect(sheet.errors).toHaveLength(0);
    expect(sheet.files[0]!.tracks).toHaveLength(2);
    expect(sheet.files[0]!.tracks[1]!.indexes.map((i) => i.index)).toEqual([0, 1]);
    expect(isMultiTrack(sheet)).toBe(true);
  });

  it('handles sheets that name several files', () => {
    const sheet = parseCue(
      [
        'FILE "track01.bin" BINARY',
        '  TRACK 01 MODE1/2352',
        '    INDEX 01 00:00:00',
        'FILE "track02.bin" BINARY',
        '  TRACK 02 AUDIO',
        '    INDEX 01 00:00:00',
      ].join('\n'),
    );
    expect(sheet.files).toHaveLength(2);
    expect(referencedFiles(sheet)).toEqual(['track01.bin', 'track02.bin']);
    expect(isMultiTrack(sheet)).toBe(true);
  });

  it('tolerates lowercase keywords, tabs, BOM and CRLF', () => {
    const sheet = parseCue('\uFEFFFILE "x.bin" BINARY\r\n\ttrack 01 MODE2/2352\r\n\t\tindex 01 00:00:00\r\n');
    expect(sheet.files).toHaveLength(1);
    expect(sheet.errors).toHaveLength(0);
  });

  it('accepts an unquoted single-word file name', () => {
    const sheet = parseCue('FILE game.bin BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n');
    expect(sheet.files[0]!.name).toBe('game.bin');
  });

  it('rejects a sheet with no FILE command', () => {
    const sheet = parseCue('TITLE "orphan"\nTRACK 01 AUDIO\n  INDEX 01 00:00:00\n');
    expect(sheet.hasFileBlock).toBe(false);
    expect(sheet.errors.length).toBeGreaterThan(0);
  });

  it('rejects TRACK outside a FILE block', () => {
    const sheet = parseCue('TRACK 01 MODE2/2352\n  INDEX 01 00:00:00\n');
    expect(sheet.errors.some((e) => e.message.includes('before any FILE'))).toBe(true);
  });

  it('rejects a track with no INDEX 01', () => {
    const sheet = parseCue('FILE "a.bin" BINARY\n  TRACK 01 MODE2/2352\n');
    expect(sheet.errors.some((e) => e.message.includes('no INDEX 01'))).toBe(true);
  });

  it('records unknown commands as warnings rather than failing the sheet', () => {
    const sheet = parseCue(
      ['FILE "a.bin" BINARY', '  TRACK 01 MODE2/2352', '    INDEX 01 00:00:00', '  BOGUS thing'].join('\n'),
    );
    expect(sheet.errors).toHaveLength(0);
    expect(sheet.warnings.some((w) => w.message.includes('BOGUS'))).toBe(true);
  });

  it('normalises Windows paths inside sheets', () => {
    expect(normaliseCuePath('C:\\Rips\\Game\\Track 01.bin')).toBe('Track 01.bin');
    expect(normaliseCuePath('"quoted.bin"')).toBe('quoted.bin');
  });

  it('converts mm:ss:ff to sectors at 75 frames/second', () => {
    expect(msfToSectors('00:00:00')).toBe(0);
    expect(msfToSectors('00:02:00')).toBe(150);
    expect(msfToSectors('01:00:00')).toBe(4500);
  });
});

describe('Disc-set resolution', () => {
  const cueText = [
    'FILE "Digimon World 3 (Track 1).bin" BINARY',
    '  TRACK 01 MODE2/2352',
    '    INDEX 01 00:00:00',
  ].join('\n');

  it('links a CUE to the BIN it names, keeping spaces intact', () => {
    const sets = resolveDiscSets([
      file('Digimon World 3 (Track 1).bin', { size: 700_000_000 }),
      file('Digimon World 3 (Track 1).cue', { text: cueText }),
    ]);
    expect(sets).toHaveLength(1);
    const set = sets[0]!;
    expect(set.status).toBe('ready');
    expect(set.entry).toBe('Digimon World 3 (Track 1).cue');
    expect(set.members.map((m) => m.name).sort()).toEqual([
      'Digimon World 3 (Track 1).bin',
      'Digimon World 3 (Track 1).cue',
    ]);
    expect(set.trackCount).toBe(1);
    // The BIN must not survive as its own separate "game".
    expect(discSetFor(sets, 'Digimon World 3 (Track 1).bin')?.id).toBe('digimon world 3 (track 1).cue');
  });

  it('resolves a multi-track set with several BINs', () => {
    const multi = [
      'FILE "game (Track 1).bin" BINARY',
      '  TRACK 01 MODE2/2352',
      '    INDEX 01 00:00:00',
      'FILE "game (Track 2).bin" BINARY',
      '  TRACK 02 AUDIO',
      '    INDEX 01 00:00:00',
    ].join('\n');
    const sets = resolveDiscSets([
      file('game (Track 1).bin'),
      file('game (Track 2).bin'),
      file('game (Track 1).cue', { text: multi }),
    ]);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.status).toBe('ready');
    expect(sets[0]!.multiTrack).toBe(true);
    expect(sets[0]!.trackCount).toBe(2);
    expect(sets[0]!.members.filter((m) => m.role === 'data-track')).toHaveLength(2);
  });

  it('names the missing companion when a CUE points at an absent BIN', () => {
    const sets = resolveDiscSets([file('game.cue', { text: cueText })]);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.status).toBe('missing-companion');
    expect(sets[0]!.problems.join(' ')).toContain('Digimon World 3 (Track 1).bin');
    expect(sets[0]!.problems.join(' ')).toMatch(/not included/);
  });

  it('does not invent a partner when the BIN is dropped alone', () => {
    const sets = resolveDiscSets([file('game.bin', { size: 700_000_000 })]);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.status).toBe('ready');
    expect(sets[0]!.notes.join(' ')).toMatch(/single-track disc/);
  });

  it('marks an unusable CUE as invalid instead of guessing', () => {
    const sets = resolveDiscSets([file('broken.cue', { text: 'this is not a cue\n' })]);
    expect(sets[0]!.status).toBe('invalid-sheet');
    expect(sets[0]!.problems.length).toBeGreaterThan(0);
  });

  it('matches file names case-insensitively', () => {
    const sets = resolveDiscSets([
      file('GAME.BIN'),
      file('game.cue', { text: 'FILE "game.bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n' }),
    ]);
    expect(sets[0]!.status).toBe('ready');
  });

  it('resolves a .m3u playlist across two discs', () => {
    const sets = resolveDiscSets([
      file('Game (Disc 1).cue', { text: cueText.replace('Digimon World 3 (Track 1).bin', 'Game (Disc 1).bin') }),
      file('Game (Disc 1).bin'),
      file('Game (Disc 2).cue', { text: cueText.replace('Digimon World 3 (Track 1).bin', 'Game (Disc 2).bin') }),
      file('Game (Disc 2).bin'),
      file('game.m3u', { text: 'Game (Disc 1).cue\nGame (Disc 2).cue\n' }),
    ]);
    const playlist = sets.find((s) => s.entry === 'game.m3u')!;
    expect(playlist.status).toBe('ready');
    expect(playlist.members.filter((m) => m.role === 'data-track')).toHaveLength(2);
    expect(playlist.trackCount).toBe(2);
  });

  it('pairs CCD with IMG and SUB', () => {
    const sets = resolveDiscSets([file('game.ccd'), file('game.img'), file('game.sub')]);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.status).toBe('ready');
    expect(sets[0]!.members.map((m) => m.role).sort()).toEqual(['data-track', 'sheet', 'subchannel']);
  });

  it('reports a CCD with no IMG', () => {
    const sets = resolveDiscSets([file('game.ccd')]);
    expect(sets[0]!.status).toBe('missing-companion');
    expect(sets[0]!.problems.join(' ')).toContain('game.img');
  });

  it('uses folder paths when the whole directory is dropped', () => {
    const sets = resolveDiscSets([
      file('Track 01.bin', { relativePath: 'Rips/Digimon World 3/Track 01.bin' }),
      file('game.cue', {
        relativePath: 'Rips/Digimon World 3/game.cue',
        text: 'FILE "Track 01.bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n',
      }),
    ]);
    expect(sets[0]!.status).toBe('ready');
  });

  it('keeps unrelated files as their own entries', () => {
    const sets = resolveDiscSets([file('mario.nes'), file('game.cue', { text: cueText })]);
    const nes = sets.find((s) => s.entry === 'mario.nes')!;
    expect(nes.status).toBe('not-a-disc-set');
    expect(sets.find((s) => s.entry === 'game.cue')!.status).toBe('missing-companion');
  });

  it('ignores an orphan .sub', () => {
    const sets = resolveDiscSets([file('stray.sub')]);
    expect(sets).toHaveLength(0);
  });

  it('strips only the final extension when computing stems', () => {
    expect(stemOf('Game (Track 1).bin')).toBe('Game (Track 1)');
    expect(stemOf('no-extension')).toBe('no-extension');
  });
});
