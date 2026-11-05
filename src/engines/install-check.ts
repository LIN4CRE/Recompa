import { EMULATORJS_PSX_DESCRIPTOR } from './descriptors';

/**
 * Discovers which optional engine payloads actually exist on this deployment.
 *
 * Two rules keep the result honest:
 *
 *  1. Probe the **core payload**, not `loader.js`. The PlayStation setup script
 *     installs `loader.js` plus pcsx_rearmed; treating the loader as an NES core
 *     made `emulatorjs-nes` look installed, and the planner then chose it for
 *     every NES ROM even though no FCEUmm payload and no NES adapter exist. The
 *     game then failed at PLAY with "Engine … is not installed in this build".
 *  2. Only engines with a real adapter are reported. `emulatorjs-nes` is in
 *     PLANNED_ENGINES (declared, not executable) and is never added here.
 *
 * The install manifest written by scripts/setup-emulatorjs.mjs is consulted as
 * an additional signal, because the older 7z-based script does not produce the
 * same file layout. Either source is enough to enable the PlayStation adapter.
 */

const base = import.meta.env.BASE_URL.replace(/\/$/, '');
const INSTALLED_MANIFEST = `${base}/cores/emulatorjs-installed.json`;
const PSX_CORE_URL = `${base}/cores/emulatorjs/data/cores/pcsx_rearmed-wasm.data`;

/** Local adapters are compiled into the bundle, so they are always present. */
const BUILT_IN = ['jsnes', 'mgba-wasm'];

let cached: { at: number; ids: Set<string> } | null = null;
const TTL = 60_000;

async function psxPayloadPresent(): Promise<boolean> {
  const [headOk, manifestOk] = await Promise.all([
    fetch(PSX_CORE_URL, { method: 'HEAD', cache: 'no-store' })
      .then((res) => res.ok)
      .catch(() => false),
    fetch(INSTALLED_MANIFEST, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return false;
        const data = (await res.json()) as { cores?: unknown };
        return Array.isArray(data.cores) && data.cores.includes('pcsx_rearmed');
      })
      .catch(() => false),
  ]);
  return headOk || manifestOk;
}

export async function fetchInstalledEngines(force = false): Promise<Set<string>> {
  if (!force && cached && Date.now() - cached.at < TTL) return cached.ids;
  const ids = new Set<string>(BUILT_IN);
  if (await psxPayloadPresent()) ids.add(EMULATORJS_PSX_DESCRIPTOR.id);
  cached = { at: Date.now(), ids };
  return ids;
}

export function installedEnginesSnapshot(): Set<string> {
  return cached?.ids ?? new Set(BUILT_IN);
}
