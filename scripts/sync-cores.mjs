#!/usr/bin/env node
/**
 * Copies engine runtime assets out of node_modules into public/ so they are
 * served by Vite (dev + preview) and copied verbatim into the production build.
 *
 * Copies engine attribution files out of node_modules so they are served next
 * to the code that uses them.
 *
 * Run automatically by `postinstall`; also exposed as `npm run sync:cores`.
 */
import { mkdir, copyFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * The WASM binary itself is imported by the adapter as a Vite asset URL
 * (`?url`), so it must NOT be duplicated into public/. What we do copy here is
 * the upstream licence/attribution material, which the MPL-2.0 requires to
 * travel with the binary.
 */
const jobs = [
  ['node_modules/@thenick775/mgba-wasm/README.md', 'public/cores/mgba/README.upstream.md'],
  ['node_modules/@thenick775/mgba-wasm/package.json', 'public/cores/mgba/package.upstream.json'],
];

const licenses = [
  {
    name: '@thenick775/mgba-wasm',
    version: '2.6.0',
    licence: 'MPL-2.0',
    homepage: 'https://github.com/thenick775/mgba-wasm',
    note: 'mGBA fork compiled to WebAssembly. MPL-2.0 source available at the upstream repository.',
  },
];

let copied = 0;
for (const [from, to] of jobs) {
  try {
    await stat(from);
  } catch {
    console.warn(`skip (missing): ${from}`);
    continue;
  }
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
  const { size } = await stat(to);
  console.log(`✓ ${to} (${(size / 1024 / 1024).toFixed(2)} MiB)`);
  copied++;
}
await writeFile(
  path.join('public/cores/mgba', 'LICENSES.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), packages: licenses }, null, 2),
);
console.log(`sync-cores: ${copied} file(s) copied.`);
