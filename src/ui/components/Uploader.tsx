import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  FileUp,
  FolderOpen,
  FolderSearch,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
  X,
} from 'lucide-react';
import { useLibrary } from '@/state/library';
import { analyzeBytes } from '@/core/analyze';
import { inspectArchive } from '@/lib/zip';
import { resolveDiscSets, type DroppedFile, type DiscSet } from '@/core/discset';
import {
  filesFromDataTransfer,
  filesFromFileList,
  filesFromHandle,
  groupScannedFiles,
  diffScan,
  isFolderPickerSupported,
  type ScanFile,
  type ScannedGame,
} from '@/core/folderscan';
import { listWatchedFolders, putWatchedFolder, deleteWatchedFolder, type WatchedFolderRecord } from '@/db/database';
import { buildDiscArchive, needsArchive } from '@/engines/psx/discArchive';
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
  const [folders, setFolders] = useState<WatchedFolderRecord[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setErrors([]);
      setResults([]);
      const collected: UploadResult[] = [];
      const failures: typeof errors = [];

      // Read just enough of each file to understand the set: sheet text for
      // .cue/.m3u, sizes and names for everything else. Track payloads are
      // deliberately not loaded here — a 700 MB disc must not be read twice.
      const described: Array<{ file: File; meta: DroppedFile }> = [];
      for (const file of list) {
        const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
        const needsText = ext === 'cue' || ext === 'm3u' || ext === 'ccd' || ext === 'toc';
        const textContent = needsText
          ? await file.slice(0, 128 * 1024).text()
          : undefined;
        described.push({
          file,
          meta: {
            name: file.name,
            size: file.size,
            ext,
            relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined,
            textContent,
          },
        });
      }

      // Group into disc sets so a .cue and its .bin tracks become ONE game and
      // individual tracks never masquerade as separate titles.
      const sets: DiscSet[] = resolveDiscSets(described.map((d) => d.meta));
      const byName = new Map(described.map((d) => [d.meta.name.toLowerCase(), d.file]));

      for (const set of sets) {
        // Standalone non-disc files keep their own path; a set marked
        // "not-a-disc-set" still goes through analysis so the detector can
        // report precisely what it is.
        if (set.status === 'not-a-disc-set') {
          const file = byName.get(set.entry.toLowerCase());
          if (file) {
            await analyseOne(file, 'reading');
          }
          continue;
        }

        if (set.status === 'missing-companion' || set.status === 'invalid-sheet') {
          failures.push({
            file: set.entry,
            message: set.problems[0] ?? 'This disc set is incomplete.',
            detail: set.members.length > 1 ? `Included: ${set.members.map((m) => m.name).join(', ')}` : undefined,
          });
          continue;
        }

        try {
          setPhase('reading');
          setProgressLabel(`${set.entry} · ${set.members.length} file${set.members.length === 1 ? '' : 's'}`);
          const members = set.members
            .map((m) => ({ member: m, file: byName.get(m.name.toLowerCase()) }))
            .filter((x): x is { member: typeof x.member; file: File } => Boolean(x.file));

          let payload: Uint8Array;
          let displayName = set.entry;
          let archiveMeta: UploadResult['archive'] = null;

          if (needsArchive(members.length)) {
            // Repackage cue + tracks into one zip for the emulator.
            setPhase('expanding');
            setProgressLabel(`${set.entry} · packaging ${members.length} files`);
            const input = [];
            for (const { member, file } of members) {
              input.push({ name: member.name, bytes: new Uint8Array(await file.arrayBuffer()) });
            }
            const archive = await buildDiscArchive(input, set.entry);
            payload = new Uint8Array(await archive.blob.arrayBuffer());
            displayName = `${set.entry.replace(/\.[^.]+$/, '')}.zip`;
            archiveMeta = { entries: members.length, selected: archive.entry };
          } else {
            const file = members[0]!.file;
            payload = new Uint8Array(await file.arrayBuffer());
            displayName = set.entry;
          }

          setPhase('analyzing');
          setProgressLabel(`${displayName} · checksums`);
          const report = await analyzeBytes(payload, displayName, {
            archiveSize: archiveMeta ? payload.length : undefined,
          });
          if (archiveMeta) report.archive = { entries: [], selectedEntry: archiveMeta.selected };

          // Preserve the human-facing name and the set detail in the report so
          // the library shows "Digimon World 3", not "Digimon World 3.zip".
          if (archiveMeta) {
            report.identification.title = report.identification.title || set.entry.replace(/\.[^.]+$/, '');
          }
          report.discSet = {
            entry: set.entry,
            files: set.members.map((m) => m.name),
            multiTrack: set.multiTrack,
            trackCount: set.trackCount,
          };

          setPhase('storing');
          const { game, job, duplicate } = await addReport(report, payload);
          collected.push({
            report,
            game,
            job,
            duplicate,
            fileName: set.entry,
            archive: archiveMeta,
          });

          if (duplicate) {
            pushToast({
              kind: 'info',
              title: 'Already in your library',
              message: `Identical SHA-256 to "${duplicate.title}". The existing entry was refreshed instead of duplicated.`,
            });
          }
          if (set.notes.length) {
            pushToast({ kind: 'info', title: set.entry, message: set.notes[0]! });
          }
        } catch (error) {
          failures.push({
            file: set.entry,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      setPhase(collected.length ? 'done' : 'error');
      setErrors(failures);
      setResults(collected);
      if (collected.length) onComplete?.(collected);

      /** Analyse one standalone file (existing single-file behaviour). */
      async function analyseOne(file: File, startPhase: Phase) {
        try {
          setPhase(startPhase);
          setProgressLabel(`${file.name} · ${formatBytes(file.size)}`);
          const raw = new Uint8Array(await file.arrayBuffer());

          let payload = raw;
          let displayName = file.name;
          let archiveMeta: UploadResult['archive'] = null;
          const isZip =
            /\.zip$/i.test(file.name) ||
            (raw.length > 4 && raw[0] === 0x50 && raw[1] === 0x4b && raw[2] === 0x03 && raw[3] === 0x04);

          if (isZip) {
            setPhase('expanding');
            const inspection = await inspectArchive(raw);
            archiveMeta = {
              entries: inspection.entries.length,
              selected:
                inspection.selectedIndex !== null ? inspection.entries[inspection.selectedIndex]!.name : null,
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
          report.archive = archiveMeta ? { entries: [], selectedEntry: archiveMeta.selected } : undefined;

          setPhase('storing');
          const { game, job, duplicate } = await addReport(report, payload);
          collected.push({ report, game, job, duplicate, fileName: file.name, archive: archiveMeta });

          if (duplicate) {
            pushToast({
              kind: 'info',
              title: 'Already in your library',
              message: `Identical SHA-256 to "${duplicate.title}". The existing entry was refreshed instead of duplicated.`,
            });
          }
        } catch (error) {
          failures.push({ file: file.name, message: error instanceof Error ? error.message : String(error) });
        }
      }
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

  /* ------------------------- folder scanning ------------------------- */

  const refreshFolders = useCallback(async () => {
    try {
      setFolders(await listWatchedFolders());
    } catch {
      /* IndexedDB unavailable — folder memory is simply absent */
    }
  }, []);

  useEffect(() => {
    void refreshFolders();
  }, [refreshFolders]);

  /**
   * Import the games a scan found.
   *
   * `only` restricts which games to import: on first scan that is everything,
   * on rescan it is only what `diffScan` reported as new.
   */
  const importScanned = useCallback(
    async (games: ScannedGame[], rootName: string) => {
      const collected: UploadResult[] = [];
      const failures: Array<{ file: string; message: string; detail?: string }> = [];

      for (const game of games) {
        const label = game.folder ? `${game.folder}/${game.set.entry}` : game.set.entry;

        if (game.set.status === 'missing-companion' || game.set.status === 'invalid-sheet') {
          failures.push({
            file: label,
            message: game.set.problems[0] ?? 'This disc set is incomplete.',
            detail: game.files.map((f) => f.name).join(', ') || undefined,
          });
          continue;
        }

        try {
          setPhase('reading');
          setProgressLabel(`${label} · ${game.files.length} file${game.files.length === 1 ? '' : 's'}`);
          let payload: Uint8Array;
          let displayName = game.set.entry;
          let archiveMeta: UploadResult['archive'] = null;

          if (game.files.length > 1) {
            setPhase('expanding');
            setProgressLabel(`${label} · packaging ${game.files.length} files`);
            const input = [];
            for (const f of game.files) {
              input.push({ name: f.name, bytes: new Uint8Array(await f.file.arrayBuffer()) });
            }
            const archive = await buildDiscArchive(input, game.set.entry);
            payload = new Uint8Array(await archive.blob.arrayBuffer());
            displayName = `${game.set.entry.replace(/\.[^.]+$/, '')}.zip`;
            archiveMeta = { entries: game.files.length, selected: archive.entry };
          } else {
            payload = new Uint8Array(await game.files[0]!.file.arrayBuffer());
          }

          setPhase('analyzing');
          setProgressLabel(`${displayName} · checksums`);
          const report = await analyzeBytes(payload, displayName, {
            archiveSize: archiveMeta ? payload.length : undefined,
          });
          if (archiveMeta) report.archive = { entries: [], selectedEntry: archiveMeta.selected };
          report.discSet = {
            entry: game.set.entry,
            files: game.set.members.map((m) => m.name),
            multiTrack: game.set.multiTrack,
            trackCount: game.set.trackCount,
          };
          if (game.folder) report.folder = game.folder;

          setPhase('storing');
          const { game: record, job, duplicate } = await addReport(report, payload);
          collected.push({
            report,
            game: record,
            job,
            duplicate,
            fileName: label,
            archive: archiveMeta,
          });
        } catch (error) {
          failures.push({ file: label, message: error instanceof Error ? error.message : String(error) });
        }
      }

      setPhase(collected.length ? 'done' : failures.length ? 'error' : 'done');
      setErrors(failures);
      setResults(collected);
      if (collected.length) onComplete?.(collected);
      const dupes = collected.filter((c) => c.duplicate).length;
      setScanSummary(
        `${rootName}: ${collected.length - dupes} imported` +
          (dupes ? `, ${dupes} already in library` : '') +
          (failures.length ? `, ${failures.length} not importable` : ''),
      );
      return collected;
    },
    [addReport, onComplete],
  );

  /** Scan a set of files (folder pick, folder drop, or a retained handle). */
  const runScan = useCallback(
    async (source: { files?: ScanFile[]; handle?: FileSystemDirectoryHandle; name: string }, rescanOf?: WatchedFolderRecord) => {
      setScanning(true);
      setErrors([]);
      setResults([]);
      setScanSummary(null);
      try {
        setPhase('expanding');
        setProgressLabel(`Scanning ${source.name}…`);
        const files = source.handle ? await filesFromHandle(source.handle) : (source.files ?? []);
        const grouped = await groupScannedFiles(files, source.name);

        let toImport = grouped.games;
        let summaryPrefix = '';

        if (rescanOf) {
          const diff = diffScan(rescanOf.knownPaths, grouped.games);
          toImport = diff.newGames;
          summaryPrefix =
            `${diff.newGames.length} new, ${diff.unchanged} unchanged` +
            (diff.removed ? `, ${diff.removed} missing from disk` : '');
          if (diff.newGames.length === 0) {
            setScanSummary(`${source.name}: nothing new — ${summaryPrefix}.`);
            setPhase('done');
            return;
          }
        }

        // Remember the folder so a rescan can re-walk it later.
        const handle = source.handle ?? rescanOf?.handle;
        if (handle) {
          const knownPaths = Array.from(
            new Set([...(rescanOf?.knownPaths ?? []), ...files.map((f) => f.relativePath)]),
          );
          await putWatchedFolder({
            id: rescanOf?.id ?? `${Date.now()}_${source.name}`,
            name: source.name,
            handle,
            addedAt: rescanOf?.addedAt ?? Date.now(),
            lastScannedAt: Date.now(),
            knownPaths,
          });
          await refreshFolders();
        }

        await importScanned(toImport, source.name);
        if (summaryPrefix) setScanSummary(`${source.name}: ${summaryPrefix}.`);
      } catch (error) {
        setErrors([{ file: source.name, message: error instanceof Error ? error.message : String(error) }]);
        setPhase('error');
      } finally {
        setScanning(false);
      }
    },
    [importScanned, refreshFolders],
  );

  /** Ask for a folder using the File System Access API when available. */
  const pickFolder = useCallback(async () => {
    if (!isFolderPickerSupported()) {
      folderInputRef.current?.click();
      return;
    }
    try {
      const handle = await (
        window as unknown as {
          showDirectoryPicker: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker({ mode: 'read' });
      // Persist the handle so this folder can be rescanned later.
      await runScan({ handle, name: handle.name });
    } catch (error) {
      // A user dismissing the picker is not an error worth shouting about.
      if ((error as Error).name !== 'AbortError') {
        setErrors([{ file: 'folder', message: (error as Error).message }]);
        setPhase('error');
      }
    }
  }, [runScan]);

  const rescanFolder = useCallback(
    async (folder: WatchedFolderRecord) => {
      try {
        // Browsers drop handle permission between sessions; re-request it.
        const handle = folder.handle as unknown as {
          queryPermission?: (d: { mode: string }) => Promise<PermissionState>;
          requestPermission?: (d: { mode: string }) => Promise<PermissionState>;
        };
        const state = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
        if (state !== 'granted') {
          const granted = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied';
          if (granted !== 'granted') {
            setErrors([
              {
                file: folder.name,
                message: 'Permission to read this folder was not granted, so it cannot be rescanned.',
                detail: 'Grant access when the browser asks, or pick the folder again.',
              },
            ]);
            return;
          }
        }
        await runScan({ handle: folder.handle, name: folder.name }, folder);
      } catch (error) {
        setErrors([{ file: folder.name, message: (error as Error).message }]);
        setPhase('error');
      }
    },
    [runScan],
  );

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const dt = event.dataTransfer;
    if (!dt) return;
    // Dropping a *folder* only exposes its contents through the entry API;
    // `dataTransfer.files` is empty for directories in Chromium.
    const hasEntries = Array.from(dt.items ?? []).some((i) => typeof i.webkitGetAsEntry === 'function');
    if (hasEntries) {
      void (async () => {
        setScanning(true);
        try {
          const files = await filesFromDataTransfer(dt);
          if (files.length === 0) return;
          // A single flat selection behaves like before; a directory tree gets
          // the full scan + grouping treatment.
          const nested = files.some((f) => f.relativePath.includes('/'));
          if (nested) {
            const root = files[0]!.relativePath.split('/')[0]!;
            await runScan({ files, name: root });
          } else {
            await handleFiles(files.map((f) => f.file));
          }
        } finally {
          setScanning(false);
        }
      })();
      return;
    }
    if (dt.files?.length) void handleFiles(dt.files);
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
                <button className="btn" onClick={() => void pickFolder()} disabled={scanning}>
                  <FolderSearch className="size-4" /> Scan a folder
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
              <input
                ref={folderInputRef}
                type="file"
                // Non-standard but universally supported attributes for
                // recursive folder selection where the FS Access API is absent.
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files?.length) {
                    const name = (event.target.files[0] as File & { webkitRelativePath?: string })
                      .webkitRelativePath?.split('/')[0];
                    void runScan({ files: filesFromFileList(event.target.files), name: name || 'folder' });
                  }
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

      {scanSummary && (
        <div className="flex items-center gap-2 rounded-lg border border-ice/25 bg-ice/[0.06] px-3 py-2 text-xs text-ice">
          <CheckCircle2 className="size-4" /> <span>{scanSummary}</span>
        </div>
      )}

      {folders.length > 0 && !busy && (
        <div className="rounded-[14px] border border-line-bright bg-panel/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="mono-label">Scanned folders</span>
            <span className="font-mono text-[10px] text-ink-4">
              {isFolderPickerSupported() ? 'rescan available' : 'rescan needs a re-pick in this browser'}
            </span>
          </div>
          <ul className="space-y-1.5">
            {folders.map((folder) => (
              <li key={folder.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/70 px-2.5 py-1.5">
                <div className="min-w-0">
                  <div className="truncate text-xs text-ink">{folder.name}</div>
                  <div className="font-mono text-[10px] text-ink-4">
                    {folder.knownPaths.length} file{folder.knownPaths.length === 1 ? '' : 's'} ·{' '}
                    {folder.lastScannedAt ? new Date(folder.lastScannedAt).toLocaleString() : 'never scanned'}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    className="btn h-7 px-2 text-[11px]"
                    disabled={scanning || !isFolderPickerSupported()}
                    onClick={() => void rescanFolder(folder)}
                    title={
                      isFolderPickerSupported()
                        ? 'Re-walk this folder and import only what is new'
                        : 'This browser cannot retain folder access; pick the folder again instead'
                    }
                  >
                    <RefreshCw className={clsx('size-3', scanning && 'animate-spin')} /> Rescan
                  </button>
                  <button
                    className="btn h-7 px-2 text-[11px]"
                    disabled={scanning}
                    onClick={async () => {
                      await deleteWatchedFolder(folder.id);
                      await refreshFolders();
                    }}
                    title="Forget this folder (does not delete imported games)"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

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
