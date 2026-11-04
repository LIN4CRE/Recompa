/**
 * Recompa Self-Test Cartridge — generated entirely in code.
 *
 * Why this exists: Recompa must prove its own NES pipeline works (iNES parsing →
 * CPU reset vector → PPU rendering → NMI/vblank handling → palette writes)
 * without shipping or downloading somebody else's ROM. Every byte is authored
 * here, so the artefact is Recompa's own work under the project licence.
 *
 * Program behaviour:
 *   1. wait two vblanks (PPU warm-up),
 *   2. disable rendering; upload a background palette; fill the nametable with a
 *      striped tile from CHR ROM,
 *   3. enable NMI + background rendering,
 *   4. every NMI: cycle the background palette from a 16-entry table, so each
 *      produced frame is measurably different from the last.
 *
 * A passing self-test therefore proves header parsing, CPU execution, PPU
 * timing, VRAM addressing, palette output and interrupt handling.
 *
 * The program is assembled by the small local assembler below, which resolves
 * labels in two passes. Hand-counted branch offsets are a classic source of
 * silent ROM bugs, so they are computed instead of typed.
 */

const PRG_BANK = 16 * 1024;
const CHR_BANK = 8 * 1024;
const CODE_ORG = 0xc000;

/** Minimal 6502 assembler: only the opcodes this cartridge needs. */
class Assembler {
  private code: number[] = [];
  private labels = new Map<string, number>();
  private fixups: Array<{ at: number; label: string; relative: boolean }> = [];

  constructor(private readonly origin: number) {}

  private get pc(): number {
    return this.origin + this.code.length;
  }

  label(name: string): this {
    this.labels.set(name, this.pc);
    return this;
  }

  /** Emit raw opcode bytes, optionally referencing a label operand. */
  op(...bytes: number[]): this {
    this.code.push(...bytes);
    return this;
  }

  /** Absolute addressing (little-endian) with an optional label fixup. */
  abs(opcode: number, address: number | string): this {
    this.op(opcode, 0x00, 0x00);
    if (typeof address === 'string') {
      this.fixups.push({ at: this.code.length - 2, label: address, relative: false });
    } else {
      this.code[this.code.length - 2] = address & 0xff;
      this.code[this.code.length - 1] = (address >> 8) & 0xff;
    }
    return this;
  }

  /** Relative branch with a label fixup. */
  branch(opcode: number, label: string): this {
    this.op(opcode, 0x00);
    this.fixups.push({ at: this.code.length - 1, label, relative: true });
    return this;
  }

  jmp(label: string): this {
    return this.abs(0x4c, label);
  }

  assemble(): Uint8Array {
    for (const fixup of this.fixups) {
      const target = this.labels.get(fixup.label);
      if (target === undefined) throw new Error(`testrom: undefined label "${fixup.label}"`);
      if (fixup.relative) {
        // Relative offsets are measured from the instruction *after* the branch.
        const nextInstruction = this.origin + fixup.at + 1;
        const delta = target - nextInstruction;
        if (delta < -128 || delta > 127) {
          throw new Error(`testrom: branch to "${fixup.label}" is out of range (${delta})`);
        }
        this.code[fixup.at] = delta & 0xff;
      } else {
        this.code[fixup.at] = target & 0xff;
        this.code[fixup.at + 1] = (target >> 8) & 0xff;
      }
    }
    return new Uint8Array(this.code);
  }
}

/** 16 background palettes: each row cycles the stripes through a bright ramp. */
function paletteCycleTable(): number[] {
  const rows = [
    [0x0f, 0x01, 0x11, 0x21],
    [0x0f, 0x02, 0x12, 0x22],
    [0x0f, 0x03, 0x13, 0x23],
    [0x0f, 0x04, 0x14, 0x24],
    [0x0f, 0x05, 0x15, 0x25],
    [0x0f, 0x06, 0x16, 0x26],
    [0x0f, 0x07, 0x17, 0x27],
    [0x0f, 0x08, 0x18, 0x28],
    [0x0f, 0x09, 0x19, 0x29],
    [0x0f, 0x0a, 0x1a, 0x2a],
    [0x0f, 0x0b, 0x1b, 0x2b],
    [0x0f, 0x0c, 0x1c, 0x2c],
    [0x0f, 0x11, 0x21, 0x31],
    [0x0f, 0x12, 0x22, 0x32],
    [0x0f, 0x13, 0x23, 0x33],
    [0x0f, 0x14, 0x24, 0x34],
  ];
  return rows.flat();
}

function buildPrg(): Uint8Array {
  const prg = new Uint8Array(PRG_BANK * 2);
  const a = new Assembler(CODE_ORG);

  // ---------------------------------------------------------------- reset
  a.label('reset')
    .op(0x78) // SEI
    .op(0xd8) // CLD
    .op(0xa2, 0xff) // LDX #$FF
    .op(0x9a) // TXS
    .op(0xa9, 0x00) // LDA #$00
    .op(0x85, 0x00); // STA $00        frame counter

  // wait for two vblanks: bit $2002 / bpl -5
  for (let i = 0; i < 2; i++) {
    a.op(0x2c, 0x02, 0x20).branch(0x10, 'vblankWait').label('vblankWait');
  }

  // rendering off while we set up VRAM
  a.op(0xa9, 0x00).abs(0x8d, 0x2000).abs(0x8d, 0x2001);

  // palette: $3F00 <- table (16 bytes)
  a.op(0xa9, 0x3f).abs(0x8d, 0x2006).op(0xa9, 0x00).abs(0x8d, 0x2006).op(0xa2, 0x00);
  a.label('palLoop').abs(0xbd, 'paletteData').abs(0x8d, 0x2007).op(0xe8).op(0xe0, 0x10).branch(0xd0, 'palLoop');

  // nametable fill: $2000 <- 960 zeros (tile 0), written 256 at a time
  a.op(0xa9, 0x20).abs(0x8d, 0x2006).op(0xa9, 0x00).abs(0x8d, 0x2006)
    .op(0xa9, 0x00) // LDA #$00 (tile index)
    .op(0xa2, 0x00) // LDX #$00
    .label('fillLoop')
    .abs(0x8d, 0x2007) // STA $2007
    .op(0xe8) // INX
    .branch(0xd0, 'fillLoop')
    .op(0xc8) // INY
    .op(0xc0, 0x04) // CPY #$04
    .branch(0xd0, 'fillLoop');

  // enable NMI + background rendering
  a.op(0xa9, 0x80).abs(0x8d, 0x2000).op(0xa9, 0x1e).abs(0x8d, 0x2001);

  // idle loop (all work happens in NMI)
  a.label('idle').jmp('idle');

  // ---------------------------------------------------------------- NMI
  // Cycle the background palette row every frame so consecutive frames differ.
  a.label('nmi')
    .op(0x48) // PHA
    .op(0xe6, 0x00) // INC $00
    .op(0xa9, 0x3f).abs(0x8d, 0x2006) // $2006 = $3F00
    .op(0xa9, 0x00).abs(0x8d, 0x2006)
    .op(0xa5, 0x00) // LDA $00
    .op(0x29, 0x0f) // AND #$0F  → row index 0..15
    .op(0x0a).op(0x0a) // ASL A; ASL A → *4 (four bytes per palette row)
    .op(0xaa) // TAX
    .op(0xa0, 0x04) // LDY #$04  (bytes remaining)
    .label('palCopy')
    .abs(0xbd, 'cycleTable') // LDA cycleTable,X
    .abs(0x8d, 0x2007) // STA $2007
    .op(0xe8) // INX
    .op(0x88) // DEY
    .branch(0xd0, 'palCopy')
    // restore VRAM address to $0000 so the next frame renders from the top-left
    .op(0xa9, 0x00).abs(0x8d, 0x2006).abs(0x8d, 0x2006)
    .op(0x68) // PLA
    .op(0x40); // RTI

  // ------------------------------------------------------------- data
  a.label('paletteData').op(...paletteCycleTable().slice(0, 16));
  a.label('cycleTable').op(...paletteCycleTable());

  const code = a.assemble();
  // Second 16 KiB PRG bank is mapped at $C000; copy the code there.
  prg.set(code, 0x4000 + (CODE_ORG - 0xc000));

  // IRQ/NMI/RESET vectors at $FFFA-$FFFF.
  const vectors = { nmi: a['labels'].get('nmi')!, reset: a['labels'].get('reset')!, irq: a['labels'].get('reset')! };
  const vec = 0x4000 + 0x3ffa;
  const write = (at: number, addr: number) => {
    prg[at] = addr & 0xff;
    prg[at + 1] = (addr >> 8) & 0xff;
  };
  write(vec, vectors.nmi);
  write(vec + 2, vectors.reset);
  write(vec + 4, vectors.irq);
  return prg;
}

function buildChr(): Uint8Array {
  // Tile 0: vertical one-pixel stripes using colour 1/2, so the palette cycle
  // is obvious both to a human and to the frame-signature check.
  const chr = new Uint8Array(CHR_BANK);
  for (let row = 0; row < 8; row++) {
    chr[row] = 0b10101010; // plane 0
    chr[row + 8] = 0b01010101; // plane 1
  }
  return chr;
}

/** Full iNES image: 16-byte header + 32 KiB PRG + 8 KiB CHR. */
export function buildTestRom(): Uint8Array {
  const prg = buildPrg();
  const chr = buildChr();
  const rom = new Uint8Array(16 + prg.length + chr.length);
  // iNES header: NROM-256 (mapper 0), vertical mirroring, no battery, no trainer.
  rom.set([0x4e, 0x45, 0x53, 0x1a, 2, 1, 0x01, 0x00, 0, 0, 0, 0, 0, 0, 0, 0], 0);
  rom.set(prg, 16);
  rom.set(chr, 16 + prg.length);
  return rom;
}

export const TEST_ROM_NAME = 'recompa-selftest.nes';

export const TEST_ROM_META = {
  name: 'Recompa Self-Test Cartridge',
  platform: 'nes' as const,
  mapper: 0,
  prgBytes: PRG_BANK * 2,
  chrBytes: CHR_BANK,
  purpose: 'Engine self-verification: boot, PPU output, NMI handling, palette animation.',
  licence: 'Generated by Recompa source (MIT) — contains no third-party ROM data.',
};
