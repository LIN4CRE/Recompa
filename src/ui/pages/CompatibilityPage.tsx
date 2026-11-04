import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Database, Search, ShieldCheck, Siren } from 'lucide-react';
import { PLATFORMS, PLATFORM_BY_ID } from '@/core/platforms';
import { fetchCatalogueIndex, type CatalogueIndex } from '@/core/catalogue';
import { ENGINE_ADAPTERS } from '@/engines';
import { descriptorsForUi, EXECUTION_PRIORITY, KNOWN_PORT_PROJECTS } from '@/core/planner';
import { useLibrary } from '@/state/library';
import { EmptyState, MethodBadge, Panel, PlatformBadge, SectionHeader, Tabs } from '../components/primitives';
import { formatBytes as bytes } from '@/core/binary';
import { listTests } from '@/db/database';
import type { PlatformId, TestRun } from '@/core/types';

type Tab = 'engines' | 'platforms' | 'tests' | 'projects';

const STATE_KEY = 'compat-matrix-v1';

export function CompatibilityPage() {
  const [tab, setTab] = useState<Tab>('engines');
  const [catalogue, setCatalogue] = useState<CatalogueIndex | null>(null);
  const [tests, setTests] = useState<TestRun[]>([]);

  useEffect(() => {
    void fetchCatalogueIndex().then(setCatalogue);
    void listTests().then(setTests);
  }, []);

  const totalFingerprints = catalogue?.entries.reduce((n, e) => n + e.count, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <div className="mono-label mb-1">Reference</div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Compatibility database</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-3">
          Three separate datasets, never mixed: <strong className="text-ink-2">declared capabilities</strong> (what an adapter can
          execute), <strong className="text-ink-2">fingerprint coverage</strong> (which exact ROM revisions are identifiable), and{' '}
          <strong className="text-ink-2">measured results</strong> (what actually happened when a game was run on this device).
          Nothing is marked compatible without a passing test record.
        </p>
      </div>

      <Tabs
        tabs={[
          { id: 'engines', label: 'Engines' },
          { id: 'platforms', label: 'Platforms', count: PLATFORMS.length },
          { id: 'tests', label: 'Measured results', count: tests.length },
          { id: 'projects', label: 'Recompilation projects', count: KNOWN_PORT_PROJECTS.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'engines' && <EnginesTab />}
      {tab === 'platforms' && <PlatformsTab catalogue={catalogue} totalFingerprints={totalFingerprints} />}
      {tab === 'tests' && <TestsTab tests={tests} />}
      {tab === 'projects' && <ProjectsTab />}

      <Panel className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-3xl text-[10px] leading-relaxed text-ink-4">
            Fingerprint data: No-Intro DAT sets mirrored by libretro-database, licensed CC-BY-SA-4.0. Contains titles, sizes and
            hashes only — no game data. Titles remain the property of their respective trademark holders.
          </p>
          {catalogue && (
            <span className="font-mono text-[10px] text-ink-4">
              {catalogue.entries.length} DATs · {totalFingerprints.toLocaleString()} fingerprints · built {new Date(catalogue.generatedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </Panel>

      <span className="hidden" data-key={STATE_KEY} />
    </div>
  );
}

function EnginesTab() {
  const engines = descriptorsForUi();
  return (
    <div className="space-y-3">
      <Panel className="p-3">
        <SectionHeader
          eyebrow="Priority order"
          title="Execution ladder"
          description="The planner always prefers the highest rung that is genuinely available for the file in front of it."
        />
        <ol className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {EXECUTION_PRIORITY.filter((p) => p.kind !== 'external-tool').map((rung) => {
            const shipped = engines.filter((e) => e.kind === rung.kind);
            const live = shipped.filter((e) => ENGINE_ADAPTERS.some((a) => a.descriptor.id === e.id));
            return (
              <li key={rung.kind} className="rounded-lg border border-line bg-black/20 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-ink-4">rung {rung.priority}</span>
                  <span
                    className={clsx(
                      'rounded px-1.5 py-px font-mono text-[9px] uppercase',
                      live.length ? 'bg-mint/15 text-mint' : 'bg-white/4 text-ink-4',
                    )}
                  >
                    {live.length ? `${live.length} live` : 'not shipped'}
                  </span>
                </div>
                <div className="mt-1 text-xs font-medium">{rung.label}</div>
                <div className="mt-0.5 font-mono text-[10px] text-ink-4">
                  {shipped.length ? shipped.map((e) => e.project).join(' · ') : 'no engine in this build'}
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        {engines.map((engine) => {
          const live = ENGINE_ADAPTERS.some((a) => a.descriptor.id === engine.id);
          return (
            <Panel key={engine.id} className="p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{engine.name}</h3>
                    <span
                      className={clsx(
                        'rounded border px-1.5 py-px font-mono text-[9px] uppercase',
                        live ? 'border-mint/35 bg-mint/10 text-mint' : 'border-amber/30 bg-amber/8 text-amber',
                      )}
                    >
                      {live ? 'integrated' : 'not installed'}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <MethodBadge kind={engine.kind} />
                    <span className="font-mono text-[10px] text-ink-4">{engine.licence}</span>
                  </div>
                </div>
                <a className="link shrink-0 font-mono text-[10px]" href={engine.homepage} target="_blank" rel="noreferrer noopener">
                  source ↗
                </a>
              </div>

              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px]">
                <Row label="version" value={engine.version} />
                <Row label="platforms" value={engine.platforms.map((p) => PLATFORM_BY_ID.get(p)?.name ?? p).join(', ')} />
                <Row label="accepts" value={engine.accepts.join(' ')} />
                <Row label="firmware" value={engine.needsFirmware ? 'required' : 'not required'} />
              </dl>

              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(engine.supports)
                  .filter(([, v]) => v === true)
                  .map(([k]) => (
                    <span key={k} className="chip h-4 px-1 text-[8px]">
                      {k}
                    </span>
                  ))}
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-ink-3">{engine.performanceNotes}</p>

              {engine.limitations.length > 0 && (
                <div className="mt-2">
                  <div className="mono-label mb-1">verified limitations</div>
                  <ul className="space-y-0.5">
                    {engine.limitations.map((limitation, i) => (
                      <li key={i} className="flex gap-1.5 text-[10px] leading-relaxed text-ink-3">
                        <span className="text-amber/70">·</span> {limitation}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!live && engine.unavailableReason && (
                <p className="mt-2 rounded border border-line bg-black/25 p-1.5 font-mono text-[10px] leading-relaxed text-ink-4">
                  {engine.installHint ? `Install with: ${engine.installHint}` : engine.unavailableReason}
                </p>
              )}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

function PlatformsTab({ catalogue, totalFingerprints }: { catalogue: CatalogueIndex | null; totalFingerprints: number }) {
  const [query, setQuery] = useState('');
  const games = useLibrary((s) => s.games);

  const rows = useMemo(() => {
    return PLATFORMS.map((platform) => {
      const entry = catalogue?.entries.find((e) => e.platform === platform.id);
      const engines = ENGINE_ADAPTERS.filter((a) => a.descriptor.platforms.includes(platform.id));
      const libraryCount = games.filter((g) => g.platformId === platform.id).length;
      return { platform, entry, engines, libraryCount };
    }).filter(({ platform }) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return platform.name.toLowerCase().includes(q) || platform.id.includes(q) || platform.manufacturer.toLowerCase().includes(q);
    });
  }, [catalogue, games, query]);

  return (
    <div className="space-y-3">
      <Panel className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" />
            <input className="input h-8 pl-8 text-xs" placeholder="Filter platforms…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <span className="font-mono text-[10px] text-ink-4">
            {totalFingerprints.toLocaleString()} fingerprints · {catalogue?.entries.length ?? 0} datasets
          </span>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-line bg-black/25">
                {['Platform', 'Gen', 'Detector', 'Fingerprints', 'Execute engine', 'In library', 'Firmware'].map((h) => (
                  <th key={h} className="px-3 py-2 font-mono text-[9px] tracking-[0.12em] text-ink-4 uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ platform, entry, engines, libraryCount }) => (
                <tr key={platform.id} className="border-b border-line/70 last:border-0 hover:bg-white/[0.015]">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <PlatformBadge platformId={platform.id as PlatformId} />
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-medium">{platform.name}</div>
                        <div className="truncate font-mono text-[9px] text-ink-4">
                          {platform.manufacturer} · {platform.extensions.slice(0, 5).join(' ')}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-3">{platform.generation || '—'}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 rounded bg-ice/10 px-1.5 py-0.5 font-mono text-[9px] text-ice">
                      <ShieldCheck className="size-2.5" /> byte level
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px]">
                    {entry ? (
                      <span className="text-ink-2">{entry.count.toLocaleString()}</span>
                    ) : (
                      <span className="text-ink-4">— not installed</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {engines.length ? (
                      engines.map((engine) => (
                        <div key={engine.descriptor.id} className="font-mono text-[10px] text-ink-3">
                          {engine.descriptor.project}
                          <span className="text-ink-4"> · {engine.descriptor.kind === 'wasm-emulator' ? 'WASM' : 'JS'}</span>
                        </div>
                      ))
                    ) : (
                      <span className="font-mono text-[10px] text-amber">no engine</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-3">{libraryCount || '—'}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-4">
                    {platform.requiredFirmware?.length ? platform.requiredFirmware.map((f) => f.name).join(', ') : 'none'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="p-3">
        <SectionHeader eyebrow="Datasets" title="Fingerprint sources" />
        {catalogue ? (
          <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {catalogue.entries.map((entry) => (
              <li key={entry.platform} className="flex items-center justify-between rounded border border-line bg-black/20 px-2 py-1.5">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[10px] text-ink-2">{PLATFORM_BY_ID.get(entry.platform)?.name ?? entry.platform}</div>
                  <div className="font-mono text-[9px] text-ink-4">
                    No-Intro {entry.datVersion} · {bytes(entry.bytes)}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-ice">{entry.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<Database className="size-5" />}
            title="Fingerprint database not installed"
            description="Run `npm run fetch:dat` to download the No-Intro DAT fingerprints (titles + hashes only). Without it, platform detection still works but titles cannot be verified."
          />
        )}
      </Panel>
    </div>
  );
}

function TestsTab({ tests }: { tests: TestRun[] }) {
  const games = useLibrary((s) => s.games);
  return (
    <Panel className="p-3">
      <SectionHeader
        eyebrow="Measured"
        title="Results recorded on this device"
        description="These records are produced by the verification harness while a game is running. They are the only evidence Recompa accepts for 'compatible'."
      />
      {tests.length === 0 ? (
        <EmptyState
          icon={<Siren className="size-5" />}
          title="No measured results yet"
          description="Launch a game, press Verify in the player toolbar, and the run will appear here with per-check measurements."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-line bg-black/25">
                {['When', 'Game', 'Engine', 'Outcome', 'Checks', 'FPS'].map((h) => (
                  <th key={h} className="px-3 py-2 font-mono text-[9px] tracking-[0.12em] text-ink-4 uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tests.slice(0, 60).map((test) => (
                <tr key={test.id} className="border-b border-line/70 last:border-0">
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-3">{new Date(test.startedAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-[11px]">{games.find((g) => g.id === test.gameId)?.title ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-3">{test.engineId}</td>
                  <td className="px-3 py-2">
                    <span
                      className={clsx(
                        'rounded px-1.5 py-0.5 font-mono text-[9px] uppercase',
                        test.status === 'passed' ? 'bg-mint/15 text-mint' : test.status === 'failed' ? 'bg-rose/15 text-rose' : 'bg-white/5 text-ink-3',
                      )}
                    >
                      {test.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-3">
                    {test.checks.filter((c) => c.status === 'pass').length} pass · {test.checks.filter((c) => c.status === 'fail').length} fail ·{' '}
                    {test.checks.filter((c) => c.status === 'skip').length} skip
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-3">{test.environment.fps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ProjectsTab() {
  return (
    <div className="space-y-3">
      <Panel className="p-3">
        <SectionHeader
          eyebrow="Audit"
          title="Game-specific recompilation projects"
          description="Real projects, with their real browser status. A native build existing on GitHub does not make it a browser engine."
        />
        <ul className="space-y-2">
          {KNOWN_PORT_PROJECTS.map((project) => (
            <li key={project.id} className="rounded-lg border border-line bg-black/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold">{project.project}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-ink-4">
                    {PLATFORM_BY_ID.get(project.platform)?.name} · {project.licence}
                  </div>
                </div>
                <span
                  className={clsx(
                    'rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase',
                    project.browserRunnable ? 'border-mint/35 bg-mint/10 text-mint' : 'border-amber/30 bg-amber/8 text-amber',
                  )}
                >
                  {project.browserRunnable ? 'browser runnable' : 'native only'}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-2">{project.artefact}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{project.note}</p>
              <a className="link mt-1 inline-block font-mono text-[10px]" href={project.homepage} target="_blank" rel="noreferrer noopener">
                {project.homepage}
              </a>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel className="p-3">
        <SectionHeader eyebrow="Analysis tooling" title="Reverse-engineering integration" />
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-black/20 p-2.5">
            <div className="text-xs font-semibold">REA (morluto/rea)</div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
              Agent-assisted reverse engineering with a TypeScript/Node toolchain and MCP plugins. MIT licensed.
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-amber/80">
              Used as an optional <em>analysis assistant</em> via the local processing service, never as a ROM converter. It needs an
              LLM provider key and a real model, so it is disabled unless you configure both.
            </p>
          </div>
          <div className="rounded-lg border border-line bg-black/20 p-2.5">
            <div className="text-xs font-semibold">Ghidra / Rizin / radare2</div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
              Ghidra (Apache-2.0) and Rizin/radare2 (LGPL-3.0) provide disassembly and function maps. They are invoked by the optional
              local service to produce symbol maps for static recompilers.
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-ink-4">
              Not executed in the browser: they are native JVM/C tools. Recompa’s core app works without them.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-line/50 py-0.5">
      <dt className="text-ink-4">{label}</dt>
      <dd className="truncate text-right text-ink-2" title={value}>
        {value}
      </dd>
    </div>
  );
}

