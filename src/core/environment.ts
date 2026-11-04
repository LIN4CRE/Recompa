import type { RuntimeEnvironment } from './types';

/**
 * Capability detection. Every value here is measured or read from a real API —
 * nothing is inferred from a product name. The planner uses these flags instead
 * of user-agent sniffing wherever possible.
 */
let cached: RuntimeEnvironment | null = null;

function detectWasmSimd(): boolean {
  // Magic bytes for a module using i8x16 intrinsics; validation only, no run.
  const bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, 0x03,
    0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0xfd, 0x62, 0x0b,
  ]);
  try {
    return WebAssembly.validate(bytes);
  } catch {
    return false;
  }
}

function detectThreads(): boolean {
  if (typeof SharedArrayBuffer === 'undefined') return false;
  try {
    const bytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x05, 0x04, 0x01, 0x03, 0x01, 0x01,
    ]);
    return WebAssembly.validate(bytes);
  } catch {
    return false;
  }
}

async function detectWebGpu(): Promise<boolean> {
  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  if (!nav.gpu) return false;
  try {
    const adapter = await nav.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

function detectGpuRenderer(): string | null {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      if (typeof renderer === 'string') return redactGpu(renderer);
    }
    return gl.getParameter(gl.RENDERER) ?? null;
  } catch {
    return null;
  }
}

/**
 * GPU strings are a fingerprinting vector. We keep the model family (useful for
 * diagnostics and adaptive quality) and drop driver revisions / vendor ids.
 */
export function redactGpu(renderer: string): string {
  return renderer
    .replace(/ANGLE \(([^)]*)\)/g, '$1')
    .replace(/\bDirect3D\d*\b/gi, '')
    .replace(/\bvs_\d+_\d+\b/gi, '')
    .replace(/\(0x[0-9a-f]+\)/gi, '')
    .replace(/\bD3D\d+\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function detectTouch(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export function userAgentClass(): RuntimeEnvironment['userAgentClass'] {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
  if (/Mobi|Android.*Mobile|iPhone|iPod/i.test(ua)) return 'mobile';
  return 'desktop';
}

export async function detectEnvironment(): Promise<RuntimeEnvironment> {
  if (cached) return cached;
  const nav = navigator as Navigator & { deviceMemory?: number; hardwareConcurrency?: number };
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const gl2 = canvas?.getContext('webgl2') ?? null;
  const gl1 = gl2 ? null : (canvas?.getContext('webgl') ?? null);

  const env: RuntimeEnvironment = {
    webAssembly: typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function',
    wasmSimd: detectWasmSimd(),
    wasmThreads: detectThreads(),
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated:
      typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
    webgpu: await detectWebGpu(),
    webgl2: Boolean(gl2),
    webgl1: Boolean(gl1),
    audioWorklet: typeof AudioWorkletNode !== 'undefined',
    indexedDb: typeof indexedDB !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    gamepadApi: typeof navigator !== 'undefined' && 'getGamepads' in navigator,
    touch: detectTouch(),
    cores: nav.hardwareConcurrency ?? null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    gpuRenderer: detectGpuRenderer(),
    userAgentClass: userAgentClass(),
  };
  cached = env;
  return env;
}

/**
 * Engine-specific runtime prerequisites that are not simple boolean flags.
 *
 * mGBA's Emscripten build is compiled with SDL2 + OpenGL ES 2 emulation, which
 * in the browser means it creates a **WebGL2** context on its canvas
 * (`canvas.getContext("webgl2")` in the glue). Without WebGL2 it cannot
 * initialise video at all — so the planner must reject it up-front instead of
 * failing after the ROM has been read.
 */
export function enginePrerequisiteBlockers(
  env: RuntimeEnvironment,
  engineId: string,
): { blockers: string[]; notes: string[] } {
  const blockers: string[] = [];
  const notes: string[] = [];
  if (engineId === 'mgba-wasm') {
    if (!env.webgl2) {
      blockers.push(
        'mGBA is built on SDL2/OpenGL ES and requires a WebGL2 context. This browser reports no WebGL2 support, so the core cannot initialise video.',
      );
    }
    if (!env.indexedDb) {
      notes.push('IndexedDB is unavailable: SRAM and save states will not persist between sessions.');
    }
  }
  if (engineId === 'jsnes') {
    if (env.cores !== null && env.cores <= 1) {
      notes.push('Single-core device: jsnes runs on the main thread and may stutter.');
    }
  }
  return { blockers, notes };
}

/** Synchronous cache read for code paths that cannot await (e.g. render). */
export function environmentSnapshot(): RuntimeEnvironment | null {
  return cached;
}

/**
 * Adaptive quality recommendation based on measured capabilities, not on the
 * device name. Used as the initial value only — the user can override, and the
 * player never silently degrades accuracy.
 */
export function recommendedQuality(env: RuntimeEnvironment): 'quality' | 'balanced' | 'speed' {
  if (env.userAgentClass === 'mobile') return env.cores && env.cores >= 8 ? 'balanced' : 'speed';
  if ((env.cores ?? 4) <= 2) return 'speed';
  if (env.webgpu || (env.webgl2 && (env.cores ?? 4) >= 6)) return 'quality';
  return 'balanced';
}
