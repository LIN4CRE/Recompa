import { useMemo, useState } from 'react';
import { Heart, Library as LibraryIcon, Play, Search, SlidersHorizontal, Trash2, Upload } from 'lucide-react';
import { useLibrary } from '@/state/library';
import { useNavigate } from '@/lib/router';
import { GameCard } from '../components/GameCard';
import { CoverPicker } from '../components/CoverArt';
import { EmptyState, Panel, Tabs } from '../components/primitives';
import { PLATFORM_BY_ID } from '@/core/platforms';
import type { GameRecord, PlatformId } from '@/core/types';

type SortKey = 'recent' | 'title' | 'added' | 'played';
type Filter = 'all' | 'favourites' | 'verified' | 'unverified';

export function LibraryPage() {
  const games = useLibrary((s) => s.games);
  const jobs = useLibrary((s) => s.jobs);
  const loading = useLibrary((s) => s.loading);
  const toggleFavourite = useLibrary((s) => s.toggleFavourite);
  const updateGame = useLibrary((s) => s.updateGame);
  const removeGame = useLibrary((s) => s.removeGame);
  const pushToast = useLibrary((s) => s.pushToast);
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<PlatformId | 'all'>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<SortKey>('recent');
  const [coverTarget, setCoverTarget] = useState<GameRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GameRecord | null>(null);

  const platforms = useMemo(() => {
    const set = new Map<PlatformId, number>();
    for (const game of games) set.set(game.platformId, (set.get(game.platformId) ?? 0) + 1);
    return [...set.entries()].sort((a, b) => b[1] - a[1]);
  }, [games]);

  const filtered = useMemo(() => {
    let list = [...games];
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          g.platformId.includes(q) ||
          (PLATFORM_BY_ID.get(g.platformId)?.name.toLowerCase().includes(q) ?? false),
      );
    }
    if (platform !== 'all') list = list.filter((g) => g.platformId === platform);
    if (filter === 'favourites') list = list.filter((g) => g.favourite);
    if (filter === 'verified') list = list.filter((g) => g.compatibility === 'compatible');
    if (filter === 'unverified') list = list.filter((g) => g.compatibility !== 'compatible');

    list.sort((a, b) => {
      switch (sort) {
        case 'title':
          return a.title.localeCompare(b.title);
        case 'added':
          return b.createdAt - a.createdAt;
        case 'played':
          return b.playSeconds - a.playSeconds;
        default:
          return (b.lastPlayedAt ?? b.updatedAt) - (a.lastPlayedAt ?? a.updatedAt);
      }
    });
    return list;
  }, [games, query, platform, filter, sort]);

  const jobFor = (game: GameRecord) => jobs.find((j) => j.gameId === game.id);

  const play = (game: GameRecord) => {
    const job = jobFor(game);
    if (!job?.plan.target?.runnable) {
      pushToast({
        kind: 'warning',
        title: 'No runnable engine',
        message: job?.plan.summary ?? 'Open the game report for the blocking reasons.',
        action: { label: 'Open report', to: `/game/${game.id}` },
      });
      navigate(`/game/${game.id}`);
      return;
    }
    navigate(`/play/${game.id}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mono-label mb-1">Your collection</div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Game library</h1>
          <p className="mt-1 text-xs text-ink-3">
            {games.length === 0
              ? 'Nothing stored on this device yet.'
              : `${games.length} game${games.length === 1 ? '' : 's'} · ${games.filter((g) => g.compatibility === 'compatible').length} verified · ${games.filter((g) => g.lastPlayedAt).length} played`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/upload')}>
          <Upload className="size-4" /> Add ROMs
        </button>
      </div>

      {games.length > 0 && (
        <Panel className="p-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" />
              <input
                className="input h-9 pl-8 text-xs"
                placeholder="Search titles, platforms…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search library"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tabs
                tabs={[
                  { id: 'all', label: 'All', count: games.length },
                  { id: 'favourites', label: 'Favourites', count: games.filter((g) => g.favourite).length },
                  { id: 'verified', label: 'Verified', count: games.filter((g) => g.compatibility === 'compatible').length },
                  { id: 'unverified', label: 'Unverified' },
                ]}
                value={filter}
                onChange={setFilter}
              />
              <select
                className="input h-9 w-auto text-xs"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label="Sort"
              >
                <option value="recent">Recently played</option>
                <option value="added">Recently added</option>
                <option value="title">Title A–Z</option>
                <option value="played">Most played</option>
              </select>
            </div>
          </div>
          {platforms.length > 1 && (
            <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-line pt-2">
              <SlidersHorizontal className="mr-1 size-3.5 text-ink-4" />
              <button
                className={`chip ${platform === 'all' ? 'border-lime/40 bg-lime/10 text-lime' : 'hover:text-ink'}`}
                onClick={() => setPlatform('all')}
              >
                all platforms
              </button>
              {platforms.map(([id, count]) => (
                <button
                  key={id}
                  className={`chip ${platform === id ? 'border-lime/40 bg-lime/10 text-lime' : 'hover:text-ink'}`}
                  onClick={() => setPlatform(id)}
                >
                  {PLATFORM_BY_ID.get(id)?.name ?? id} <span className="text-ink-4">{count}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[3/4] rounded-xl" />
          ))}
        </div>
      ) : games.length === 0 ? (
        <EmptyState
          icon={<LibraryIcon className="size-5" />}
          title="Your library is empty"
          description="Drop a cartridge or disc image on the upload page. Recompa identifies it and stores it locally in IndexedDB — it never leaves your device."
          action={
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/upload')}>
              <Upload className="size-3.5" /> Upload a ROM
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search className="size-5" />} title="No matches" description="Try a different search or clear the platform filter." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              job={jobFor(game)}
              onPlay={() => play(game)}
              onFavourite={() => void toggleFavourite(game.id)}
              onCover={() => setCoverTarget(game)}
              onDelete={() => setDeleteTarget(game)}
            />
          ))}
        </div>
      )}

      {games.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 border-t border-line pt-3 font-mono text-[10px] text-ink-4">
          <span className="flex items-center gap-1.5">
            <Play className="size-3" /> click a cover to play
          </span>
          <span className="flex items-center gap-1.5">
            <Heart className="size-3" /> heart pins to favourites
          </span>
          <span className="flex items-center gap-1.5">
            <Trash2 className="size-3" /> removing deletes the local ROM copy
          </span>
        </div>
      )}

      <CoverPicker
        open={Boolean(coverTarget)}
        onClose={() => setCoverTarget(null)}
        onSelect={(dataUrl) => {
          if (!coverTarget) return;
          void updateGame(coverTarget.id, {
            cover: { kind: 'user', value: dataUrl, source: 'User-supplied image', updatedAt: Date.now() },
          });
          pushToast({ kind: 'success', title: 'Cover updated', message: 'Stored locally in IndexedDB.' });
        }}
      />

      {deleteTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setDeleteTarget(null)} role="dialog" aria-modal>
          <div className="panel w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Remove “{deleteTarget.title}”?</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
              This deletes the stored ROM bytes, battery saves, save states and test results for this entry from this device.
              Your original file on disk is untouched.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn btn-sm" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => {
                  void removeGame(deleteTarget.id);
                  setDeleteTarget(null);
                  pushToast({ kind: 'success', title: 'Removed', message: `${deleteTarget.title} was deleted from this device.` });
                }}
              >
                <Trash2 className="size-3.5" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
