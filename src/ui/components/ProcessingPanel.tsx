import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, Cpu, ExternalLink, ServerCog, XCircle } from 'lucide-react';
import { useSettings } from '@/state/settings';
import { useLibrary } from '@/state/library';
import {
  analyseStructure,
  fetchCapabilities,
  isProcessingAvailable,
  planN64Recomp,
  ProcessingError,
  endpointLabel,
  type ServiceCapabilities,
} from '@/lib/processing';
import { Panel, SectionHeader, Spinner } from './primitives';
import type { GameRecord } from '@/core/types';

/**
 * Optional local processing panel.
 *
 * Shown in Settings and on N64 game pages. It is explicit at every step about
 * the fact that a file would leave the browser — and it cannot send anything
 * until the user ticks the confirmation inside the modal.
 */
export function ProcessingPanel({ game }: { game?: GameRecord }) {
  const settings = useSettings((s) => s.settings);
  const pushToast = useLibrary((s) => s.pushToast);
  const loadRom = useLibrary((s) => s.loadRom);
  const [caps, setCaps] = useState<ServiceCapabilities | null>(null);
  const [status, setStatus] = useState<'idle' | 'probing' | 'reachable' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const available = isProcessingAvailable(settings);

  useEffect(() => {
    if (!available) {
      setStatus('idle');
      setCaps(null);
      return;
    }
    setStatus('probing');
    setError(null);
    void fetchCapabilities(settings)
      .then((c) => {
        setCaps(c);
        setStatus('reachable');
      })
      .catch((err: ProcessingError) => {
        setStatus('error');
        setError(err.message);
      });
  }, [available, settings, settings.externalProcessingEndpoint]);

  const send = async () => {
    if (!game) return;
    setConfirming(false);
    setRunning(true);
    setResult(null);
    try {
      const bytes = await loadRom(game.id);
      if (!bytes) throw new Error('ROM bytes are not stored on this device.');
      const isN64 = game.platformId === 'n64';
      const res = isN64 ? await planN64Recomp(settings, game.title) : await analyseStructure(settings, { name: game.title, bytes });
      setResult(res);
      pushToast({
        kind: res.status === 'ok' || res.status === 'planned' ? 'success' : 'warning',
        title: `Service: ${String(res.status ?? 'unknown')}`,
        message: typeof res.reason === 'string' ? res.reason : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResult({ status: 'error', reason: message });
      pushToast({ kind: 'error', title: 'Processing failed', message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Panel className="p-4">
      <SectionHeader
        eyebrow="Optional"
        title="Local processing service"
        description="Heavier analysis (Rizin structure maps, N64Recomp job preparation) needs native tools. The bundled Node service runs them on your machine — never in the browser and never on a third-party server."
      />

      {!settings.enableExternalProcessing && (
        <div className="rounded-lg border border-line bg-black/25 p-3 text-[11px] leading-relaxed text-ink-3">
          Disabled. Turn on <strong className="text-ink-2">Allow explicit server-side processing</strong> in Settings → Advanced and
          start the service with <code className="text-ink-2">npm run serve:processing</code>. Until then Recompa has no endpoint and
          will not offer to send files anywhere.
        </div>
      )}

      {settings.enableExternalProcessing && !settings.externalProcessingEndpoint.trim() && (
        <div className="flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/[0.06] p-3 text-[11px] text-ink-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber" />
          Enabled, but no endpoint is configured. Set it in Settings → Advanced (default <code>http://127.0.0.1:7333</code>).
        </div>
      )}

      {available && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2 text-[11px]">
            <ServerCog className="size-3.5 text-ink-4" />
            <span className="font-mono text-ink-3">{settings.externalProcessingEndpoint}</span>
            {status === 'probing' && (
              <span className="flex items-center gap-1 text-ink-4">
                <Spinner className="size-3" /> probing…
              </span>
            )}
            {status === 'reachable' && caps && (
              <span className="inline-flex items-center gap-1 rounded bg-mint/12 px-1.5 py-0.5 font-mono text-[9px] text-mint uppercase">
                <CheckCircle2 className="size-2.5" /> reachable · v{caps.version}
              </span>
            )}
            {status === 'error' && (
              <span className="inline-flex items-center gap-1 rounded bg-rose/12 px-1.5 py-0.5 font-mono text-[9px] text-rose uppercase">
                <XCircle className="size-2.5" /> unreachable
              </span>
            )}
          </div>

          {error && <p className="rounded border border-rose/25 bg-rose/[0.05] p-2 font-mono text-[10px] leading-relaxed text-rose/90">{error}</p>}

          {caps && (
            <div className="rounded-lg border border-line bg-black/20 p-2.5">
              <div className="mono-label mb-1.5 flex items-center gap-1.5">
                <Cpu className="size-3" /> tools on this machine
              </div>
              <ul className="space-y-1">
                {Object.entries(caps.tools).map(([name, tool]) => (
                  <li key={name} className="flex items-start justify-between gap-2 border-b border-line/50 py-1 last:border-0">
                    <span className="font-mono text-[10px] text-ink-2">{name}</span>
                    <span className={clsx('text-right font-mono text-[10px]', tool.configured ? 'text-mint' : 'text-ink-4')}>
                      {tool.configured ? tool.version || 'configured' : tool.reason ?? 'not configured'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-ink-4">
                bound to {caps.privacy.bindsTo} · body cap {(caps.limits.maxBodyBytes / 1024 / 1024).toFixed(0)} MiB · job timeout{' '}
                {(caps.limits.jobTimeoutMs / 1000).toFixed(0)}s
              </p>
            </div>
          )}

          {game && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn btn-sm"
                disabled={running || status !== 'reachable'}
                onClick={() => setConfirming(true)}
              >
                {running ? <Spinner className="size-3.5" /> : null}
                {game.platformId === 'n64' ? 'Prepare N64Recomp job' : 'Analyse structure'}
              </button>
              <span className="font-mono text-[10px] text-amber/80">
                sends {game.title} to {settings.externalProcessingEndpoint} in this step only
              </span>
            </div>
          )}

          {result && (
            <pre className="scroll-area max-h-64 overflow-auto rounded border border-line bg-black/40 p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-ink-2">
{JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}

      {confirming && game && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" role="dialog" aria-modal onClick={() => setConfirming(false)}>
          <div className="panel w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Send this ROM to your local service?</h3>
            <p className="mt-2 text-xs leading-relaxed text-ink-3">
              This is the only action in Recompa that transmits file bytes. They go to{' '}
              <span className="font-mono text-ink-2">{settings.externalProcessingEndpoint}</span> on this machine, are written to a
              temporary directory, read as data by a native tool and deleted afterwards. Remote endpoints are refused, so nothing is
              sent to us or to any third party.
            </p>
            <div className="mt-3 rounded-lg border border-line bg-black/25 p-2.5">
              <div className="text-[11px] font-medium text-ink">{game.title}</div>
              <div className="font-mono text-[10px] text-ink-4">{game.platformId.toUpperCase()} · {game.payloadId.slice(0, 16)}…</div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn btn-sm" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="btn btn-ice btn-sm" onClick={() => void send()}>
                Send to {endpointLabel(settings.externalProcessingEndpoint)}
              </button>
            </div>
          </div>
        </div>
      )}

      <a
        className="link mt-3 inline-flex items-center gap-1 font-mono text-[10px]"
        href="https://github.com/libretro/libretro-database"
        target="_blank"
        rel="noreferrer noopener"
      >
        <ExternalLink className="size-2.5" />
        dataset provenance
      </a>
    </Panel>
  );
}
