import { clsx } from 'clsx';
import { Heart, Play, Settings2, Trash2 } from 'lucide-react';
import type { GameRecord, Job } from '@/core/types';
import { CoverArt } from './CoverArt';
import { CompatBadge, MethodBadge, PlatformBadge, relativeTime } from './primitives';
import { useNavigate } from '@/lib/router';
import { ALL_DESCRIPTORS } from '@/engines/descriptors';

export function GameCard({
  game,
  job,
  onPlay,
  onFavourite,
  onCover,
  onDelete,
  priority = false,
}: {
  game: GameRecord;
  job?: Job;
  onPlay: () => void;
  onFavourite: () => void;
  onCover: () => void;
  onDelete: () => void;
  priority?: boolean;
}) {
  const navigate = useNavigate();
  const target = job?.plan.target ?? null;
  const engineName = target?.descriptor.name ?? ALL_DESCRIPTORS.find((d) => d.id === game.engineId)?.name;
  const playable = Boolean(target?.runnable);
  const method = target?.method;
  const methodLabel = target?.methodLabel;

  return (
    <article
      className={clsx(
        'group relative flex flex-col overflow-hidden rounded-xl border border-line bg-panel/70 transition-all duration-200',
        'hover:-translate-y-0.5 hover:border-line-bright hover:shadow-[0_18px_50px_-30px_rgba(0,0,0,0.9)]',
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        className="relative block w-full overflow-hidden text-left"
        aria-label={playable ? `Play ${game.title}` : `Open analysis for ${game.title}`}
        {...(priority ? {} : {})}
      >
        <CoverArt game={game} editable onPick={onCover} className="rounded-b-none border-0 border-b border-line" />
        <div className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100">
          <span
            className={clsx(
              'flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold tracking-wide',
              playable ? 'bg-lime text-[#10160a]' : 'bg-panel-3 text-ink-2',
            )}
          >
            <Play className="size-3.5 fill-current" />
            {playable ? 'PLAY' : 'REVIEW'}
          </span>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onFavourite();
          }}
          aria-label={game.favourite ? 'Remove from favourites' : 'Add to favourites'}
          className={clsx(
            'absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full border backdrop-blur transition-all',
            game.favourite
              ? 'border-lime/40 bg-black/60 text-lime opacity-100'
              : 'border-white/15 bg-black/50 text-white/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
        >
          <Heart className={clsx('size-3.5', game.favourite && 'fill-current')} />
        </button>
      </button>

      <div className="flex flex-1 flex-col p-2.5">
        <div className="flex items-start justify-between gap-2">
          <button onClick={onPlay} className="min-w-0 flex-1 text-left">
            <h3 className="truncate text-[13px] leading-tight font-semibold text-ink transition-colors group-hover:text-white" title={game.title}>
              {game.title}
            </h3>
          </button>
          <PlatformBadge platformId={game.platformId} className="mt-0.5 shrink-0" />
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {method ? <MethodBadge kind={method} label={methodLabel} /> : <span className="chip text-amber">No engine</span>}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 border-t border-line/70 pt-2">
          {playable ? (
            <span className="truncate font-mono text-[10px] text-ink-4" title={engineName}>
              {engineName}
            </span>
          ) : (
            <span className="truncate font-mono text-[10px] text-amber/80">needs attention</span>
          )}
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              className="grid size-6 place-items-center rounded text-ink-4 hover:bg-white/6 hover:text-ink-2"
              onClick={() => navigate(`/game/${game.id}`)}
              title="Game details"
              aria-label="Game details"
            >
              <Settings2 className="size-3.5" />
            </button>
            <button
              className="grid size-6 place-items-center rounded text-ink-4 hover:bg-rose/10 hover:text-rose"
              onClick={onDelete}
              title="Remove from library"
              aria-label="Remove from library"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="mt-1.5 flex items-center justify-between">
          <CompatBadge state={game.compatibility} />
          <span className="font-mono text-[9px] text-ink-4">{relativeTime(game.lastPlayedAt)}</span>
        </div>
      </div>
    </article>
  );
}
