import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import type { CompatibilityState, ExecutionKind, PlatformId } from '@/core/types';
import { PLATFORM_BY_ID } from '@/core/platforms';

/* -------------------------------------------------------------------------- */
/* Panels                                                                     */
/* -------------------------------------------------------------------------- */

export function Panel({
  children,
  className,
  as: Tag = 'section',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'aside';
} & Record<string, unknown>) {
  return (
    <Tag className={clsx('panel', className)} {...rest}>
      {children}
    </Tag>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="mono-label mb-1.5">{eyebrow}</div>}
        <h2 className="text-xl font-semibold text-ink">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Status / badges                                                            */
/* -------------------------------------------------------------------------- */

const COMPAT_META: Record<CompatibilityState, { label: string; tone: string }> = {
  'not-tested': { label: 'Not tested', tone: 'text-ink-3 border-line-bright bg-white/3' },
  'analysis-complete': { label: 'Analysis complete', tone: 'text-ice border-ice/30 bg-ice/8' },
  compatible: { label: 'Compatible', tone: 'text-mint border-mint/35 bg-mint/10' },
  'partially-compatible': { label: 'Partially compatible', tone: 'text-amber border-amber/35 bg-amber/10' },
  incompatible: { label: 'Incompatible', tone: 'text-rose border-rose/35 bg-rose/10' },
  'requires-files': { label: 'Needs files', tone: 'text-amber border-amber/35 bg-amber/10' },
  'recompilation-available': { label: 'Recompilation available', tone: 'text-violet border-violet/35 bg-violet/10' },
};

export function CompatBadge({ state, className }: { state: CompatibilityState; className?: string }) {
  const meta = COMPAT_META[state] ?? COMPAT_META['not-tested'];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.08em] uppercase',
        meta.tone,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}

const METHOD_TONE: Record<ExecutionKind, string> = {
  'browser-native-recompilation': 'text-lime border-lime/35 bg-lime/10',
  'static-recompilation': 'text-violet border-violet/35 bg-violet/10',
  'source-port-wasm': 'text-ice border-ice/30 bg-ice/8',
  'wasm-emulator': 'text-ice border-ice/30 bg-ice/8',
  'js-emulator': 'text-ink-2 border-line-bright bg-white/4',
  'external-tool': 'text-amber border-amber/30 bg-amber/8',
};

export function MethodBadge({
  kind,
  label,
  className,
}: {
  kind: ExecutionKind;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em] uppercase',
        METHOD_TONE[kind],
        className,
      )}
    >
      {label ?? kind.replace(/-/g, ' ')}
    </span>
  );
}

export function PlatformBadge({ platformId, className }: { platformId: PlatformId; className?: string }) {
  const platform = PLATFORM_BY_ID.get(platformId);
  if (!platform) {
    return <span className={clsx('chip', className)}>Unknown</span>;
  }
  return (
    <span className={clsx('chip border-line-bright/80 bg-panel-2 text-ink-2', className)} title={platform.name}>
      {shortPlatform(platform.id)}
    </span>
  );
}

export function shortPlatform(id: PlatformId): string {
  const map: Partial<Record<PlatformId, string>> = {
    nes: 'NES',
    snes: 'SNES',
    gb: 'GB',
    gbc: 'GBC',
    gba: 'GBA',
    n64: 'N64',
    nds: 'NDS',
    genesis: 'MD',
    sms: 'SMS',
    gg: 'GG',
    pce: 'PCE',
    psx: 'PSX',
    psp: 'PSP',
    atari2600: '2600',
    atari7800: '7800',
    lynx: 'LYNX',
    ws: 'WS',
    vb: 'VB',
    ngp: 'NGP',
    arcade: 'ARC',
  };
  return map[id] ?? id.toUpperCase();
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="data-row">
      <span className="text-xs text-ink-3">{label}</span>
      <span className="max-w-[62%] text-right font-mono text-xs break-all text-ink-2">{children}</span>
    </div>
  );
}

export function Meter({
  value,
  max,
  tone = 'ice',
  label,
}: {
  value: number;
  max: number;
  tone?: 'ice' | 'lime' | 'amber' | 'rose' | 'mint';
  label?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const colors: Record<string, string> = {
    ice: 'bg-ice',
    lime: 'bg-lime',
    amber: 'bg-amber',
    rose: 'bg-rose',
    mint: 'bg-mint',
  };
  return (
    <div>
      {label && (
        <div className="mb-1 flex justify-between text-[11px] text-ink-3">
          <span>{label}</span>
          <span className="font-mono">{pct.toFixed(0)}%</span>
        </div>
      )}
      <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
        <div className={clsx('h-full rounded-full transition-[width] duration-300', colors[tone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center rounded-[10px] border border-dashed border-line-bright/70 bg-panel/40 px-6 py-12 text-center',
        className,
      )}
    >
      {icon && <div className="mb-3 grid size-11 place-items-center rounded-xl border border-line-bright bg-panel-2 text-ink-3">{icon}</div>}
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                       */
/* -------------------------------------------------------------------------- */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx('flex gap-1 overflow-x-auto rounded-lg border border-line bg-panel/60 p-1', className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={clsx(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
            value === tab.id ? 'bg-panel-3 text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={clsx('rounded px-1 py-px font-mono text-[10px]', value === tab.id ? 'bg-white/10 text-ink-2' : 'text-ink-4')}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Small utilities                                                            */
/* -------------------------------------------------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('size-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function relativeTime(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
