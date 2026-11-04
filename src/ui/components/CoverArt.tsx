import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ImagePlus, Upload, X } from 'lucide-react';
import type { GameRecord } from '@/core/types';
import { shortPlatform } from './primitives';

/**
 * Cover art.
 *
 * Recompa never ships or scrapes commercial box art. Three legitimate sources:
 *   1. a real screenshot you capture from your own session,
 *   2. an image you own and add yourself (stored in IndexedDB, local only),
 *   3. nothing — in which case we render a deterministic *generated* tile that
 *      is clearly a placeholder, not a fake cover.
 *
 * Deterministic generation: a hash of the game's SHA-256 picks hue + geometry,
 * so a title keeps the same identity across sessions without any invented art.
 */
export function CoverArt({
  game,
  className,
  editable = false,
  onPick,
}: {
  game: GameRecord;
  className?: string;
  editable?: boolean;
  onPick?: () => void;
}) {
  const cover = game.cover;
  const [failed, setFailed] = useState(false);
  const aspect = 'aspect-[3/4]';

  if (cover?.kind === 'user' && cover.value && !failed) {
    return (
      <div className={clsx('relative overflow-hidden rounded-lg bg-panel-2', aspect, className)}>
        <img
          src={cover.value}
          alt={`Cover art for ${game.title}`}
          className="size-full object-cover"
          onError={() => setFailed(true)}
          loading="lazy"
        />
        {editable && <EditButton onPick={onPick} />}
      </div>
    );
  }

  return (
    <div className={clsx('group relative overflow-hidden rounded-lg border border-line bg-panel', aspect, className)}>
      <GeneratedTile seed={game.payloadId || game.id} title={game.title} platform={shortPlatform(game.platformId)} />
      {editable && <EditButton onPick={onPick} />}
    </div>
  );
}

function EditButton({ onPick }: { onPick?: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onPick?.();
      }}
      className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded border border-white/15 bg-black/70 px-1.5 py-1 font-mono text-[9px] tracking-wide text-white/80 uppercase opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      title="Add your own cover image (stored locally)"
    >
      <ImagePlus className="size-3" /> art
    </button>
  );
}

export function GeneratedTile({ seed, title, platform }: { seed: string; title: string; platform: string }) {
  const { from, to, accent, pattern } = useMemo(() => paletteFor(seed), [seed]);
  return (
    <div className="relative size-full" style={{ background: `linear-gradient(155deg, ${from}, ${to})` }}>
      <svg className="absolute inset-0 size-full opacity-[0.35]" viewBox="0 0 120 160" preserveAspectRatio="none" aria-hidden>
        {pattern === 'grid' &&
          Array.from({ length: 9 }, (_, i) => (
            <line key={i} x1="0" y1={i * 20} x2="120" y2={i * 20} stroke={accent} strokeWidth="0.35" strokeOpacity="0.5" />
          ))}
        {pattern === 'rings' &&
          [18, 34, 52, 74].map((r) => (
            <circle key={r} cx="60" cy="66" r={r} fill="none" stroke={accent} strokeWidth="0.5" strokeOpacity="0.55" />
          ))}
        {pattern === 'bars' &&
          Array.from({ length: 7 }, (_, i) => (
            <rect key={i} x={8 + i * 15} y={118 - Math.abs(3 - i) * 16} width="6" height={Math.abs(3 - i) * 16 + 14} fill={accent} fillOpacity="0.5" />
          ))}
        {pattern === 'diagonal' &&
          Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1={-30 + i * 14} y1="160" x2={i * 14 + 10} y2="0" stroke={accent} strokeWidth="0.5" strokeOpacity="0.45" />
          ))}
      </svg>
      <div className="scanline-overlay opacity-25" aria-hidden />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2">
        <span className="rounded border border-white/20 bg-black/35 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.12em] text-white/80 uppercase backdrop-blur-sm">
          {platform}
        </span>
        <span className="font-mono text-[8px] text-white/45">generated</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent p-2.5 pt-8">
        <div className="line-clamp-3 font-display text-[12px] leading-tight font-semibold text-white/92">{title}</div>
      </div>
    </div>
  );
}

function hashSeed(seed: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function paletteFor(seed: string): { from: string; to: string; accent: string; pattern: 'grid' | 'rings' | 'bars' | 'diagonal' } {
  const h = hashSeed(seed);
  const hue = h % 360;
  const hue2 = (hue + 34 + ((h >> 8) % 40)) % 360;
  const patterns = ['grid', 'rings', 'bars', 'diagonal'] as const;
  return {
    from: `hsl(${hue} 34% 15%)`,
    to: `hsl(${hue2} 42% 8%)`,
    accent: `hsl(${hue2} 78% 62%)`,
    pattern: patterns[(h >> 4) % patterns.length]!,
  };
}

/** Cover picker: user-supplied image, stored locally as a data URL. */
export function CoverPicker({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (dataUrl: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  if (!open) return null;

  const handleFile = async (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError('Use a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError('Image must be under 4 MiB (it is stored locally in IndexedDB).');
      return;
    }
    const dataUrl = await downscale(file);
    onSelect(dataUrl);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal>
      <div className="panel w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold">Add cover art</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-3">
              Your image stays on this device. Recompa ships no commercial box art and never fetches it.
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <button className="btn" onClick={() => inputRef.current?.click()}>
            <Upload className="size-4" /> Choose image
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = '';
            }}
          />
          {error && <p className="text-xs text-rose">{error}</p>}
          <p className="font-mono text-[10px] text-ink-4">PNG · JPEG · WebP — max 4 MiB, resized to 480×640</p>
        </div>
      </div>
    </div>
  );
}

async function downscale(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const targetW = 480;
  const targetH = 640;
  const scale = Math.min(targetW / bitmap.width, targetH / bitmap.height, 1);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas is unavailable.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
