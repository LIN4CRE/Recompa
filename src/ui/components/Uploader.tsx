import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, Archive, CheckCircle2, FileUp, FolderOpen, Loader2, ShieldCheck, UploadCloud } from 'lucide-react';
import { useLibrary } from '@/state/library';
import { analyzeBytes } from '@/core/analyze';
import { inspectArchive } from '@/lib/zip';
import { formatBytes } from '@/core/binary';
import type { AnalysisReport, GameRecord, Job } from '@/core/types';
import { Spinner } from './primitives';

export interface UploadResult {
  report: AnalysisReport;
  game: GameRecord;
  job: Job;
  duplicate: GameRecord | null;
  fileName: string;
  archive: { entries: number; selected: string | null } | null;
}

type Phase = 'idle' | 'reading' | 'expanding' | 'analyzing' | 'storing' | 'done' | 'error';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Waiting for files',
  reading: 'Reading file',
  expanding: 'Inspecting archive',
  analyzing: 'Fingerprinting & analysing',
  storing: 'Saving to local library',
  done: 'Analysis complete',
  error: 'Analysis failed',
};

export function Uploader({
  onComplete,
  compact = false,
  autoStart = true,
}: {
  onComplete?: (results: UploadResult[]) => void;
  compact?: boolean;
  autoStart?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progressLabel, setProgressLabel] = useState<string>('');
  const [errors, setErrors] = useState<Array<{ file: string; message: string; detail?: string }>>([]);
  const [results, setResults] = useState<UploadResult[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const addReport = useLibrary((s) => s.addReport);
  const pushToast = useLibrary((s) => s.pushToast);
  const busy = phase !== 'idle' && phase !== 'done' && phase !== 'error';

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setErrors([]);
      setResults([]);
      const collected: UploadResult[] = [];
      const failures: typeof errors = [];

      for (const file of list) {
        try {
          setPhase('reading');
          setProgressLabel(`${file.name} · ${formatBytes(file.size)}`);
          const raw = new Uint8Array(await file.arrayBuffer());

          let payload = raw;
          let displayName = file.name;
          let archiveMeta: UploadResult['archive'] = null;
          const isZip =
            /\.zip$/i.test(file.name) || (raw.length > 4 && raw[0] === 0x50 && raw[1] === 0x4b && raw[2] === 0x03 && raw[3] === 0x04);

          if (isZip) {
            setPhase('expanding');
            const inspection = await inspectArchive(raw);
            archiveMeta = {
              entries: inspection.entries.length,
              selected: inspection.selectedIndex !== null ? inspection.entries[inspection.selectedIndex]!.name : null,
            };
            if (!inspection.selectedBytes) {
              throw new Error(
                inspection.errors[0] ??
                  'The archive did not contain a recognisable game image. Recompa does not guess which file inside an archive is the game.',
              );
            }
            payload = new Uint8Array(inspection.selectedBytes);
            displayName = archiveMeta.selected ?? file.name;
            if (inspection.truncated) {
              pushToast({
                kind: 'warning',
                title: 'Large archive',
                message: `Only the first ${inspection.entries.length} entries were listed. The selected game was still extracted.`,
              });
            }
          }

          setPhase('analyzing');
          setProgressLabel(`${displayName} · checksums`);
          const report = await analyzeBytes(payload, displayName, {
            archiveSize: isZip ? raw.length : undefined,
          });
          report.archive = archiveMeta
            ? {
                entries: [],
                selectedEntry: archiveMeta.selected,
              }
            : undefined;

          setPhase('storing');
          const { game, job, duplicate } = await addReport(report, payload);
          const result: UploadResult = { report, game, job, duplicate, fileName: file.name, archive: archiveMeta };
          collected.push(result);

          if (duplicate) {
            pushToast({
              kind: 'info',
              title: 'Already in your library',
              message: `Identical SHA-256 to "${duplicate.title}". The existing entry was refreshed instead of duplicated.`,
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push({ file: file.name, message });
        }
      }

      setPhase(collected.length ? 'done' : 'error');
      setErrors(failures);
      setResults(collected);
      if (collected.length) onComplete?.(collected);
    },
    [addReport, onComplete, pushToast],
  );

  useEffect(() => {
    if (!autoStart) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files;
      if (files && files.length) void handleFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [autoStart, handleFiles]);

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer?.files?.length) void handleFiles(event.dataTransfer.files);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={clsx(
          'group relative overflow-hidden rounded-[14px] border-2 border-dashed transition-all',
          compact ? 'p-6' : 'p-8 sm:p-12',
          dragging
            ? 'border-lime/70 bg-lime/[0.055] shadow-[0_0_0_1px_rgba(214,255,75,0.25),0_24px_80px_-40px_rgba(214,255,75,0.5)]'
            : 'border-line-bright hover:border-ink-4/60 hover:bg-white/[0.015]',
          busy && 'pointer-events-none',
        )}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            maskImage: 'radial-gradient(circle at 50% 40%, black, transparent 72%)',
          }}
          aria-hidden
        />
        <div className="relative flex flex-col items-center text-center">
          <div
            className={clsx(
              'mb-4 grid size-14 place-items-center rounded-2xl border transition-colors',
              dragging ? 'border-lime/50 bg-lime/10 text-lime' : 'border-line-bright bg-panel-2 text-ink-3',
            )}
          >
            {busy ? <Loader2 className="size-6 animate-spin" /> : <UploadCloud className="size-6" />}
          </div>

          {busy ? (
            <>
              <h3 className="text-base font-semibold text-ink">{PHASE_LABEL[phase]}…</h3>
              <p className="mt-1 font-mono text-xs text-ink-3">{progressLabel}</p>
              <div className="mt-3 h-1 w-56 overflow-hidden rounded-full bg-white/8">
                <div
                  className={clsx(
                    'h-full rounded-full bg-lime transition-all duration-500',
                    phase === 'reading' ? 'w-[18%]' : phase === 'expanding' ? 'w-[35%]' : phase === 'analyzing' ? 'w-[68%]' : 'w-[92%]',
                  )}
                />
              </div>
              <p className="mt-3 max-w-sm text-[11px] leading-relaxed text-ink-4">
                Everything happens in this tab. Files are hashed and analysed locally and never leave your device.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold text-ink">
                {dragging ? 'Drop to analyse' : 'Drop a ROM, or choose files'}
              </h3>
              <p className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-3">
                Cartridge images, disc images and <code className="text-ink-2">.zip</code> archives. Multiple files are analysed
                in one pass.
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
                  <FolderOpen className="size-4" /> Choose ROM files
                </button>
                <span className="font-mono text-[11px] text-ink-4">or paste from clipboard</span>
              </div>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) void handleFiles(event.target.files);
                  event.target.value = '';
                }}
              />
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-mono text-[10px] tracking-wide text-ink-4 uppercase">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3 text-mint/70" /> Local processing
                </span>
                <span className="flex items-center gap-1.5">
                  <Archive className="size-3 text-ice/70" /> Zip supported
                </span>
                <span className="flex items-center gap-1.5">
                  <FileUp className="size-3 text-violet/70" /> Multi-file
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {errors.length > 0 && (
        <ul className="space-y-2">
          {errors.map((error) => (
            <li key={error.file} className="flex gap-2.5 rounded-lg border border-rose/25 bg-rose/[0.06] p-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose" />
              <div className="min-w-0 text-xs">
                <div className="font-medium text-ink">{error.file}</div>
                <p className="mt-0.5 leading-relaxed text-ink-2">{error.message}</p>
                {error.detail && <p className="mt-1 font-mono text-[10px] break-all text-ink-4">{error.detail}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {phase === 'done' && results.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-mint/25 bg-mint/[0.06] px-3 py-2 text-xs text-mint">
          <CheckCircle2 className="size-4" />
          <span>
            {results.length} file{results.length === 1 ? '' : 's'} analysed locally
            {results.some((r) => r.report.platform) ? '' : ' — no platform could be verified'}
          </span>
        </div>
      )}
    </div>
  );
}

export function UploadProgressInline({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-xs text-ink-3">
      <Spinner className="size-3.5" /> {label}
    </div>
  );
}
