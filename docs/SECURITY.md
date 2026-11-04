# Security posture

Recompa handles untrusted binary files and runs third-party emulator cores, so
the security model is worth stating precisely rather than implied.

## What Recompa never does

- **No uploads.** There is no server-side processing path. Every analysis runs in
  the tab; ROMs live in that origin's IndexedDB and are never transmitted.
- **No accounts, no telemetry, no analytics.**
- **No `dangerouslySetInnerHTML`, `innerHTML`, or `new Function` in first-party
  code.** Verified by grep in CI-adjacent review; the only dynamic script
  execution is inside the vendored EmulatorJS bundle (see below).
- **No secrets in the repository.** No API keys, tokens or credentials.

## Headers

Declared in `vercel.json`, which is where Vercel actually reads them.

> **Previously broken:** the CSP lived only in `public/_headers`, which is the
> **Netlify / Cloudflare Pages** format. Vercel ignores that file entirely, so
> production shipped COOP/COEP but **no CSP at all**. Both files are now kept in
> sync, with `vercel.json` authoritative for this deployment.

| Header | Value | Why |
| --- | --- | --- |
| `Cross-Origin-Opener-Policy` | `same-origin` | Required with COEP for `SharedArrayBuffer` |
| `Cross-Origin-Embedder-Policy` | `require-corp` | Enables `crossOriginIsolated` |
| `Cross-Origin-Resource-Policy` | `same-origin` | Stops cross-origin embedding of assets |
| `X-Content-Type-Options` | `nosniff` | No MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Leaks nothing cross-origin |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | Nothing needs these; deny by default |
| `Content-Security-Policy` | see below | |

### CSP and its two deliberate weakenings

```
default-src 'self';
script-src  'self' 'wasm-unsafe-eval' 'unsafe-eval';
style-src   'self' 'unsafe-inline';
img-src     'self' data: blob:;
media-src   'self' blob:;
font-src    'self';
connect-src 'self' blob: http://127.0.0.1:7333 http://localhost:7333;
worker-src  'self' blob: data:;
child-src   'self' blob:;
frame-src   'self' blob: about:;
frame-ancestors 'self';
base-uri    'self';
form-action 'self'
```

Every non-obvious directive has a reason:

- **`'wasm-unsafe-eval'`** — the emulator cores are WebAssembly and must compile.
- **`'unsafe-eval'`** — **EmulatorJS ships Emscripten's `extractzip.js` and
  `extract7z.js`, which dispatch through `getCFunc()`/`ccall()` and call
  `eval()`.** EmulatorJS chooses a decompressor by inspecting the *first bytes*
  of the game data, so any file beginning with `PK\x03\x04` is routed to the ZIP
  worker. Recompa deliberately hands multi-track PlayStation discs to the core
  as a **ZIP** (`src/engines/psx/discArchive.ts`), so this path is on the
  critical path of the flagship feature — not an edge case.
  Without this directive the worker throws and the game fails to start with no
  obvious cause.
- **`frame-src … about:`** — the adapter builds its own `about:blank` iframe and
  writes the bootstrap document into it.
- **`connect-src … 127.0.0.1:7333`** — the optional local recompilation worker.
  Nothing else leaves the origin.
- **`worker-src … blob: data:`** — Emscripten instantiates workers from blobs and
  can pass them as data URLs.

**Residual risk, stated plainly:** `'unsafe-eval'` means a successful
script-injection into the page could execute arbitrary strings. It is scoped to
this origin only (`'self'` provides no third-party script origin), and the
alternative — dropping ZIP packaging — would break multi-track PlayStation discs
entirely. This trade-off is recorded here rather than hidden.

`tests/unit/security-headers.test.ts` asserts these directives exist, so a future
tidy-up cannot quietly remove one and break playback.

## Third-party code

EmulatorJS 4.2.3 and the `pcsx_rearmed` core are **GPL-3.0 / GPL-2.0**, fetched
from the npm registry at build time, not committed. Serving them makes the
deployment a distributor, so the corresponding source is offered via
`docs/PLAYSTATION.md` and `THIRD-PARTY-NOTICES.md`.

## Reporting

This is a personal open-source project with no bug-bounty programme. Open an
issue at <https://github.com/LIN4CRE/Recompa/issues>.
