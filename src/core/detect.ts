import { ByteReader, asciiBytes as A, formatBytes } from './binary';
import type {
  DetectedFormat,
  HeaderInfo,
  PlatformId,
  RegionCode,
  TechnicalError,
} from './types';
import { extensionOf } from './platforms';

export interface DetectionResult {
  platformId: PlatformId | null;
  platformConfidence: 'certain' | 'probable' | 'unknown';
  format: DetectedFormat | null;
  header: HeaderInfo;
  /** Canonical payload (header stripped) — this is what gets hashed + stored. */
  payload: Uint8Array;
  facts: Array<{ label: string; value: string }>;
  errors: TechnicalError[];
  /** Region hint from headers (GB, SMD, iNES...). */
  regionHint: RegionCode | null;
  /** Embedded title when the format provides one. */
  embeddedTitle: string | null;
  /** Serial/product code (GBA, NDS, N64 cart id...). */
  serial: string | null;
}

const err = (
  code: string,
  severity: TechnicalError['severity'],
  message: string,
  remedy?: string,
  detail?: string,
): TechnicalError => ({ code, severity, message, remedy, detail });

const emptyHeader = (): HeaderInfo => ({ strippedBytes: 0, fields: {}, warnings: [] });

/* ------------------------------------------------------------------ */
/* NES — iNES / NES 2.0 / UNIF / FDS                                   */
/* ------------------------------------------------------------------ */

const NES_MAPPER_NAMES: Record<number, string> = {
  0: 'NROM',
  1: 'MMC1',
  2: 'UxROM',
  3: 'CNROM',
  4: 'MMC3 / MMC6',
  5: 'MMC5',
  7: 'AxROM',
  9: 'MMC2',
  10: 'MMC4',
  11: 'Color Dreams',
  13: 'CPROM',
  16: 'Bandai FCG',
  18: 'Jaleco SS88006',
  19: 'Namco 163',
  21: 'VRC4a/c',
  22: 'VRC2a',
  23: 'VRC2b/VRC4e',
  24: 'VRC6a',
  25: 'VRC4b/d',
  26: 'VRC6b',
  32: 'Irem G-101',
  33: 'Taito TC0190',
  34: 'BNROM / NINA-001',
  64: 'Rambo-1',
  66: 'GxROM',
  69: 'Sunsoft FME-7',
  71: 'Camerica',
  75: 'VRC1',
  79: 'NINA-03/06',
  85: 'VRC7',
  118: 'TxSROM',
  119: 'TQROM',
  140: 'Jaleco JF-11/14',
  180: 'UNROM 512',
  206: 'Namco 108/118',
  210: 'Namco 175/340',
  232: 'Camerica Quattro',
};

function detectNes(r: ByteReader, ext: string): DetectionResult | null {
  const header = emptyHeader();
  const facts: Array<{ label: string; value: string }> = [];

  if (r.startsWith(0, A('NESM'))) {
    return {
      platformId: 'nes',
      platformConfidence: 'certain',
      format: {
        id: 'ines',
        label: 'iNES / NES 2.0 cartridge image',
        kind: 'container',
        confidence: 'certain',
        evidence: ['Magic bytes "NES\\x1A" at offset 0'],
      },
      header,
      payload: r.bytes,
      facts,
      errors: [],
      regionHint: null,
      embeddedTitle: null,
      serial: null,
    };
  }

  if (r.startsWith(0, A('UNIF'))) {
    header.fields.container = 'UNIF';
    return {
      platformId: 'nes',
      platformConfidence: 'certain',
      format: {
        id: 'unif',
        label: 'UNIF cartridge image',
        kind: 'container',
        confidence: 'certain',
        evidence: ['Magic bytes "UNIF" at offset 0'],
      },
      header,
      payload: r.bytes,
      facts: [{ label: 'Container', value: 'UNIF (mapper in CHR/board chunk, not iNES)' }],
      errors: [],
      regionHint: null,
      embeddedTitle: null,
      serial: null,
    };
  }

  if (r.startsWith(0, A('FDS\x1a'))) {
    header.fields.container = 'FDS';
    return {
      platformId: 'nes',
      platformConfidence: 'certain',
      format: {
        id: 'fds',
        label: 'Famicom Disk System image',
        kind: 'container',
        confidence: 'certain',
        evidence: ['Magic bytes "FDS\\x1A" at offset 0'],
      },
      header,
      payload: r.bytes,
      facts: [{ label: 'Media', value: 'Famicom Disk System disk image' }],
      errors: [],
      regionHint: 'JP',
      embeddedTitle: null,
      serial: null,
    };
  }

  const b0 = r.u8(0);
  const b1 = r.u8(1);
  const b2 = r.u8(2);
  const b3 = r.u8(3);
  const hasMagic = b0 === 0x4e && b1 === 0x45 && b2 === 0x53 && b3 === 0x1a;
  if (!hasMagic) {
    // Headerless .nes is common; only claim NES when the extension says so and
    // the size is a plausible power-of-two cartridge size.
    if (ext === 'nes' || ext === 'fds') {
      const powerOfTwoish = (r.length & (r.length - 1)) === 0 || r.length % 8192 === 0;
      if (powerOfTwoish && r.length >= 8192) {
        return {
          platformId: 'nes',
          platformConfidence: 'probable',
          format: {
            id: 'nes-raw',
            label: 'Headerless NES image (no iNES header)',
            kind: 'raw',
            confidence: 'probable',
            evidence: [
              `.nes extension with no iNES magic`,
              `Size ${formatBytes(r.length)} is a valid PRG/CHR multiple`,
            ],
          },
          header,
          payload: r.bytes,
          facts: [{ label: 'Header', value: 'None — mapper cannot be inferred reliably' }],
          errors: [
            err(
              'NES_NO_HEADER',
              'warning',
              'This NES image has no iNES header, so the mapper and mirroring are unknown.',
              'Re-dump as .nes with a header, or supply the mapper manually. Engines will assume NROM at best.',
            ),
          ],
          regionHint: null,
          embeddedTitle: null,
          serial: null,
        };
      }
    }
    return null;
  }

  // ---- iNES header ----
  const flags6 = r.u8(6)!;
  const flags7 = r.u8(7)!;
  const nes2 = (flags7 & 0x0c) === 0x08;
  const prgBanks = r.u8(4)!;
  const chrBanks = r.u8(5)!;
  const mapper = (flags7 & 0xf0) | (flags6 >> 4);
  const fourScreen = (flags6 & 0x08) !== 0;
  const hasTrainer = (flags6 & 0x04) !== 0;
  const battery = (flags6 & 0x02) !== 0;
  const mirroring = fourScreen ? 'four-screen' : (flags6 & 0x01) === 1 ? 'vertical' : 'horizontal';

  header.strippedBytes = 16 + (hasTrainer ? 512 : 0);
  header.fields = {
    mapper,
    mapperBoard: NES_MAPPER_NAMES[mapper] ?? `mapper ${mapper}`,
    prgBanks,
    chrBanks,
    prgBytes: prgBanks * 16384,
    chrBytes: chrBanks * 8192,
    mirroring,
    battery,
    trainer: hasTrainer,
    nes2,
  };

  const expectedSize = header.strippedBytes + prgBanks * 16384 + chrBanks * 8192;
  const sizeMatches = expectedSize === r.length;
  if (!sizeMatches) {
    header.warnings.push(
      `Header declares ${formatBytes(expectedSize)} but file is ${formatBytes(r.length)} — the image may be trimmed or over-dumped.`,
    );
  }
  if (chrBanks === 0) {
    header.fields.chrRam = '8 KiB CHR RAM (no CHR ROM)';
  }
  if (hasTrainer) header.fields.trainer = '512 bytes at 0x10 (stripped on export)';
  const reservedNonZero = Array.from(r.bytes.subarray(7, 16)).some((b) => b !== 0);
  if (reservedNonZero && !nes2) {
    // Bytes 7-15 must be zero in a clean iNES header. Old dumping tools wrote
    // junk here ("DiskDude!", "demiforce"), which confuses mappers.
    header.warnings.push(
      'Bytes 7–15 of the iNES header are not zero — this is a "dirty" dump from an old dumping tool.',
    );
  }

  facts.push(
    { label: 'Mapper', value: `${mapper} — ${NES_MAPPER_NAMES[mapper] ?? 'unknown board'}` },
    { label: 'PRG ROM', value: formatBytes(prgBanks * 16384) },
    { label: 'CHR ROM', value: chrBanks === 0 ? 'none (CHR RAM)' : formatBytes(chrBanks * 8192) },
    { label: 'Mirroring', value: mirroring },
  );
  if (battery) facts.push({ label: 'Battery', value: 'yes — persistent save RAM' });
  if (hasTrainer) facts.push({ label: 'Trainer', value: '512 bytes at 0x10 (stripped on export)' });

  return {
    platformId: 'nes',
    platformConfidence: 'certain',
    format: {
      id: nes2 ? 'ines2' : 'ines',
      label: nes2 ? 'NES 2.0 cartridge image' : 'iNES cartridge image',
      kind: 'container',
      confidence: 'certain',
      evidence: ['"NES\\x1A" magic at offset 0', `PRG=${prgBanks} CHR=${chrBanks}`],
    },
    header,
    payload: r.bytes,
    facts,
    errors: sizeMatches
      ? []
      : [
          err(
            'NES_SIZE_MISMATCH',
            'warning',
            `iNES header declares ${formatBytes(expectedSize)} but the file is ${formatBytes(r.length)}.`,
            'Run the ROM through a header fixer or re-dump it. Loading will still be attempted.',
          ),
        ],
    regionHint: (flags7 & 0x01) === 0 ? null : null,
    embeddedTitle: null,
    serial: null,
  };
}

/* ------------------------------------------------------------------ */
/* Game Boy / Game Boy Color / GBA                                     */
/* ------------------------------------------------------------------ */

const GB_NINTENDO_LOGO = [
  0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b, 0x03, 0x73, 0x00, 0x83, 0x00, 0x0c, 0x00, 0x0d,
  0x00, 0x08, 0x11, 0x1f, 0x88, 0x89, 0x00, 0x0e, 0xdc, 0xcc, 0x6e, 0xe6, 0xdd, 0xdd, 0xd9, 0x99,
  0xbb, 0xbb, 0x67, 0x63, 0x6e, 0x0e, 0xec, 0xcc, 0xdd, 0xdc, 0x99, 0x9f, 0xbb, 0xb9, 0x33, 0x3e,
];

const GB_CARTRIDGE_TYPES: Record<number, string> = {
  0x00: 'ROM ONLY',
  0x01: 'MBC1',
  0x02: 'MBC1+RAM',
  0x03: 'MBC1+RAM+BATTERY',
  0x05: 'MBC2',
  0x06: 'MBC2+BATTERY',
  0x08: 'ROM+RAM',
  0x09: 'ROM+RAM+BATTERY',
  0x0b: 'MMM01',
  0x0f: 'MBC3+TIMER+BATTERY',
  0x10: 'MBC3+TIMER+RAM+BATTERY',
  0x11: 'MBC3',
  0x13: 'MBC3+RAM+BATTERY',
  0x19: 'MBC5',
  0x1a: 'MBC5+RAM',
  0x1b: 'MBC5+RAM+BATTERY',
  0x1c: 'MBC5+RUMBLE',
  0x1e: 'MBC5+RUMBLE+RAM+BATTERY',
  0x20: 'MBC6',
  0x22: 'MBC7+SENSOR+RUMBLE+RAM+BATTERY',
  0xfc: 'POCKET CAMERA',
  0xfd: 'BANDAI TAMA5',
  0xfe: 'HuC3',
  0xff: 'HuC1+RAM+BATTERY',
};

function gbLogoMatches(r: ByteReader): boolean {
  for (let i = 0; i < GB_NINTENDO_LOGO.length; i++) {
    if (r.u8(0x104 + i) !== GB_NINTENDO_LOGO[i]) return false;
  }
  return true;
}

function detectGameBoy(r: ByteReader, ext: string): DetectionResult | null {
  if (r.length < 0x150) return null;
  const logo = gbLogoMatches(r);
  const cgbFlag = r.u8(0x143);
  const isCgb = cgbFlag === 0xc0 || cgbFlag === 0x80;

  // Require the boot logo for a certain match; extension + header sanity for
  // a probable one (some homebrew omits the logo).
  const headerSane =
    r.u8(0x147) !== null &&
    r.u8(0x148) !== null &&
    (r.u8(0x14b) === 0x33 || r.u8(0x14b) === 0x00) &&
    r.length % 0x4000 === 0;

  if (!logo && !(headerSane && (ext === 'gb' || ext === 'gbc'))) return null;

  const titleBytes = r.bytes.subarray(0x134, isCgb ? 0x13f : 0x144);
  let title = '';
  for (const c of titleBytes) {
    if (c === 0) break;
    if (c >= 0x20 && c < 0x7f) title += String.fromCharCode(c);
  }

  const cartType = r.u8(0x147) ?? 0;
  const romSizeCode = r.u8(0x148) ?? 0;
  const ramSizeCode = r.u8(0x149) ?? 0;
  const dest = r.u8(0x14a) ?? 0;
  const version = r.u8(0x14c) ?? 0;
  const headerChecksum = r.u8(0x14d) ?? 0;

  // The Game Boy header checksum is defined over $0134-$014C (title, CGB flag,
  // new-licencee code, SGB flag, cart type, ROM/RAM size, destination, version).
  // The logo at $0104 is deliberately *not* part of it.
  let checksum = 0;
  for (let i = 0x134; i <= 0x14c; i++) checksum = (checksum - (r.u8(i) ?? 0) - 1) & 0xff;
  const checksumOk = checksum === headerChecksum;

  const declaredRomSize = romSizeCode <= 8 ? 32 * 1024 * (1 << romSizeCode) : null;
  const header = emptyHeader();
  header.fields = {
    cartType,
    cartTypeName: GB_CARTRIDGE_TYPES[cartType] ?? `unknown (0x${cartType.toString(16)})`,
    romSizeCode,
    ramSizeCode,
    destinationCode: dest,
    version,
    headerChecksumOk: checksumOk,
    bootLogoValid: logo,
    cgb: isCgb,
    sgb: r.u8(0x146) === 0x03,
  };
  if (!checksumOk) {
    header.warnings.push(
      `Header checksum byte is 0x${headerChecksum.toString(16)} but the computed value is 0x${checksum.toString(16)}.`,
    );
  }
  if (declaredRomSize !== null && declaredRomSize !== r.length) {
    header.warnings.push(
      `Header declares a ${formatBytes(declaredRomSize)} ROM but the file is ${formatBytes(r.length)} (over-dump or trimmed image).`,
    );
  }
  if (!logo) {
    header.warnings.push('Nintendo boot logo is missing from 0x104 — this may be homebrew or a modified ROM.');
  }

  const region: RegionCode =
    dest === 0x00 ? 'JP' : dest === 0x01 ? 'US' : dest === 0x02 ? 'EU' : 'UNKNOWN';

  const facts: Array<{ label: string; value: string }> = [
    { label: 'Mapper', value: GB_CARTRIDGE_TYPES[cartType] ?? `0x${cartType.toString(16)}` },
    { label: 'ROM size', value: declaredRomSize ? formatBytes(declaredRomSize) : 'unusual code' },
    { label: 'Cartridge RAM', value: ramSizeCode === 0 ? 'none' : `${32 * 1024 * (1 << Math.max(0, ramSizeCode - 2))} bytes` },
    { label: 'Header checksum', value: checksumOk ? 'valid' : 'invalid' },
    { label: 'Version', value: `${version} (${version === 0 ? '1.0' : `1.${version}`})` },
  ];

  const platformId: PlatformId = isCgb ? 'gbc' : 'gb';
  return {
    platformId,
    platformConfidence: logo ? 'certain' : 'probable',
    format: {
      id: 'gb',
      label: isCgb ? 'Game Boy Color cartridge image' : 'Game Boy cartridge image',
      kind: 'raw',
      confidence: logo ? 'certain' : 'probable',
      evidence: logo
        ? ['Nintendo boot logo present at 0x104', `CGB flag 0x${(cgbFlag ?? 0).toString(16)}`]
        : ['No boot logo', 'Game Boy header layout + .gb/.gbc extension'],
    },
    header,
    payload: r.bytes,
    facts,
    errors: !checksumOk
      ? [
          err(
            'GB_HEADER_CHECKSUM',
            'warning',
            'The Game Boy header checksum is invalid.',
            'The emulator may refuse to boot. Re-dump the cartridge; do not patch the checksum blindly.',
          ),
        ]
      : [],
    regionHint: region,
    embeddedTitle: title || null,
    serial: null,
  };
}

function detectGba(r: ByteReader, ext: string): DetectionResult | null {
  if (r.length < 0xc0) return null;
  const complement = r.u8(0xb2);

  const logoOk = gbLogoMatches(r); // same 156-byte logo, at 0x04
  const title = r.printable(0xa0, 12);
  const gameCode = r.printable(0xac, 4);
  const makerCode = r.printable(0xb0, 2);

  // Compute the documented header checksum first: it is independent corroboration
  // that the header really is a GBA header, unlike size + extension alone.
  let sum = 0;
  for (let i = 0xa0; i <= 0xbc; i++) sum += r.u8(i) ?? 0;
  const computedHeaderChecksum = (-(sum + 0x19)) & 0xff;
  const headerChecksumOk = computedHeaderChecksum === (r.u8(0xbd) ?? -1);

  // Corroboration rules, strongest first. Deliberately excludes "has the right
  // header checksum" on its own: 1-in-256 random blobs satisfy that, and a wrong
  // identification is worse than an honest "unrecognised".
  const plausible =
    (logoOk && complement === 0x96) ||
    (logoOk && headerChecksumOk) ||
    (logoOk && ext === 'gba') ||
    (complement === 0x96 && headerChecksumOk && (ext === 'gba' || ext === 'agb'));

  if (!plausible) {
    // Neither the Nintendo logo, the 0x96 complement byte, nor the header
    // checksum corroborate a GBA cartridge. A name ending in .gba is not
    // evidence: random data has that too. Refuse it, so the user sees an honest
    // "format not recognised" report instead of a launch that silently fails.
    return null;
  }

  // Header checksum was already validated above (bytes 0xA0..0xBC, stored at 0xBD).
  const checksumOk = headerChecksumOk;

  const header = emptyHeader();
  header.fields = {
    title,
    gameCode,
    makerCode,
    unitCode: r.u8(0x12),
    softwareVersion: r.u8(0xbc),
    headerChecksumOk: checksumOk,
    bootLogoValid: logoOk,
    complementOk: complement === 0x96,
    saveType: r.u8(0xbe),
  };
  if (!checksumOk) header.warnings.push('GBA header checksum byte at 0xBD does not verify.');
  if (complement === 0x96) header.warnings.push('0xB2 complement byte unset (patched header).');

  // GBA cartridges are mirrored to a power-of-two size; detect padding.
  let pow2 = 1;
  while (pow2 < r.length) pow2 <<= 1;
  if (pow2 !== r.length) {
    header.warnings.push(
      `File size ${formatBytes(r.length)} is not a power of two; the dump is likely mirrored/padded to ${formatBytes(pow2)}.`,
    );
  }

  return {
    platformId: 'gba',
    platformConfidence: logoOk ? 'certain' : 'probable',
    format: {
      id: 'gba',
      label: 'Game Boy Advance cartridge image',
      kind: 'raw',
      confidence: logoOk ? 'certain' : 'probable',
      evidence: [
        logoOk ? 'Nintendo boot logo present at 0x04' : 'Logo absent',
        `0xB2 complement byte = 0x${(complement ?? 0).toString(16)}`,
      ],
    },
    header,
    payload: r.bytes,
    facts: [
      { label: 'Game code', value: gameCode || '—' },
      { label: 'Maker code', value: makerCode || '—' },
      { label: 'Header checksum', value: checksumOk ? 'valid' : 'invalid' },
    ],
    errors: checksumOk
      ? []
      : [
          err(
            'GBA_HEADER_CHECKSUM',
            'warning',
            'GBA header checksum does not verify — the ROM may have been modified.',
            'Boot will still be attempted; some patched ROMs are intentional.',
          ),
        ],
    regionHint: null,
    embeddedTitle: title || null,
    serial: gameCode ? `${gameCode}${makerCode ? `-${makerCode}` : ''}` : null,
  };
}

/* ------------------------------------------------------------------ */
/* N64 — byte order decides the container                              */
/* ------------------------------------------------------------------ */

const N64_HEADER_SIGNATURES: Array<{
  id: string;
  label: string;
  signature: number[];
  byteOrder: 'big' | 'little' | 'byteswapped';
  ext: string;
}> = [
  { id: 'n64-be', label: 'Nintendo 64 ROM (.z64, big endian)', signature: [0x80, 0x37, 0x12, 0x40], byteOrder: 'big', ext: 'z64' },
  { id: 'n64-le', label: 'Nintendo 64 ROM (.n64, little endian)', signature: [0x40, 0x12, 0x37, 0x80], byteOrder: 'little', ext: 'n64' },
  { id: 'n64-v64', label: 'Nintendo 64 ROM (.v64, 16-bit byteswapped)', signature: [0x37, 0x80, 0x40, 0x12], byteOrder: 'byteswapped', ext: 'v64' },
];

function detectN64(r: ByteReader): DetectionResult | null {
  for (const sig of N64_HEADER_SIGNATURES) {
    if (!r.startsWith(0, sig.signature)) continue;

    const header = emptyHeader();
    let title = '';
    let cartId = '';
    let countryCode = 0;
    let version = 0;

    if (sig.byteOrder === 'big') {
      title = r.printable(0x20, 20);
      cartId = r.ascii(0x3b, 4).replace(/\./g, '').trim();
      countryCode = r.u8(0x3e) ?? 0;
      version = r.u8(0x3f) ?? 0;
    }

    const region: RegionCode =
      countryCode === 0x45 || countryCode === 0x4a
        ? 'US'
        : countryCode === 0x50 || countryCode === 0x44 || countryCode === 0x46
          ? 'EU'
          : countryCode === 0x4b
            ? 'JP'
            : 'UNKNOWN';

    const clockRate = sig.byteOrder === 'big' ? (r.u32be(0x04) ?? 0) : null;
    header.fields = {
      byteOrder: sig.byteOrder,
      clockRate,
      entryPoint: r.u32be(0x08)?.toString(16) ?? null,
      crc1: r.u32be(0x10)?.toString(16) ?? null,
      crc2: r.u32be(0x14)?.toString(16) ?? null,
      internalName: title,
      cartId,
      countryCode,
      version,
      saveType: null,
    };

    const needsSwap = sig.byteOrder !== 'big';
    if (needsSwap) {
      header.warnings.push(
        `Byte order is ${sig.byteOrder}: Recompa can byte-swap this to .z64 on export, but emulator cores may require the swap.`,
      );
    }
    if (r.length % (1024 * 1024) !== 0) {
      header.warnings.push(
        `ROM size ${formatBytes(r.length)} is not a whole number of MiB — the dump may include headers or be trimmed.`,
      );
    }

    return {
      platformId: 'n64',
      platformConfidence: 'certain',
      format: {
        id: sig.id,
        label: sig.label,
        kind: 'raw',
        confidence: 'certain',
        evidence: [
          `Signature ${sig.signature.map((b) => b.toString(16).padStart(2, '0')).join(' ')} at offset 0`,
          `Byte order: ${sig.byteOrder}`,
        ],
      },
      header,
      payload: r.bytes,
      facts: [
        { label: 'Internal name', value: title || '—' },
        { label: 'Cartridge ID', value: cartId || '—' },
        { label: 'Byte order', value: sig.byteOrder },
        { label: 'Clock rate', value: clockRate ? `${(clockRate / 1e6).toFixed(2)} MHz` : '—' },
      ],
      errors: [],
      regionHint: region,
      embeddedTitle: title || null,
      serial: cartId || null,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Nintendo DS                                                         */
/* ------------------------------------------------------------------ */

function detectNds(r: ByteReader, ext: string): DetectionResult | null {
  if (r.length < 0x200) return null;
  const title = r.printable(0x00, 12);
  const gameCode = r.printable(0x0c, 4);
  const maker = r.printable(0x10, 2);
  const unitCode = r.u8(0x12);
  const romSizeField = r.u8(0x14);
  const headerCrc = r.u16le(0x15e);
  const nintendoLogoOk = r.startsWith(0xc0, A('NmU') ) || r.startsWith(0xc0, [0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21]);

  const plausible =
    (nintendoLogoOk && ext !== 'gba') ||
    (ext === 'nds' && romSizeField !== null && romSizeField > 0 && romSizeField < 0x40 && title.length > 0);
  if (!plausible) return null;

  let crcOk = false;
  if (headerCrc !== null) {
    let sum = 0;
    for (let i = 0; i < 0x15e; i += 2) sum = (sum + (r.u16le(i) ?? 0)) & 0xffff;
    sum = (sum + headerCrc) & 0xffff;
    crcOk = sum === 0xffff;
  }

  const header = emptyHeader();
  header.fields = {
    title,
    gameCode,
    maker,
    unitCode,
    romSizeCode: romSizeField,
    headerCrcOk: crcOk,
    nintendoLogoOk,
    dsi: unitCode === 0x02 || unitCode === 0x03,
  };
  if (!crcOk) header.warnings.push('NDS header CRC16 does not verify.');

  return {
    platformId: 'nds',
    platformConfidence: nintendoLogoOk || crcOk ? 'certain' : 'probable',
    format: {
      id: 'nds',
      label: 'Nintendo DS ROM image',
      kind: 'raw',
      confidence: nintendoLogoOk || crcOk ? 'certain' : 'probable',
      evidence: [
        nintendoLogoOk ? 'Nintendo logo at 0xC0' : 'Logo not recognised',
        `Header CRC16 ${crcOk ? 'valid' : 'invalid'}`,
      ],
    },
    header,
    payload: r.bytes,
    facts: [
      { label: 'Game code', value: gameCode || '—' },
      { label: 'Maker', value: maker || '—' },
      { label: 'ROM size code', value: `${romSizeField} (${romSizeField ? formatBytes(128 * 1024 * (1 << romSizeField)) : 'unknown'})` },
    ],
    errors: [],
    regionHint: (r.u8(0x10) ?? 0) === 0x01 ? 'US' : 'UNKNOWN',
    embeddedTitle: title || null,
    serial: gameCode || null,
  };
}

/* ------------------------------------------------------------------ */
/* Sega Mega Drive / Genesis                                           */
/* ------------------------------------------------------------------ */

const SMD_MAGIC = [0xaa, 0xbb, 0x06, 0x00];

function smdToBin(bytes: Uint8Array): Uint8Array {
  // SMD: 512-byte copier header followed by 16 KiB blocks with an interleaved
  // odd/even byte layout. De-interleave back to linear Mega Drive order.
  const body = bytes.subarray(512);
  const blocks = Math.floor(body.length / 16384);
  const out = new Uint8Array(blocks * 16384);
  for (let b = 0; b < blocks; b++) {
    const src = body.subarray(b * 16384, (b + 1) * 16384);
    const dst = out.subarray(b * 16384, (b + 1) * 16384);
    for (let i = 0; i < 8192; i++) {
      dst[i * 2 + 1] = src[i]!;
      dst[i * 2] = src[i + 8192]!;
    }
  }
  return out;
}

function detectSega(r: ByteReader, ext: string): DetectionResult | null {
  if (ext === 'smd' && r.length > 512 + 0x200 && r.startsWith(0, SMD_MAGIC)) {
    const bin = smdToBin(r.bytes);
    const binReader = new ByteReader(bin);
    const consoleName = binReader.ascii(0x100, 16).replace(/\0/g, '').trim();
    const header = emptyHeader();
    header.strippedBytes = 512;
    header.fields = {
      container: 'SMD (interleaved)',
      consoleName,
      convertedSize: bin.length,
      deinterleaved: true,
    };
    return {
      platformId: 'genesis',
      platformConfidence: consoleName.startsWith('SEGA') ? 'certain' : 'probable',
      format: {
        id: 'smd',
        label: 'Sega SMD image (interleaved)',
        kind: 'container',
        confidence: 'certain',
        evidence: ['SMD magic AA BB 06 00 at offset 0', '16 KiB interleaved blocks'],
      },
      header,
      payload: bin,
      facts: [{ label: 'Console', value: consoleName || '—' }],
      errors: [
        err(
          'SMD_DEINTERLEAVED',
          'info',
          'This is an interleaved SMD image; Recompa de-interleaved it to linear Mega Drive order.',
          'The canonical payload stored in your library is the linear .bin.',
        ),
      ],
      regionHint: null,
      embeddedTitle: null,
      serial: null,
    };
  }

  if (r.length < 0x200) return null;

  const segaSig = r.ascii(0x100, 4);
  const consoleName = r.ascii(0x100, 16).replace(/\0/g, '').trim();
  const domesticName = r.ascii(0x120, 48).replace(/\0/g, '').trim();
  const overseasName = r.ascii(0x150, 48).replace(/\0/g, '').trim();
  const regionField = r.ascii(0x1f0, 3);
  const romEnd = r.u32be(0x1a4);
  const romStart = r.u32be(0x1a0);

  const hasSega = segaSig === 'SEGA';
  const plausibleName = overseasName.length > 0 && overseasName !== domesticName;
  if (!hasSega && !(plausibleName && r.length % 0x8000 === 0 && (ext === 'md' || ext === 'gen' || ext === 'bin'))) {
    return null;
  }

  let mapper = 'unknown';
  if (romStart !== null && romEnd !== null && romStart === 0 && romEnd > 0 && romEnd <= r.length) {
    mapper = 'SEGA mapper (SSF2-style bank switching)';
  }

  const header = emptyHeader();
  header.fields = {
    consoleName,
    domesticName,
    overseasName,
    regionField,
    romStart: romStart ?? null,
    romEnd: romEnd ?? null,
    mapper,
  };

  // Region field is a bitmap of accepted hardware palettes.
  const regionNames: string[] = [];
  if (regionField) {
    if (regionField.includes('J')) regionNames.push('JP');
    if (regionField.includes('U')) regionNames.push('US');
    if (regionField.includes('E')) regionNames.push('EU');
  }
  const region: RegionCode = regionNames.includes('US')
    ? 'US'
    : regionNames.includes('EU')
      ? 'EU'
      : regionNames.includes('JP')
        ? 'JP'
        : 'UNKNOWN';

  return {
    platformId: 'genesis',
    platformConfidence: hasSega ? 'certain' : 'probable',
    format: {
      id: 'md-rom',
      label: 'Sega Mega Drive / Genesis cartridge image',
      kind: 'raw',
      confidence: hasSega ? 'certain' : 'probable',
      evidence: hasSega
        ? ['"SEGA" signature at offset 0x100']
        : ['No SEGA signature', '.bin/.md extension with 32 KiB-aligned size'],
    },
    header,
    payload: r.bytes,
    facts: [
      { label: 'Console name', value: consoleName || '—' },
      { label: 'Title (overseas)', value: overseasName || '—' },
      { label: 'Region field', value: regionField || '—' },
      { label: 'Mapper', value: mapper },
    ],
    errors: hasSega
      ? []
      : [
          err(
            'MD_NO_SIGNATURE',
            'warning',
            'No "SEGA" signature at 0x100 — this may be a headerless dump or a different platform using .bin.',
            'If the game does not boot, re-dump it; .bin is also used by many CD-based systems.',
          ),
        ],
    regionHint: region,
    embeddedTitle: overseasName || domesticName || null,
    serial: null,
  };
}

/* ------------------------------------------------------------------ */
/* Master System / Game Gear                                           */
/* ------------------------------------------------------------------ */

function detectSmsGg(r: ByteReader, ext: string): DetectionResult | null {
  const size = r.length;
  if (size < 0x8000) return null;
  const footerOffset = size >= 0x8000 ? size - 0x10 : -1;
  const hasFooter = footerOffset > 0 && r.ascii(footerOffset, 8) === 'TMR SEGA';
  if (!hasFooter && ext !== 'sms' && ext !== 'gg') return null;
  if (!hasFooter && size % 0x4000 !== 0) return null;

  let regionCode: number | null = null;
  let productCode = '';
  let version = '';
  if (hasFooter) {
    productCode = r.ascii(footerOffset + 0x0e, 2);
    version = r.ascii(footerOffset + 0x0c, 1);
    const regionByte = r.u8(footerOffset + 0x0f);
    regionCode = regionByte === null ? null : (regionByte >> 4) & 0x0f;
  }
  // Region code 3 = SMS export, 4 = SMS Japan, 5 = Game Gear export, 6 = GG Japan, 7 = GG export.
  const isGameGear = regionCode === 5 || regionCode === 6 || regionCode === 7 || ext === 'gg';
  const header = emptyHeader();
  header.fields = { productCode, version, regionCode, hasFooter };
  const region: RegionCode =
    regionCode === 3 || regionCode === 5 || regionCode === 7
      ? 'EU'
      : regionCode === 4 || regionCode === 6
        ? 'JP'
        : 'UNKNOWN';

  return {
    platformId: isGameGear ? 'gg' : 'sms',
    platformConfidence: hasFooter ? 'certain' : 'probable',
    format: {
      id: isGameGear ? 'gg-rom' : 'sms-rom',
      label: isGameGear ? 'Sega Game Gear cartridge image' : 'Sega Master System cartridge image',
      kind: 'raw',
      confidence: hasFooter ? 'certain' : 'probable',
      evidence: hasFooter
        ? ['"TMR SEGA" footer at end of image']
        : ['.gg/.sms extension with 16 KiB-aligned size'],
    },
    header,
    payload: r.bytes,
    facts: [
      { label: 'Product code', value: productCode || '—' },
      { label: 'Revision', value: version || '—' },
    ],
    errors: [],
    regionHint: region,
    embeddedTitle: null,
    serial: productCode || null,
  };
}

/* ------------------------------------------------------------------ */
/* Atari 7800 / Lynx                                                   */
/* ------------------------------------------------------------------ */

function detectAtari(r: ByteReader, _ext: string): DetectionResult | null {
  if (r.length > 128 && r.startsWith(0, A('ATARI7800'))) {
    const header = emptyHeader();
    header.strippedBytes = 128;
    header.fields = {
      container: 'A78 header',
      title: r.printable(0x11, 32),
      cartType: r.ascii(0x31, 32).replace(/\0/g, '').trim(),
    };
    return {
      platformId: 'atari7800',
      platformConfidence: 'certain',
      format: {
        id: 'a78',
        label: 'Atari 7800 image with A78 header',
        kind: 'container',
        confidence: 'certain',
        evidence: ['"ATARI7800" at offset 0x01'],
      },
      header,
      payload: r.slice(128),
      facts: [{ label: 'Cart type', value: r.ascii(0x31, 32).replace(/\0/g, '').trim() || '—' }],
      errors: [],
      regionHint: null,
      embeddedTitle: null,
      serial: null,
    };
  }
  if (r.startsWith(0, A('LYNX'))) {
    const header = emptyHeader();
    header.strippedBytes = 64;
    header.fields = { container: 'LYNX header', title: r.printable(0x0a, 32) };
    return {
      platformId: 'lynx',
      platformConfidence: 'certain',
      format: {
        id: 'lnx',
        label: 'Atari Lynx image with LNX header',
        kind: 'container',
        confidence: 'certain',
        evidence: ['"LYNX" magic at offset 0'],
      },
      header,
      payload: r.slice(64),
      facts: [],
      errors: [],
      regionHint: null,
      embeddedTitle: null,
      serial: null,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Disc images                                                         */
/* ------------------------------------------------------------------ */

const ISO9660_PVD_OFFSET = 16 * 2048;

function detectDisc(r: ByteReader, ext: string): DetectionResult | null {
  const isCueText =
    ext === 'cue' ||
    (r.length < 64 * 1024 && r.indexOf(A('FILE '), 0, 4096) === 0);
  if (isCueText) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(r.slice(0, Math.min(r.length, 64 * 1024)));
    const fileRefs = Array.from(text.matchAll(/FILE\s+"([^"]+)"\s+BINARY/gi)).map((m) => m[1]!);
    return {
      platformId: 'psx',
      platformConfidence: 'probable',
      format: {
        id: 'cue',
        label: 'CD cue sheet',
        kind: 'container',
        confidence: 'certain',
        evidence: ['CUE sheet text ("FILE … BINARY" lines)'],
      },
      header: { strippedBytes: 0, fields: { trackCount: fileRefs.length }, warnings: [] },
      payload: r.bytes,
      facts: [
        { label: 'Referenced tracks', value: String(fileRefs.length) },
        { label: 'Missing companion files', value: fileRefs.join(', ') || '—' },
      ],
      errors: [
        err(
          'CUE_INCOMPLETE',
          'error',
          'A .cue sheet is only a track index — the referenced .bin tracks must be added too.',
          `Upload the ${fileRefs.length} referenced .bin file(s) alongside this cue sheet, or upload a single .chd/.iso.`,
        ),
      ],
      regionHint: null,
      embeddedTitle: null,
      serial: null,
    };
  }

  // CHD
  if (r.startsWith(0, A('MComprHD'))) {
    return {
      platformId: 'psx',
      platformConfidence: 'probable',
      format: {
        id: 'chd',
        label: 'MAME CHD compressed disc image',
        kind: 'container',
        confidence: 'certain',
        evidence: ['"MComprHD" magic at offset 0'],
      },
      header: emptyHeader(),
      payload: r.bytes,
      facts: [{ label: 'Container', value: 'CHD v5 (compressed hunks of data)' }],
      errors: [],
      regionHint: null,
      embeddedTitle: null,
      serial: null,
    };
  }

  // Raw disc image: check ISO9660 primary volume descriptor.
  if (r.has(ISO9660_PVD_OFFSET, 6) && r.u8(ISO9660_PVD_OFFSET) === 0x01 && r.ascii(ISO9660_PVD_OFFSET + 1, 5) === 'CD001') {
    const volumeId = r.ascii(ISO9660_PVD_OFFSET + 40, 32).replace(/\0/g, '').trim();
    const systemId = r.ascii(ISO9660_PVD_OFFSET + 8, 32).replace(/\0/g, '').trim();
    const isPsx = systemId.toUpperCase().includes('PLAYSTATION') || r.indexOf(A('PLAYSTATION'), 0, 8 * 2048) >= 0;
    return {
      platformId: isPsx ? 'psx' : 'psx',
      platformConfidence: isPsx ? 'certain' : 'probable',
      format: {
        id: 'iso9660',
        label: 'ISO 9660 disc image',
        kind: 'raw',
        confidence: 'certain',
        evidence: ['ISO 9660 PVD "CD001" at sector 16'],
      },
      header: { strippedBytes: 0, fields: { volumeId, systemId }, warnings: [] },
      payload: r.bytes,
      facts: [
        { label: 'Volume ID', value: volumeId || '—' },
        { label: 'System ID', value: systemId || '—' },
        { label: 'PSX system area', value: isPsx ? 'PlayStation licence string found' : 'not found' },
      ],
      errors: isPsx
        ? []
        : [
            err(
              'DISC_SYSTEM_UNCLEAR',
              'warning',
              'The disc contains an ISO 9660 filesystem but no PlayStation system identifier was found.',
              'Recompa will treat it as a PlayStation disc; if it is a PC-FX/Sega CD disc the engine will reject it at load time.',
            ),
          ],
      regionHint: null,
      embeddedTitle: null,
      serial: null,
    };
  }

  // PSX PAL/RAW sector 16 scan (sector size 2352) - licence text at 0x00.
  if (ext === 'bin' || ext === 'img' || ext === 'iso') {
    const magic = r.startsWith(0, A('PLAYSTATION'));
    if (magic) {
      return {
        platformId: 'psx',
        platformConfidence: 'probable',
        format: {
          id: 'psx-raw',
          label: 'PlayStation raw sector image',
          kind: 'raw',
          confidence: 'probable',
          evidence: ['"PLAYSTATION" licence string at offset 0'],
        },
        header: emptyHeader(),
        payload: r.bytes,
        facts: [{ label: 'Sector format', value: 'assumed 2352-byte raw sector' }],
        errors: [],
        regionHint: null,
        embeddedTitle: null,
        serial: null,
      };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

export function detectFormat(payload: Uint8Array, fileName: string): DetectionResult {
  const ext = extensionOf(fileName);
  const r = new ByteReader(payload);

  const detectors: Array<() => DetectionResult | null> = [
    () => (r.length < 8 ? null : detectNes(r, ext)),
    () => detectGameBoy(r, ext),
    () => (ext === 'gba' || ext === 'agb' ? detectGba(r, ext) : detectGba(r, ext)),
    () => (r.length >= 4 ? detectN64(r) : null),
    () => detectNds(r, ext),
    () => detectSega(r, ext),
    () => detectSmsGg(r, ext),
    () => detectAtari(r, ext),
    () => detectDisc(r, ext),
  ];

  for (const detect of detectors) {
    const result = detect();
    if (result) return result;
  }

  // Nothing matched: report honestly with evidence.
  const header = emptyHeader();
  const errors: TechnicalError[] = [];
  if (ext === 'zip' || ext === '7z' || ext === 'rar') {
    errors.push(
      err(
        'ARCHIVE_UNEXPECTED',
        'error',
        `The archive was not expanded before detection (.${ext}).`,
        'This is an internal ordering bug — please report it with the file name.',
      ),
    );
  } else {
    errors.push(
      err(
        'FORMAT_UNKNOWN',
        'error',
        `No supported console format matched this file${ext ? ` (.${ext})` : ''}.`,
        'Check that it is a cartridge/disc image rather than a save file, patch, or archive member. Recompa never guesses a platform.',
        `Size ${formatBytes(r.length)}; first bytes: ${Array.from(payload.subarray(0, 16))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(' ')}`,
      ),
    );
  }

  return {
    platformId: null,
    platformConfidence: 'unknown',
    format: null,
    header,
    payload,
    facts: [],
    errors,
    regionHint: null,
    embeddedTitle: null,
    serial: null,
  };
}

/** Byte-swap a V64/N64 image to canonical .z64 big-endian order. */
export function toBigEndianN64(bytes: Uint8Array, order: 'big' | 'little' | 'byteswapped'): Uint8Array {
  if (order === 'big') return bytes;
  const out = new Uint8Array(bytes.length);
  if (order === 'byteswapped') {
    for (let i = 0; i < bytes.length; i += 2) {
      out[i] = bytes[i + 1] ?? 0;
      out[i + 1] = bytes[i] ?? 0;
    }
  } else {
    for (let i = 0; i < bytes.length; i += 4) {
      out[i] = bytes[i + 3] ?? 0;
      out[i + 1] = bytes[i + 2] ?? 0;
      out[i + 2] = bytes[i + 1] ?? 0;
      out[i + 3] = bytes[i] ?? 0;
    }
  }
  return out;
}
