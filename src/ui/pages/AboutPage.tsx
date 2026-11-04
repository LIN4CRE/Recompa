import { useEffect, useState } from 'react';
import { ExternalLink, Scale, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Panel, SectionHeader } from '../components/primitives';
import { ENGINE_ADAPTERS } from '@/engines';
import { descriptorsForUi } from '@/core/planner';
import { fetchCatalogueIndex, type CatalogueIndex } from '@/core/catalogue';
import { runSelfTest } from '@/lib/selftest';
import { useNavigate } from '@/lib/router';
import { FlaskConical } from 'lucide-react';

const ATTRIBUTION = [
  {
    name: 'jsnes',
    licence: 'Apache-2.0',
    use: 'NES execution core (CPU, PPU, APU, mappers).',
    url: 'https://github.com/bfirsh/jsnes',
  },
  {
    name: 'mGBA / @thenick775/mgba-wasm',
    licence: 'MPL-2.0',
    use: 'Game Boy Advance, Game Boy and Game Boy Color core compiled to WebAssembly.',
    url: 'https://github.com/thenick775/mgba-wasm',
  },
  {
    name: 'No-Intro DAT sets via libretro-database',
    licence: 'CC-BY-SA-4.0',
    use: 'ROM fingerprint metadata (titles, sizes, CRC32/SHA-1). No game data is distributed.',
    url: 'https://github.com/libretro/libretro-database',
  },
  {
    name: 'fflate',
    licence: 'MIT',
    use: 'Zip archive inspection in the browser.',
    url: 'https://github.com/101arrowz/fflate',
  },
  {
    name: 'idb',
    licence: 'ISC',
    use: 'IndexedDB access layer.',
    url: 'https://github.com/jakearchibald/idb',
  },
  {
    name: 'React, Vite, Tailwind CSS, Zustand, lucide-react',
    licence: 'MIT / Apache-2.0 / ISC',
    use: 'Application framework, build tooling, styling, state and iconography.',
    url: 'https://github.com/facebook/react',
  },
  {
    name: 'EmulatorJS + libretro cores',
    licence: 'GPL-3.0 (EmulatorJS) / per-core',
    use: 'Optional additional cores, installed by the operator with `npm run fetch:emulatorjs`. Not bundled in this repository.',
    url: 'https://github.com/EmulatorJS/EmulatorJS',
  },
  {
    name: 'N64Recomp / N64ModernRuntime / Zelda64Recomp',
    licence: 'MIT / GPL-3.0',
    use: 'Referenced and audited for the static-recompilation ladder. No binary or source is vendored here.',
    url: 'https://github.com/N64Recomp/N64Recomp',
  },
  {
    name: 'REA (morluto/rea)',
    licence: 'MIT',
    use: 'Optional agent-assisted reverse-engineering assistant, invoked only by the local processing service.',
    url: 'https://github.com/morluto/rea',
  },
];

export function AboutPage() {
  const navigate = useNavigate();
  const [selfTestBusy, setSelfTestBusy] = useState(false);
  const [catalogue, setCatalogue] = useState<CatalogueIndex | null>(null);
  useEffect(() => {
    void fetchCatalogueIndex().then(setCatalogue);
  }, []);
  const engines = descriptorsForUi();

  return (
    <div className="space-y-4">
      <div>
        <div className="mono-label mb-1">Project</div>
        <h1 className="font-display text-2xl font-bold tracking-tight">About Recompa</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-3">
          Recompa is a local-first workbench for legally obtained game files. It identifies what a file is, proves it with hashes,
          audits every execution route that exists today, and runs the best one it can actually deliver in a browser — while stating
          plainly which method is running.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel className="p-4">
          <SectionHeader eyebrow="Principles" title="What we refuse to do" />
          <ul className="space-y-1.5 text-[11px] leading-relaxed text-ink-3">
            <li>· No ROMs, BIOS files or firmware are distributed, bundled or downloaded.</li>
            <li>· No DRM or platform security is bypassed.</li>
            <li>· No file is uploaded, and the app makes no third-party requests at runtime.</li>
            <li>· No compatibility is claimed without a recorded test on the device.</li>
            <li>· Emulation is never labelled as recompilation.</li>
            <li>· Uploaded files are parsed as untrusted data — never executed as native code.</li>
          </ul>
        </Panel>

        <Panel className="p-4">
          <SectionHeader eyebrow="Legal" title="Your responsibility" />
          <p className="text-[11px] leading-relaxed text-ink-3">
            You must own the original media, or hold a licence that permits the copy you load. Recompa cannot verify ownership and does
            not attempt to. Titles, trademarks and copyrights belong to their holders; identifying a file is not a claim of ownership.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            The bundled fingerprint dataset contains metadata only and is distributed under CC-BY-SA-4.0; it does not include or
            reproduce any game content.
          </p>
        </Panel>

        <Panel className="p-4">
          <SectionHeader eyebrow="Status" title="Honest scope" />
          <p className="text-[11px] leading-relaxed text-ink-3">
            Two execution engines are integrated and tested: a JavaScript NES core and a WebAssembly GBA/GB/GBC core. Broader platform
            support requires additional cores that are not shipped here, and the app says so rather than offering dead buttons.
          </p>
          <p className="mt-2 font-mono text-[10px] text-ink-4">
            {engines.filter((e) => ENGINE_ADAPTERS.some((a) => a.descriptor.id === e.id)).length} live engines ·{' '}
            {catalogue?.entries.reduce((n, e) => n + e.count, 0).toLocaleString() ?? '—'} fingerprints
          </p>
        </Panel>
      </div>

      <Panel className="p-4">
        <SectionHeader eyebrow="Attribution" title="Third-party software" description="See THIRD-PARTY-NOTICES.md for full licence texts and retrieval dates." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-line">
                {['Project', 'Licence', 'Used for', ''].map((h, i) => (
                  <th key={i} className="px-2 py-1.5 font-mono text-[9px] tracking-[0.12em] text-ink-4 uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ATTRIBUTION.map((dep) => (
                <tr key={dep.name} className="border-b border-line/60 last:border-0">
                  <td className="px-2 py-1.5 text-[11px] font-medium">{dep.name}</td>
                  <td className="px-2 py-1.5">
                    <span className="chip h-4 px-1 text-[8px]">
                      <Scale className="size-2.5" /> {dep.licence}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-[10px] leading-relaxed text-ink-3">{dep.use}</td>
                  <td className="px-2 py-1.5">
                    <a className="link inline-flex items-center gap-1 font-mono text-[10px]" href={dep.url} target="_blank" rel="noreferrer noopener">
                      repo <ExternalLink className="size-2.5" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel className="p-4">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-mint" />
            <h2 className="text-xs font-semibold">Security model</h2>
          </div>
          <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-ink-3">
            <li>· ROM bytes are parsed in the main thread with bounds-checked readers; malformed headers cannot index out of range.</li>
            <li>· Archives are inspected through a filter pass; only one selected member is inflated, with a 256 MiB cap.</li>
            <li>· Emulator cores receive bytes only — no native code from the ROM runs on the host.</li>
            <li>· The optional processing service binds to loopback, validates origins, enforces a byte cap, and never executes uploaded binaries.</li>
            <li>· No analytics, no error reporting beacons, no third-party scripts.</li>
          </ul>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="size-3.5 text-amber" />
            <h2 className="text-xs font-semibold">Known limitations</h2>
          </div>
          <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-ink-3">
            <li>· Recompilation in the browser is not shipped: N64Recomp requires a native toolchain and a symbol map, and the modern runtime has no WASM build.</li>
            <li>· Only NES and GBA/GB/GBC have integrated execution cores in this release.</li>
            <li>· Fingerprint coverage depends on the installed DAT set for each platform.</li>
            <li>· Disc-based systems need their own BIOS, supplied by you; no core for them is bundled.</li>
            <li>· PAL timing is not modelled by the NES core.</li>
          </ul>
        </Panel>
      </div>

      <Panel className="p-4">
        <SectionHeader
          eyebrow="Self-verification"
          title="Prove the engine works on your device"
          description="Recompa can generate its own NES test cartridge in memory — a small program that boots, renders and animates. It is not a game and contains no third-party code or assets."
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn btn-ice btn-sm"
            disabled={selfTestBusy}
            onClick={async () => {
              setSelfTestBusy(true);
              try {
                const { game } = await runSelfTest();
                navigate(`/game/${game.id}`);
              } finally {
                setSelfTestBusy(false);
              }
            }}
          >
            <FlaskConical className="size-3.5" /> {selfTestBusy ? 'Generating…' : 'Add self-test cartridge'}
          </button>
          <p className="font-mono text-[10px] text-ink-4">
            Launch it, press <span className="text-ink-2">Verify</span>, and the harness records real measurements for boot, video,
            animation, input and save-state round-trip.
          </p>
        </div>
      </Panel>

      <Panel className="p-4">
        <SectionHeader eyebrow="Architecture" title="Module boundaries" />
        <div className="grid gap-2 font-mono text-[10px] sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['core/detect', 'Byte-level platform & container detection'],
            ['core/analyze', 'Canonicalisation, hashing, report assembly'],
            ['core/catalogue', 'Fingerprint lookup (No-Intro DATs)'],
            ['core/planner', 'Execution ladder & job plans'],
            ['core/verification', 'Live test harness'],
            ['engines/*', 'Independent adapters (jsnes, mGBA)'],
            ['db/database', 'IndexedDB persistence'],
            ['ui/player', 'Lifecycle, input, stats, controls'],
            ['lib/zip · lib/exports', 'Archive intake and save export'],
          ].map(([name, desc]) => (
            <div key={name} className="rounded border border-line bg-black/20 p-2">
              <div className="text-ice">{name}</div>
              <div className="mt-0.5 font-sans text-[10px] leading-relaxed text-ink-3">{desc}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
