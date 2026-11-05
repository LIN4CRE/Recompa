/**
 * Video layout maths for the player stage.
 *
 * Kept pure and free of DOM access so the scaling and aspect rules can be
 * unit-tested directly. `EmulatorStage` only applies the numbers this module
 * returns.
 *
 * Two user-facing settings land here:
 *
 *   • `aspect`    — 'auto' derives a per-platform display shape instead of
 *                   pretending one ratio fits every console.
 *   • `videoScale` — 'auto' fits the container, 'native' shows one canvas pixel
 *                   per CSS pixel, 'pixel-perfect' picks the largest integer
 *                   multiple that fits (no uneven pixel widths).
 */

export type AspectSetting = 'auto' | '4:3' | '16:9' | 'stretch';
export type VideoScaleSetting = 'auto' | 'native' | 'pixel-perfect';

/** Display shape actually applied to the stage box. */
export type ResolvedAspect = '4:3' | '16:9' | 'stretch' | 'native';

export interface CanvasSize {
  width: number;
  height: number;
}

export interface ContainerSize {
  width: number;
  height: number;
}

/**
 * Native display ratio per platform.
 *
 * Consoles whose pixel grid is not square in video memory are shown at the
 * ratio a CRT produced, not at `width/height` of the framebuffer:
 *
 *   NES   256×240 framebuffer, 8:7 pixels → 4:3 on a TV
 *   GB    160×144 → 10:9 (the handheld's own LCD)
 *   GBA   240×160 → 3:2
 *   PSX   320×240 → 4:3
 *
 * Platforms without an entry fall back to their framebuffer ratio.
 */
const PLATFORM_ASPECT: Record<string, ResolvedAspect> = {
  nes: '4:3',
  gb: 'native',
  gbc: 'native',
  gba: 'native',
  psx: '4:3',
};

/** Aspect applied when the user has left the setting on 'auto'. */
export function autoAspect(platformId: string): ResolvedAspect {
  return PLATFORM_ASPECT[platformId] ?? 'native';
}

/** Combine the user's setting with the platform's native shape. */
export function resolveAspect(setting: AspectSetting, platformId: string): ResolvedAspect {
  return setting === 'auto' ? autoAspect(platformId) : setting;
}

/** CSS `aspect-ratio` value for a resolved aspect, or `undefined` for native. */
export function aspectRatioCss(aspect: ResolvedAspect): string | undefined {
  switch (aspect) {
    case '4:3':
      return '4 / 3';
    case '16:9':
      return '16 / 9';
    case 'stretch':
      return 'auto';
    case 'native':
      return undefined;
  }
}

export interface StageSize {
  width: number;
  height: number;
}

/**
 * CSS size for the canvas, or `null` when the browser should fit it to the
 * stage (`width: 100%`, `height: 100%`, `max-width/max-height`).
 *
 * Returns `null` for 'auto', and whenever the inputs are unusable (zero-sized
 * canvas or container) so a hidden or unmeasured stage never collapses to 0px.
 */
export function computeStageSize(
  scale: VideoScaleSetting,
  canvas: CanvasSize,
  container: ContainerSize,
): StageSize | null {
  if (scale === 'auto') return null;
  if (!(canvas.width > 0) || !(canvas.height > 0)) return null;
  if (!(container.width > 0) || !(container.height > 0)) return null;

  if (scale === 'native') {
    return { width: Math.round(canvas.width), height: Math.round(canvas.height) };
  }

  // pixel-perfect: the largest integer multiple that still fits. At least 1 so
  // a canvas larger than the stage is scaled down rather than cropped.
  const fit = Math.min(container.width / canvas.width, container.height / canvas.height);
  const factor = Math.max(1, Math.floor(fit));
  return { width: Math.round(canvas.width * factor), height: Math.round(canvas.height * factor) };
}
