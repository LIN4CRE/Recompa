// @vitest-environment jsdom
/**
 * The app had no render-error boundary: any thrown error unmounted the whole
 * tree and left a blank page, with no way back. These tests render the real
 * boundary in jsdom and assert it (a) gets out of the way when nothing is
 * wrong, and (b) shows a recovery UI instead of white space when a child throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';

function Boom(): never {
  throw new Error('Emulator adapter exploded');
}

describe('ErrorBoundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // React logs the caught error; the boundary intentionally re-logs it too.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    consoleError.mockRestore();
  });

  it('renders children untouched when nothing throws', () => {
    act(() => {
      root.render(createElement(ErrorBoundary, null, createElement('p', null, 'library is fine')));
    });
    expect(container.textContent).toContain('library is fine');
    expect(container.textContent).not.toContain('Runtime error');
  });

  it('shows a recovery screen instead of a blank page', () => {
    act(() => {
      root.render(createElement(ErrorBoundary, null, createElement(Boom)));
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Runtime error');
    expect(text).toContain('Emulator adapter exploded');
    // Recovery actions must exist, not just an apology.
    expect(text).toContain('Reload');
    expect(text).toContain('Go to home screen');
  });

  it('tells the user their stored games survive a reload', () => {
    act(() => {
      root.render(createElement(ErrorBoundary, null, createElement(Boom)));
    });
    expect(container.textContent).toMatch(/IndexedDB/);
  });

  it('is actually mounted above the application in main.tsx', () => {
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'main.tsx'), 'utf8');
    expect(main).toContain('<ErrorBoundary>');
    // It must wrap App, not sit beneath it.
    const boundary = main.indexOf('<ErrorBoundary>');
    const app = main.indexOf('<App />');
    const close = main.indexOf('</ErrorBoundary>');
    expect(boundary).toBeGreaterThan(-1);
    expect(app).toBeGreaterThan(boundary);
    expect(close).toBeGreaterThan(app);
  });
});
