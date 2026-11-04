import { describe, it, expect } from 'vitest';
import { validateBios, platformNeedsBios } from '@/core/bios';
import { isCandidateFile, diffScan, groupScannedFiles, type ScanFile, type ScannedGame } from '@/core/folderscan';
import { EmulatorJsPsxAdapter } from '@/engines/psx/adapter';
import { analyzeBytes } from '@/core/analyze';
import { buildPsxDisc, cueSheet } from './fixtures/disc';
import type { RuntimeEnvironment } from '@/core/types';

const PS1_SIZE = 512 * 1024;
const env = (o: Partial<RuntimeEnvironment> = {}): RuntimeEnvironment => ({
  webAssembly: true,
  wasmSimd: true,
  wasmThreads: false,
  sharedArrayBuffer: true,
  crossOriginIsolated: true,
  webgpu: false,
  webgl2: true,
  webgl1: true,
  audioWorklet: true,
  indexedDb: true,
  offscreenCanvas: true,
  gamepadApi: true,
  touch: false,
  cores: 8,
  deviceMemoryGb: 16,
  gpuRenderer: 'test',
  userAgentClass: 'desktop',
  ...o,
});

/** A File stand-in for the scanner, which only needs name/size/text/slice. */
function fakeFile(name: string, bytes: Uint8Array): File {
  return new File([bytes.slice().buffer as ArrayBuffer], name);
}

function scanFile(name: string, bytes: Uint8Array, relativePath?: string): ScanFile {
  const file = fakeFile(name, bytes);
  return {
    name,
    relativePath: relativePath ?? name,
    size: bytes.length,
    lastModified: 0,
    file,
  };
}

describe('BIOS validation', () => {
  it('accepts a 512 KiB image', () => {
    const result = validateBios('psx', 'scph5501.bin', PS1_SIZE);
    expect(result.ok).toBe(true);
    expect(result.sizeAccepted).toBe(true);
    expect(result.notes.join(' ')).toMatch(/SCPH5501/i);
  });

  it('rejects the wrong size and explains exactly why', () => {
    const result = validateBios('psx', 'scph5501.bin', 64 * 1024);
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/512 KiB/);
    expect(result.problem).toMatch(/truncated|padded/i);
  });

  it('does not let a convincing filename make an invalid file valid', () => {
    // The whole point: a rename must not bypass the size check.
    expect(validateBios('psx', 'scph7001.bin', 1).ok).toBe(false);
  });

  it('is honest that content cannot be authenticated offline', () => {
    const result = validateBios('psx', 'mystery.bin', PS1_SIZE);
    expect(result.ok).toBe(true);
    expect(result.notes.join(' ')).toMatch(/cannot be authenticated offline/i);
  });

  it('refuses platforms with no firmware requirement defined', () => {
    expect(validateBios('nes', 'whatever.bin', 512).ok).toBe(false);
  });

  it('reports which platforms need firmware', () => {
    expect(platformNeedsBios('psx')).toBe(true);
    expect(platformNeedsBios('nes')).toBe(false);
    expect(platformNeedsBios('snes')).toBe(false);
  });
});

describe('PS1 engine BIOS gating', () => {
  const raw = buildPsxDisc({ sectors: 40 });
  const reportFor = () => analyzeBytes(raw, 'game.bin', { catalogue: false });

  it('blocks when firmware status is unknown', async () => {
    const report = await reportFor();
    const c = EmulatorJsPsxAdapter.canRun({ report, platform: report.platform, environment: env() });
    expect(c.runnable).toBe(false);
    expect(c.blockers.join(' ')).toMatch(/BIOS not installed/i);
  });

  it('blocks when firmware is explicitly absent', async () => {
    const report = await reportFor();
    const c = EmulatorJsPsxAdapter.canRun({
      report,
      platform: report.platform,
      environment: env(),
      biosInstalled: false,
    });
    expect(c.runnable).toBe(false);
  });

  it('becomes runnable once firmware is installed', async () => {
    const report = await reportFor();
    const c = EmulatorJsPsxAdapter.canRun({
      report,
      platform: report.platform,
      environment: env(),
      biosInstalled: true,
    });
    expect(c.blockers).toHaveLength(0);
    expect(c.runnable).toBe(true);
  });

  it('still blocks when firmware exists but the browser lacks WebGL2', async () => {
    const report = await reportFor();
    const c = EmulatorJsPsxAdapter.canRun({
      report,
      platform: report.platform,
      environment: env({ webgl2: false }),
      biosInstalled: true,
    });
    expect(c.runnable).toBe(false);
    expect(c.blockers.join(' ')).toMatch(/WebGL2/i);
  });
});

describe('folder scan filtering', () => {
  it('drops obvious clutter', () => {
    for (const name of ['readme.txt', 'cover.jpg', 'game.nfo', '.DS_Store', 'thumbs.db', '._resource']) {
      expect(isCandidateFile(name)).toBe(false);
    }
  });

  it('keeps game images and sheets', () => {
    for (const name of ['game.bin', 'game.cue', 'track 01.bin', 'Game (Disc 1).chd', 'a.m3u']) {
      expect(isCandidateFile(name)).toBe(true);
    }
  });

  it('keeps a file with no extension out of the candidate set', () => {
    expect(isCandidateFile('LICENSE')).toBe(false);
  });
});

describe('folder grouping', () => {
  const raw = buildPsxDisc({ sectors: 40 });
  const cueText = cueSheet('Digimon World 3.bin', [{ n: 1, mode: 'MODE2/2352', index1: '00:00:00' }]);

  it('groups a cue and its bin inside one folder into a single game', async () => {
    const files = [
      scanFile('Digimon World 3.bin', raw, 'Roms/PS1/Digimon World 3.bin'),
      scanFile('Digimon World 3.cue', new TextEncoder().encode(cueText), 'Roms/PS1/Digimon World 3.cue'),
    ];
    const result = await groupScannedFiles(files, 'Roms');
    const ready = result.games.filter((g) => g.set.status === 'ready');
    expect(ready).toHaveLength(1);
    expect(ready[0]!.set.entry).toBe('Digimon World 3.cue');
    expect(ready[0]!.files).toHaveLength(2);
    expect(ready[0]!.folder).toBe('Roms/PS1');
  });

  it('keeps games in different folders separate even with identical names', async () => {
    const files = [
      scanFile('game.bin', raw, 'A/game.bin'),
      scanFile('game.bin', raw, 'B/game.bin'),
    ];
    const result = await groupScannedFiles(files, 'root');
    expect(result.games).toHaveLength(2);
    expect(result.games.map((g) => g.folder).sort()).toEqual(['A', 'B']);
  });

  it('claims companion tracks so they are not separate games', async () => {
    const files = [
      scanFile('Game (Track 1).bin', raw, 'PS1/Game (Track 1).bin'),
      scanFile('Game (Track 1).cue', new TextEncoder().encode(
        cueSheet('Game (Track 1).bin', [{ n: 1, mode: 'MODE2/2352', index1: '00:00:00' }]),
      ), 'PS1/Game (Track 1).cue'),
    ];
    const result = await groupScannedFiles(files, 'root');
    expect(result.games).toHaveLength(1);
  });

  it('counts incomplete sets rather than hiding them', async () => {
    const files = [
      scanFile('game.cue', new TextEncoder().encode(cueText), 'PS1/game.cue'),
    ];
    const result = await groupScannedFiles(files, 'root');
    expect(result.incomplete).toBe(1);
    expect(result.games[0]!.set.status).toBe('missing-companion');
  });

  it('records ignored clutter by path', async () => {
    const files = [scanFile('readme.txt', new Uint8Array(4), 'PS1/readme.txt')];
    const result = await groupScannedFiles(files, 'root');
    expect(result.ignored).toEqual(['PS1/readme.txt']);
    expect(result.games).toHaveLength(0);
  });
});

describe('rescan diffing', () => {
  const game = (paths: string[]): ScannedGame =>
    ({
      folder: 'PS1',
      files: paths.map((p) => ({ name: p.split('/').pop()!, relativePath: p, size: 1, lastModified: 0, file: null as never })),
      key: paths.join('|'),
      set: { members: paths.map((p) => ({ name: p.split('/').pop()! })) } as never,
    }) as ScannedGame;

  it('treats everything as new on a first scan', () => {
    const diff = diffScan([], [game(['PS1/a.bin'])]);
    expect(diff.newGames).toHaveLength(1);
    expect(diff.unchanged).toBe(0);
  });

  it('skips a game whose files were all imported before', () => {
    const diff = diffScan(['PS1/a.bin'], [game(['PS1/a.bin'])]);
    expect(diff.newGames).toHaveLength(0);
    expect(diff.unchanged).toBe(1);
  });

  it('re-imports a disc that gained a track', () => {
    // Previously only track 1 existed; now track 2 does too, so the stored
    // payload is the wrong image and must be rebuilt.
    const diff = diffScan(['PS1/a.bin'], [game(['PS1/a.bin', 'PS1/b.bin'])]);
    expect(diff.newGames).toHaveLength(1);
  });

  it('reports files that vanished without deleting anything', () => {
    const diff = diffScan(['PS1/gone.bin'], [game(['PS1/a.bin'])]);
    expect(diff.removed).toBe(1);
    expect(diff.newGames).toHaveLength(1);
  });

  it('matches paths case-insensitively', () => {
    const diff = diffScan(['ps1/a.bin'], [game(['PS1/A.BIN'])]);
    expect(diff.unchanged).toBe(1);
  });
});

describe('support link', () => {
  it('points at the exact PayPal.me destination', async () => {
    const { SUPPORT_URL } = await import('@/ui/components/SupportButton');
    expect(SUPPORT_URL).toBe('https://paypal.me/dlinacre16');
  });
});
