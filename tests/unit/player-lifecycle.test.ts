// @vitest-environment jsdom
/**
 * Regression for the "Loading core… / stopped" player bug.
 *
 * `useEmulator()` returns a fresh object on every render. `Player.tsx` therefore
 * must depend on the handle's *stable* members (`start`, `stop`, `actions`) in
 * its effects. Depending on the whole object made the teardown effect — which
 * calls `stop()` — run on every render and abort the session immediately after
 * `start()` created it. The Playwright smoke suite caught the symptom; this test
 * guards the invariant that keeps the fix cheap to verify.
 */
import { describe, expect, it } from 'vitest';
import { act, createElement, useEffect, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEmulator } from '@/ui/player/useEmulator';

interface HandleSnapshot {
  start: unknown;
  stop: unknown;
  actions: unknown;
}

describe('useEmulator handle stability', () => {
  it('does not re-run a stop()-on-cleanup effect on re-render', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const snapshots: HandleSnapshot[] = [];
    let triggerRender: (() => void) | null = null;
    let teardowns = 0;

    function Harness() {
      const [, forceRender] = useReducer((n: number) => n + 1, 0);
      const handle = useEmulator();
      triggerRender = () => forceRender();
      snapshots.push({ start: handle.start, stop: handle.stop, actions: handle.actions });
      // Mirrors Player.tsx's lifecycle teardown effect: it depends on `stop`
      // and calls it on cleanup. A re-render must not trigger that cleanup.
      useEffect(
        () => () => {
          teardowns += 1;
        },
        [handle.stop],
      );
      return null;
    }

    await act(async () => {
      root.render(createElement(Harness));
    });
    expect(snapshots.length).toBeGreaterThan(0);
    const before = snapshots[0];

    await act(async () => {
      triggerRender?.();
    });
    const after = snapshots[snapshots.length - 1];

    expect(snapshots.length).toBeGreaterThan(1);
    expect(after.start).toBe(before.start);
    expect(after.stop).toBe(before.stop);
    expect(after.actions).toBe(before.actions);
    expect(teardowns).toBe(0);

    await act(async () => {
      root.unmount();
    });
    expect(teardowns).toBe(1);
    container.remove();
  });
});
