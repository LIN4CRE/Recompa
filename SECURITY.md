# Security policy

## Reporting a vulnerability

Open a private security advisory on the GitHub repository
(*Security → Advisories → Report a vulnerability*). Please do not open a public issue for
anything that could expose user data or allow code execution.

Include: affected version/commit, browser and OS, reproduction steps, and the impact you observed.
You can expect an acknowledgement within seven days.

## Threat model

Recompa is a **static, single-origin web application** with an optional loopback service. The
assets worth protecting are:

1. the user's own game files (copyrighted, personal),
2. locally stored saves and save states,
3. the integrity of the browser session while parsing untrusted files.

There is no account system, no server-side user data, no payment flow and no telemetry.

### Boundaries

| Boundary | Handling |
| --- | --- |
| ROM bytes | Read with `File.arrayBuffer()`, parsed by bounds-checked readers (`ByteReader`). Never uploaded. Stored in IndexedDB only when the user opts in. |
| Archives | Inspected with a filter pass; exactly one member is inflated. Caps: 512 entries listed, 256 MiB per member. Nested archives are rejected, not recursed. |
| Filenames | Used only for display and for deriving an engine-side save filename, which is sanitised (`[^\w.\- ]` → `_`, truncated). |
| Emulator cores | Receive bytes as data. No native code from a ROM ever runs on the host. WASM is served same-origin and its integrity is pinned by the build. |
| External tools | Only invoked by the optional service, always `spawn(cmd, args, { shell: false })`, with a hard timeout and output caps. |
| Secrets | None are required by the client. The service reads configuration from the environment only; nothing is logged that contains a key. |

### Cross-origin isolation

`COOP: same-origin` + `COEP: require-corp` are set so `SharedArrayBuffer` is available for the audio
ring buffer. Consequence: every asset must be same-origin or carry CORP headers. Recompa loads no
third-party runtime assets, which keeps this constraint trivial. On hosts that cannot set headers
(GitHub Pages), isolation is off and the app degrades to the ScriptProcessor audio path — verified
by the capability probe shown in the sidebar.

### Content Security Policy

The authoritative policy is `vercel.json` (kept in sync with `public/_headers` by
`tests/unit/security-headers.test.ts`). Verbatim, as deployed:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' blob: http://127.0.0.1:7333 http://localhost:7333; worker-src 'self' blob: data:; child-src 'self' blob:; frame-src 'self' blob: about:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'
```

`style-src 'unsafe-inline'` is required by Tailwind's inlined critical styles.
`'wasm-unsafe-eval'` permits WebAssembly compilation without enabling general
JavaScript `eval()` ([MDN][csp-script-src]). `'unsafe-eval'` is the one genuinely
costly directive: EmulatorJS ships Emscripten's `extractzip.js`, which calls
`eval()`, and Recompa hands multi-track PlayStation discs to the core as a ZIP.
It is scoped to `script-src`, is required only for the optional PlayStation core,
and is documented rather than hidden. `connect-src` allows the optional loopback
service only; `frame-src blob: about:` is required by the PlayStation bootstrap
frame. See `docs/SECURITY.md` for the full rationale.

[csp-script-src]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src

## Hardening already applied

- No `dangerouslySetInnerHTML` anywhere in the codebase.
- No `eval`, no `new Function`.
- All binary reads go through bounds-checked accessors (`u8/u16/u32/has/ascii/printable`).
- Archive and payload size limits enforced before allocation.
- IndexedDB operations wrapped so a quota failure surfaces as a user-facing error rather than an
  unhandled rejection.
- The processing service validates `Origin`, enforces `application/json` on POST, and refuses to
  bind publicly unless `RECOMPA_ALLOW_REMOTE=1` is set deliberately.

## Known limitations

- The client cannot verify that a user is entitled to the ROM they load; that is stated in the UI
  and in the README rather than implied by a check that would be theatre.
- Fingerprint data is CC-BY-SA-4.0 metadata; it is not signed, so a tampered `public/data` would
  change identification results. It cannot affect execution safety.

## Repository hardening: what is in the repo and what the owner must enable

Everything that can be expressed as a file is already committed:

- `.github/dependabot.yml` — weekly `npm` and `github-actions` updates, with the
  two execution cores pinned deliberately (adapter behaviour depends on their
  internals).
- `.github/workflows/ci.yml` — typecheck, unit tests, catalogue freshness,
  production build, artefact verification and Playwright E2E.
- `.github/workflows/codeql.yml` — CodeQL `security-and-quality` for
  JavaScript/TypeScript, weekly and on `main`/PRs.
- `.github/workflows/pages.yml` — separate GitHub Pages deployment.
- Every workflow declares an explicit least-privilege `permissions:` block
  (`contents: read` for CI/CodeQL; `pages: write` + `id-token: write` only in
  the Pages deploy job), uses `persist-credentials: false` on checkout, and
  never runs untrusted PR code with write permissions.
- Third-party actions are pinned to **immutable commit SHAs**, resolved from the
  upstream repositories through the GitHub API on 5 November 2026:

  | Action | Tag | Pinned commit |
  | --- | --- | --- |
  | `actions/checkout` | v7 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
  | `actions/setup-node` | v7 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
  | `actions/upload-artifact` | v7 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
  | `github/codeql-action` | v4 | `33d7b85da1a04171e211befe2c739303b9a4c066` |
  | `actions/configure-pages` | v6 | `45bfe0192ca1faeb007ade9deae92b16b8254a0d` |
  | `actions/upload-pages-artifact` | v5 | `fc324d3547104276b827a68afc52ff2a11cc49c9` |
  | `actions/deploy-pages` | v5 | `368f82528645a54fb793d4d04e342629a3f51346` |

  To refresh one, resolve the tag to a commit (`gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`)
  and replace the SHA, keeping the trailing `# vN` comment for readability.

The following cannot be set from a repository file and require the owner to act
in the GitHub web UI (these are account/repository settings, not code):

1. **Settings → Code security and analysis**: enable *Dependency graph*,
   *Dependabot alerts*, *Dependabot security updates*, *Secret scanning* and
   *Push protection*. No paid service is required; these are free for public
   repositories.
2. **Settings → Code security and analysis → Code scanning**: confirm the CodeQL
   workflow has uploaded results at least once; the workflow file alone is not
   enough to populate the *Security* tab.
3. **Settings → Branches → Branch protection rule** for `main` (or an equivalent
   *Ruleset*): require a pull request before merging, require the
   `Typecheck, unit tests, build` and `End-to-end (Chromium)` status checks,
   require branches to be up to date, and disallow force pushes and deletions.
4. **Settings → Actions → General**: set the default `GITHUB_TOKEN` permissions
   to *Read repository contents* and disable *Allow GitHub Actions to create and
   approve pull requests*.
5. **Settings → Environments**: for `github-pages`, restrict deployments to the
   `main` branch if the Pages workflow should never be triggered from a preview
   branch.
6. **Vercel project → Settings → Git**: confirm the production branch is `main`
   and that preview deployments do not inherit production environment variables.
   Recompa needs no production secrets; the client has none.

If GitHub Actions jobs are refused before their first step with a billing
message, resolve the owner account's billing status — no workflow change can
clear that, and the equivalent checks must be run locally (as done in
`docs/AUDIT-2026-11-05.md`).
