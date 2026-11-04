import { useState } from 'react';
import { useNavigate } from '@/lib/router';
import { AlertTriangle, ImageOff, ShieldCheck } from 'lucide-react';
import { Uploader, type UploadResult } from '../components/Uploader';
import { MethodBadge } from '../components/primitives';
import { Panel } from '../components/primitives';
import { bytes } from '../components/primitives';
import { useLibrary } from '@/state/library';

export function UploadPage() {
  const navigate = useNavigate();
  const [results, setResults] = useState<UploadResult[]>([]);
  const games = useLibrary((s) => s.games);

  return (
    <div className="space-y-6">
      <div>
        <div className="mono-label mb-1">Intake</div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Upload &amp; analyse</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-3">
          Files are read with the File API and stay in this tab. Nothing is transmitted: checksums, platform detection and
          fingerprint lookup all run locally against the catalogue bundled with the app.
        </p>
      </div>

      <Uploader
        onComplete={(r) => {
          setResults(r);
          if (r.length === 1) navigate(`/game/${r[0]!.game.id}`);
        }}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <InfoCard
          icon={<ShieldCheck className="size-4 text-mint" />}
          title="What we check"
          body="Container signature, platform header, header checksums (GB/GBA/NDS), size sanity, entropy, and whether a firmware dependency exists."
        />
        <InfoCard
          icon={<ImageOff className="size-4 text-ice" />}
          title="What we never do"
          body="We never guess a platform, never download ROMs or BIOS files, and never claim a title match we cannot prove with a hash."
        />
        <InfoCard
          icon={<AlertTriangle className="size-4 text-amber" />}
          title="When something is unknown"
          body="You get a technical error with the measured evidence (magic bytes, offsets, sizes) and a concrete next step instead of a broken launch."
        />
      </div>

      {results.length > 1 && (
        <Panel className="p-4">
          <h2 className="text-sm font-semibold">Batch results</h2>
          <ul className="mt-2 divide-y divide-line">
            {results.map((r) => (
              <li key={r.report.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{r.report.identification.title ?? r.fileName}</div>
                  <div className="font-mono text-[10px] text-ink-4">
                    {r.report.platform?.name ?? 'unidentified'} · {bytes(r.report.checksums.size)} ·{' '}
                    {r.report.checksums.sha256.slice(0, 16)}…
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {r.job.plan.target && <MethodBadge kind={r.job.plan.target.method} label={r.job.plan.target.methodLabel} />}
                  <button className="btn btn-sm" onClick={() => navigate(`/game/${r.game.id}`)}>
                    Report
                  </button>
                  {r.job.plan.target?.runnable && (
                    <button className="btn btn-primary btn-sm" onClick={() => navigate(`/play/${r.game.id}`)}>
                      Play
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 font-mono text-[10px] text-ink-4">{games.length} games now in the local library.</p>
        </Panel>
      )}
    </div>
  );
}

function InfoCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="panel p-3">
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md border border-line bg-panel-2">{icon}</span>
        <h3 className="text-xs font-semibold">{title}</h3>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">{body}</p>
    </div>
  );
}
