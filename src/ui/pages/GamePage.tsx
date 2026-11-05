import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Download,
  FileText,
  Fingerprint,
  Info,
  Play,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useNavigate } from '@/lib/router';
import { useLibrary } from '@/state/library';
import { getReport, getSram, hasPayload, listTests, listStates } from '@/db/database';
import type { AnalysisReport, GameRecord, TestRun } from '@/core/types';
import { hexdump } from '@/core/analyze';
import { downloadBlob } from '@/lib/exports';
import { CoverPicker, CoverArt } from '../components/CoverArt';
import {
  bytes,
  CompatBadge,
  EmptyState,
  KeyValue,
  MethodBadge,
  Panel,
  PlatformBadge,
  SectionHeader,
  Spinner,
  Tabs,
  relativeTime,
} from '../components/primitives';
import { ErrorList, FactsTable, MethodStatement, StageTimeline } from '../components/report-bits';
import { downloadSram, downloadStateBundle } from '@/lib/exports';
import { ProcessingPanel } from '../components/ProcessingPanel';

type Tab = 'overview' | 'analysis' | 'methods' | 'tests' | 'saves';

export function GamePage({ gameId }: { gameId: string }) {
  const navigate = useNavigate();
  const games = useLibrary((s) => s.games);
  const jobs = useLibrary((s) => s.jobs);
  const updateGame = useLibrary((s) => s.updateGame);
  const pushToast = useLibrary((s) => s.pushToast);
  const game = games.find((g) => g.id === gameId) ?? null;
  const job = jobs.find((j) => j.gameId === gameId) ?? null;
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [tests, setTests] = useState<TestRun[]>([]);
  const [states, setStates] = useState<Awaited<ReturnType<typeof listStates>>>([]);
  const [hasSram, setHasSram] = useState(false);
  // A report can exist without its ROM bytes: "Store ROM bytes after analysis"
  // is off, or the payload was deleted. Launching would fail, so the button
  // says why instead of offering a guaranteed error.
  const [payloadStored, setPayloadStored] = useState<boolean | null>(null);
  const [coverOpen, setCoverOpen] = useState(false);
  const [hexOpen, setHexOpen] = useState(false);

  useEffect(() => {
    if (!game) return;
    void (async () => {
      const [rep, testList, stateList, sram, stored] = await Promise.all([
        getReport(game.reportId),
        listTests(game.id),
        listStates(game.id),
        getSram(game.id),
        hasPayload(game.payloadId),
      ]);
      setReport(rep ?? null);
      setTests(testList);
      setStates(stateList);
      setHasSram(Boolean(sram?.bytes?.length));
      setPayloadStored(stored);
    })();
  }, [game]);

  if (!game) {
    return (
      <EmptyState
        icon={<Info className="size-5" />}
        title="Game not found in this library"
        description="It may have been removed on this device. Add the ROM again to rebuild its report."
        action={<button className="btn btn-sm" onClick={() => navigate('/library')}>Back to library</button>}
      />
    );
  }

  const target = job?.plan.target ?? null;
  const latestTest = tests[0] ?? null;

  return (
    <div className="space-y-5">
      <button className="btn btn-ghost btn-sm -ml-2" onClick={() => navigate('/library')}>
        <ArrowLeft className="size-3.5" /> Library
      </button>

      {/* Header */}
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="mx-auto w-full max-w-[220px] lg:mx-0">
          <CoverArt game={game} className="shadow-2xl" editable onPick={() => setCoverOpen(true)} />
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              className={clsx('btn btn-sm', target?.runnable && payloadStored ? 'btn-primary col-span-2' : 'col-span-2')}
              onClick={() => {
                if (!target?.runnable) {
                  pushToast({ kind: 'warning', title: 'Nothing to launch', message: job?.plan.summary ?? 'No engine available.' });
                  return;
                }
                if (payloadStored === false) {
                  pushToast({
                    kind: 'warning',
                    title: 'ROM bytes are not stored',
                    message:
                      'This entry was analysed without keeping the file. Re-add it through Upload with “Store ROM bytes after analysis” on.',
                  });
                  return;
                }
                navigate(`/play/${game.id}`);
              }}
              disabled={!target?.runnable || payloadStored === false}
            >
              <Play className="size-3.5" />{' '}
              {!target?.runnable ? 'Not runnable' : payloadStored === false ? 'File not kept' : 'Play'}
            </button>
            <button className="btn btn-sm" onClick={() => void updateGame(game.id, { favourite: !game.favourite })}>
              {game.favourite ? '★ Favourited' : '☆ Favourite'}
            </button>
            <button className="btn btn-sm" onClick={() => setCoverOpen(true)}>
              Cover art
            </button>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PlatformBadge platformId={game.platformId} />
            <CompatBadge state={game.compatibility} />
            {report?.identification.catalogueMatch ? (
              <span className="inline-flex items-center gap-1 rounded border border-mint/30 bg-mint/8 px-1.5 py-0.5 font-mono text-[10px] text-mint">
                <ShieldCheck className="size-3" /> fingerprint verified
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded border border-line-bright bg-white/3 px-1.5 py-0.5 font-mono text-[10px] text-ink-4">
                <AlertTriangle className="size-3" /> title not verified
              </span>
            )}
          </div>
          <h1 className="mt-2 font-display text-2xl leading-tight font-bold tracking-tight sm:text-3xl">{game.title}</h1>
          <p className="mt-1 text-xs text-ink-3">
            {report?.identification.titleSource === 'database'
              ? 'Title confirmed against the No-Intro fingerprint catalogue.'
              : report?.identification.titleSource === 'header'
                ? 'Title read from the ROM header — not cross-checked against a database.'
                : 'Title derived from the file name — not verified. Upload with an exact dump, or install the fingerprint database.'}
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <MiniStat label="Platform" value={report?.platform?.name ?? 'not identified'} sub={report?.platformConfidence} />
            <MiniStat label="Format" value={report?.format?.label ?? 'unknown'} sub={report?.format?.kind} />
            <MiniStat label="Size" value={report ? bytes(report.checksums.size) : '—'} sub={report ? `${report.checksums.size.toLocaleString()} bytes` : ''} />
            <MiniStat label="Region" value={report?.identification.region ?? '—'} sub={report?.identification.regionSource ? `from ${report.identification.regionSource}` : ''} />
            <MiniStat label="Version" value={report?.identification.version ?? 'unknown'} sub="from catalogue / header" />
            <MiniStat label="Last played" value={relativeTime(game.lastPlayedAt)} sub={`${game.playCount} launch${game.playCount === 1 ? '' : 'es'}`} />
          </div>

          {target && (
            <div className="mt-3">
              <MethodStatement
                kind={target.method}
                statement={job?.plan.executionStatement ?? ''}
                engineName={target.descriptor.name}
                licence={target.descriptor.licence}
                version={target.descriptor.version}
              />
            </div>
          )}
          {!target && job && (
            <div className="mt-3 rounded-lg border border-amber/30 bg-amber/[0.06] p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber">
                <AlertTriangle className="size-3.5" /> No runnable execution path
              </div>
              <p className="mt-1 text-[11px] whitespace-pre-line text-ink-2">{job.plan.executionStatement}</p>
            </div>
          )}
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'analysis', label: 'Technical report' },
          { id: 'methods', label: 'Execution methods', count: job?.plan.considered.length },
          { id: 'tests', label: 'Tests', count: tests.length },
          { id: 'saves', label: 'Saves', count: states.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="p-4">
            <SectionHeader eyebrow="Report" title="Diagnostics" />
            <ErrorList errors={report?.errors ?? []} />
            {(report?.errors.length ?? 0) === 0 && (
              <p className="flex items-center gap-1.5 text-xs text-mint">
                <Check className="size-3.5" /> No structural problems detected in this image.
              </p>
            )}
            {report?.header.warnings.length ? (
              <div className="mt-3">
                <div className="mono-label mb-1.5">header warnings</div>
                <ul className="space-y-1">
                  {report.header.warnings.map((w, i) => (
                    <li key={i} className="flex gap-1.5 text-[11px] text-ink-3">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber/70" /> {w}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>

          <Panel className="p-4">
            <SectionHeader eyebrow="Provenance" title="Identification" />
            <KeyValue label="File name">{report?.fileName ?? '—'}</KeyValue>
            <KeyValue label="Title source">{report?.identification.titleSource ?? '—'}</KeyValue>
            <KeyValue label="Region source">{report?.identification.regionSource ?? '—'}</KeyValue>
            <KeyValue label="Serial / game code">{report?.identification.serial ?? '—'}</KeyValue>
            {report?.identification.catalogueMatch && (
              <>
                <KeyValue label="Catalogue entry">{report.identification.catalogueMatch.name}</KeyValue>
                <KeyValue label="Matched on">{report.identification.catalogueMatch.matchedOn.toUpperCase()}</KeyValue>
                <KeyValue label="Dataset">{report.identification.catalogueMatch.source}</KeyValue>
              </>
            )}
            {report?.archive && (
              <KeyValue label="Archive member">{report.archive.selectedEntry ?? '—'}</KeyValue>
            )}
            <div className="mt-3 flex gap-1.5">
              <button className="btn btn-sm" onClick={() => setTab('analysis')}>
                <FileText className="size-3.5" /> Full report
              </button>
              <button className="btn btn-sm" onClick={() => downloadReport(report, game)}>
                <Download className="size-3.5" /> Export JSON
              </button>
            </div>
          </Panel>

          <Panel className="p-4 lg:col-span-2">
            <SectionHeader eyebrow="Pipeline" title="What the planner did" description={job?.plan.summary} />
            {job ? <StageTimeline stages={job.stages} /> : <p className="text-xs text-ink-3">No job recorded for this game.</p>}
          </Panel>
        </div>
      )}

      {tab === 'analysis' && report && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="p-4">
            <SectionHeader eyebrow="Hashes" title="Checksums" description="Computed over the canonical payload: copier/SMD headers are stripped and N64 images are normalised to big-endian before hashing." />
            <HashRow label="CRC32" value={report.checksums.crc32.toUpperCase()} />
            <HashRow label="MD5" value={report.checksums.md5} />
            <HashRow label="SHA-1" value={report.checksums.sha1} />
            <HashRow label="SHA-256" value={report.checksums.sha256} />
            <KeyValue label="Hashed bytes">{report.checksums.size.toLocaleString()}</KeyValue>
            <KeyValue label="File size">{report.fileSize.toLocaleString()}</KeyValue>
          </Panel>

          <Panel className="p-4">
            <SectionHeader eyebrow="Container" title="Format & header" />
            <KeyValue label="Detector">{report.format?.id ?? 'none matched'}</KeyValue>
            <KeyValue label="Label">{report.format?.label ?? '—'}</KeyValue>
            <KeyValue label="Confidence">{report.format?.confidence ?? '—'}</KeyValue>
            <KeyValue label="Payload offset">{report.header.strippedBytes} bytes</KeyValue>
            <KeyValue label="Evidence">{report.platformEvidence.join(' · ') || '—'}</KeyValue>
            <div className="mt-2">
              <div className="mono-label mb-1">raw header fields</div>
              <pre className="scroll-area max-h-52 overflow-auto rounded border border-line bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-ink-2">
{JSON.stringify(report.header.fields, null, 2)}
              </pre>
            </div>
          </Panel>

          <Panel className="p-4">
            <SectionHeader eyebrow="Facts" title="Extracted values" />
            <FactsTable facts={report.facts} />
          </Panel>

          <Panel className="p-4">
            <SectionHeader
              eyebrow="Dependencies"
              title="Required files"
              description="Recompa never bundles firmware. Anything listed here must come from your own console or a licensed source."
            />
            {report.dependencies.length === 0 ? (
              <p className="text-xs text-ink-3">No firmware or companion files are required for this platform.</p>
            ) : (
              <ul className="space-y-2">
                {report.dependencies.map((dep) => (
                  <li key={dep.id} className="rounded-lg border border-line bg-black/20 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">{dep.name}</span>
                      <span className={clsx('chip', dep.required ? 'border-amber/40 text-amber' : 'text-ink-3')}>
                        {dep.required ? 'required' : 'optional'}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{dep.reason}</p>
                    {dep.acceptedSizes && (
                      <p className="mt-1 font-mono text-[10px] text-ink-4">
                        accepted sizes: {dep.acceptedSizes.map((s) => bytes(s)).join(', ')}
                      </p>
                    )}
                    {dep.expectedFileName && <p className="font-mono text-[10px] text-ink-4">expected: {dep.expectedFileName}</p>}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <button className="btn btn-sm" onClick={() => setHexOpen((v) => !v)}>
                {hexOpen ? 'Hide' : 'Show'} hex dump
              </button>
              {hexOpen && <HexDump gameId={game.id} />}
            </div>
          </Panel>
        </div>
      )}

      {tab === 'analysis' && !report && <Spinner />}

      {tab === 'methods' && job && (
        <div className="space-y-3">
          <Panel className="p-4">
            <SectionHeader
              eyebrow="Priority ladder"
              title="Considered execution paths"
              description="The planner walks this list in order. Accepted candidates keep their measured evidence; rejected ones keep the exact reason."
            />
            <ol className="space-y-2">
              {job.plan.considered.map((candidate) => (
                <li
                  key={candidate.engineId}
                  className={clsx(
                    'rounded-lg border p-3',
                    candidate.accepted ? 'border-mint/25 bg-mint/[0.04]' : 'border-line bg-black/15',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="grid size-5 shrink-0 place-items-center rounded font-mono text-[10px] text-ink-4 ring-1 ring-line-bright">
                        {candidate.priority}
                      </span>
                      <span className="truncate text-xs font-medium">{candidate.engineName}</span>
                      <MethodBadge kind={candidate.kind as never} />
                    </div>
                    <span
                      className={clsx(
                        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase',
                        candidate.accepted ? 'bg-mint/15 text-mint' : 'bg-white/4 text-ink-4',
                      )}
                    >
                      {candidate.accepted ? <Check className="size-2.5" /> : <X className="size-2.5" />}
                      {candidate.accepted ? 'selected' : 'rejected'}
                    </span>
                  </div>
                  {candidate.blockers.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {candidate.blockers.map((b, i) => (
                        <li key={i} className="flex gap-1.5 font-mono text-[10px] leading-relaxed text-ink-3">
                          <X className="mt-0.5 size-2.5 shrink-0 text-rose/70" />
                          <span>
                            {b}
                            {/BIOS not installed/i.test(b) && (
                              <>
                                {' '}
                                <button
                                  className="text-lime underline underline-offset-2 hover:text-lime/80"
                                  onClick={() => navigate('/settings?tab=firmware')}
                                >
                                  Open firmware settings
                                </button>
                              </>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {candidate.notes.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {candidate.notes.map((n, i) => (
                        <li key={i} className="flex gap-1.5 font-mono text-[10px] leading-relaxed text-ink-4">
                          <ChevronRight className="mt-0.5 size-2.5 shrink-0" /> {n}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </Panel>
          <Panel className="p-4">
            <SectionHeader eyebrow="Statement" title="What PLAY will actually do" />
            <p className="whitespace-pre-line text-xs leading-relaxed text-ink-2">{job.plan.executionStatement}</p>
          </Panel>
          {game.platformId === 'n64' && <ProcessingPanel game={game} />}
        </div>
      )}

      {tab === 'tests' && (
        <div className="space-y-3">
          <Panel className="p-4">
            <SectionHeader
              eyebrow="Verification"
              title="Recorded test runs"
              description="Compatibility is only marked verified after one of these runs passes on this device. Each check stores the measured value that justified it."
            />
            {tests.length === 0 ? (
              <EmptyState
                icon={<Fingerprint className="size-5" />}
                title="No test runs yet"
                description="Launch the game and press Verify in the player toolbar. The harness samples video, audio, input and save-state round-trips for the configured window."
                action={
                  target?.runnable ? (
                    <button className="btn btn-primary btn-sm" onClick={() => navigate(`/play/${game.id}`)}>
                      <Play className="size-3.5" /> Launch and verify
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <div className="space-y-2">
                {tests.map((test) => (
                  <details key={test.id} className="rounded-lg border border-line bg-black/20" open={test.id === latestTest?.id}>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-2.5 text-xs">
                      <span className="flex items-center gap-2">
                        <span
                          className={clsx(
                            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase',
                            test.status === 'passed' ? 'bg-mint/15 text-mint' : test.status === 'failed' ? 'bg-rose/15 text-rose' : 'bg-white/5 text-ink-3',
                          )}
                        >
                          {test.status}
                        </span>
                        <span className="font-mono text-[10px] text-ink-3">{new Date(test.startedAt).toLocaleString()}</span>
                        <span className="font-mono text-[10px] text-ink-4">{test.engineId}</span>
                      </span>
                      <span className="font-mono text-[10px] text-ink-4">
                        {test.environment.fps} fps · {test.checks.filter((c) => c.status === 'pass').length}/{test.checks.length} passed
                      </span>
                    </summary>
                    <ul className="border-t border-line p-2.5">
                      {test.checks.map((check) => (
                        <li key={check.id} className="flex items-start gap-2 border-b border-line/60 py-1.5 last:border-0">
                          <span
                            className={clsx(
                              'mt-1 size-1.5 shrink-0 rounded-full',
                              check.status === 'pass' ? 'bg-mint' : check.status === 'fail' ? 'bg-rose' : 'bg-ink-4',
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="text-[11px] font-medium text-ink">{check.label}</span>
                              <span className="font-mono text-[10px] text-ink-3">{check.measured}</span>
                            </div>
                            {check.detail && <p className="mt-0.5 text-[10px] leading-relaxed text-ink-4">{check.detail}</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="border-t border-line px-2.5 py-1.5 font-mono text-[9px] text-ink-4">
                      ua: {test.environment.userAgent.slice(0, 80)}… · cores {test.environment.cores ?? '?'} · isolated{' '}
                      {String(test.environment.crossOriginIsolated)}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === 'saves' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="p-4">
            <SectionHeader eyebrow="Battery save" title="SRAM" description="Written by the game itself. Stored per game and per engine so switching cores never destroys a save." />
            {hasSram ? (
              <>
                <p className="text-xs text-ink-2">A battery save exists for this game on this device.</p>
                <button
                  className="btn btn-sm mt-2"
                  onClick={async () => {
                    const sram = await getSram(game.id);
                    if (sram) downloadSram(game, sram.bytes);
                  }}
                >
                  <Download className="size-3.5" /> Export .sav
                </button>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-ink-3">
                No battery save recorded yet. Most games only create one after you save in-game (or via a save point).
              </p>
            )}
          </Panel>
          <Panel className="p-4">
            <SectionHeader eyebrow="States" title={`${states.length} save state${states.length === 1 ? '' : 's'}`} />
            {states.length === 0 ? (
              <p className="text-xs text-ink-3">Capture states from the player toolbar — they are stored with a thumbnail and engine version.</p>
            ) : (
              <>
                <ul className="grid grid-cols-3 gap-1.5">
                  {states.slice(0, 6).map((state) => (
                    <li key={state.id} className="overflow-hidden rounded border border-line">
                      {state.thumbnail ? (
                        <img src={state.thumbnail} alt="" className="aspect-[4/3] w-full object-cover" />
                      ) : (
                        <div className="aspect-[4/3] w-full bg-panel-3" />
                      )}
                      <div className="p-1 font-mono text-[9px] text-ink-4">{new Date(state.createdAt).toLocaleDateString()}</div>
                    </li>
                  ))}
                </ul>
                <button className="btn btn-sm mt-2" onClick={() => downloadStateBundle(game, states)}>
                  <Download className="size-3.5" /> Export states
                </button>
              </>
            )}
          </Panel>
        </div>
      )}

      <CoverPicker
        open={coverOpen}
        onClose={() => setCoverOpen(false)}
        onSelect={(url) => {
          void updateGame(game.id, { cover: { kind: 'user', value: url, source: 'user supplied', updatedAt: Date.now() } });
        }}
      />
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel/50 px-2.5 py-2">
      <div className="mono-label">{label}</div>
      <div className="mt-0.5 truncate text-xs font-medium text-ink" title={value}>
        {value}
      </div>
      {sub && <div className="truncate font-mono text-[9px] text-ink-4">{sub}</div>}
    </div>
  );
}

function HashRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="data-row">
      <span className="font-mono text-[10px] tracking-wider text-ink-4 uppercase">{label}</span>
      <button
        className="group flex items-center gap-1.5 font-mono text-[10px] break-all text-ink-2 hover:text-ice"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        title="Copy"
      >
        {value}
        {copied ? <Check className="size-3 text-mint" /> : <span className="text-ink-4 opacity-0 group-hover:opacity-100">copy</span>}
      </button>
    </div>
  );
}

function HexDump({ gameId }: { gameId: string }) {
  const [lines, setLines] = useState<string[] | null>(null);
  const loadRom = useLibrary((s) => s.loadRom);
  useEffect(() => {
    void (async () => {
      const rom = await loadRom(gameId);
      setLines(rom ? hexdump(rom, 512) : ['ROM bytes are not stored on this device.']);
    })();
  }, [gameId, loadRom]);
  if (!lines) return <Spinner className="mt-2" />;
  return (
    <pre className="scroll-area mt-2 max-h-64 overflow-auto rounded border border-line bg-black/50 p-2 font-mono text-[10px] leading-relaxed text-ink-2">
{lines.join('\n')}
    </pre>
  );
}

function downloadReport(report: AnalysisReport | null, game: GameRecord) {
  if (!report) return;
  const payload = {
    ...report,
    game: { id: game.id, title: game.title, compatibility: game.compatibility, engineId: game.engineId },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${game.title.replace(/[^\w-]+/g, '_')}-report.json`);
}
