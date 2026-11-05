import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Activity, ChevronRight, FileDown, Layers, ListChecks } from 'lucide-react';
import { useLibrary } from '@/state/library';
import { useNavigate } from '@/lib/router';
import { downloadBlob } from '@/lib/exports';
import { EmptyState, MethodBadge, Panel, relativeTime, SectionHeader, Tabs } from '../components/primitives';
import { StageTimeline } from '../components/report-bits';
import type { Job } from '@/core/types';

type Filter = 'all' | 'completed' | 'blocked';

export function JobsPage() {
  const jobs = useLibrary((s) => s.jobs);
  const games = useLibrary((s) => s.games);
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(jobs[0]?.id ?? null);
  const navigate = useNavigate();

  const filtered = useMemo(
    () => jobs.filter((job) => (filter === 'all' ? true : job.status === filter)),
    [jobs, filter],
  );

  const totals = useMemo(
    () => ({
      all: jobs.length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      blocked: jobs.filter((j) => j.status === 'blocked').length,
      stages: jobs.reduce((n, j) => n + j.stages.filter((s) => s.status === 'done').length, 0),
    }),
    [jobs],
  );

  const exportJob = (job: Job) => {
    const game = games.find((g) => g.id === job.gameId);
    const payload = { ...job, gameTitle: game?.title ?? null, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `recompa-job-${job.id}.json`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mono-label mb-1">Pipeline</div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Recompilation jobs</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-3">
            Every analysis produces a job. A job records the planner's decision, the exact engine (or the reason none could run), and
            the real work performed. Nothing here is simulated: a blocked stage is blocked because the tool cannot run in a browser.
          </p>
        </div>
        <div className="flex gap-2 font-mono text-[10px]">
          <Stat label="jobs" value={totals.all} />
          <Stat label="runnable" value={totals.completed} tone="mint" />
          <Stat label="blocked" value={totals.blocked} tone="amber" />
          <Stat label="stages done" value={totals.stages} tone="ice" />
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'all', label: 'All', count: totals.all },
          { id: 'completed', label: 'Runnable', count: totals.completed },
          { id: 'blocked', label: 'Blocked', count: totals.blocked },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Activity className="size-5" />}
          title="No jobs yet"
          description="Analyse a ROM and its job appears here with every stage, tool and outcome."
          action={
            <button className="btn btn-sm" onClick={() => navigate('/upload')}>
              Analyse a file
            </button>
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((job) => {
            const game = games.find((g) => g.id === job.gameId);
            const open = openId === job.id;
            return (
              <Panel key={job.id} className="overflow-hidden">
                <button
                  className="flex w-full flex-wrap items-center gap-3 p-3 text-left hover:bg-white/[0.02]"
                  onClick={() => setOpenId(open ? null : job.id)}
                  aria-expanded={open}
                >
                  <span
                    className={clsx(
                      'grid size-8 shrink-0 place-items-center rounded-lg border',
                      job.status === 'completed'
                        ? 'border-mint/30 bg-mint/8 text-mint'
                        : job.status === 'blocked'
                          ? 'border-amber/30 bg-amber/8 text-amber'
                          : 'border-line-bright bg-panel-2 text-ink-3',
                    )}
                  >
                    <Layers className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{game?.title ?? 'Unknown game'}</span>
                      <span className="font-mono text-[9px] tracking-wider text-ink-4 uppercase">{job.status}</span>
                      {job.plan.target && <MethodBadge kind={job.plan.target.method} label={job.plan.target.methodLabel} />}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-ink-4">{job.plan.summary}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-ink-4">
                    <span>{job.stages.filter((s) => s.status === 'done').length}/{job.stages.length} stages</span>
                    <span>·</span>
                    <span>{relativeTime(job.createdAt)}</span>
                    <ChevronRight className={clsx('size-3.5 transition-transform', open && 'rotate-90')} />
                  </div>
                </button>

                {open && (
                  <div className="grid gap-4 border-t border-line p-3 md:grid-cols-2">
                    <div>
                      <SectionHeader eyebrow="Stages" title="Recorded work" />
                      <StageTimeline stages={job.stages} />
                    </div>
                    <div>
                      <SectionHeader eyebrow="Decision" title="Candidate matrix" />
                      <ul className="space-y-1.5">
                        {job.plan.considered.map((c) => (
                          <li key={c.engineId} className="rounded-md border border-line bg-black/20 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-[11px] font-medium">{c.engineName}</span>
                              <span
                                className={clsx(
                                  'shrink-0 rounded px-1 py-px font-mono text-[9px] uppercase',
                                  c.accepted ? 'bg-mint/15 text-mint' : 'bg-white/4 text-ink-4',
                                )}
                              >
                                {c.accepted ? 'selected' : 'rejected'}
                              </span>
                            </div>
                            <div className="mt-0.5 font-mono text-[9px] text-ink-4">priority {c.priority} · {c.kind}</div>
                            {c.blockers[0] && <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-ink-3">{c.blockers[0]}</p>}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 flex gap-1.5">
                        {job.plan.target?.runnable && game && (
                          <button className="btn btn-primary btn-sm" onClick={() => navigate(`/play/${game.id}`)}>
                            Play
                          </button>
                        )}
                        {game && (
                          <button className="btn btn-sm" onClick={() => navigate(`/game/${game.id}`)}>
                            <ListChecks className="size-3.5" /> Report
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => exportJob(job)}>
                          <FileDown className="size-3.5" /> Export
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'ink' }: { label: string; value: number; tone?: 'ink' | 'mint' | 'amber' | 'ice' }) {
  const tones = { ink: 'text-ink', mint: 'text-mint', amber: 'text-amber', ice: 'text-ice' };
  return (
    <div className="rounded-lg border border-line bg-panel/60 px-2.5 py-1.5">
      <div className="mono-label text-[9px]">{label}</div>
      <div className={clsx('font-display text-base font-semibold', tones[tone])}>{value}</div>
    </div>
  );
}
