import type { FirmwareRequirement, Platform, PlatformId } from './types';

/**
 * Platform catalogue.
 *
 * Facts here are deliberately conservative: sizes are typical ranges used only
 * to *warn* on implausible files, never to reject them. Firmware entries list
 * byte sizes that are publicly documented for those dumps; Recompa ships no
 * firmware and no hashes it cannot attribute, so `knownHashes` is populated
 * only for dumps whose SHA-1 appears in a public reference we can cite.
 */
const PS1_BIOS: FirmwareRequirement = {
  name: 'PlayStation BIOS',
  sizes: [512 * 1024],
  reason:
    'PS1 system software (SCPH-5501 and friends) initialises the GPU/SPU and loads the game executable. Several cores can boot with a partial HLE BIOS, but commercial titles need the real one.',
  optional: false,
};

const NDS_FIRMWARE: FirmwareRequirement[] = [
  {
    name: 'Nintendo DS BIOS7',
    sizes: [16 * 1024],
    reason: 'ARM7 BIOS: touchscreen, sound, SPI and firmware routines.',
    optional: true,
  },
  {
    name: 'Nintendo DS BIOS9',
    sizes: [4 * 1024],
    reason: 'ARM9 BIOS: boot and card routines.',
    optional: true,
  },
  {
    name: 'Nintendo DS firmware',
    sizes: [256 * 1024, 512 * 1024],
    reason: 'Firmware image: splash, user settings, Wi-Fi calibration.',
    optional: true,
  },
];

const PCE_CD_BIOS: FirmwareRequirement = {
  name: 'PC Engine CD System Card 3',
  sizes: [256 * 1024],
  reason: 'CD-ROM² System Card 3 is the system software for PCE CD titles.',
  optional: false,
};

export const PLATFORMS: Platform[] = [
  {
    id: 'nes',
    name: 'Nintendo Entertainment System',
    manufacturer: 'Nintendo',
    generation: 3,
    releaseYear: 1983,
    mediaFormats: ['Cartridge', 'Famicom Disk System disk'],
    extensions: ['nes', 'fds', 'unf', 'unif'],
    romSizeRange: [8 * 1024, 8 * 1024 * 1024],
    notes: 'iNES/NES 2.0 headers carry mapper + mirroring metadata.',
  },
  {
    id: 'snes',
    name: 'Super Nintendo Entertainment System',
    manufacturer: 'Nintendo',
    generation: 4,
    releaseYear: 1990,
    mediaFormats: ['Cartridge'],
    extensions: ['sfc', 'smc', 'swc', 'fig', 'bs'],
    romSizeRange: [256 * 1024, 8 * 1024 * 1024],
    notes: 'Some dumps carry a 512-byte copier header (SMC) that must be stripped.',
  },
  {
    id: 'gb',
    name: 'Game Boy',
    manufacturer: 'Nintendo',
    generation: 4,
    releaseYear: 1989,
    mediaFormats: ['Cartridge'],
    extensions: ['gb'],
    romSizeRange: [32 * 1024, 8 * 1024 * 1024],
  },
  {
    id: 'gbc',
    name: 'Game Boy Color',
    manufacturer: 'Nintendo',
    generation: 5,
    releaseYear: 1998,
    mediaFormats: ['Cartridge'],
    extensions: ['gbc'],
    romSizeRange: [32 * 1024, 8 * 1024 * 1024],
  },
  {
    id: 'gba',
    name: 'Game Boy Advance',
    manufacturer: 'Nintendo',
    generation: 6,
    releaseYear: 2001,
    mediaFormats: ['Cartridge'],
    extensions: ['gba', 'agb'],
    romSizeRange: [64 * 1024, 32 * 1024 * 1024],
    notes: 'Header ends with the 0x96 complement byte at 0xB2.',
  },
  {
    id: 'n64',
    name: 'Nintendo 64',
    manufacturer: 'Nintendo',
    generation: 5,
    releaseYear: 1996,
    mediaFormats: ['Cartridge', '64DD disk'],
    extensions: ['z64', 'n64', 'v64', 'ndd'],
    romSizeRange: [4 * 1024 * 1024, 64 * 1024 * 1024],
    notes:
      'Byte order decides the container: .z64 (big endian), .v64 (16-bit byteswapped), .n64 (little endian).',
  },
  {
    id: 'nds',
    name: 'Nintendo DS',
    manufacturer: 'Nintendo',
    generation: 7,
    releaseYear: 2004,
    mediaFormats: ['Game Card', 'Download Play'],
    extensions: ['nds', 'srl', 'dsi'],
    romSizeRange: [4 * 1024 * 1024, 512 * 1024 * 1024],
    requiredFirmware: NDS_FIRMWARE,
    notes: 'Header at 0x00 is the game title; unit code 0x02 marks a DSi title.',
  },
  {
    id: 'genesis',
    name: 'Sega Mega Drive / Genesis',
    manufacturer: 'Sega',
    generation: 4,
    releaseYear: 1988,
    mediaFormats: ['Cartridge', 'Sega CD'],
    extensions: ['md', 'gen', 'smd', 'bin'],
    romSizeRange: [128 * 1024, 16 * 1024 * 1024],
    notes: 'Cartridges carry a "SEGA" signature at 0x100. SMD files have a 512-byte header.',
  },
  {
    id: 'sms',
    name: 'Sega Master System',
    manufacturer: 'Sega',
    generation: 3,
    releaseYear: 1985,
    mediaFormats: ['Cartridge', 'Card', 'SG-1000'],
    extensions: ['sms'],
    romSizeRange: [8 * 1024, 2 * 1024 * 1024],
    notes: '"TMR SEGA" footer sits at 0x7FF0 / 0x3FF0 / 0x1FF0 depending on ROM size.',
  },
  {
    id: 'gg',
    name: 'Sega Game Gear',
    manufacturer: 'Sega',
    generation: 4,
    releaseYear: 1990,
    mediaFormats: ['Cartridge'],
    extensions: ['gg'],
    romSizeRange: [8 * 1024, 2 * 1024 * 1024],
  },
  {
    id: 'pce',
    name: 'PC Engine / TurboGrafx-16',
    manufacturer: 'NEC',
    generation: 4,
    releaseYear: 1987,
    mediaFormats: ['HuCard', 'CD-ROM²'],
    extensions: ['pce', 'sgx'],
    romSizeRange: [32 * 1024, 8 * 1024 * 1024],
    requiredFirmware: [PCE_CD_BIOS],
  },
  {
    id: 'psx',
    name: 'PlayStation',
    manufacturer: 'Sony',
    generation: 5,
    releaseYear: 1994,
    mediaFormats: ['CD-ROM'],
    extensions: ['cue', 'bin', 'iso', 'chd', 'img', 'pbp', 'm3u', 'ccd'],
    romSizeRange: [1024 * 1024, 800 * 1024 * 1024],
    requiredFirmware: [PS1_BIOS],
    notes: 'Disc images need the system BIOS; .cue sheets reference one or more .bin tracks.',
  },
  {
    id: 'psp',
    name: 'PlayStation Portable',
    manufacturer: 'Sony',
    generation: 7,
    releaseYear: 2004,
    mediaFormats: ['UMD'],
    extensions: ['iso', 'cso', 'pbp'],
    romSizeRange: [16 * 1024 * 1024, 2 * 1024 * 1024 * 1024],
  },
  {
    id: 'atari2600',
    name: 'Atari 2600',
    manufacturer: 'Atari',
    generation: 2,
    releaseYear: 1977,
    mediaFormats: ['Cartridge'],
    extensions: ['a26'],
    romSizeRange: [2048, 128 * 1024],
    notes: 'Headerless: bank-switching scheme is inferred from file size.',
  },
  {
    id: 'atari7800',
    name: 'Atari 7800',
    manufacturer: 'Atari',
    generation: 3,
    releaseYear: 1986,
    mediaFormats: ['Cartridge'],
    extensions: ['a78'],
    romSizeRange: [16 * 1024, 1024 * 1024],
    notes: 'The 128-byte A78 header starts with the version byte 0x01 and "ATARI7800".',
  },
  {
    id: 'lynx',
    name: 'Atari Lynx',
    manufacturer: 'Atari',
    generation: 4,
    releaseYear: 1989,
    mediaFormats: ['Cartridge'],
    extensions: ['lnx'],
    romSizeRange: [32 * 1024, 2 * 1024 * 1024],
    notes: 'Header begins with "LYNX".',
  },
  {
    id: 'ws',
    name: 'WonderSwan / WonderSwan Color',
    manufacturer: 'Bandai',
    generation: 5,
    releaseYear: 1999,
    mediaFormats: ['Cartridge'],
    extensions: ['ws', 'wsc'],
    romSizeRange: [32 * 1024, 8 * 1024 * 1024],
  },
  {
    id: 'vb',
    name: 'Virtual Boy',
    manufacturer: 'Nintendo',
    generation: 5,
    releaseYear: 1995,
    mediaFormats: ['Cartridge'],
    extensions: ['vb'],
    romSizeRange: [512 * 1024, 16 * 1024 * 1024],
  },
  {
    id: 'ngp',
    name: 'Neo Geo Pocket / Color',
    manufacturer: 'SNK',
    generation: 5,
    releaseYear: 1998,
    mediaFormats: ['Cartridge'],
    extensions: ['ngp', 'ngc'],
    romSizeRange: [512 * 1024, 16 * 1024 * 1024],
  },
  {
    id: 'arcade',
    name: 'Arcade',
    manufacturer: 'Various',
    generation: 0,
    releaseYear: 1971,
    mediaFormats: ['ROM sets', 'CHD'],
    extensions: ['zip', '7z'],
    notes: 'Arcade sets are multi-file; the set name must match a MAME/FBNeo driver list.',
  },
];

export const PLATFORM_BY_ID = new Map<PlatformId, Platform>(PLATFORMS.map((p) => [p.id, p]));

/** Extensions that appear on more than one platform and need content sniffing. */
export const AMBIGUOUS_EXTENSIONS = new Set(['bin', 'iso', 'zip', 'pbp', 'sgx']);

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

export function platformsForExtension(ext: string): Platform[] {
  return PLATFORMS.filter((p) => p.extensions.includes(ext));
}

/**
 * Firmware a platform needs. Only platforms whose system software is genuinely
 * required to boot commercial software are listed this way; engines may still
 * supply high-level emulation for subsets.
 */
export function firmwareFor(platformId: PlatformId): FirmwareRequirement[] {
  return PLATFORM_BY_ID.get(platformId)?.requiredFirmware ?? [];
}

export const KNOWN_EXTENSIONS: readonly string[] = Array.from(
  new Set([
    ...PLATFORMS.flatMap((p) => p.extensions),
    'zip',
    '7z',
    'rar',
    'cue',
    'm3u',
    'txt',
    'json',
    'xml',
    'dat',
    'sfv',
    'png',
    'jpg',
    'jpeg',
    'md5',
    'sha1',
  ]),
);
