import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchInstalledEngines } from '@/engines/install-check';

/**
 * The installed-engine probe must never mistake the shared EmulatorJS loader
 * for an NES core. `loader.js` is installed for the PlayStation adapter; using
 * it as an "emulatorjs-nes" signal made the planner choose an engine with no
 * adapter (see tests/unit/planner.test.ts).
 */
function stubFetch(handler: (url: string) => unknown) {
  const seen: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const value = String(url);
      seen.push(value);
      const result = handler(value) as { ok?: boolean; json?: () => Promise<unknown> } | null;
      if (!result) throw new Error('network error');
      return {
        ok: result.ok ?? false,
        json: async () => result.json?.() ?? {},
      } as Response;
    }),
  );
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchInstalledEngines', () => {
  it('reports the PlayStation core but never an NES core, even when loader.js exists', async () => {
    const seen = stubFetch((url) => {
      if (url.includes('loader.js')) return { ok: true };
      if (url.includes('pcsx_rearmed-wasm.data')) return { ok: true };
      if (url.includes('emulatorjs-installed.json')) return { ok: true, json: async () => ({ cores: ['pcsx_rearmed'] }) };
      return { ok: false };
    });

    const ids = await fetchInstalledEngines(true);
    expect([...ids].sort()).toEqual(['emulatorjs-psx', 'jsnes', 'mgba-wasm']);
    expect(ids.has('emulatorjs-nes')).toBe(false);
    expect(seen.some((url) => url.includes('loader.js'))).toBe(false);
  });

  it('falls back to the built-in engines when nothing is installed', async () => {
    stubFetch(() => null); // every request fails
    const ids = await fetchInstalledEngines(true);
    expect([...ids].sort()).toEqual(['jsnes', 'mgba-wasm']);
  });

  it('trusts the install manifest when the core HEAD probe is unavailable', async () => {
    stubFetch((url) => {
      if (url.includes('pcsx_rearmed-wasm.data')) return { ok: false };
      if (url.includes('emulatorjs-installed.json')) return { ok: true, json: async () => ({ cores: ['pcsx_rearmed'] }) };
      return { ok: false };
    });
    const ids = await fetchInstalledEngines(true);
    expect(ids.has('emulatorjs-psx')).toBe(true);
    expect(ids.has('emulatorjs-nes')).toBe(false);
  });
});
