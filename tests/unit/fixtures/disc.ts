/**
 * Synthetic optical-disc fixtures for tests.
 *
 * These build *structurally faithful* images — correct sector geometry, a real
 * ISO 9660 Primary Volume Descriptor, a root directory, SYSTEM.CNF and a
 * PS-X EXE stub — while containing no copyrighted material whatsoever. The
 * catalogue volume name is invented.
 *
 * Keeping the builder in code (rather than committing multi-megabyte binaries)
 * means every test states exactly what geometry it is exercising.
 */

export interface DiscOptions {
  /** Volume Identifier written into the PVD (max 32 chars). */
  volumeId?: string;
  /** System Identifier written into the PVD. */
  systemId?: string;
  /** Write the "Licensed by Sony Computer Entertainment" notice into the system area. */
  psxLicence?: boolean;
  /** Total sectors to emit (a real disc is ~300k; tests use a few hundred). */
  sectors?: number;
}

const RAW_SECTOR = 2352;
const DATA_SECTOR = 2048;

/** One MODE2/2352 sector: 12-byte sync+header, 8-byte subheader, 2048 data, EDC/ECC. */
function rawMode2Sector(lba: number, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(RAW_SECTOR);
  s[0] = 0x00;
  for (let i = 1; i <= 10; i++) s[i] = 0xff;
  s[11] = 0x00; // mode byte in header
  s[12] = Math.floor(lba / 4500) & 0xff;
  s[13] = Math.floor((lba % 4500) / 75) & 0xff;
  s[14] = lba % 75;
  s[15] = 2; // MODE2
  // Subheader: file number / channel / submode / coding, duplicated.
  s[16] = 0;
  s[17] = 0;
  s[18] = 0x08; // data
  s[19] = 0;
  s[20] = 0;
  s[21] = 0;
  s[22] = 0x08;
  s[23] = 0;
  s.set(data.subarray(0, DATA_SECTOR), 24);
  return s;
}

const LICENCE_TEXT = '          Licensed  by          Sony Computer Entertainment Inc.';

function licenceSector(lba: number): Uint8Array {
  const data = new Uint8Array(DATA_SECTOR);
  data.set(new TextEncoder().encode(LICENCE_TEXT).subarray(0, DATA_SECTOR), 0);
  return rawMode2Sector(lba, data);
}

function directoryRecord(name: string, lba: number, size: number, isDir: boolean): Uint8Array {
  const n = new TextEncoder().encode(name);
  const rec = new Uint8Array(33 + n.length + (n.length % 2 === 0 ? 1 : 0));
  let o = 0;
  rec[o++] = rec.length;
  rec[o++] = 0;
  const le = (v: number) => {
    rec[o++] = v & 0xff;
    rec[o++] = (v >>> 8) & 0xff;
    rec[o++] = (v >>> 16) & 0xff;
    rec[o++] = (v >>> 24) & 0xff;
  };
  const be = (v: number) => {
    rec[o++] = (v >>> 24) & 0xff;
    rec[o++] = (v >>> 16) & 0xff;
    rec[o++] = (v >>> 8) & 0xff;
    rec[o++] = v & 0xff;
  };
  le(lba);
  be(lba);
  le(size);
  be(size);
  rec[o++] = 124;
  rec[o++] = 1;
  rec[o++] = 1;
  rec[o++] = 0;
  rec[o++] = 0;
  rec[o++] = 0;
  rec[o++] = 0;
  rec[o++] = isDir ? 2 : 0;
  rec[o++] = 0;
  rec[o++] = 0;
  rec[o++] = 1;
  rec[o++] = 0;
  rec[o++] = n.length;
  rec.set(n, o);
  return rec;
}

function sectorData(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(DATA_SECTOR);
  out.set(data.subarray(0, DATA_SECTOR), 0);
  return out;
}

/**
 * Build a PlayStation disc.
 *
 * @param options volumeId / systemId / psxLicence / sectors
 * @returns the raw 2352-byte-per-sector image
 */
export function buildPsxDisc(options: DiscOptions = {}): Uint8Array {
  const { volumeId = 'RECOMPA TEST', systemId = 'PLAYSTATION', psxLicence = true, sectors = 300 } = options;

  const D = (s: string) => new Uint8Array(new TextEncoder().encode(s));

  // Root directory lives at LBA 20 with one sector.
  const rootLba = 20;
  const cnfLba = 21;
  const exeLba = 22;

  const systemCnf = D('BOOT=cdrom:\\SLPS_012.34;1\r\nTCB=4\r\nEVENT=10\r\nSTACK=801FFF00\r\n');
  const exe = new Uint8Array(DATA_SECTOR);
  // Minimal PS-X EXE header so the image looks like a bootable disc.
  exe.set(D('PS-X EXE'), 0);
  exe.set(D('RECOMPA SYNTHETIC TEST IMAGE'), 0x10);

  const root = new Uint8Array(DATA_SECTOR);
  let o = 0;
  for (const rec of [
    directoryRecord('.', rootLba, DATA_SECTOR, true),
    directoryRecord('..', rootLba, DATA_SECTOR, true),
    directoryRecord('SYSTEM.CNF;1', cnfLba, systemCnf.length, false),
    directoryRecord('SLPS_012.34;1', exeLba, 0x800, false),
  ]) {
    root.set(rec, o);
    o += rec.length;
  }

  const pvd = new Uint8Array(DATA_SECTOR);
  pvd[0] = 0x01;
  pvd.set(D('CD001'), 1);
  pvd[6] = 0x01;
  pvd.set(D(systemId).subarray(0, 32), 8);
  pvd.set(D(volumeId).subarray(0, 32), 40);
  // Volume space size: both-endian 32-bit at offset 80.
  const spatial = sectors;
  pvd[80] = spatial & 0xff;
  pvd[81] = (spatial >>> 8) & 0xff;
  pvd[84] = (spatial >>> 24) & 0xff;
  pvd[87] = spatial & 0xff;

  const sectorsOut: Uint8Array[] = [];
  for (let lba = 0; lba < sectors; lba++) {
    let data = new Uint8Array(DATA_SECTOR);
    if (lba < 16) {
      if (psxLicence && lba === 4) data = sectorData(new TextEncoder().encode(LICENCE_TEXT));
    } else if (lba === 16) data = pvd;
    else if (lba === 17) {
      data = new Uint8Array(DATA_SECTOR);
      data[0] = 0xff; // Volume descriptor set terminator
      data.set(D('CD001'), 1);
      data[6] = 0x01;
    } else if (lba === rootLba) data = root;
    else if (lba === cnfLba) data = sectorData(systemCnf);
    else if (lba === exeLba) data = exe;
    sectorsOut.push(rawMode2Sector(lba, data));
  }

  const out = new Uint8Array(sectorsOut.length * RAW_SECTOR);
  sectorsOut.forEach((s, i) => out.set(s, i * RAW_SECTOR));
  return out;
}

/** Re-slice a 2352-byte raw image into a 2048-byte cooked `.iso`. */
export function toCookedIso(raw: Uint8Array): Uint8Array {
  const count = Math.floor(raw.length / RAW_SECTOR);
  const out = new Uint8Array(count * DATA_SECTOR);
  for (let i = 0; i < count; i++) {
    // MODE2/2352: user data at byte 24; MODE1/2352: at byte 16. Fixtures use MODE2.
    out.set(raw.subarray(i * RAW_SECTOR + 24, i * RAW_SECTOR + 24 + DATA_SECTOR), i * DATA_SECTOR);
  }
  return out;
}

/** Re-slice into 2336-byte sectors (subheader retained, sync/header dropped). */
export function to2336(raw: Uint8Array): Uint8Array {
  const count = Math.floor(raw.length / RAW_SECTOR);
  const out = new Uint8Array(count * 2336);
  for (let i = 0; i < count; i++) {
    out.set(raw.subarray(i * RAW_SECTOR + 16, i * RAW_SECTOR + 2352), i * 2336);
  }
  return out;
}

/** A cue sheet naming the given bin, with index positions per track. */
export function cueSheet(binName: string, tracks: Array<{ n: number; mode: string; index1: string }>): string {
  const lines = [`FILE "${binName}" BINARY`];
  for (const t of tracks) {
    lines.push(`  TRACK ${String(t.n).padStart(2, '0')} ${t.mode}`);
    lines.push(`    INDEX 01 ${t.index1}`);
  }
  return `${lines.join('\n')}\n`;
}
