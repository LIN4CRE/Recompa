import { useEffect, useRef } from 'react';

/**
 * Keyboard and focus behaviour for modal dialogs.
 *
 * Every dialog in the app already declares `role="dialog" aria-modal="true"`,
 * which tells assistive technology that the rest of the page is inert — but
 * nothing made that true: Escape did not close, focus stayed on the button
 * behind the overlay, and Tab walked straight out of the dialog into hidden
 * content. This hook supplies the behaviour that declaration promises.
 *
 * Attach the returned ref to the panel element (not the backdrop).
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModal(onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const panel = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // The selector already excludes disabled controls and tabindex="-1". An
    // `offsetParent` check is deliberately avoided: it is null in jsdom and for
    // fixed-position ancestors, which would make every real dialog look empty.
    const focusable = () =>
      panel
        ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
          )
        : [];

    // Move focus into the dialog so the keyboard is where the screen reader is.
    (focusable()[0] ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = focusable();
      if (items.length === 0) {
        // Nothing focusable inside: keep focus on the panel rather than letting
        // Tab reach the inert page behind it.
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Return focus to whatever opened the dialog, if it is still there.
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [onClose]);

  return ref;
}
