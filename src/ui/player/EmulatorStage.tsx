import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { aspectRatioCss, computeStageSize, type ResolvedAspect, type VideoScaleSetting } from './layout';

/**
 * The canvas host.
 *
 * Video sizing is CSS-driven: the aspect ratio is enforced with `aspect-ratio`
 * and the canvas keeps `image-rendering: pixelated` so upscaling stays crisp.
 * The canvas backing store is owned by the engine (256×240 for NES, 240×160 for
 * GBA) — never upscaled internally, which would waste fill rate and blur
 * pixels.
 *
 * The user's scaling choice is applied here rather than in the adapter, so
 * switching it never restarts the emulator: `auto` fits the stage, `native`
 * shows one canvas pixel per CSS pixel and `pixel-perfect` rounds down to the
 * largest integer multiple that fits. The maths lives in `layout.ts` so it can
 * be tested without a DOM.
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
  /** Already resolved from the user's setting and the platform (see `resolveAspect`). */
  aspect: ResolvedAspect;
  scale: VideoScaleSetting;
  filters: 'off' | 'scanlines' | 'smooth';
  playing: boolean;
  children?: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const apply = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const size = computeStageSize(
        scale,
        { width: canvas.width, height: canvas.height },
        { width: rect.width, height: rect.height },
      );
      if (size) {
        canvas.style.width = `${size.width}px`;
        canvas.style.height = `${size.height}px`;
        canvas.style.maxWidth = 'none';
        canvas.style.maxHeight = 'none';
      } else {
        // Fit mode: let the box size the canvas, keeping the pixel grid intact.
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.maxWidth = '100%';
        canvas.style.maxHeight = '100%';
      }
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(host);
    return () => observer.disconnect();
  }, [canvasRef, scale]);

  const aspectStyle = aspectRatioCss(aspect);

  return (
    <div
      ref={hostRef}
      className={clsx(
        'relative flex items-center justify-center overflow-hidden rounded-lg border border-line bg-black',
        playing ? 'shadow-[0_0_0_1px_rgba(214,255,75,0.14),0_30px_90px_-50px_rgba(214,255,75,0.35)]' : '',
      )}
      style={{ aspectRatio: aspectStyle, minHeight: '240px', maxHeight: 'calc(100dvh - 250px)' }}
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
