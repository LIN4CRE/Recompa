import { EMULATORJS_DESCRIPTOR } from './descriptors';

/**
 * Discovers which optional engine payloads exist on this deployment.
 *
 * A HEAD request against the engine's entry point is the only honest way to
 * know whether a core is installed: the descriptor's `available` flag is a
 * build-time default, not a runtime fact.
 */

const PROBES: Array<{ id: string; url: string }> = [
  { id: EMULATORJS_DESCRIPTOR.id, url: `${import.meta.env.BASE_URL.replace(/\/$/, '')}/cores/emulatorjs/data/loader.js` },
];

let cached: { at: number; ids: Set<string> } | null = null;
const TTL = 60_000;

export async function fetchInstalledEngines(force = false): Promise<Set<string>> {
  if (!force && cached && Date.now() - cached.at < TTL) return cached.ids;
  const ids = new Set<string>();
  await Promise.all(
    PROBES.map(async (probe) => {
      try {
        // `cache: no-store` avoids a stale 404 after a fresh install.
        const res = await fetch(probe.url, { method: 'HEAD', cache: 'no-store' });
        if (res.ok) ids.add(probe.id);
      } catch {
        /* offline / blocked — engine stays unavailable */
      }
    }),
  );
  // Local adapters are compiled into the bundle, so they are always present.
  ids.add('jsnes');
  ids.add('mgba-wasm');
  cached = { at: Date.now(), ids };
  return ids;
}

export function installedEnginesSnapshot(): Set<string> {
  return cached?.ids ?? new Set(['jsnes', 'mgba-wasm']);
}
