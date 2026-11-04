/** Bounds-checked binary reader for format sniffing. */
export class ByteReader {
  readonly view: DataView;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.bytes.length;
  }

  has(offset: number, size = 1): boolean {
    return offset >= 0 && offset + size <= this.bytes.length;
  }

  u8(offset: number): number | null {
    return this.has(offset) ? this.view.getUint8(offset) : null;
  }

  u16le(offset: number): number | null {
    return this.has(offset, 2) ? this.view.getUint16(offset, true) : null;
  }

  u16be(offset: number): number | null {
    return this.has(offset, 2) ? this.view.getUint16(offset, false) : null;
  }

  u32le(offset: number): number | null {
    return this.has(offset, 4) ? this.view.getUint32(offset, true) : null;
  }

  u32be(offset: number): number | null {
    return this.has(offset, 4) ? this.view.getUint32(offset, false) : null;
  }

  u64be(offset: number): bigint | null {
    if (!this.has(offset, 8)) return null;
    return this.view.getBigUint64(offset, false);
  }

  ascii(offset: number, length: number): string {
    const end = Math.min(offset + length, this.bytes.length);
    let out = '';
    for (let i = offset; i < end; i++) {
      const c = this.bytes[i]!;
      out += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.';
    }
    return out;
  }

  /** Printable ASCII run, trimmed. Used for N64 game titles at 0x20. */
  printable(offset: number, length: number): string {
    const end = Math.min(offset + length, this.bytes.length);
    let out = '';
    for (let i = offset; i < end; i++) {
      const c = this.bytes[i]!;
      if (c === 0) break;
      if (c >= 0x20 && c < 0x7f) out += String.fromCharCode(c);
      else return out.trim();
    }
    return out.trim();
  }

  startsWith(offset: number, signature: readonly number[]): boolean {
    if (!this.has(offset, signature.length)) return false;
    for (let i = 0; i < signature.length; i++) {
      if (this.bytes[offset + i] !== signature[i]) return false;
    }
    return true;
  }

  indexOf(signature: readonly number[], from = 0, limit = this.bytes.length): number {
    const first = signature[0]!;
    const max = Math.min(limit, this.bytes.length) - signature.length;
    outer: for (let i = from; i <= max; i++) {
      if (this.bytes[i] !== first) continue;
      for (let j = 1; j < signature.length; j++) {
        if (this.bytes[i + j] !== signature[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  slice(offset: number, length?: number): Uint8Array {
    return this.bytes.subarray(offset, length === undefined ? undefined : offset + length);
  }
}

export const asciiBytes = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

/** Shannon entropy over the payload, sampled to stay fast on 64 MiB files. */
export function entropy(bytes: Uint8Array, sampleLimit = 1 << 20): number {
  const step = Math.max(1, Math.floor(bytes.length / sampleLimit));
  const counts = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < bytes.length; i += step) {
    counts[bytes[i]!]!++;
    total++;
  }
  if (total === 0) return 0;
  let h = 0;
  for (let i = 0; i < 256; i++) {
    const p = counts[i]! / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

/** True when the payload looks compressed/encrypted rather than structured. */
export function looksCompressed(bytes: Uint8Array): boolean {
  if (bytes.length < 4096) return false;
  return entropy(bytes, 1 << 18) > 7.6;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

export function formatHex(n: number, width = 0): string {
  return `0x${n.toString(16).toUpperCase().padStart(width, '0')}`;
}
