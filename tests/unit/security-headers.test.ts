import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Security headers must exist on the platform we actually deploy to.
 *
 * A previous version declared the Content-Security-Policy only in
 * `public/_headers`, which is Netlify/Cloudflare syntax that **Vercel ignores**.
 * Production therefore ran with COOP/COEP and no CSP whatsoever, while the repo
 * looked as though it had one. These tests read the real config files.
 */

const root = resolve(__dirname, '../..');
const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8')) as {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};
const allHeaders = vercel.headers.flatMap((block) => block.headers);
const header = (name: string): string | undefined =>
  allHeaders.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value;

describe('vercel.json security headers', () => {
  it('declares a Content-Security-Policy at all', () => {
    // The whole point: this file is what Vercel reads.
    expect(header('Content-Security-Policy')).toBeTruthy();
  });

  it('keeps cross-origin isolation, which SharedArrayBuffer depends on', () => {
    expect(header('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(header('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  });

  it('denies powerful browser APIs nothing needs', () => {
    const pp = header('Permissions-Policy') ?? '';
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('geolocation=()');
  });

  it('blocks framing by other origins', () => {
    expect(header('Content-Security-Policy')).toContain("frame-ancestors 'self'");
  });

  it('locks base and form targets to the origin', () => {
    const csp = header('Content-Security-Policy') ?? '';
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});

describe('CSP permits exactly what the emulators require', () => {
  const csp = header('Content-Security-Policy') ?? '';

  it('allows WebAssembly compilation', () => {
    expect(csp).toContain("'wasm-unsafe-eval'");
  });

  it("allows 'unsafe-eval' because EmulatorJS decompresses ZIPs with eval", () => {
    // EmulatorJS picks a decompressor by reading the first bytes of game data,
    // and extractzip.js dispatches through getCFunc()/ccall() which call eval().
    // Recompa packages multi-track PlayStation discs as ZIP, so removing this
    // breaks the PlayStation path in a way that is silent and hard to diagnose.
    expect(csp).toContain("'unsafe-eval'");
  });

  it('allows the about:blank emulator frame', () => {
    expect(csp).toContain('frame-src');
    expect(csp).toContain('about:');
  });

  it('allows blob: for object URLs and workers', () => {
    expect(csp).toContain('blob:');
    expect(csp).toMatch(/worker-src[^;]*blob:/);
  });

  it('does not allow third-party script origins', () => {
    const scriptSrc = /script-src([^;]*)/.exec(csp)?.[1] ?? '';
    expect(scriptSrc).toContain("'self'");
    // No remote hosts in script-src: only keywords are permitted.
    expect(scriptSrc).not.toMatch(/https?:\/\//);
  });
});

describe('the Netlify-format header file stays consistent', () => {
  it('documents the same CSP directives', () => {
    const netlify = readFileSync(resolve(root, 'public/_headers'), 'utf8');
    const cspLine = /Content-Security-Policy:\s*(.+)/.exec(netlify)?.[1] ?? '';
    // Both files must agree, or a future deploy target silently loses a
    // directive that the Vercel config happens to have.
    expect(cspLine).toContain("'unsafe-eval'");
    expect(cspLine).toContain('about:');
  });
});
