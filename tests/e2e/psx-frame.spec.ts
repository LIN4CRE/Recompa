/**
 * Real-browser regression test for the PlayStation bootstrap frame.
 *
 * The v0.1.0 adapter read `iframe.contentDocument` before the frame was
 * connected, which throws in Chromium and made PlayStation launch impossible.
 * A fake-DOM unit test (tests/unit/psx-frame.test.ts) guards the ordering; this
 * test proves the same path works in an actual browser, including the inline
 * bootstrap script and the parent's `postMessage` handshake.
 */
import { expect, test } from '@playwright/test';

test('EmulatorJS bootstrap frame mounts, runs its script and signals the parent', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { mountBootstrapFrame } = await import('/src/engines/psx/frame.ts');
    const { bootstrapHtml } = await import('/src/engines/psx/adapter.ts');

    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);

    const html = bootstrapHtml({
      gameName: 'frame probe',
      gameUrl: 'blob:probe',
      biosUrl: '',
      dataPath: '/cores/emulatorjs/data/',
      volume: 0.5,
      parentOrigin: window.location.origin,
    });

    const frame = mountBootstrapFrame(canvas, html);
    const win = frame.contentWindow as (Window & { EJS_core?: string; __recompaBoot?: unknown }) | null;

    // The listener is attached AFTER the synchronous write, exactly as the
    // session constructor does. postMessage is a queued task, so it must still
    // be delivered — otherwise the runtime would never be booted.
    const message = await new Promise<{ sameSource: boolean; origin: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no boot message from the frame')), 5000);
      window.addEventListener('message', function handler(event: MessageEvent) {
        const data = event.data as { recompaPsx?: string } | null;
        if (data?.recompaPsx === 'booted') {
          clearTimeout(timer);
          window.removeEventListener('message', handler);
          resolve({ sameSource: event.source === frame.contentWindow, origin: event.origin });
        }
      });
    });

    const out = {
      connected: frame.isConnected,
      canvasStillInDocument: canvas.isConnected,
      hasGameDiv: Boolean(frame.contentDocument?.getElementById('game')),
      core: win?.EJS_core ?? null,
      hasBoot: typeof win?.__recompaBoot === 'function',
      src: frame.getAttribute('src'),
      message,
      expectedOrigin: window.location.origin,
    };
    frame.remove();
    return out;
  });

  expect(result.connected).toBe(true);
  expect(result.canvasStillInDocument).toBe(false);
  expect(result.hasGameDiv).toBe(true);
  expect(result.core).toBe('psx');
  expect(result.hasBoot).toBe(true);
  expect(result.src).toBe('about:blank');
  expect(result.message.sameSource).toBe(true);
  expect(result.message.origin).toBe(result.expectedOrigin);
  expect(errors).toEqual([]);
});
