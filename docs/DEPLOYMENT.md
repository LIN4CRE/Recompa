# Deployment

**Current production deployment: <https://recompa.vercel.app>** — Vercel project `recompa`, connected
to `LIN4CRE/Recompa`, production branch `main`, build `npm ci` → `npm run build`, output `dist/`.
Verified live: app renders, `/library` deep link rewrites, catalogue JSON serves, and the page reports
`crossOriginIsolated === true`.

Recompa's client is a static bundle. Nothing is required at runtime except a web server that serves
files and — ideally — sets two headers.

## 1. Build

```bash
npm ci
npm run check:dat      # asserts the committed 31,655-fingerprint catalogue still matches upstream
npm run build          # → dist/
```

`npm run fetch:dat` regenerates the catalogue (it is committed, so this is only needed to refresh it
or to add a platform). `npm run check:dat` rebuilds it in memory and compares content while ignoring
the volatile `generatedAt` field, exiting non-zero if the snapshot is stale; CI runs it on every push.

`npm ci` runs `postinstall → scripts/sync-cores.mjs`, which copies third-party attribution files
(the mGBA README/manifest required by MPL-2.0) into `public/cores/mgba/`. The mGBA WASM binary
itself is bundled by Vite through a `?url` import, so there is exactly one copy in the output.

Verify locally before deploying:

```bash
npm run preview        # http://localhost:4173, with COOP/COEP headers
curl -sI http://localhost:4173/ | grep -i cross-origin
```

## 2. Required headers

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

Without them the app still works; it loses `SharedArrayBuffer`, so audio falls back from the
AudioWorklet ring buffer to `ScriptProcessorNode` (higher latency). The sidebar shows the live
`Threads` state, so the difference is visible rather than silent.

Also recommended:

```
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' http://127.0.0.1:7333 http://localhost:7333; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'
```

## 3. Host configurations (committed)

| Host | File | Notes |
| --- | --- | --- |
| Netlify | `public/_headers` | Copied into `dist/` by Vite. Set build command `npm run build`, publish directory `dist`. |
| Cloudflare Pages | `public/_headers` | Same file; Cloudflare honours the subset of syntax used here. |
| Vercel | `vercel.json` | **In use for production.** Headers + SPA rewrite. Framework preset: Vite, install `npm ci`, output `dist`. |
| GitHub Pages | `.github/workflows/pages.yml` | Cannot set custom headers, so isolation is off and audio uses the fallback path. |
| Any static host (nginx/Caddy/S3+CDN) | manual | Add the headers above; serve `index.html` for unknown paths (hash routing means this is rarely needed). |

Routing uses the URL hash (`#/library`), so deep links work on hosts without rewrite rules.

## 4. Optional: local processing service

Not needed for gameplay or analysis. It exists for native tooling (Rizin, Ghidra, N64Recomp).

```bash
# on your own machine, never on a public host
npm run serve:processing
```

Configuration (see `.env.example`):

| Variable | Effect |
| --- | --- |
| `RECOMPA_SERVICE_PORT` | Port (default 7333) |
| `RECOMPA_ALLOW_REMOTE=1` | Binds `0.0.0.0` instead of loopback — **do not set on a public host** |
| `RECOMPA_ALLOWED_ORIGINS` | Comma-separated origins allowed to call it |
| `RECOMPA_JOB_TIMEOUT_MS` | Hard child-process timeout (default 120000) |
| `RIZIN_BIN` | Path to `rizin` (enables `/jobs/analyse-structure`) |
| `GHIDRA_HEADLESS` | Path to `analyzeHeadless` |
| `N64RECOMP_BIN` | Path to `N64Recomp` |
| `REA_CLI`, `REA_MODEL`, `REA_API_KEY` | Enable the REA assistant bridge; all three are required |

The service reports which tools are genuinely installed at `GET /capabilities`, and the UI shows
"not configured" for the rest. If you deploy the client on a public origin and want it to reach a
local service, add that origin to `RECOMPA_ALLOWED_ORIGINS` **and** to the CSP `connect-src`.

### Systemd unit (example, self-hosted)

```ini
[Unit]
Description=Recompa processing service
After=network.target

[Service]
Type=simple
User=recompa
WorkingDirectory=/opt/recompa
Environment=RIZIN_BIN=/usr/bin/rizin
ExecStart=/usr/bin/node server/processing-service.mjs
Restart=on-failure
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes

[Install]
WantedBy=multi-user.target
```

Keep `RECOMPA_ALLOW_REMOTE` unset and reach it through an SSH tunnel or a reverse proxy that
terminates TLS and enforces authentication.

## 5. Version pinning

`package.json` pins the exact versions of both execution cores (`jsnes`, `@thenick775/mgba-wasm`)
because adapter behaviour depends on their internals:

- jsnes 2.1.0's CJS bundle hides its exports and its `reset()` is unsafe — both are handled by
  shims that must be re-verified on upgrade (tests will fail loudly if the shim breaks).
- mGBA's WASM build is imported by URL; a major version may change the `locateFile` contract.

When upgrading either, run `npm test` and the Playwright suite before shipping.

## 6. Rollback

The build is immutable per commit: redeploy the previous `dist/` artefact (or the previous commit on
the host's deploy history). No database migrations exist — client state lives in the user's
IndexedDB, and the backup format is versioned, so a newer client can still import older backups
(v1 rescue path is implemented and tested).
