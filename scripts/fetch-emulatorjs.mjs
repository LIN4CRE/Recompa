#!/usr/bin/env node
/**
 * Installs the OPTIONAL EmulatorJS runtime into public/cores/emulatorjs.
 *
 * Why this is a script and not a dependency:
 *   • the `emulatorjs` npm package was unpublished (verified 2025-03-07), so it
 *     cannot be installed reproducibly from the registry;
 *   • EmulatorJS is GPL-3.0. Bundling it into Recompa's MIT build would make the
 *     deployed site a distribution of GPL-3.0 binaries. By fetching it at the
 *     operator's request into a git-ignored directory, the default build stays
 *     permissive and the licence obligation sits with whoever deploys it.
 *
 * The release asset is a single .7z archive. Extraction uses the system `7z`
 * binary; if it is missing the script prints the exact install command for
 * Debian/Ubuntu, macOS and Windows and exits non-zero instead of leaving a
 * half-installed core behind.
 *
 * Usage: node scripts/fetch-emulatorjs.mjs [--version 4.2.3]
 */
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';

const REPO = 'EmulatorJS/EmulatorJS';
const OUT_DIR = path.resolve('public/cores/emulatorjs');
const MANIFEST = path.resolve('public/cores/emulatorjs-installed.json');

const args = process.argv.slice(2);
const versionArg = args.indexOf('--version');
const PINNED = versionArg !== -1 ? args[versionArg + 1] : '4.2.3';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

const headers = {
  'user-agent': 'recompa-setup/1.0',
  accept: 'application/vnd.github+json',
  ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
};

async function api(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);
  return res.json();
}

async function main() {
  console.log(`Resolving ${REPO} release v${PINNED}…`);
  const release = await api(`https://api.github.com/repos/${REPO}/releases/tags/v${PINNED}`);
  const asset = (release.assets ?? []).find((a) => a.name.endsWith('.7z'));
  if (!asset) throw new Error(`No .7z asset in release v${PINNED}`);

  console.log(`Downloading ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MiB)…`);
  const res = await fetch(asset.browser_download_url, { headers });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  console.log(`Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MiB · sha256 ${sha256.slice(0, 16)}…`);

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  // Try the system 7z first (fastest, most compatible), then explain if absent.
  const { spawn } = await import('node:child_process');
  const archivePath = path.join(OUT_DIR, asset.name);
  await writeFile(archivePath, buffer);

  const ok = await new Promise((resolve) => {
    const child = spawn('7z', ['x', '-y', `-o${OUT_DIR}`, archivePath], { shell: false });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });

  if (!ok) {
    await rm(archivePath, { force: true });
    throw new Error(
      [
        'Could not extract the archive: the `7z` command is not available on this machine.',
        '',
        'EmulatorJS is GPL-3.0 and is deliberately NOT bundled with Recompa, so this script needs a',
        'local 7z binary to install it:',
        '',
        '  Debian/Ubuntu : sudo apt install p7zip-full',
        '  macOS         : brew install p7zip',
        '  Windows       : winget install 7zip.7zip   (then run from a shell with 7z on PATH)',
        '',
        `The downloaded archive has been kept at ${archivePath} if you prefer to extract it manually.`,
      ].join('\n'),
    );
  }

  await rm(archivePath, { force: true });
  // The archive usually nests everything in "data/". Normalise if needed.
  const entries = await readdir(OUT_DIR);
  if (entries.length === 1 && !entries[0].includes('.')) {
    const inner = path.join(OUT_DIR, entries[0]);
    const innerEntries = await readdir(inner);
    if (innerEntries.includes('loader.js') || innerEntries.includes('data')) {
      for (const name of innerEntries) {
        await import('node:fs/promises').then((fs) => fs.rename(path.join(inner, name), path.join(OUT_DIR, name)));
      }
      await rm(inner, { recursive: true, force: true });
    }
  }

  const loader = path.join(OUT_DIR, 'data/loader.js');
  if (!existsSync(loader) && !existsSync(path.join(OUT_DIR, 'loader.js'))) {
    throw new Error('Extraction completed but loader.js was not found — the archive layout may have changed.');
  }

  await writeFile(
    MANIFEST,
    JSON.stringify(
      {
        installedAt: new Date().toISOString(),
        project: 'EmulatorJS',
        version: PINNED,
        licence: 'GPL-3.0',
        source: `https://github.com/${REPO}/releases/tag/v${PINNED}`,
        asset: asset.name,
        assetSha256: sha256,
        warning:
          'GPL-3.0 binaries. If you deploy these files you must provide the corresponding source for them.',
      },
      null,
      2,
    ),
  );

  console.log(`\n✓ EmulatorJS v${PINNED} installed into public/cores/emulatorjs`);
  console.log('  Licence: GPL-3.0 — deploying these files makes your site a distributor.');
  console.log('  Source:  https://github.com/EmulatorJS/EmulatorJS');
  console.log('  Recompa will detect it automatically at runtime (HEAD probe).');
}

main().catch(async (error) => {
  console.error(`\n✗ EmulatorJS install failed: ${error.message}`);
  process.exitCode = 1;
});
