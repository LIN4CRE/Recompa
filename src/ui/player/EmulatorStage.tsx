import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';

/**
 * The canvas host.
 *
 * Video sizing is CSS-driven: aspect ratio is enforced with `aspect-ratio`
 * and the canvas is scaled with `image-rendering: pixelated` so integer-ish
 * upscaling stays crisp. The canvas backing store is owned by the engine
 * (256×240 for NES, 240×160 for GBA) — never upscaled internally, which would
 * waste fill rate and blur pixels.
 */
export function EmulatorStage({
  canvasRef,
  aspect,
  scale,
  filters,
  playing,
  children,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  aspect: '4:3' | '16:9' | 'stretch' | 'native';
  scale: number;
  filters: 'off' | 'scanlines' | 'smooth';
  playing: boolean;
  children?: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Keep the canvas centred with letterboxing; `scale` is a fractional zoom
  // used by the resolution selector (0.75 / 1 / 1.5).
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const apply = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width === 0) return;
      canvas.style.maxWidth = '100%';
      canvas.style.maxHeight = '100%';
      canvas.style.width = `${Math.round(rect.width * scale)}px`;
      canvas.style.height = '100%';
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(host);
    return () => observer.disconnect();
  }, [canvasRef, scale]);

  const aspectStyle =
    aspect === '4:3'
      ? '4 / 3'
      : aspect === '16:9'
        ? '16 / 9'
        : aspect === 'stretch'
          ? 'auto'
          : 'native';

  return (
    <div
      ref={hostRef}
      className={clsx(
        'relative flex items-center justify-center overflow-hidden rounded-lg border border-line bg-black',
        playing ? 'shadow-[0_0_0_1px_rgba(214,255,75,0.14),0_30px_90px_-50px_rgba(214,255,75,0.35)]' : '',
      )}
      style={{ aspectRatio: aspectStyle === 'auto' ? undefined : aspectStyle, minHeight: '240px', maxHeight: 'calc(100dvh - 250px)' }}
    >
      <canvas
        ref={canvasRef}
        className={clsx(
          'block touch-none',
          filters === 'smooth' ? 'image-rendering-auto' : 'image-rendering-pixelated',
          aspect === 'stretch' && 'size-full object-fill',
        )}
        style={{ imageRendering: filters === 'smooth' ? 'auto' : 'pixelated' }}
      />
      {filters === 'scanlines' && <div className="scanline-overlay opacity-40" aria-hidden />}
      {children}
    </div>
  );
}
