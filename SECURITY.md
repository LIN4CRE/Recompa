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

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self';
connect-src 'self' http://127.0.0.1:7333 http://localhost:7333;
worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'
```

`style-src 'unsafe-inline'` is required by Tailwind's inlined critical styles. `connect-src` allows
the optional loopback service only.

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
