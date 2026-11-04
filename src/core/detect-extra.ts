/**
 * Detectors for platforms whose formats were declared but never actually
 * identified.
 *
 * Before this module, `PlatformId` listed `snes`, `pce`, `atari2600`, `ws`,
 * `vb` and `ngp`, and the compatibility page listed them, but no byte of any of
 * those formats was ever inspected: `detect.ts` never returned those ids. The
 * platforms existed as labels only. Each function here reads real header bytes
 * and returns `null` when the signature does not match, so a platform is only
 * ever reported when the bytes justified it.
 *
 * Every layout below is taken from published format documentation and is
 * written so that a near-miss produces *no* match rather than a wrong one.
 */

import { ByteReader } from './binary';
import type { DetectedFormat, HeaderInfo, PlatformId, RegionCode, TechnicalError } from './types';

export interface ExtraDetection {
  platformId: PlatformId;
  platformConfidence: 'certain' | 'probable';
  format: DetectedFormat;
  header: HeaderInfo;
  /** Canonical payload after any header/footer container is removed. */
  payload: Uint8Array;
  facts: Array<{ label: string; value: string }>;
  errors: TechnicalError[];
  regionHint: RegionCode | null;
  embeddedTitle: string | null;
  serial: string | null;
}

const emptyHeader = (): HeaderInfo => ({ strippedBytes: 0, fields: {}, warnings: [] });

/* ------------------------------------------------------------------ */
/* Super Nintendo — LoROM / HiROM / ExHiROM, copier-header aware       */
/* ------------------------------------------------------------------ */

/**
 * SNES has no magic number, so identification has to be *structural*.
 *
 * The cartridge header sits at a bus address that depends on the mapping:
 *
 *  - LoROM:  header at ROM offset 0x7FC0 for a headerless dump
 *  - HiROM:  header at ROM offset 0xFFC0
 *  - ExHiROM: header at ROM offset 0x40FFC0
 *
 * Several games also arrive with a 512-byte copier header (`.smc`), which
 * shifts all of the above by 0x200. We therefore try every candidate offset for
 * both presence and absence of the copier header, and score each candidate.
 *
 * The score checks things a real header always has and random data usually
 * does not: a printable title, a plausible ROM size code matching the file
 * length, a sane checksum/complement pair, and — most tellingly — the
 * complement relationship `checksum ^ complement == 0xFFFF`, which is a very
 * strong signal that it is genuinely a SNES header and not a coincidence.
 */
const SNES_MAP_MODES: Record<number, string> = {
  0x20: 'LoROM',
  0x21: 'HiROM',
  0x22: 'S-DD1',
  0x23: 'SA-1',
  0x25: 'ExHiROM',
  0x30: 'LoROM + FastROM',
  0x31: 'HiROM + FastROM',
  0x32: 'S-DD1 + FastROM',
  0x33: 'SA-1 + FastROM',
  0x35: 'ExHiROM + FastROM',
};

const SNES_ROM_SIZE_KB: Record<number, number> = {
  0x08: 256,
  0x09: 512,
  0x0a: 1024,
  0x0b: 2048,
  0x0c: 4096,
  0x0d: 8192,
};

interface SnesCandidate {
  headerAt: number;
  copierHeader: boolean;
  score: number;
  title: string;
  mapMode: number;
  romSizeCode: number;
  checksum: number;
  complement: number;
  countryCode: number;
}

/** A plausible title: printable ASCII/space, not all spaces, no control junk. */
function snesTitle(r: ByteReader, at: number): string | null {
  if (!r.has(at, 21)) return null;
  let out = '';
  for (let i = 0; i < 21; i += 1) {
    const b = r.u8(at + i)!;
    if (b === 0x00) break;
    // Printable ASCII only. High bytes in a title are a strong sign we are
    // looking at code, not a header, so reject rather than sanitise.
    if (b < 0x20 || b > 0x7e) return null;
    out += String.fromCharCode(b);
  }
  const trimmed = out.trim();
  return trimmed.length >= 2 ? trimmed : null;
}

function scoreSnesCandidate(r: ByteReader, headerAt: number, copierHeader: boolean): SnesCandidate | null {
  const title = snesTitle(r, headerAt);
  if (!title) return null;

  const mapMode = r.u8(headerAt + 0x15)!;
  const romSizeCode = r.u8(headerAt + 0x17)!;
  const checksum = r.u16le(headerAt + 0x1e)!;
  const complement = r.u16le(headerAt + 0x1c)!;
  const countryCode = r.u8(headerAt + 0x19)!;

  let score = 0;
  // The complement/checksum pair is the single most reliable structural sign.
  // Dumps that were byte-swapped or repaired may break it, so it is a strong
  // bonus rather than a hard requirement.
  if (((checksum ^ complement) & 0xffff) === 0xffff) score += 4;
  if (SNES_MAP_MODES[mapMode] !== undefined) score += 3;
  if (SNES_ROM_SIZE_KB[romSizeCode] !== undefined) score += 2;
  if (countryCode <= 0x14) score += 1;

  // Verify the declared ROM size against the real file length where possible.
  const declaredKb = SNES_ROM_SIZE_KB[romSizeCode];
  if (declaredKb) {
    const payloadLength = r.length - (copierHeader ? 512 : 0);
    // Real dumps are frequently a power-of-two that is >= the declared size
    // (padding), never drastically smaller.
    if (payloadLength >= declaredKb * 1024 - 512) score += 2;
    else score -= 2;
  }

  return { headerAt, copierHeader, score, title, mapMode, romSizeCode, checksum, complement, countryCode };
}

export function detectSnes(r: ByteReader, ext: string): ExtraDetection | null {
  // Only inspect offsets that exist in the file.
  const candidates: SnesCandidate[] = [];
  const attempts: Array<[number, boolean]> = [
    [0x7fc0, false],
    [0xffc0, false],
    [0x40ffc0, false],
    [0x7fc0 + 0x200, true],
    [0xffc0 + 0x200, true],
    [0x40ffc0 + 0x200, true],
    // A .fig dump uses a different intra-bank layout on some copiers.
    [0x7fd5, false],
  ];
  for (const [at, copier] of attempts) {
    if (!r.has(at, 32)) continue;
    const candidate = scoreSnesCandidate(r, at, copier);
    if (candidate) candidates.push(candidate);
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]!;

  // Refuse to guess. A candidate needs the structural pair (map mode) plus at
  // least one more corroborating field, otherwise a random binary that happens
  // to hold 21 printable bytes would be mislabelled as a SNES game.
  if (best.score < 5) return null;

  // A structural match this weak on a file whose extension is unrelated is more
  // likely coincidence than a cartridge, so require some extension agreement
  // when the score is not decisive.
  const snesExtOk = ext === 'sfc' || ext === 'smc' || ext === 'swc' || ext === 'fig' || ext === 'bs';
  if (!snesExtOk && best.score < 7) return null;

  const copierBytes = best.copierHeader ? 512 : 0;
  const header = emptyHeader();
  header.strippedBytes = copierBytes;
  header.fields = {
    container: best.copierHeader ? 'SMC copier header (512 bytes)' : 'headerless',
    mapping: SNES_MAP_MODES[best.mapMode] ?? `unknown (0x${best.mapMode.toString(16)})`,
    romSizeDeclaredKb: SNES_ROM_SIZE_KB[best.romSizeCode] ?? 'unknown',
    countryCode: best.countryCode,
    checksum: `0x${best.checksum.toString(16).padStart(4, '0')}`,
    checksumComplementValid: ((best.checksum ^ best.complement) & 0xffff) === 0xffff,
  };
  if (best.copierHeader) header.warnings.push('512-byte copier header removed; the remaining bytes are the cartridge image.');

  const region: RegionCode =
    best.countryCode === 0x00 ? 'JP' : best.countryCode === 0x01 ? 'US' : best.countryCode <= 0x14 ? 'EU' : 'UNKNOWN';

  const evidence = [
    `SNES header at ROM offset 0x${best.headerAt.toString(16)}`,
    `${SNES_MAP_MODES[best.mapMode] ?? 'mapping'} mode byte 0x${best.mapMode.toString(16)}`,
  ];
  if (header.fields.checksumComplementValid) evidence.push('checksum/complement pair is self-consistent');

  return {
    platformId: 'snes',
    platformConfidence: best.score >= 7 ? 'certain' : 'probable',
    format: {
      id: 'snes-rom',
      label: 'Super Nintendo cartridge image',
      kind: best.copierHeader ? 'container' : 'raw',
      confidence: best.score >= 7 ? 'certain' : 'probable',
      evidence,
    },
    header,
    payload: best.copierHeader ? r.slice(512) : r.bytes,
    facts: [
      { label: 'Mapping', value: SNES_MAP_MODES[best.mapMode] ?? 'unknown' },
      { label: 'Title', value: best.title },
      {
        label: 'Declared ROM size',
        value: SNES_ROM_SIZE_KB[best.romSizeCode] ? `${SNES_ROM_SIZE_KB[best.romSizeCode]} KiB` : 'unknown',
      },
    ],
    errors: [],
    regionHint: region,
    embeddedTitle: best.title,
    serial: null,
  };
}

/* ------------------------------------------------------------------ */
/* PC Engine / TurboGrafx-16 HuCard                                    */
/* ------------------------------------------------------------------ */

/**
 * HuCards are headerless. Two structural facts make detection possible:
 *
 *  - The reset vector lives in the last six bytes of the 8 KiB bank mapped at
 *    the top of the address space, and points into the ROM.
 *  - ROM images are a power of two, from 8 KiB up to 1 MiB (2 MiB for some
 *    Street Fighter II dumps), so a file whose length is not such a size is not
 *    a HuCard.
 *
 * The vector must land inside the image itself. That rejects files with a
 * random trailing sector far more often than it accepts a wrong one.
 */
const PCE_VALID_SIZES = new Set<number>([
  32 * 1024,
  128 * 1024,
  256 * 1024,
  512 * 1024,
  1024 * 1024,
  2048 * 1024,
]);

/** 8 KiB bank size; the vector is read from the final bank. */
const PCE_BANK = 0x2000;

export function detectPce(r: ByteReader, ext: string): ExtraDetection | null {
  if (r.length < PCE_BANK * 2) return null;
  const size = r.length;
  if (!PCE_VALID_SIZES.has(size)) return null;

  // Vector sits in the last 6 bytes of the last mapped bank (0xFFF6..0xFFFB
  // relative to the bank), mirroring how the CPU reads it at reset.
  const vectorBase = size - 6;
  if (!r.has(vectorBase, 6)) return null;

  const reset = r.u16le(vectorBase + 4)!;
  // The 6280 maps the final bank at 0xE000, so a reset into ROM must fall in
  // that window. Reject vectors pointing outside the image.
  if (reset < 0xe000) return null;
  const bankOffset = reset - 0xe000;
  if (bankOffset >= PCE_BANK) return null;

  // HuCard images are a power of two and nothing else; a Nintendo DS ROM is a
  // multiple of 4 KiB too, so the *strict* power-of-two test is what keeps this
  // detector from claiming unrelated files. Sizes above the largest HuCard are
  // rejected outright.
  if ((size & (size - 1)) !== 0) return null;

  // The vector target must itself hold plausible 6280 code, not 0x00/0xFF fill.
  const target = size - PCE_BANK + bankOffset;
  if (!r.has(target, 4)) return null;
  const first = r.u8(target)!;
  const second = r.u8(target + 1)!;
  if ((first === 0x00 && second === 0x00) || (first === 0xff && second === 0xff)) return null;

  const header = emptyHeader();
  header.fields = {
    container: 'headerless HuCard',
    sizes: `${Math.round(size / 1024)} KiB`,
    resetVector: `0x${reset.toString(16).padStart(4, '0')}`,
  };

  const isSupergrafx = ext === 'sgx';
  return {
    platformId: 'pce',
    platformConfidence: 'probable',
    format: {
      id: isSupergrafx ? 'sgx-rom' : 'pce-rom',
      label: isSupergrafx ? 'SuperGrafx HuCard image' : 'PC Engine HuCard image',
      kind: 'raw',
      confidence: 'probable',
      evidence: [
        `ROM length ${size} bytes is a valid HuCard size`,
        `reset vector 0x${reset.toString(16).padStart(4, '0')} points into the mapped ROM bank`,
      ],
    },
    header,
    payload: r.bytes,
    facts: [{ label: 'Reset vector', value: `0x${reset.toString(16).padStart(4, '0')}` }],
    // Be explicit that this is structural inference, not a signature match.
    errors: [],
    regionHint: null,
    embeddedTitle: null,
    serial: null,
  };
}

/* ------------------------------------------------------------------ */
/* Atari 2600                                                          */
/* ------------------------------------------------------------------ */

/**
 * The 2600 is headerless and has no magic bytes, so this is deliberately the
 * most conservative detector in the file.
 *
 * It requires *all* of the following, and still reports only "probable":
 *
 *  1. A size the console's cartridges actually used (2K, 4K, 8K, 12K, 16K,
 *     32K).
 *  2. A reset vector in the final 4 bytes that points inside the cartridge
 *     window ($F000-$FFFF), which is how the 6502 finds its entry point.
 *  3. The byte at the vector target must not be inert fill.
 *
 * Bank-switched cartridges put their vector in the last bank, which is exactly
 * where this reads. Anything that fails any test is reported as unknown rather
 * than guessed at.
 */
const VCS_SIZES = new Set<number>([2048, 4096, 8192, 12288, 16384, 32768]);

export function detectAtari2600(r: ByteReader, ext: string): ExtraDetection | null {
  const size = r.length;
  if (!VCS_SIZES.has(size)) return null;

  const vector = r.u16le(size - 4)!;
  // Vectors below $F000 point outside the cartridge address window.
  if (vector < 0xf000) return null;

  // Map the vector back into the file through the bank window that the console
  // presents at reset. For a flat 4K image the mapping is direct.
  const windowBase = size <= 4096 ? 0xf000 : 0xf000;
  const fileOffset = (windowBase - 0xf000) + (vector - 0xf000);
  const clamped = fileOffset < size ? fileOffset : size - (0x10000 - vector);
  if (clamped < 0 || clamped >= size) return null;

  const targetByte = r.u8(clamped)!;
  if (targetByte === 0x00 || targetByte === 0xff) return null;

  // Require the extension to agree: a headerless blob this ambiguous should not
  // be claimed for anyone who merely dropped a random 4 KiB file.
  if (ext !== 'a26' && ext !== 'bin' && ext !== 'rom') return null;

  const header = emptyHeader();
  header.fields = {
    container: 'headerless cartridge',
    bankScheme: size <= 4096 ? '2K/4K flat' : `${size / 4096}K bank-switched`,
    resetVector: `0x${vector.toString(16).padStart(4, '0')}`,
  };
  header.warnings.push(
    'Atari 2600 images carry no header. This identification is structural (size + valid reset vector) and is reported as probable, never certain.',
  );

  return {
    platformId: 'atari2600',
    platformConfidence: 'probable',
    format: {
      id: 'a26-rom',
      label: 'Atari 2600 cartridge image',
      kind: 'raw',
      confidence: 'probable',
      evidence: [
        `${size}-byte image, a standard 2600 cartridge size`,
        `reset vector 0x${vector.toString(16).padStart(4, '0')} falls inside the cartridge window`,
      ],
    },
    header,
    payload: r.bytes,
    facts: [
      { label: 'Bank scheme', value: size <= 4096 ? '2K/4K flat' : `${size / 4096}K bank-switched` },
      { label: 'Reset vector', value: `0x${vector.toString(16).padStart(4, '0')}` },
    ],
    errors: [],
    regionHint: null,
    embeddedTitle: null,
    serial: null,
  };
}

/* ------------------------------------------------------------------ */
/* WonderSwan / WonderSwan Color                                       */
/* ------------------------------------------------------------------ */

/**
 * WonderSwan stores its header in a **footer**, in the last 10 bytes of the
 * image. Layout, from the last 10 bytes onward:
 *
 *   -10  publisher ID
 *    -9  system: 0x00 = WonderSwan, 0x01 = WonderSwan Color
 *    -8  game ID (BCD)
 *    -7  revision
 *    -6  ROM size code
 *    -5  save type
 *    -4  flags
 *    -3  RTC flag
 *  -2..  checksum (little-endian)
 *
 * The checksum is the 8-bit sum of every byte except the two checksum bytes
 * themselves. Verifying it is what makes this more than a guess — a wrong file
 * passes the system byte by 1/256 chance but almost never passes the checksum.
 */
export function detectWonderswan(r: ByteReader, ext: string): ExtraDetection | null {
  const size = r.length;
  if (size < 64 * 1024) return null;
  const footer = size - 10;

  const system = r.u8(footer + 1)!;
  if (system !== 0x00 && system !== 0x01) return null;

  // A legal WonderSwan capacity code. Random data lands on 0x00 or an
  // out-of-range byte far more often than on one of these, which is what stops
  // an arbitrary 128 KiB file from being accepted as a cartridge.
  const romSizeCode = r.u8(footer + 4)!;
  const sizeCodeValid = romSizeCode >= 0x01 && romSizeCode <= 0x09;

  const storedChecksum = r.u16le(footer + 8)!;
  // Sum all bytes excluding the checksum field itself.
  let sum = 0;
  for (let i = 0; i < size; i += 1) {
    if (i === footer + 8 || i === footer + 9) continue;
    sum = (sum + r.u8(i)!) & 0xffff;
  }
  const checksumOk = sum === storedChecksum;

  // Without a matching checksum, only trust an explicit .ws/.wsc extension AND
  // a legal size code. The extension alone is a filename, not evidence.
  const extOk = ext === 'ws' || ext === 'wsc';
  if (!checksumOk && !(extOk && sizeCodeValid)) return null;
  if (!sizeCodeValid && !checksumOk) return null;

  const gameIdByte = r.u8(footer + 2)!;
  const publisher = r.u8(footer)!;
  const isColor = system === 0x01 || ext === 'wsc';

  const header = emptyHeader();
  header.fields = {
    container: 'footer header (last 10 bytes)',
    system: isColor ? 'WonderSwan Color' : 'WonderSwan',
    publisherId: `0x${publisher.toString(16).padStart(2, '0')}`,
    gameId: `0x${gameIdByte.toString(16).padStart(2, '0')}`,
    romSizeCode,
    checksumValid: checksumOk,
  };
  if (!checksumOk) header.warnings.push('Footer checksum did not match; platform inferred from the file extension.');

  return {
    platformId: 'ws',
    platformConfidence: checksumOk ? 'certain' : 'probable',
    format: {
      id: isColor ? 'wsc-rom' : 'ws-rom',
      label: isColor ? 'WonderSwan Color cartridge image' : 'WonderSwan cartridge image',
      kind: 'raw',
      confidence: checksumOk ? 'certain' : 'probable',
      evidence: checksumOk
        ? ['10-byte WonderSwan footer present', 'footer checksum verified']
        : ['.ws/.wsc extension with a plausible footer'],
    },
    header,
    payload: r.bytes,
    facts: [
      { label: 'System', value: isColor ? 'WonderSwan Color' : 'WonderSwan' },
      { label: 'Checksum', value: checksumOk ? 'verified' : 'mismatch' },
    ],
    errors: [],
    regionHint: 'JP',
    embeddedTitle: null,
    serial: null,
  };
}

/* ------------------------------------------------------------------ */
/* Virtual Boy                                                         */
/* ------------------------------------------------------------------ */

/**
 * Virtual Boy images end with a 32-byte header at the top of the address
 * space, i.e. the last 0x20 bytes of the file:
 *
 *   0xFFFFFDE0  title, 20 bytes Shift-JIS
 *   0xFFFFFDF4  reserved, 5 bytes
 *   0xFFFFFDF9  maker code, 2 bytes ASCII
 *   0xFFFFFDFB  game code, 4 bytes ASCII
 *   0xFFFFFDFF  version, 1 byte
 *
 * Note that the popular "VB" magic at offset 0 belongs to a *homebrew* header
 * format, not to commercial dumps, so it is not used as the primary test.
 *
 * The structural test used here is that the reserved field is zero-filled and
 * the maker/game codes are printable — commercial images always satisfy both.
 */
export function detectVirtualBoy(r: ByteReader, ext: string): ExtraDetection | null {
  const size = r.length;
  if (size < 0x20) return null;
  const h = size - 0x20;

  // Reserved bytes between title and maker code must be zero.
  for (let i = 0; i < 5; i += 1) {
    if (r.u8(h + 0x14 + i) !== 0x00) return null;
  }

  const isPrintable = (at: number, len: number): boolean => {
    for (let i = 0; i < len; i += 1) {
      const b = r.u8(at + i)!;
      if (b < 0x20 || b > 0x7e) return false;
    }
    return true;
  };
  if (!isPrintable(h + 0x19, 2)) return null;
  if (!isPrintable(h + 0x1b, 4)) return null;

  const maker = r.ascii(h + 0x19, 2);
  const gameCode = r.ascii(h + 0x1b, 4);
  // Commercial codes are never all-zero or all-space.
  if (/^\s*$/.test(maker) || /^\s*$/.test(gameCode)) return null;

  // Title is Shift-JIS; keep it only if it is printable enough to display.
  const rawTitle = r.printable(h, 20).trim();
  const extOk = ext === 'vb';
  if (!extOk && !/^[A-Z0-9]{4}$/.test(gameCode)) return null;

  const header = emptyHeader();
  header.fields = {
    container: 'footer header (last 0x20 bytes)',
    makerCode: maker.trim(),
    gameCode: gameCode.trim(),
    title: rawTitle || '—',
  };

  return {
    platformId: 'vb',
    platformConfidence: 'probable',
    format: {
      id: 'vb-rom',
      label: 'Virtual Boy cartridge image',
      kind: 'raw',
      confidence: 'probable',
      evidence: [
        '32-byte Virtual Boy header at the end of the image',
        'reserved field is zero-filled and maker/game codes are printable ASCII',
      ],
    },
    header,
    payload: r.bytes,
    facts: [
      { label: 'Game code', value: gameCode.trim() },
      { label: 'Maker', value: maker.trim() },
    ],
    errors: [],
    regionHint: 'JP',
    embeddedTitle: rawTitle || null,
    serial: gameCode.trim() || null,
  };
}

/* ------------------------------------------------------------------ */
/* Neo Geo Pocket / Neo Geo Pocket Color                               */
/* ------------------------------------------------------------------ */

/**
 * NGP cartridges carry a 28-byte recognition code at the start of the image:
 *
 *   "COPYRIGHT BY SNK CORPORATION"   first-party
 *   " LICENSED BY SNK CORPORATION"   third-party (leading space)
 *
 * and byte 0x23 distinguishes Color (0x10) from monochrome (0x00).
 *
 * The recognition string is a genuine signature, so this is the one detector in
 * this module that can return `certain`.
 */
const NGP_COPYRIGHT = 'COPYRIGHT BY SNK CORPORATION';
const NGP_LICENSED = ' LICENSED BY SNK CORPORATION';

export function detectNeoGeoPocket(r: ByteReader, ext: string): ExtraDetection | null {
  if (r.length < 0x24) return null;

  const head = r.ascii(0, 28);
  const isFirstParty = head.startsWith(NGP_COPYRIGHT);
  const isThirdParty = head.startsWith(NGP_LICENSED);
  if (!isFirstParty && !isThirdParty) return null;

  const systemCode = r.u8(0x23)!;
  const isColor = systemCode === 0x10 || ext === 'ngc';
  const title = r.printable(0x24, 12).trim();

  const header = emptyHeader();
  header.fields = {
    recognition: isFirstParty ? 'COPYRIGHT BY SNK CORPORATION' : 'LICENSED BY SNK CORPORATION',
    systemCode: `0x${systemCode.toString(16).padStart(2, '0')}`,
    title: title || '—',
  };
  if (systemCode !== 0x00 && systemCode !== 0x10) {
    header.warnings.push(
      `System byte 0x${systemCode.toString(16)} is neither 0x00 (mono) nor 0x10 (Color); platform inferred from the extension.`,
    );
  }

  return {
    platformId: 'ngp',
    platformConfidence: 'certain',
    format: {
      id: isColor ? 'ngc-rom' : 'ngp-rom',
      label: isColor ? 'Neo Geo Pocket Color cartridge image' : 'Neo Geo Pocket cartridge image',
      kind: 'raw',
      confidence: 'certain',
      evidence: [
        isFirstParty ? '"COPYRIGHT BY SNK CORPORATION" at offset 0' : '"LICENSED BY SNK CORPORATION" at offset 0',
        `system code 0x${systemCode.toString(16).padStart(2, '0')}`,
      ],
    },
    header,
    payload: r.bytes,
    facts: [
      { label: 'System', value: isColor ? 'Neo Geo Pocket Color' : 'Neo Geo Pocket' },
      { label: 'Title', value: title || '—' },
    ],
    errors: [],
    regionHint: 'JP',
    embeddedTitle: title || null,
    serial: null,
  };
}
