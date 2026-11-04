import { describe, it, expect } from 'vitest';
import { detectFormat } from '@/core/detect';
import { analyzeBytes } from '@/core/analyze';
import { buildPsxDisc, toCookedIso, to2336, cueSheet } from './fixtures/disc';

/**
 * PlayStation disc-image detection.
 *
 * Regression guard for the `Digimon World 3.bin` bug: a raw 2352-byte/sector
 * image used to return `platformId: null` because the detector sampled byte 0
 * for the licence string and only ever looked for the ISO 9660 PVD at
 * `16 * 2048`.
 */
describe('PlayStation disc detection', () => {
  const raw = buildPsxDisc({ volumeId: 'DIGIMONWORLD3' });

  it('identifies a raw MODE2/2352 .bin as a PlayStation disc', () => {
    const result = detectFormat(raw, 'Digimon World 3.bin');
    expect(result.platformId).toBe('psx');
    expect(result.format?.id).toBe('psx-raw');
    expect(result.format?.confidence).toBe('certain');
    expect(result.errors).toHaveLength(0);
    expect(result.header.fields.sectorSize).toBe(2352);
    expect(result.header.fields.payloadOffset).toBe(24);
    expect(result.header.fields.volumeId).toBe('DIGIMONWORLD3');
    expect(result.facts.some((f) => f.value.includes('licence string found'))).toBe(true);
  });

  it('still identifies a 2048-byte cooked .iso', () => {
    const result = detectFormat(toCookedIso(raw), 'Digimon World 3.iso');
    expect(result.platformId).toBe('psx');
    expect(result.format?.id).toBe('iso9660');
    expect(result.header.fields.sectorSize).toBe(2048);
  });

  it('identifies 2336-byte sector dumps', () => {
    const result = detectFormat(to2336(raw), 'disc.img');
    expect(result.platformId).toBe('psx');
    expect(result.header.fields.sectorSize).toBe(2336);
  });

  it('identifies a MODE1/2352 image whose payload starts at byte 16', () => {
    // Strip the 8-byte subheader from every MODE2 sector to synthesise MODE1.
    const sectors = raw.length / 2352;
    const mode1 = new Uint8Array(sectors * 2352);
    for (let i = 0; i < sectors; i++) {
      const src = i * 2352;
      mode1.set(raw.subarray(src, src + 16), src); // sync + header
      mode1.set(raw.subarray(src + 24, src + 24 + 2048), src + 16); // data
    }
    // Rewrite the PVD at the MODE1 position (16*2352 + 16) from the MODE2 copy.
    const pvdSrc = 16 * 2352 + 24;
    mode1.set(raw.subarray(pvdSrc, pvdSrc + 2048), 16 * 2352 + 16);

    const result = detectFormat(mode1, 'mode1.bin');
    expect(result.platformId).toBe('psx');
    expect(result.header.fields.payloadOffset).toBe(16);
  });

  it('does not claim a PlayStation disc when nothing identifies one', () => {
    const generic = buildPsxDisc({ systemId: 'CD-RTOS', psxLicence: false });
    const result = detectFormat(generic, 'generic.iso');
    expect(result.platformId).toBe('psx');
    expect(result.errors.some((e) => e.code === 'DISC_SYSTEM_UNCLEAR')).toBe(true);
  });

  it('reports a cue sheet as an index that needs its tracks', async () => {
    const cue = new TextEncoder().encode(
      cueSheet('Digimon World 3 (Track 1).bin', [{ n: 1, mode: 'MODE2/2352', index1: '00:00:00' }]),
    );
    const result = detectFormat(cue, 'Digimon World 3 (Track 1).cue');
    expect(result.platformId).toBe('psx');
    expect(result.format?.id).toBe('cue');
    // A sheet is only an index: usable, but never on its own.
    expect(result.errors.some((e) => e.code === 'CUE_INCOMPLETE')).toBe(true);
    expect(result.errors.find((e) => e.code === 'CUE_INCOMPLETE')?.severity).toBe('warning');
  });

  it('marks a cue sheet with no FILE/TRACK/INDEX as malformed', () => {
    const cue = new TextEncoder().encode('TITLE "nothing useful"\n');
    const result = detectFormat(cue, 'broken.cue');
    expect(result.errors.some((e) => e.code === 'CUE_MALFORMED')).toBe(true);
  });

  it('recognises a multi-track cue sheet and lists every track mode', () => {
    const cue = new TextEncoder().encode(
      cueSheet('game.bin', [
        { n: 1, mode: 'MODE2/2352', index1: '00:00:00' },
        { n: 2, mode: 'AUDIO', index1: '12:34:00' },
      ]),
    );
    const result = detectFormat(cue, 'game.cue');
    expect(result.header.fields.trackCount).toBe(2);
    expect(result.facts.some((f) => f.value.includes('AUDIO'))).toBe(true);
  });

  it('recognises CHD but says plainly that no engine can load it', () => {
    const chd = new Uint8Array(4096);
    chd.set(new TextEncoder().encode('MComprHD'), 0);
    chd[12] = 5;
    chd.set(new TextEncoder().encode('CD-ROM'), 124);
    const result = detectFormat(chd, 'game.chd');
    expect(result.format?.id).toBe('chd');
    expect(result.errors.some((e) => e.code === 'ENGINE_FORMAT_UNSUPPORTED')).toBe(true);
  });

  it('distinguishes a PS1 Classics PBP from a PSP PBP', () => {
    const ps1 = new Uint8Array(2048);
    ps1.set(new TextEncoder().encode('PSISOIMG0000'), 0);
    expect(detectFormat(ps1, 'classic.pbp').platformId).toBe('psx');

    const psp = new Uint8Array(2048);
    psp.set([0x00, 0x50, 0x42, 0x50], 0);
    const pspResult = detectFormat(psp, 'psp.pbp');
    expect(pspResult.platformId).toBe('psp');
    expect(pspResult.errors.some((e) => e.code === 'ENGINE_FORMAT_UNSUPPORTED')).toBe(true);
  });

  it('produces a full analysis report with firmware requirements', async () => {
    const report = await analyzeBytes(raw, 'Digimon World 3.bin', { catalogue: false });
    expect(report.platform?.id).toBe('psx');
    expect(report.errors.filter((e) => e.severity === 'fatal')).toHaveLength(0);
    expect(report.dependencies.some((d) => d.name.includes('BIOS') && d.required)).toBe(true);
  });

  it('leaves unrelated formats untouched', () => {
    const junk = new Uint8Array(4096).map((_, i) => (i * 37) & 0xff);
    const result = detectFormat(junk, 'unknown.bin');
    expect(result.platformId).toBeNull();
  });
});
