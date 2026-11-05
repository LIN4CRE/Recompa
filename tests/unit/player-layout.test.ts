import { describe, expect, it } from 'vitest';
import { aspectRatioCss, autoAspect, computeStageSize, resolveAspect } from '@/ui/player/layout';

describe('aspect resolution', () => {
  it('gives each console its native display shape instead of one blanket ratio', () => {
    expect(autoAspect('nes')).toBe('4:3');
    expect(autoAspect('psx')).toBe('4:3');
    expect(autoAspect('gb')).toBe('native');
    expect(autoAspect('gbc')).toBe('native');
    expect(autoAspect('gba')).toBe('native');
  });

  it('falls back to the framebuffer ratio for an unknown platform', () => {
    expect(autoAspect('snes')).toBe('native');
    expect(autoAspect('unknown')).toBe('native');
  });

  it('honours an explicit setting over the platform default', () => {
    expect(resolveAspect('16:9', 'nes')).toBe('16:9');
    expect(resolveAspect('stretch', 'gba')).toBe('stretch');
    expect(resolveAspect('4:3', 'gba')).toBe('4:3');
  });

  it('resolves auto through the platform table', () => {
    expect(resolveAspect('auto', 'nes')).toBe('4:3');
    expect(resolveAspect('auto', 'gba')).toBe('native');
  });

  it('maps resolved aspects to CSS aspect-ratio values', () => {
    expect(aspectRatioCss('4:3')).toBe('4 / 3');
    expect(aspectRatioCss('16:9')).toBe('16 / 9');
    expect(aspectRatioCss('stretch')).toBe('auto');
    // 'native' means "let the canvas define it" — no CSS override.
    expect(aspectRatioCss('native')).toBeUndefined();
  });
});

describe('stage scaling', () => {
  const canvas = { width: 256, height: 240 };

  it('returns null in auto mode so the browser fits the stage', () => {
    expect(computeStageSize('auto', canvas, { width: 800, height: 600 })).toBeNull();
  });

  it('uses one canvas pixel per CSS pixel in native mode', () => {
    expect(computeStageSize('native', canvas, { width: 800, height: 600 })).toEqual({ width: 256, height: 240 });
  });

  it('picks the largest integer multiple that fits (pixel perfect)', () => {
    // 800/256 = 3.1, 600/240 = 2.5 → the limiting axis allows exactly 2.
    expect(computeStageSize('pixel-perfect', canvas, { width: 800, height: 600 })).toEqual({ width: 512, height: 480 });
    // 1024/256 = 4, 960/240 = 4 → exactly 4.
    expect(computeStageSize('pixel-perfect', canvas, { width: 1024, height: 960 })).toEqual({ width: 1024, height: 960 });
  });

  it('never rounds to zero when the canvas is larger than the stage', () => {
    expect(computeStageSize('pixel-perfect', { width: 640, height: 480 }, { width: 300, height: 200 })).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('declines to size an unmeasured container or empty canvas', () => {
    expect(computeStageSize('pixel-perfect', canvas, { width: 0, height: 0 })).toBeNull();
    expect(computeStageSize('pixel-perfect', { width: 0, height: 0 }, { width: 800, height: 600 })).toBeNull();
  });

  it('produces whole-pixel dimensions at every integer factor', () => {
    for (const factor of [1, 2, 3, 4, 5]) {
      const size = computeStageSize('pixel-perfect', canvas, { width: 256 * factor, height: 240 * factor });
      expect(size).toEqual({ width: 256 * factor, height: 240 * factor });
      expect(Number.isInteger(size!.width) && Number.isInteger(size!.height)).toBe(true);
    }
  });
});
