import * as jsnesNs from 'jsnes';
import type { NES as NesCore } from 'jsnes';
import type { DetectedFormat, HeaderInfo } from '@/core/types';
import { ByteReader } from '@/core/binary';

/**
 * jsnes adapter internals.
 *
 * jsnes 2.1.0 ships a webpack UMD bundle as its `main`, and the UMD wrapper
 * only attaches named exports when the bundle is built with them. Verified in
 * this repo: `Object.keys(require('jsnes'))` is empty, so we must reach into the
 * module's internal registry. The wrapper below tries, in order:
 *   1. `jsnes.NES` (works if upstream restores named exports),
 *   2. `jsnes.default.NES` (UMD namespace interop),
 *   3. the webpack internal module cache (`new NES(...)` in the minified code).
 */

export interface JsnesNES {
  frame(): void;
  buttonDown(port: 1 | 2, button: string): void;
  buttonUp(port: 1 | 2, button: string): void;
  loadROM(data: string): void;
  reset(): void;
  toJSON(): unknown;
  fromJSON(state: unknown): void;
  reloadROM(): void;
  getFPS?(): number;
  mmap?: { cart?: { batteryRam?: Uint8Array } };
}

type NesConstructor = new (opts: {
  onFrame: (buffer: number[]) => void;
  onAudioSample: (left: number, right: number) => void;
  sampleRate: number;
  emulateSound?: boolean;
  onBatteryRamWrite?: (address: number, value: number) => void;
}) => JsnesNES;

export function resolveNesConstructor(): NesConstructor {
  const mod = jsnesNs as unknown as Record<string, unknown>;
  const candidates: unknown[] = [mod.NES, (mod.default as Record<string, unknown> | undefined)?.NES];
  if (typeof mod.default === 'function') candidates.push(mod.default);

  for (const c of candidates) if (typeof c === 'function') return c as NesConstructor;

  // Webpack registry fallback: `__webpack_require__(id)` is exposed on the
  // bundle's internal closure only through `.c`, but ESM interop gives us the
  // factory object on `default`. Try the known module ids by probing `.c`.
  const factory = (mod.default ?? mod) as { c?: Record<string, { exports?: unknown }> };
  if (factory?.c) {
    for (const entry of Object.values(factory.c)) {
      const exports = entry?.exports as Record<string, unknown> | undefined;
      if (exports && typeof exports.NES === 'function') return exports.NES as NesConstructor;
      const nested = exports?.default as Record<string, unknown> | undefined;
      if (nested && typeof nested.NES === 'function') return nested.NES as NesConstructor;
    }
  }
  throw new Error(
    'jsnes did not expose a NES constructor in this build. This is an upstream packaging issue — pin jsnes@2.1.0 or open an issue.',
  );
}

export const NES_BUTTONS: Record<string, string> = {
  A: 'A',
  B: 'B',
  SELECT: 'SELECT',
  START: 'START',
  UP: 'UP',
  DOWN: 'DOWN',
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
};

export const NES_WIDTH = 256;
export const NES_HEIGHT = 240;
/** NES frames per second (NTSC 60.0988, PAL 50.007). */
export const NES_FPS_NTSC = 60.0988;

export function isPal(format: DetectedFormat | null, header: HeaderInfo): boolean {
  if (format?.id === 'ines' || format?.id === 'ines2' || format?.id === 'ines') {
    // Byte 10 (flags7) bit 0 is the TV system flag in iNES.
    const payload = header.fields as Record<string, unknown>;
    if (payload.pal !== undefined) return Boolean(payload.pal);
  }
  // The iNES header is offset 0 in the file; detect.ts exposes only parsed
  // fields, so fall back to NTSC unless a PAL flag was recorded.
  return header.fields.pal === true;
}

/**
 * Battery save extraction. jsnes writes to `mmap.cart.batteryRam` when the
 * cartridge declares battery-backed PRG RAM; we locate it defensively because
 * the property names differ between forks.
 */
export function readBatteryRam(nes: JsnesNES): Uint8Array | null {
  const mmap = nes.mmap as unknown as Record<string, unknown> | undefined;
  if (!mmap) return null;
  const cart = (mmap.cart ?? mmap.Cart) as Record<string, unknown> | undefined;
  if (!cart) return null;
  for (const key of ['batteryRam', 'BatteryRam', '_batteryRam']) {
    const v = cart[key];
    if (v instanceof Uint8Array && v.length > 0) return v.slice();
  }
  return null;
}

export function writeBatteryRam(nes: JsnesNES, sram: Uint8Array): boolean {
  const mmap = nes.mmap as unknown as Record<string, unknown> | undefined;
  const cart = (mmap?.cart ?? mmap?.Cart) as Record<string, unknown> | undefined;
  if (!cart) return false;
  for (const key of ['batteryRam', 'BatteryRam', '_batteryRam']) {
    const v = cart[key];
    if (v instanceof Uint8Array && v.length === sram.length) {
      v.set(sram);
      return true;
    }
  }
  return false;
}

export function parseMapper(format: DetectedFormat | null, header: HeaderInfo): number | null {
  if (!format || !['ines', 'ines2'].includes(format.id)) return null;
  const mapper = header.fields.mapper;
  return typeof mapper === 'number' ? mapper : null;
}

/** Header fields that jsnes' mapper table is known to support (verified list). */
export const JSNES_MAPPERS = [0, 1, 2, 3, 4, 7, 10, 11, 13, 21, 22, 23, 66, 140, 180, 240] as const;

export function mapperSupport(format: DetectedFormat | null, header: HeaderInfo): { supported: boolean; mapper: number | null } {
  const mapper = parseMapper(format, header);
  if (mapper === null) return { supported: false, mapper: null };
  return { supported: (JSNES_MAPPERS as readonly number[]).includes(mapper), mapper };
}

/**
 * Frame analysis for the verification harness.
 *
 * `signature` is an FNV-1a hash over a strided sample of the framebuffer. Two
 * different signatures mean the picture genuinely changed (scroll, animation,
 * or a menu transition), which is how "is this thing alive?" is answered without
 * shipping reference images.
 */
export function analyseFrame(framebuffer: ArrayLike<number>): {
  nonBlackRatio: number;
  distinctColours: number;
  signature: number;
} {
  let nonBlack = 0;
  const seen = new Set<number>();
  let hash = 2166136261 >>> 0;
  const stride = 7; // prime stride avoids aliasing with tile width (8px)
  for (let i = 0; i < framebuffer.length; i += stride) {
    const px = framebuffer[i]!;
    if (px !== 0) nonBlack++;
    if (seen.size < 96) seen.add(px);
    hash ^= px & 0xff;
    hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (px >>> 8) & 0xff;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return {
    nonBlackRatio: nonBlack / Math.ceil(framebuffer.length / stride),
    distinctColours: seen.size,
    signature: hash >>> 0,
  };
}

export function headerPalFlag(fileBytes: Uint8Array): boolean | null {
  if (fileBytes.length < 16) return null;
  const r = new ByteReader(fileBytes);
  if (!(r.u8(0) === 0x4e && r.u8(1) === 0x45 && r.u8(2) === 0x53 && r.u8(3) === 0x1a)) return null;
  return ((r.u8(9) ?? 0) & 0x01) === 1;
}

/**
 * Restart a jsnes instance safely.
 *
 * jsnes 2.1.0's `reset()` rebuilds the CPU/PPU but re-creates the mapper in a
 * state where the PRG banks are not loaded, so the next `frame()` executes
 * garbage (verified: "Game crashed, invalid opcode at address $1fd").
 * `reloadROM()` performs the full load path (mapper + ROM + mirroring) and is
 * the only supported restart for this build.
 */
export function restartNes(nes: JsnesNES, logger?: (message: string) => void): void {
  try {
    nes.reloadROM();
  } catch (error) {
    logger?.(`restart failed: ${(error as Error).message}`);
  }
}

export type { NesCore };
