import { useEffect, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import {
  Activity,
  Cpu,
  Database,
  Gamepad2,
  HardDrive,
  Home,
  Info,
  Library,
  Settings as SettingsIcon,
  Upload,
  X,
} from 'lucide-react';
import { useRoute, useNavigate } from '@/lib/router';
import { useLibrary } from '@/state/library';
import { fetchCatalogueIndex, type CatalogueIndex } from '@/core/catalogue';
import { ALL_DESCRIPTORS } from '@/engines/descriptors';
import { detectEnvironment } from '@/core/environment';
import type { RuntimeEnvironment } from '@/core/types';
import { Spinner } from './primitives';
import { SupportButton } from './SupportButton';

const NAV = [
  { path: '/', label: 'Home', icon: Home },
  { path: '/library', label: 'Library', icon: Library },
  { path: '/upload', label: 'Upload ROM', icon: Upload },
  { path: '/jobs', label: 'Jobs', icon: Activity },
  { path: '/compatibility', label: 'Compatibility', icon: Database },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
  { path: '/about', label: 'About', icon: Info },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const route = useRoute();
  const navigate = useNavigate();
  const jobs = useLibrary((s) => s.jobs);
  const games = useLibrary((s) => s.games);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0 });
  }, [route.path]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeJobs = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;

  return (
    <div className="min-h-dvh">
      <div className="app-backdrop" aria-hidden />

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col border-r border-line bg-abyss/85 backdrop-blur-xl lg:flex">
        <Brand />
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {NAV.map((item) => {
            const active = route.path === item.path || (item.path !== '/' && route.path.startsWith(item.path));
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={clsx(
                  'group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                  active ? 'bg-panel-2 text-ink' : 'text-ink-3 hover:bg-white/4 hover:text-ink-2',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <item.icon className={clsx('size-4 shrink-0', active ? 'text-lime' : 'text-ink-4 group-hover:text-ink-3')} />
                <span className="flex-1 text-left font-medium">{item.label}</span>
                {item.path === '/jobs' && activeJobs > 0 && (
                  <span className="rounded bg-lime/15 px-1.5 py-px font-mono text-[10px] text-lime">{activeJobs}</span>
                )}
                {item.path === '/library' && games.length > 0 && (
                  <span className="font-mono text-[10px] text-ink-4">{games.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <SystemFooter />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-abyss/90 px-4 backdrop-blur-xl lg:hidden">
        <button onClick={() => navigate('/')} className="flex items-center gap-2" aria-label="Recompa home">
          <LogoMark className="size-6" />
          <span className="font-display text-sm font-bold tracking-tight">RECOMPA</span>
        </button>
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="size-5" /> : <MenuIcon />}
        </button>
      </header>

      {mobileOpen && (
        <div className="fixed inset-x-0 top-14 z-30 border-b border-line bg-abyss/98 p-3 backdrop-blur-xl lg:hidden">
          <nav className="grid gap-1">
            {NAV.map((item) => {
              const active = route.path === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={clsx(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm',
                    active ? 'bg-panel-2 text-ink' : 'text-ink-2',
                  )}
                >
                  <item.icon className={clsx('size-4', active ? 'text-lime' : 'text-ink-4')} />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      )}

      {/* Keyboard users would otherwise tab through every navigation item on
          every page before reaching the content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:border focus:border-line-bright focus:bg-panel focus:px-3 focus:py-1.5 focus:text-xs focus:text-ink"
      >
        Skip to content
      </a>
      <main id="main-content" tabIndex={-1} className="lg:pl-[232px]">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
        <PageFooter />
      </main>
    </div>
  );
}

function Brand() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate('/')}
      className="flex items-center gap-2.5 border-b border-line px-5 py-4 text-left"
      aria-label="Recompa home"
    >
      <LogoMark className="size-7" />
      <div>
        <div className="font-display text-[15px] leading-none font-bold tracking-tight">RECOMPA</div>
        <div className="mt-1 font-mono text-[9px] tracking-[0.18em] text-ink-4 uppercase">Rom · Recomp · Play</div>
      </div>
    </button>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="#0c1118" stroke="#27364a" />
      <path d="M9 22V10h6.2c2.9 0 4.6 1.4 4.6 3.9 0 1.8-.9 3-2.5 3.6l3 4.5h-3.3l-2.6-4.1h-2.6V22H9Zm2.8-6.4h3.2c1.3 0 2-.6 2-1.7s-.7-1.6-2-1.6h-3.2v3.3Z" fill="#d6ff4b" />
      <path d="M23.5 10.5h2.2v11h-2.2z" fill="#6fd3ff" opacity="0.85" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SystemFooter() {
  const [env, setEnv] = useState<RuntimeEnvironment | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueIndex | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    void detectEnvironment().then((e) => !cancelled && setEnv(e));
    void fetchCatalogueIndex().then((c) => !cancelled && setCatalogue(c));
    return () => {
      cancelled = true;
    };
  }, []);

  const totalFingerprints = catalogue?.entries.reduce((n, e) => n + e.count, 0) ?? null;

  return (
    <div className="border-t border-line p-3">
      <div className="mb-2">
        <SupportButton compact />
      </div>
      <div className="rounded-lg border border-line bg-panel/70 p-2.5">
        <div className="mono-label mb-2 flex items-center gap-1.5">
          <Cpu className="size-3" /> Runtime
        </div>
        {env ? (
          <dl className="space-y-1.5 font-mono text-[10px] leading-tight">
            <Row icon={<Cpu className="size-2.5" />} label="WASM" value={env.webAssembly ? (env.wasmSimd ? 'SIMD' : 'yes') : 'no'} ok={env.webAssembly} />
            <Row icon={<Activity className="size-2.5" />} label="Threads" value={env.crossOriginIsolated ? 'SAB' : 'isolated: no'} ok={env.crossOriginIsolated} />
            <Row icon={<Gamepad2 className="size-2.5" />} label="GPU" value={env.webgpu ? 'WebGPU' : env.webgl2 ? 'WebGL2' : 'canvas'} ok={env.webgl2 || env.webgpu} />
            <Row icon={<HardDrive className="size-2.5" />} label="IDB" value={env.indexedDb ? 'ready' : 'off'} ok={env.indexedDb} />
          </dl>
        ) : (
          <div className="flex items-center gap-2 text-[10px] text-ink-4">
            <Spinner className="size-3" /> probing…
          </div>
        )}
        <button
          onClick={() => navigate('/compatibility')}
          className="mt-2 flex w-full items-center justify-between rounded border border-line bg-black/20 px-2 py-1.5 font-mono text-[10px] text-ink-3 hover:border-line-bright hover:text-ink-2"
        >
          <span>fingerprints</span>
          <span className="text-ice">{totalFingerprints?.toLocaleString() ?? '—'}</span>
        </button>
        <div className="mt-1.5 flex items-center justify-between px-0.5 font-mono text-[9px] text-ink-4">
          <span>{ALL_DESCRIPTORS.filter((d) => d.available).length} live engines</span>
          <span>local-only</span>
        </div>
      </div>
    </div>
  );
}

function Row({ icon, label, value, ok }: { icon: ReactNode; label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="flex items-center gap-1 text-ink-4">
        {icon}
        {label}
      </dt>
      <dd className={clsx('flex items-center gap-1', ok ? 'text-mint' : 'text-ink-3')}>
        <span className={clsx('size-1 rounded-full', ok ? 'bg-mint' : 'bg-ink-4')} />
        {value}
      </dd>
    </div>
  );
}

function PageFooter() {
  const navigate = useNavigate();
  return (
    <footer className="mt-10 border-t border-line px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-3 text-xs text-ink-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl leading-relaxed">
          Recompa analyses and runs <strong className="font-medium text-ink-3">your own legally obtained game files</strong>. It
          ships no ROMs, no BIOS files and no firmware. Emulation is not recompilation, and the interface always says which one is
          running.
        </p>
        <div className="flex shrink-0 gap-4">
          <button className="link" onClick={() => navigate('/about')}>
            About &amp; licences
          </button>
          <a className="link" href="https://github.com/LIN4CRE/Recompa" target="_blank" rel="noreferrer noopener">
            Source
          </a>
        </div>
      </div>
    </footer>
  );
}

export function Toasts() {
  const toasts = useLibrary((s) => s.toasts);
  const dismiss = useLibrary((s) => s.dismissToast);
  const navigate = useNavigate();
  if (toasts.length === 0) return null;
  const tone = {
    info: 'border-ice/30 bg-panel-2 text-ice',
    success: 'border-mint/30 bg-panel-2 text-mint',
    warning: 'border-amber/30 bg-panel-2 text-amber',
    error: 'border-rose/35 bg-panel-2 text-rose',
  } as const;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={clsx(
            'pointer-events-auto animate-[fade-up_0.3s_ease-out] rounded-xl border bg-panel/95 p-3 shadow-2xl backdrop-blur',
            tone[toast.kind],
          )}
        >
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <div className="text-xs font-semibold text-ink">{toast.title}</div>
              {toast.message && <div className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{toast.message}</div>}
              {toast.action && (
                <button
                  className="mt-1.5 font-mono text-[10px] text-ice hover:underline"
                  onClick={() => {
                    navigate(toast.action!.to);
                    dismiss(toast.id);
                  }}
                >
                  {toast.action.label} →
                </button>
              )}
            </div>
            <button className="text-ink-4 hover:text-ink" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
