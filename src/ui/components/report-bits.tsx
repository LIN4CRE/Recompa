import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, CircleDot, Info, MinusCircle, XCircle } from 'lucide-react';
import type { JobStage, TechnicalError } from '@/core/types';
import { KeyValue, MethodBadge, Panel } from './primitives';
import type { ExecutionKind } from '@/core/types';

/** Re-export the shared method badge so report pages import from one place. */
export { MethodBadge, Panel };
export const PanelHeaderless = Panel;

const SEVERITY_META: Record<TechnicalError['severity'], { icon: React.ReactNode; tone: string; label: string }> = {
  info: { icon: <Info className="size-3.5" />, tone: 'text-ice border-ice/25 bg-ice/[0.05]', label: 'info' },
  warning: { icon: <AlertTriangle className="size-3.5" />, tone: 'text-amber border-amber/30 bg-amber/[0.06]', label: 'warning' },
  error: { icon: <XCircle className="size-3.5" />, tone: 'text-rose border-rose/30 bg-rose/[0.06]', label: 'error' },
  fatal: { icon: <XCircle className="size-3.5" />, tone: 'text-rose border-rose/45 bg-rose/[0.09]', label: 'blocking' },
};

export function ErrorList({ errors }: { errors: TechnicalError[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {errors.map((error, i) => {
        const meta = SEVERITY_META[error.severity];
        return (
          <li key={`${error.code}-${i}`} className={clsx('flex gap-2 rounded-lg border p-2.5', meta.tone)}>
            <span className="mt-0.5 shrink-0">{meta.icon}</span>
            <div className="min-w-0 text-[11px] leading-relaxed">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[9px] tracking-wider uppercase opacity-70">{error.code}</span>
                {error.severity === 'fatal' && (
                  <span className="rounded bg-rose/20 px-1 font-mono text-[9px] text-rose">blocking</span>
                )}
              </div>
              <p className="mt-0.5 text-ink-2">{error.message}</p>
              {error.detail && <p className="mt-1 font-mono text-[10px] break-all text-ink-4">{error.detail}</p>}
              {error.remedy && <p className="mt-1 text-[10px] text-ink-3"><strong className="font-medium text-ink-2">Next:</strong> {error.remedy}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function FactsTable({ facts }: { facts: Array<{ label: string; value: string }> }) {
  return (
    <div>
      {facts.map((fact, i) => (
        <KeyValue key={`${fact.label}-${i}`} label={fact.label}>
          {fact.value}
        </KeyValue>
      ))}
    </div>
  );
}

export function StageTimeline({ stages }: { stages: JobStage[] }) {
  const icon = (status: JobStage['status']) => {
    switch (status) {
      case 'done':
        return <CheckCircle2 className="size-3.5 text-mint" />;
      case 'running':
        return <CircleDot className="size-3.5 animate-pulse text-lime" />;
      case 'failed':
        return <XCircle className="size-3.5 text-rose" />;
      case 'blocked':
        return <AlertTriangle className="size-3.5 text-amber" />;
      case 'skipped':
        return <MinusCircle className="size-3.5 text-ink-4" />;
      default:
        return <CircleDot className="size-3.5 text-ink-4" />;
    }
  };
  return (
    <ol className="relative space-y-3 border-l border-line pl-4">
      {stages.map((stage) => (
        <li key={stage.id} className="relative">
          <span className="absolute top-0.5 -left-[22px] grid size-3.5 place-items-center bg-panel">{icon(stage.status)}</span>
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="text-xs font-medium text-ink">{stage.label}</span>
            <span className="font-mono text-[9px] tracking-wider text-ink-4 uppercase">
              {stage.status}
              {stage.requiresService && <span className="ml-1 text-amber">· needs local tool</span>}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-ink-4">{stage.tool}</div>
          {stage.output.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {stage.output.map((line, i) => (
                <li key={i} className="font-mono text-[10px] leading-relaxed text-ink-3">
                  <span className="text-ink-4">·</span> {line}
                </li>
              ))}
            </ul>
          )}
          {stage.error && <p className="mt-1 text-[10px] text-rose">{stage.error}</p>}
        </li>
      ))}
    </ol>
  );
}

export function MethodStatement({
  kind,
  statement,
  engineName,
  licence,
  version,
}: {
  kind: ExecutionKind;
  statement: string;
  engineName: string;
  licence: string;
  version: string;
}) {
  const isEmulation = kind === 'wasm-emulator' || kind === 'js-emulator';
  return (
    <div className="rounded-lg border border-line bg-black/25 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <MethodBadge kind={kind} />
        <span className="text-xs font-medium text-ink">{engineName}</span>
        <span className="font-mono text-[10px] text-ink-4">
          {licence} · v{version}
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-2">
        {statement.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
          part.startsWith('**') ? (
            <strong key={i} className={clsx('font-semibold', isEmulation ? 'text-ice' : 'text-lime')}>
              {part.replace(/\*\*/g, '')}
            </strong>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>
    </div>
  );
}
