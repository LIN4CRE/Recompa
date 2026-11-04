import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Cpu, Database, Gauge, HardDrive, Layers, Play, ShieldCheck, Terminal, Upload, Zap } from 'lucide-react';
import { useLibrary } from '@/state/library';
import { useNavigate } from '@/lib/router';
import { Uploader, type UploadResult } from '../components/Uploader';
import { CoverArt } from '../components/CoverArt';
import {
  bytes,
  EmptyState,
  MethodBadge,
  Panel,
  PlatformBadge,
  relativeTime,
  SectionHeader,
  Spinner,
} from '../components/primitives';
import { detectEnvironment } from '@/core/environment';
import type { RuntimeEnvironment } from '@/core/types';
import { PLATFORMS } from '@/core/platforms';
import { fetchCatalogueIndex, type CatalogueIndex } from '@/core/catalogue';
import { ENGINE_ADAPTERS } from '@/engines';
import { descriptorsForUi } from '@/core/planner';
import { runSelfTest } from '@/lib/selftest';
import { FlaskConical } from 'lucide-react';

export function HomePage() {
  const navigate = useNavigate();
  const games = useLibrary((s) => s.games);
  const loading = useLibrary((s) => s.loading);
  const jobs = useLibrary((s) => s.jobs);
  const [env, setEnv] = useState<RuntimeEnvironment | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueIndex | null>(null);
  const [lastUpload, setLastUpload] = useState<UploadResult[] | null>(null);
  const [selfTestBusy, setSelfTestBusy] = useState(false);

  useEffect(() => {
    void detectEnvironment().then(setEnv);
    void fetchCatalogueIndex().then(setCatalogue);
  }, []);

  const recent = useMemo(
    () => [...games].filter((g) => g.lastPlayedAt).sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)).slice(0, 4),
    [games],
  );
  const favourites = useMemo(() => games.filter((g) => g.favourite).slice(0, 4), [games]);
  const fingerprints = catalogue?.entries.reduce((n, e) => n + e.count, 0) ?? null;
  const platformsWithData = new Set(catalogue?.entries.map((e) => e.platform) ?? []);
  const liveEngines = ENGINE_ADAPTERS.map((a) => a.descriptor);
  const plannedEngines = descriptorsForUi().filter((d) => !liveEngines.some((l) => l.id === d.id));

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-panel-2/90 via-panel/80 to-void p-5 sm:p-8">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.13]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.55) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.55) 1px, transparent 1px)',
            backgroundSize: '54px 54px',
            maskImage: 'radial-gradient(ellipse at 70% 0%, black, transparent 70%)',
          }}
          aria-hidden
        />
        <div className="relative grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-lime/25 bg-lime/[0.07] px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-lime uppercase">
              <span className="size-1.5 animate-[pulse-soft_2.4s_ease-in-out_infinite] rounded-full bg-lime" />
              Local-first · no upload · no account
            </div>
            <h1 className="font-display text-[clamp(1.85rem,4.4vw,3rem)] leading-[1.03] font-bold tracking-[-0.03em] text-balance">
              Drop a ROM.
              <br />
              <span className="text-lime glow-text-lime">Know exactly</span> how it runs.
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-ink-2">
              Recompa fingerprints your file, verifies every checksum, then walks the full execution ladder — verified
              recompilation, static recompilation, source ports, WebAssembly cores — and tells you which one is actually
              available. No invented compatibility, no fake progress bars.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button className="btn btn-primary btn-lg" onClick={() => navigate('/upload')}>
                <Upload className="size-4" /> Analyse a ROM
              </button>
              <button className="btn btn-lg" onClick={() => navigate('/library')}>
                <Play className="size-4" /> Open library
                {games.length > 0 && <span className="ml-1 font-mono text-[11px] text-ink-3">{games.length}</span>}
              </button>
              <button
                className="btn btn-lg"
                disabled={selfTestBusy}
                title="Generate Recompa's own NES test cartridge, then verify the engine against it"
                onClick={async () => {
                  setSelfTestBusy(true);
                  try {
                    const result = await runSelfTest();
                    navigate(`/game/${result.game.id}`);
                  } finally {
                    setSelfTestBusy(false);
                  }
                }}
              >
                <FlaskConical className="size-4" />
                {selfTestBusy ? 'Generating…' : 'Self-test engine'}
              </button>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat icon={<Database className="size-3.5" />} label="Fingerprints" value={fingerprints ? fingerprints.toLocaleString() : '—'} />
              <Stat icon={<Cpu className="size-3.5" />} label="Live engines" value={String(liveEngines.length)} />
              <Stat icon={<HardDrive className="size-3.5" />} label="In library" value={String(games.length)} />
              <Stat icon={<Terminal className="size-3.5" />} label="Jobs" value={String(jobs.length)} />
            </dl>
          </div>

          <div className="lg:pl-4">
            <Uploader
              compact
              onComplete={(results) => {
                setLastUpload(results);
                if (results[0]) navigate(`/game/${results[0].game.id}`);
              }}
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section>
        <SectionHeader
          eyebrow="Pipeline"
          title="What actually happens to your file"
          description="Every step below runs in this browser tab. The numbered stages are the same objects you see in a job's report."
        />
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { n: '01', t: 'Fingerprint', d: 'CRC32, MD5, SHA-1 and SHA-256 over the canonical payload, with iNES/copier/SMD headers stripped first.', icon: <ShieldCheck className="size-4" /> },
            { n: '02', t: 'Identify', d: 'Container and platform are proven from bytes. Titles come from a No-Intro fingerprint match, never from a guess.', icon: <Database className="size-4" /> },
            { n: '03', t: 'Audit methods', d: 'Each engine adapter declares what it can run. Rejected options keep their rejection reasons in the report.', icon: <Layers className="size-4" /> },
            { n: '04', t: 'Run & verify', d: 'PLAY boots a real core. Verification then samples video, audio, input and state round-trips before claiming compatibility.', icon: <Gauge className="size-4" /> },
          ].map((step) => (
            <li key={step.n} className="panel group p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-[0.2em] text-ink-4">{step.n}</span>
                <span className="grid size-7 place-items-center rounded-md border border-line bg-panel-2 text-ink-3 transition-colors group-hover:text-lime">{step.icon}</span>
              </div>
              <h3 className="mt-3 text-sm font-semibold">{step.t}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-3">{step.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Recent + favourites */}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <SectionHeader
            eyebrow="Continue"
            title="Recently played"
            actions={
              games.length > 0 ? (
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/library')}>
                  Library <ArrowRight className="size-3.5" />
                </button>
              ) : undefined
            }
          />
          {loading ? (
            <div className="flex items-center gap-2 p-4 text-xs text-ink-3">
              <Spinner /> reading local library…
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<Play className="size-5" />}
              title="Nothing played yet"
              description="Games you launch appear here with their real engine, play time and last-played timestamp."
              action={
                <button className="btn btn-sm" onClick={() => navigate('/upload')}>
                  Add your first ROM
                </button>
              }
            />
          ) : (
            <div className="grid gap-2">
              {recent.map((game) => (
                <button
                  key={game.id}
                  onClick={() => navigate(`/play/${game.id}`)}
                  className="group flex items-center gap-3 rounded-xl border border-line bg-panel/60 p-2 text-left transition-colors hover:border-line-bright hover:bg-panel-2"
                >
                  <div className="w-11 shrink-0">
                    <CoverArt game={game} className="rounded" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{game.title}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-ink-4">
                      <PlatformBadge platformId={game.platformId} className="h-4 px-1 text-[9px]" />
                      <span>{relativeTime(game.lastPlayedAt)}</span>
                      <span>·</span>
                      <span>{formatPlaytime(game.playSeconds)}</span>
                    </div>
                  </div>
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-lime/30 bg-lime/10 text-lime opacity-0 transition-opacity group-hover:opacity-100">
                    <Play className="size-3.5 fill-current" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionHeader eyebrow="Saved" title="Favourites" />
          {favourites.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="size-5" />}
              title="No favourites yet"
              description="Tap the heart on any game card to pin it here."
            />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {favourites.map((game) => (
                <button key={game.id} onClick={() => navigate(`/play/${game.id}`)} className="group text-left">
                  <CoverArt game={game} className="transition-transform group-hover:-translate-y-0.5" />
                  <div className="mt-1 truncate text-[11px] font-medium">{game.title}</div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Engines + platforms */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionHeader eyebrow="Engines" title="Execution backends" description="Declared capabilities, licences and the truth about what each one is." />
          <div className="space-y-2">
            {[...liveEngines, ...plannedEngines].map((descriptor) => {
              const live = liveEngines.some((d) => d.id === descriptor.id);
              return (
                <div key={descriptor.id} className="panel p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-[13px] font-semibold">{descriptor.name}</h3>
                        <span
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[9px] uppercase ${
                            live ? 'border-mint/35 bg-mint/10 text-mint' : 'border-amber/30 bg-amber/8 text-amber'
                          }`}
                        >
                          <span className="size-1 rounded-full bg-current" />
                          {live ? 'active' : 'not installed'}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <MethodBadge kind={descriptor.kind} />
                        <span className="font-mono text-[10px] text-ink-4">{descriptor.licence}</span>
                        <span className="font-mono text-[10px] text-ink-4">v{descriptor.version}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 font-mono text-[9px] text-ink-4">
                      {descriptor.supports.wasm && <span className="chip h-4 px-1 text-[8px]">WASM</span>}
                      {descriptor.supports.saveStates && <span className="chip h-4 px-1 text-[8px]">states</span>}
                      {descriptor.supports.touch && <span className="chip h-4 px-1 text-[8px]">touch</span>}
                    </div>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-ink-3">{descriptor.performanceNotes}</p>
                  {!live && (
                    <p className="mt-1.5 rounded border border-line bg-black/25 px-2 py-1 font-mono text-[10px] leading-relaxed text-ink-4">
                      {descriptor.installHint ? `Install: ${descriptor.installHint}` : descriptor.unavailableReason}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <SectionHeader
            eyebrow="Platforms"
            title="Detection coverage"
            description="Every platform below has a real byte-level detector. A platform is only shown as identified when its signature matched."
          />
          <div className="panel p-3">
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {PLATFORMS.filter((p) => p.id !== 'arcade').map((platform) => {
                const indexed = platformsWithData.has(platform.id);
                return (
                  <div
                    key={platform.id}
                    className="flex items-center gap-1.5 rounded-md border border-line bg-black/20 px-1.5 py-1"
                    title={`${platform.name} — ${indexed ? 'fingerprint database loaded' : 'detector only, no fingerprint DB'}`}
                  >
                    <span className={`size-1.5 shrink-0 rounded-full ${indexed ? 'bg-ice' : 'bg-line-bright'}`} />
                    <span className="truncate font-mono text-[10px] text-ink-3">{platform.name.replace(/Nintendo |Sega |Atari /, '')}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-line pt-2 font-mono text-[10px] text-ink-4">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-ice" /> fingerprint DB
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-line-bright" /> detector only
              </span>
            </div>
          </div>

          <div className="panel mt-3 p-3">
            <div className="mono-label mb-2 flex items-center gap-1.5">
              <Zap className="size-3" /> This device
            </div>
            {env ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px]">
                <Fact label="WebAssembly" value={env.webAssembly ? (env.wasmSimd ? 'SIMD' : 'yes') : 'no'} ok={env.webAssembly} />
                <Fact label="Cross-origin isolated" value={env.crossOriginIsolated ? 'yes (SAB)' : 'no'} ok={env.crossOriginIsolated} />
                <Fact label="WebGPU" value={env.webgpu ? 'available' : 'no'} ok={env.webgpu} />
                <Fact label="WebGL2" value={env.webgl2 ? 'available' : 'no'} ok={env.webgl2} />
                <Fact label="AudioWorklet" value={env.audioWorklet ? 'yes' : 'no'} ok={env.audioWorklet} />
                <Fact label="IndexedDB" value={env.indexedDb ? 'yes' : 'no'} ok={env.indexedDb} />
                <Fact label="CPU cores" value={env.cores ? String(env.cores) : 'unknown'} ok={Boolean(env.cores)} />
                <Fact label="Device memory" value={env.deviceMemoryGb ? `${env.deviceMemoryGb} GB` : 'unknown'} ok={Boolean(env.deviceMemoryGb)} />
                <Fact label="Pointer" value={env.touch ? 'coarse (touch)' : 'fine'} ok />
                <Fact label="GPU" value={env.gpuRenderer ? truncate(env.gpuRenderer, 26) : 'masked'} ok={Boolean(env.gpuRenderer)} />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[10px] text-ink-3">
                <Spinner /> probing capabilities…
              </div>
            )}
          </div>
        </section>
      </div>

      {lastUpload && lastUpload[0] && (
        <section>
          <SectionHeader eyebrow="Last analysis" title="Latest result" />
          <Panel className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{lastUpload[0].report.identification.title ?? lastUpload[0].fileName}</div>
                <div className="mt-0.5 font-mono text-[10px] text-ink-4">
                  {lastUpload[0].report.platform?.name ?? 'platform not identified'} · {bytes(lastUpload[0].report.checksums.size)}
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => navigate(`/game/${lastUpload[0]!.game.id}`)}>
                Open report <ArrowRight className="size-3.5" />
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-3">{lastUpload[0].job.plan.summary}</p>
          </Panel>
        </section>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-black/25 px-2.5 py-2">
      <dt className="flex items-center gap-1 font-mono text-[9px] tracking-[0.12em] text-ink-4 uppercase">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 font-display text-lg leading-none font-semibold text-ink">{value}</dd>
    </div>
  );
}

function Fact({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line/50 py-0.5 last:border-0">
      <span className="truncate text-ink-4">{label}</span>
      <span className={`shrink-0 ${ok ? 'text-ink-2' : 'text-ink-4'}`}>{value}</span>
    </div>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatPlaytime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
