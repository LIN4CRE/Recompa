// @vitest-environment jsdom
/**
 * The app's dialogs declare `aria-modal="true"`, which promises that they can
 * be operated and dismissed from the keyboard. These tests hold the shared hook
 * to that promise: focus moves in, Escape closes, Tab wraps inside the panel and
 * focus returns to whatever opened the dialog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useModal } from '@/lib/use-modal';

function Dialog({ onClose }: { onClose: () => void }) {
  const ref = useModal(onClose);
  return createElement(
    'div',
    { ref, role: 'dialog', 'aria-modal': 'true', tabIndex: -1, id: 'panel' },
    createElement('button', { id: 'first' }, 'First'),
    createElement('button', { id: 'last' }, 'Last'),
  );
}

describe('useModal', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('moves focus into the dialog on mount', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    act(() => root.render(createElement(Dialog, { onClose: () => undefined })));
    expect(document.activeElement?.id).toBe('first');

    opener.remove();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    act(() => root.render(createElement(Dialog, { onClose })));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys', () => {
    const onClose = vi.fn();
    act(() => root.render(createElement(Dialog, { onClose })));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps Tab inside the dialog by wrapping to the first control', () => {
    act(() => root.render(createElement(Dialog, { onClose: () => undefined })));
    const last = document.getElementById('last')!;
    last.focus();
    expect(document.activeElement).toBe(last);

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => {
      last.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('first');
  });

  it('wraps backwards from the first control to the last', () => {
    act(() => root.render(createElement(Dialog, { onClose: () => undefined })));
    const first = document.getElementById('first')!;
    first.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    act(() => {
      first.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('last');
  });

  it('returns focus to the opener when the dialog unmounts', () => {
    const opener = document.createElement('button');
    opener.id = 'opener';
    document.body.appendChild(opener);
    opener.focus();

    act(() => root.render(createElement(Dialog, { onClose: () => undefined })));
    act(() => root.render(createElement('span', null, 'closed')));
    expect(document.activeElement?.id).toBe('opener');

    opener.remove();
  });
});
