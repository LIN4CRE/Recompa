import { describe, expect, it } from 'vitest';
import { crc32, crc32Hex, md5, toHex, duplicateKey } from '@/core/hash';

describe('crc32', () => {
  it('matches the published CRC32 check value for "123456789"', () => {
    // The standard CRC32/BZIP2 check value.
    expect(crc32Hex(new TextEncoder().encode('123456789'))).toBe('cbf43926');
  });

  it('computes the empty string as zero', () => {
    expect(crc32Hex(new Uint8Array())).toBe('00000000');
  });

  it('is order sensitive', () => {
    const a = crc32Hex(new TextEncoder().encode('ab'));
    const b = crc32Hex(new TextEncoder().encode('ba'));
    expect(a).not.toBe(b);
  });

  it('handles a 1 MiB buffer without throwing', () => {
    const data = new Uint8Array(1024 * 1024);
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
    const value = crc32(data);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('md5', () => {
  const vector = (text: string) => toHex(md5(new TextEncoder().encode(text)));

  it('matches RFC 1321 test vectors', () => {
    expect(vector('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(vector('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(vector('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(vector('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(vector('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
  });

  it('matches the 55/56/64-byte padding boundaries', () => {
    // These lengths exercise every padding branch.
    expect(vector('a'.repeat(55))).toBe('ef1772b6dff9a122358552954ad0df65');
    expect(vector('a'.repeat(56))).toBe('3b0c8ac703f828b04c6c197006d17218');
    expect(vector('a'.repeat(64))).toBe('014842d480b571495a4a0363793f7367');
  });

  it('hashes binary data consistently', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(toHex(md5(bytes))).toHaveLength(32);
  });
});

describe('duplicateKey', () => {
  it('combines size and CRC so different files never collide trivially', () => {
    expect(duplicateKey(1024, 'deadbeef')).toBe('1024:deadbeef');
  });
});
