/**
 * Mounting helper for the isolated EmulatorJS iframe.
 *
 * ── Why this is a separate module ──────────────────────────────────────────
 * The PlayStation adapter needs an `about:blank` iframe whose document it
 * writes itself. The **order matters**: a detached iframe has no browsing
 * context in modern Chromium, so `iframe.contentDocument` and
 * `iframe.contentWindow` are both `null` until the element is connected to the
 * document. Writing the bootstrap into a detached frame therefore either throws
 * or is discarded when the frame is later attached.
 *
 * The previous implementation read `contentDocument` before replacing the
 * canvas with the frame, which made `create()` fail with "Could not create the
 * emulator frame" on every PlayStation launch. This helper is kept small and
 * dependency-free so the ordering invariant can be unit-tested with a fake DOM
 * and exercised in a real browser by the E2E suite.
 */

/** Attributes the emulator frame needs; kept here so tests can assert them. */
export const EMULATOR_FRAME_STYLE =
  'width:100%;height:100%;border:0;display:block;background:#000;';

/**
 * Replace `canvas` with a connected, same-origin iframe and write `html` into
 * it. Returns the frame, or throws after restoring the original canvas.
 *
 * `canvas` is put back on failure so the caller's video surface is not lost
 * when the browser refuses to create the frame (e.g. a restrictive embedding
 * policy). Blob URL cleanup stays with the caller, which owns those URLs.
 */
export function mountBootstrapFrame(canvas: HTMLCanvasElement, html: string): HTMLIFrameElement {
  const host = canvas.parentElement ?? document.body;

  const frame = document.createElement('iframe');
  frame.setAttribute('title', 'PlayStation emulator');
  frame.setAttribute('allow', 'autoplay; gamepad; fullscreen');
  frame.style.cssText = EMULATOR_FRAME_STYLE;
  frame.src = 'about:blank';

  // 1. Connect first. No code below may touch contentDocument/contentWindow
  //    before this point.
  canvas.replaceWith(frame);
  if (!frame.isConnected) host.appendChild(frame);

  // 2. Only now does the browsing context exist.
  const doc = frame.contentDocument;
  if (!doc) {
    frame.replaceWith(canvas);
    throw new Error('Could not create the emulator frame');
  }

  doc.open();
  doc.write(html);
  doc.close();
  return frame;
}
