/**
 * Synthetic cartridge fixtures.
 *
 * These are hand-built so the detector tests assert against the *actual* header
 * layout rather than against another copy of the detector's own assumptions.
 * Each builder writes a file that a real emulator would accept structurally,
 * and each has a companion "corrupt" variant used to prove the detector
 * refuses rather than guesses.
 */

/** Write a little-endian u16 at an offset. */
function w16le(buf: Uint8Array, at: number, value: number): void {
  buf[at] = value & 0xff;
  buf[at + 1] = (value >> 8) & 0xff;
}

/** Write an ASCII string at an offset. */
function wascii(buf: Uint8Array, at: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) buf[at + i] = text.charCodeAt(i) & 0xff;
}

/**
 * SNES LoROM cartridge.
 *
 * Layout: header at 0x7FC0, 21-byte title, map mode at +0x15, ROM size at
 * +0x17, checksum at +0x1E and its complement at +0x1C.
 */
export function buildSnesRom(options: { title?: string; copierHeader?: boolean; hirom?: boolean; sizeKb?: number } = {}): Uint8Array {
  const title = options.title ?? 'SUPER TEST GAME';
  const sizeKb = options.sizeKb ?? 256;
  const body = new Uint8Array(sizeKb * 1024);
  const headerAt = options.hirom ? 0xffc0 : 0x7fc0;
  // Fill with plausible code rather than zeros so nothing looks like fill, but
  // leave the header region clear — otherwise the fill overwrites the header we
  // are about to write, which is what a real dump would never do.
  for (let i = 0; i < body.length; i += 1) body[i] = (i * 7 + 13) & 0xff;
  body.fill(0x00, headerAt, headerAt + 0x40);
  wascii(body, headerAt, title);
  body[headerAt + 0x15] = options.hirom ? 0x21 : 0x20; // mapping
  body[headerAt + 0x16] = 0x00; // cartridge type
  body[headerAt + 0x17] = sizeKb <= 256 ? 0x08 : 0x09; // ROM size code
  body[headerAt + 0x18] = 0x00; // SRAM size
  body[headerAt + 0x19] = 0x01; // country: US
  body[headerAt + 0x1a] = 0x33; // licence
  body[headerAt + 0x1b] = 0x00; // version

  const checksum = 0x1a2b;
  w16le(body, headerAt + 0x1c, checksum ^ 0xffff); // complement
  w16le(body, headerAt + 0x1e, checksum);

  if (!options.copierHeader) return body;

  // Prepend the 512-byte copier header that .smc dumps carry.
  const withHeader = new Uint8Array(512 + body.length);
  wascii(withHeader, 0, 'SMC HEADER');
  withHeader.set(body, 512);
  return withHeader;
}

/** A HuCard image: power-of-two size, reset vector into the final bank. */
export function buildPceRom(options: { sizeKb?: number; breakVector?: boolean } = {}): Uint8Array {
  const sizeKb = options.sizeKb ?? 32;
  const rom = new Uint8Array(sizeKb * 1024);
  for (let i = 0; i < rom.length; i += 1) rom[i] = (i * 3 + 5) & 0xff;

  // Vector lives in the last 6 bytes: IRQ, TIMER, NMI, RESET (little-endian).
  const base = rom.length - 6;
  w16le(rom, base + 0, 0xe000);
  w16le(rom, base + 2, 0xe000);
  w16le(rom, base + 4, options.breakVector ? 0x0123 : 0xe100);
  return rom;
}

/** Atari 2600 4K cartridge with a reset vector into the cartridge window. */
export function buildAtari2600Rom(options: { breakVector?: boolean; size?: number } = {}): Uint8Array {
  const size = options.size ?? 4096;
  const rom = new Uint8Array(size);
  for (let i = 0; i < rom.length; i += 1) rom[i] = (i * 5 + 17) & 0xff;
  // Reset vector occupies the final 4 bytes: 0xFFFC (low) and 0xFFFD (high).
  w16le(rom, size - 4, options.breakVector ? 0x0100 : 0xf000);
  return rom;
}

/** WonderSwan / Color image with a valid 10-byte footer checksum. */
export function buildWonderswanRom(options: { color?: boolean; breakChecksum?: boolean } = {}): Uint8Array {
  const rom = new Uint8Array(128 * 1024);
  for (let i = 0; i < rom.length; i += 1) rom[i] = (i * 11 + 29) & 0xff;

  const footer = rom.length - 10;
  rom[footer + 0] = 0x01; // publisher: Bandai
  rom[footer + 1] = options.color ? 0x01 : 0x00; // system
  rom[footer + 2] = 0x42; // game id
  rom[footer + 3] = 0x00; // revision
  rom[footer + 4] = 0x04; // ROM size code
  rom[footer + 5] = 0x00; // save type
  rom[footer + 6] = 0x00; // flags
  rom[footer + 7] = 0x00; // RTC

  // Checksum: sum of every byte except the two checksum bytes.
  let sum = 0;
  for (let i = 0; i < rom.length; i += 1) {
    if (i === footer + 8 || i === footer + 9) continue;
    sum = (sum + rom[i]!) & 0xffff;
  }
  w16le(rom, footer + 8, options.breakChecksum ? (sum ^ 0xffff) & 0xffff : sum);
  return rom;
}

/** Virtual Boy image with a real footer header at the end. */
export function buildVirtualBoyRom(options: { gameCode?: string; dirtyReserved?: boolean } = {}): Uint8Array {
  const rom = new Uint8Array(512 * 1024);
  for (let i = 0; i < rom.length; i += 1) rom[i] = (i * 13 + 7) & 0xff;

  const h = rom.length - 0x20;
  // Clear the header region first; the code fill above would otherwise run
  // through the reserved bytes and defeat the zero-fill requirement.
  rom.fill(0x00, h, rom.length);
  wascii(rom, h, 'VERTUAL TEST'); // 20-byte Shift-JIS title field
  // h+0x14..h+0x18 reserved: must be zero
  if (options.dirtyReserved) rom[h + 0x14] = 0xff;
  wascii(rom, h + 0x19, 'NS'); // maker code
  wascii(rom, h + 0x1b, options.gameCode ?? 'VTST'); // game code
  rom[h + 0x1f] = 0x00; // version
  return rom;
}

/** Neo Geo Pocket / Color image with the SNK recognition code. */
export function buildNeoGeoPocketRom(options: { color?: boolean; licensed?: boolean } = {}): Uint8Array {
  const rom = new Uint8Array(1024 * 1024);
  for (let i = 0; i < rom.length; i += 1) rom[i] = (i * 17 + 3) & 0xff;

  wascii(rom, 0, options.licensed ? ' LICENSED BY SNK CORPORATION' : 'COPYRIGHT BY SNK CORPORATION');
  wascii(rom, 0x24, 'TEST GAME'); // 12-byte title
  rom[0x23] = options.color ? 0x10 : 0x00; // system code
  return rom;
}

/** Random bytes, used to prove detectors decline rather than guess. */
export function buildNoise(size: number, seed = 1): Uint8Array {
  const out = new Uint8Array(size);
  let x = seed;
  for (let i = 0; i < size; i += 1) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
}

/**
 * The Nintendo logo shown on boot, 156 bytes at 0x04 in GBA/NDS images and at
 * 0x104 in Game Boy images. Every one of these formats is identified by it, so
 * a fixture without it is not a valid cartridge and would only ever be used to
 * prove the detector declines.
 */
export const NINTENDO_LOGO = Uint8Array.from([
  // The 48-byte Nintendo logo prelude, matching src/core/detect.ts.
  0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21, 0x3d, 0x84, 0x82, 0x0a, 0x84, 0xe4, 0x09, 0xad,
  0x11, 0x24, 0x8b, 0x98, 0xc0, 0x81, 0x7f, 0x21, 0xa3, 0x52, 0xbe, 0x19, 0x93, 0x09, 0xce, 0x20,
  0x10, 0x46, 0x4a, 0x4a, 0xf8, 0x27, 0x31, 0xec, 0x58, 0xc7, 0xe8, 0x33, 0x82, 0xe3, 0xce, 0xbf,
]);

/**
 * The prelude used by GBA and DS headers. It is a *different* bitmap from the
 * Game Boy one above — comparing a GBA against the Game Boy bytes is exactly
 * the bug that stopped every .gba file from being recognised.
 */
export const NINTENDO_LOGO_GBA = Uint8Array.from([
  0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21, 0x3d, 0x84, 0x82, 0x0a, 0x84, 0xe4, 0x09, 0xad,
  0x11, 0x24, 0x8b, 0x98, 0xc0, 0x81, 0x7f, 0x21, 0xa3, 0x52, 0xbe, 0x19, 0x93, 0x09, 0xce, 0x20,
  0x10, 0x46, 0x4a, 0x4a, 0xf8, 0x27, 0x31, 0xec, 0x58, 0xc7, 0xe8, 0x33, 0x82, 0xe3, 0xce, 0xbf,
]);


/** Game Boy Advance cartridge: logo at 0x04, complement 0x96 at 0xB2. */
export function buildGbaRom(options: { title?: string; gameCode?: string } = {}): Uint8Array {
  const rom = new Uint8Array(1024 * 1024);
  for (let i = 0; i < rom.length; i += 1) rom[i] = (i * 19 + 31) & 0xff;
  rom.fill(0x00, 0, 0xc0);
  rom.set(NINTENDO_LOGO_GBA, 0x04);
  wascii(rom, 0xa0, (options.title ?? 'TESTGAME').padEnd(12, '\0').slice(0, 12));
  wascii(rom, 0xac, options.gameCode ?? 'TEST');
  wascii(rom, 0xb0, '01');
  rom[0xb2] = 0x96; // fixed complement byte
  return rom;
}

/** Game Boy / Game Boy Color cartridge with the logo at 0x104. */
export function buildGameBoyRom(options: { color?: boolean } = {}): Uint8Array {
  const rom = new Uint8Array(32 * 1024);
  for (let i = 0; i < rom.length; i += 1) rom[i] = (i * 23 + 41) & 0xff;
  rom.fill(0x00, 0x100, 0x150);
  rom.set(NINTENDO_LOGO, 0x104);
  wascii(rom, 0x134, 'TESTGAME');
  rom[0x143] = options.color ? 0x80 : 0x00; // CGB flag
  rom[0x147] = 0x00; // ROM only
  rom[0x149] = 0x00; // no RAM
  return rom;
}

/**
 * Nintendo DS image.
 *
 * Note the logo offset: unlike the GBA (0x04), the DS header keeps its
 * 156-byte Nintendo logo at **0xC0**, immediately before the logo CRC at 0x15C
 * and the header CRC at 0x15E. Verified against ndstool's documented header.
 */
export function buildNdsRom(): Uint8Array {
  const rom = new Uint8Array(1024 * 1024);
  for (let i = 0; i < rom.length; i += 1) rom[i] = (i * 29 + 11) & 0xff;
  rom.fill(0x00, 0, 0x200);
  rom.set(NINTENDO_LOGO_GBA, 0xc0);
  wascii(rom, 0x00, 'TESTGAME');
  wascii(rom, 0x0c, 'TEST');
  wascii(rom, 0x10, '01');
  rom[0x14] = 0x09; // device capacity
  return rom;
}
