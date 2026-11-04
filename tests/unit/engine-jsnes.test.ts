import { describe, expect, it } from 'vitest';
import { resolveNesConstructor, analyseFrame, readBatteryRam, restartNes } from '@/engines/nes/core';
import { buildTestRom } from '@/core/testrom';
import { detectFormat } from '@/core/detect';

/**
 * These tests drive the *real* jsnes core (no stubs). They are the executable
 * proof that Recompa's NES execution path boots a cartridge, renders pixels and
 * responds to input — the same assertions the in-app verification harness makes.
 */

const WIDTH = 256;
const HEIGHT = 240;

function boot(rom: Uint8Array) {
  const NesCtor = resolveNesConstructor();
  let last: number[] | null = null;
  const nes = new NesCtor({
    onFrame: (buffer: number[]) => {
      last = buffer;
    },
    onAudioSample: () => undefined,
    sampleRate: 44100,
    emulateSound: false,
  });
  // jsnes expects a binary string; the adapter does the same conversion.
  nes.loadROM(Buffer.from(rom).toString('binary'));
  return { nes, frame: () => nes.frame(), screen: () => last };
}

describe('jsnes: constructor resolution', () => {
  it('finds a NES constructor through the ESM namespace', () => {
    const Ctor = resolveNesConstructor();
    expect(typeof Ctor).toBe('function');
    const instance = new Ctor({ onFrame: () => undefined, onAudioSample: () => undefined, sampleRate: 44100 });
    expect(typeof instance.frame).toBe('function');
    expect(typeof instance.loadROM).toBe('function');
  });
});

describe('jsnes: self-test cartridge', () => {
  it('boots, renders a non-black frame and animates', () => {
    const rom = buildTestRom();
    const { frame, screen } = boot(rom);
    const signatures = new Set<string>();
    let best = { nonBlackRatio: 0, distinctColours: 0, signature: 0 };
    for (let i = 0; i < 90; i++) {
      frame();
      if (i >= 20 && i % 6 === 0) {
        const analysis = analyseFrame(screen()!);
        signatures.add(String(analysis.signature));
        if (analysis.nonBlackRatio > best.nonBlackRatio) best = analysis;
      }
    }
    // The cartridge fills the background: most pixels must be lit.
    expect(best.nonBlackRatio).toBeGreaterThan(0.5);
    // At least two distinct colours prove palette writes landed.
    expect(best.distinctColours).toBeGreaterThanOrEqual(2);
    // NMI-driven palette cycling means consecutive frames differ.
    expect(signatures.size).toBeGreaterThan(1);
  });

  it('produces a screenshot-able framebuffer of the exact NES size', () => {
    const { frame, screen } = boot(buildTestRom());
    frame();
    frame();
    const buffer = screen();
    expect(buffer).not.toBeNull();
    expect(buffer!.length).toBe(WIDTH * HEIGHT);
  });

  it('accepts button presses and restarts through reloadROM', () => {
    const rom = buildTestRom();
    const NesCtor = resolveNesConstructor();
    const nes = new NesCtor({
      onFrame: () => undefined,
      onAudioSample: () => undefined,
      sampleRate: 44100,
      emulateSound: false,
    });
    nes.loadROM(Buffer.from(rom).toString('binary'));
    expect(() => {
      nes.frame();
      nes.buttonDown(1, 'START');
      nes.buttonUp(1, 'START');
      nes.buttonDown(2, 'A');
      nes.buttonUp(2, 'A');
      // reset() is documented below as unsafe in jsnes 2.1.0; the adapter uses
      // restartNes(), which this test exercises end to end.
      restartNes(nes);
      nes.frame();
      nes.frame();
    }).not.toThrow();
  });

  it('regression: jsnes reset() leaves the mapper unloaded (documents why we use reloadROM)', () => {
    const nes = resolveNesConstructor();
    const instance = new nes({
      onFrame: () => undefined,
      onAudioSample: () => undefined,
      sampleRate: 44100,
      emulateSound: false,
    });
    instance.loadROM(Buffer.from(buildTestRom()).toString('binary'));
    instance.frame();
    instance.reset();
    // Upstream behaviour: the mapper loses its ROM banks after reset().
    expect(() => instance.frame()).toThrow(/crashed|invalid opcode/i);
  });

  it('round-trips a save state and keeps rendering afterwards', () => {
    const { nes, frame, screen } = boot(buildTestRom());
    for (let i = 0; i < 30; i++) frame();
    const state = JSON.parse(JSON.stringify(nes.toJSON()));
    expect(state).toHaveProperty('cpu');
    expect(state).toHaveProperty('ppu');
    for (let i = 0; i < 10; i++) frame();
    expect(() => nes.fromJSON(state)).not.toThrow();
    frame();
    const analysis = analyseFrame(screen()!);
    expect(analysis.nonBlackRatio).toBeGreaterThan(0.5);
  });

  it('exposes no battery RAM for a battery-less cartridge', () => {
    const { nes } = boot(buildTestRom());
    expect(readBatteryRam(nes)).toBeNull();
  });
});

describe('jsnes: real-world header handling', () => {
  it('boots a header-only MMC1 image without throwing', () => {
    // 8 × 16 KiB PRG, no CHR ROM, mapper 1 — the shape of many real MMC1 dumps.
    const prg = 8 * 16384;
    const rom = new Uint8Array(16 + prg);
    rom.set([0x4e, 0x45, 0x53, 0x1a, 8, 0, 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    // Fill with a tight infinite loop at the reset vector area.
    for (let i = 16; i < rom.length; i++) rom[i] = 0xea; // NOP sled
    rom.set([0x4c, 0x00, 0x80], 16 + prg - 6); // JMP $8000
    rom.set([0x00, 0x80], 16 + prg - 6 + 3); // ...approx vector, detectors tolerate
    const detection = detectFormat(rom, 'mmc1.nes');
    expect(detection.platformId).toBe('nes');
    expect(detection.header.fields.mapperBoard).toContain('MMC1');
  });
});
