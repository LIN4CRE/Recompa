import { useEffect, useState } from 'react';
import { AppShell, Toasts } from './ui/components/layout';
import { useRoute, useNavigate } from './lib/router';
import { useLibrary } from './state/library';
import { useSettings } from './state/settings';
import { getReport } from './db/database';
import { HomePage } from './ui/pages/HomePage';
import { LibraryPage } from './ui/pages/LibraryPage';
import { UploadPage } from './ui/pages/UploadPage';
import { JobsPage } from './ui/pages/JobsPage';
import { CompatibilityPage } from './ui/pages/CompatibilityPage';
import { SettingsPage } from './ui/pages/SettingsPage';
import { AboutPage } from './ui/pages/AboutPage';
import { GamePage } from './ui/pages/GamePage';
import { Player } from './ui/player/Player';
import { EmptyState, Spinner } from './ui/components/primitives';
import type { AnalysisReport } from './core/types';

export default function App() {
  const route = useRoute();
  const navigate = useNavigate();
  const hydrate = useLibrary((s) => s.hydrate);
  const loadSettings = useSettings((s) => s.load);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void Promise.all([hydrate(), loadSettings()]).finally(() => setReady(true));
  }, [hydrate, loadSettings]);

  const isPlayer = route.segments[0] === 'play';
  const gameId = route.segments[1];

  if (!ready) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="app-backdrop" aria-hidden />
        <div className="flex flex-col items-center gap-3">
          <Spinner className="size-6 text-lime" />
          <p className="font-mono text-[11px] tracking-wider text-ink-4 uppercase">opening local database…</p>
        </div>
      </div>
    );
  }

  // The player owns the viewport (needed for fullscreen) and skips the shell.
  if (isPlayer && gameId) {
    return (
      <>
        <PlayerRoute gameId={gameId} />
        <Toasts />
      </>
    );
  }

  const page = (() => {
    switch (route.path) {
      case '/':
        return <HomePage />;
      case '/library':
        return <LibraryPage />;
      case '/upload':
        return <UploadPage />;
      case '/jobs':
        return <JobsPage />;
      case '/compatibility':
        return <CompatibilityPage />;
      case '/settings':
        return <SettingsPage />;
      case '/about':
        return <AboutPage />;
      default:
        if (route.segments[0] === 'game' && gameId) return <GamePage gameId={gameId} />;
        return (
          <EmptyState
            title="Page not found"
            description={`No route matches ${route.path}.`}
            action={
              <button className="btn btn-sm" onClick={() => navigate('/')}>
                Go home
              </button>
            }
          />
        );
    }
  })();

  return (
    <>
      <AppShell>{page}</AppShell>
      <Toasts />
    </>
  );
}

function PlayerRoute({ gameId }: { gameId: string }) {
  const games = useLibrary((s) => s.games);
  const loading = useLibrary((s) => s.loading);
  const pushToast = useLibrary((s) => s.pushToast);
  const navigate = useNavigate();
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [checked, setChecked] = useState(false);
  const game = games.find((g) => g.id === gameId) ?? null;

  useEffect(() => {
    if (!game) return;
    void getReport(game.reportId).then((rep) => {
      setReport(rep ?? null);
      setChecked(true);
    });
  }, [game]);

  useEffect(() => {
    if (!game && !loading) {
      pushToast({ kind: 'error', title: 'Game not found', message: 'It is not in this device’s library.' });
      navigate('/library');
    }
  }, [game, loading, navigate, pushToast]);

  if (!game || !checked) {
    return (
      <div className="grid min-h-dvh place-items-center gap-3">
        <Spinner className="size-6 text-lime" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="grid min-h-dvh place-items-center p-4">
        <EmptyState
          title="Analysis report missing"
          description="The report for this entry is gone, so Recompa cannot verify what it is about to run. Re-upload the file."
          action={
            <button className="btn btn-sm" onClick={() => navigate('/upload')}>
              Upload again
            </button>
          }
        />
      </div>
    );
  }

  return <Player game={game} report={report} />;
}
