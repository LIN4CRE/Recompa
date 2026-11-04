import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { buildDiscArchive, needsArchive } from '@/engines/psx/discArchive';
import { EmulatorJsPsxAdapter } from '@/engines/psx/adapter';
import { EMULATORJS_PSX_DESCRIPTOR } from '@/engines/descriptors';
import { ENGINE_ADAPTERS, getAdapter } from '@/engines';
import {
  buildPsxDisc,
  cueSheet,
} from './fixtures/disc';
import { analyzeBytes } from '@/core/analyze';
import type { RuntimeEnvironment } from '@/core/types';

const env = (overrides: Partial<RuntimeEnvironment> = {}): RuntimeEnvironment => ({
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
  ...overrides,
});

describe('disc archive packaging', () => {
  const raw = buildPsxDisc({ sectors: 40 });
  const cueText = cueSheet('game (Track 1).bin', [{ n: 1, mode: 'MODE2/2352', index1: '00:00:00' }]);

  it('packs a cue and its track into one zip with the cue first', async () => {
    const result = await buildDiscArchive(
      [
        { name: 'game (Track 1).bin', bytes: raw },
        { name: 'game.cue', bytes: new TextEncoder().encode(cueText) },
      ],
      'game.cue',
    );

    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual(['game (Track 1).bin', 'game.cue']);
    expect(result.entry).toBe('game.cue');
    expect(result.totalBytes).toBe(raw.length + cueText.length);

    // The cue must survive byte-for-byte, or the sheet no longer matches its bin.
    expect(new TextDecoder().decode(entries['game.cue']!)).toBe(cueText);
    // And the track must round-trip unmodified: originals are never altered.
    expect(entries['game (Track 1).bin']!.length).toBe(raw.length);
    expect(Buffer.from(entries['game (Track 1).bin']!).equals(Buffer.from(raw))).toBe(true);
  });

  it('preserves names containing spaces and punctuation', async () => {
    const result = await buildDiscArchive(
      [{ name: 'Digimon World 3 (Track 1) [NTSC-U].bin', bytes: raw }],
      'Digimon World 3 (Track 1) [NTSC-U].bin',
    );
    const entries = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    expect(Object.keys(entries)).toEqual(['Digimon World 3 (Track 1) [NTSC-U].bin']);
  });

  it('skips duplicate names instead of writing a corrupt archive', async () => {
    const result = await buildDiscArchive(
      [
        { name: 'game.cue', bytes: new TextEncoder().encode(cueText) },
        { name: 'GAME.CUE', bytes: new TextEncoder().encode(cueText) },
      ],
      'game.cue',
    );
    // The entry file (the cue sheet) is written first, so the case-variant
    // duplicate is the one dropped — never the launchable entry.
    expect(result.skipped).toEqual(['GAME.CUE']);
  });

  it('only packages when there is more than one file', () => {
    expect(needsArchive(1)).toBe(false);
    expect(needsArchive(2)).toBe(true);
  });
});

describe('PlayStation engine registration', () => {
  it('is registered in the engine list exactly once', () => {
    const ids = ENGINE_ADAPTERS.map((a) => a.descriptor.id);
    expect(ids.filter((id) => id === 'emulatorjs-psx')).toHaveLength(1);
    expect(getAdapter('emulatorjs-psx')).toBe(EmulatorJsPsxAdapter);
  });

  it('does not claim platforms it cannot run', () => {
    expect(EMULATORJS_PSX_DESCRIPTOR.platforms).toEqual(['psx']);
  });

  it('advertises only the extensions the core manifest lists', () => {
    // Taken verbatim from pcsx_rearmed's own core.json.
    expect(EMULATORJS_PSX_DESCRIPTOR.accepts).toEqual([
      'bin',
      'cue',
      'img',
      'mdf',
      'pbp',
      'toc',
      'cbn',
      'm3u',
      'ccd',
    ]);
    // CHD is genuinely absent from that manifest and must not be claimed.
    expect(EMULATORJS_PSX_DESCRIPTOR.accepts).not.toContain('chd');
  });

  it('declares the BIOS requirement honestly', () => {
    expect(EMULATORJS_PSX_DESCRIPTOR.needsFirmware).toBe(true);
    expect(EMULATORJS_PSX_DESCRIPTOR.limitations.join(' ')).toMatch(/never bundled/i);
  });
});

describe('PlayStation engine pre-flight', () => {
  const raw = buildPsxDisc({ sectors: 40 });

  const analyse = (name: string, bytes: Uint8Array) => analyzeBytes(bytes, name, { catalogue: false });

  it('blocks a PlayStation disc until a BIOS is supplied', async () => {
    const report = await analyse('game.bin', raw);
    const candidate = EmulatorJsPsxAdapter.canRun({ report, platform: report.platform, environment: env() });
    expect(candidate.runnable).toBe(false);
    expect(candidate.blockers.join(' ')).toMatch(/BIOS required/i);
  });

  it('becomes runnable once a BIOS dependency is satisfied', async () => {
    const report = await analyse('game.bin', raw);
    // Simulate the user attaching their own BIOS dump.
    const bios = report.dependencies.find((d) => /bios/i.test(d.name));
    expect(bios).toBeDefined();
    bios!.suppliedBy = 'scph5501.bin';

    const candidate = EmulatorJsPsxAdapter.canRun({ report, platform: report.platform, environment: env() });
    expect(candidate.blockers).toHaveLength(0);
    expect(candidate.runnable).toBe(true);
  });

  it('refuses non-PlayStation images', async () => {
    const report = await analyse('game.bin', raw);
    const candidate = EmulatorJsPsxAdapter.canRun({
      report,
      platform: { ...report.platform!, id: 'nes' },
      environment: env(),
    });
    expect(candidate.runnable).toBe(false);
    expect(candidate.blockers.join(' ')).toMatch(/Not a PlayStation image/i);
  });

  it('blocks when WebGL2 is unavailable', async () => {
    const report = await analyse('game.bin', raw);
    report.dependencies.find((d) => /bios/i.test(d.name))!.suppliedBy = 'scph5501.bin';
    const candidate = EmulatorJsPsxAdapter.canRun({
      report,
      platform: report.platform,
      environment: env({ webgl2: false }),
    });
    expect(candidate.runnable).toBe(false);
    expect(candidate.blockers.join(' ')).toMatch(/WebGL2/i);
  });

  it('blocks when WebAssembly is unavailable', async () => {
    const report = await analyse('game.bin', raw);
    report.dependencies.find((d) => /bios/i.test(d.name))!.suppliedBy = 'scph5501.bin';
    const candidate = EmulatorJsPsxAdapter.canRun({
      report,
      platform: report.platform,
      environment: env({ webAssembly: false }),
    });
    expect(candidate.runnable).toBe(false);
  });

  it('explains that CHD cannot be loaded rather than silently accepting it', async () => {
    const chd = new Uint8Array(4096);
    chd.set(new TextEncoder().encode('MComprHD'), 0);
    chd[12] = 5;
    chd.set(new TextEncoder().encode('CD-ROM'), 124);
    const report = await analyse('game.chd', chd);
    report.dependencies.find((d) => /bios/i.test(d.name))!.suppliedBy = 'scph5501.bin';
    const candidate = EmulatorJsPsxAdapter.canRun({
      report,
      platform: report.platform,
      environment: env(),
    });
    expect(candidate.runnable).toBe(false);
    expect(candidate.blockers.join(' ')).toMatch(/CHD is not supported/i);
  });

  it('notes mobile frame-rate risk without blocking', async () => {
    const report = await analyse('game.bin', raw);
    report.dependencies.find((d) => /bios/i.test(d.name))!.suppliedBy = 'scph5501.bin';
    const candidate = EmulatorJsPsxAdapter.canRun({
      report,
      platform: report.platform,
      environment: env({ userAgentClass: 'mobile' }),
    });
    expect(candidate.runnable).toBe(true);
    expect(candidate.notes.join(' ')).toMatch(/frame-rate/i);
  });
});

describe('Player engine selection', () => {
  /**
   * Regression guard: `game.engineId ?? report.platform?.id === 'nes' ? … : …`
   * parses as `(a ?? b) ? x : y`, which forced *every* game with an engineId
   * to jsnes — including PlayStation ones.
   */
  const resolve = (engineId: string | undefined, platformId: string) =>
    engineId ?? (platformId === 'nes' ? 'jsnes' : 'mgba-wasm');

  it('honours an explicit PlayStation engine instead of falling back to jsnes', () => {
    expect(resolve('emulatorjs-psx', 'psx')).toBe('emulatorjs-psx');
  });

  it('keeps existing fallbacks working', () => {
    expect(resolve(undefined, 'nes')).toBe('jsnes');
    expect(resolve('mgba-wasm', 'gba')).toBe('mgba-wasm');
  });
});

describe('PlayStation button mapping', () => {
  it('maps the full PS1 pad and rejects buttons the pad lacks', async () => {
    const { mapButton } = await import('@/ui/player/useEmulator');
    expect(mapButton('emulatorjs-psx', 'A')).toBe('cross');
    expect(mapButton('emulatorjs-psx', 'X')).toBe('triangle');
    expect(mapButton('emulatorjs-psx', 'Y')).toBe('square');
    expect(mapButton('emulatorjs-psx', 'L2')).toBe('l2');
    expect(mapButton('emulatorjs-psx', 'START')).toBe('start');
  });
});
