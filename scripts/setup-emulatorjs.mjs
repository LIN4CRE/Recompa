#!/usr/bin/env node
/**
 * Installs the EmulatorJS runtime + PlayStation core into
 * `public/cores/emulatorjs`, from tarballs pinned in `vendor/emulatorjs`.
 *
 * WHY TARBALLS AND NOT A DEPENDENCY
 * ---------------------------------
 * `npm i @emulatorjs/emulatorjs` pulls `@emulatorjs/cores`, a meta-package
 * that installs every core for every system (~400 MB across 40 packages) and
 * brought 52 high-severity advisories into the tree. We only want two
 * artefacts, so they are pinned by SHA-1 (taken from the npm registry's own
 * `dist.shasum`) and extracted here instead.
 *
 * WHY NOT COMMITTED
 * -----------------
 * EmulatorJS and pcsx_rearmed are GPL-3.0. Committing them would make every
 * clone a redistribution of copyleft binaries. `vendor/` is git-ignored and
 * fetched on demand, keeping the repository itself MIT and the licence
 * obligation with whoever chooses to deploy the runtime.
 *
 * Output layout (matches what install-check.ts probes and what loader.js
 * expects, which differs from the upstream release archive):
 *
 *   public/cores/emulatorjs/data/loader.js
 *   public/cores/emulatorjs/data/src/*.js
 *   public/cores/emulatorjs/data/compression/*.js
 *   public/cores/emulatorjs/data/localization/*.json
 *   public/cores/emulatorjs/data/version.json
 *   public/cores/emulatorjs/data/cores/pcsx_rearmed-wasm.data
 *   public/cores/emulatorjs/data/cores/pcsx_rearmed-legacy-wasm.data
 *   public/cores/emulatorjs/data/cores/reports/pcsx_rearmed.json
 *   public/cores/emulatorjs/data/cores/COPYING.pcsx_rearmed
 *   public/cores/emulatorjs/data/cores/LICENSE.emulatorjs
 *   public/cores/emulatorjs-installed.json
 *
 * Usage: node scripts/setup-emulatorjs.mjs [--core pcsx_rearmed]
 */
import { mkdir, rm, copyFile, writeFile, readdir, stat, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor/emulatorjs');
const OUT_DIR = path.join(ROOT, 'public/cores/emulatorjs');
const DATA_DIR = path.join(OUT_DIR, 'data');
const CORE_OUT = path.join(DATA_DIR, 'cores');
const MANIFEST = path.join(ROOT, 'public/cores/emulatorjs-installed.json');

/**
 * Pinned inputs. `sha1` is the npm registry `dist.shasum` for the exact
 * version, so a swapped or tampered tarball fails loudly instead of being
 * silently extracted.
 */
const PINNED = [
  {
    id: 'emulatorjs',
    package: '@emulatorjs/emulatorjs',
    version: '4.2.3',
    file: 'emulatorjs-emulatorjs-4.2.3.tgz',
    sha1: '724b90d39c44cfa617b12c43660990abf906343d',
    licence: 'GPL-3.0',
    source: 'https://github.com/EmulatorJS/EmulatorJS',
  },
  {
    id: 'pcsx_rearmed',
    package: '@emulatorjs/core-pcsx_rearmed',
    version: '4.2.3',
    file: 'emulatorjs-core-pcsx_rearmed-4.2.3.tgz',
    sha1: '219686aa59180ee0345e8ce3e7ba76899262d718',
    licence: 'GPL-2.0 (pcsx_rearmed) · GPL-3.0 (EmulatorJS)',
    source: 'https://github.com/EmulatorJS/pcsx_rearmed',
  },
];

/** Cores shipped, in preference order. EmulatorJS picks the first that exists. */
const CORE_FILES = ['pcsx_rearmed-wasm.data', 'pcsx_rearmed-legacy-wasm.data'];

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

const argv = process.argv.slice(2);
/**
 * `--optional` is used by `npm run build`: a missing toolchain or missing
 * tarballs must not fail a production build, because the app is fully
 * functional without PlayStation support and reports it honestly in the UI.
 * Run without the flag to get a hard failure (the default for operators who
 * explicitly asked for the PlayStation core).
 */
const OPTIONAL = argv.includes('--optional');

/**
 * Fetch a pinned tarball from the npm registry when it is not vendored.
 *
 * This keeps copyleft binaries out of Git while still letting an automated
 * build (Vercel) produce a deployment that includes the core. The SHA-1 is
 * the registry's own `dist.shasum`, so a substituted artefact is rejected.
 */
async function fetchTarball(pin) {
  const dest = path.join(VENDOR, pin.file);
  if (existsSync(dest)) return dest;

  await mkdir(VENDOR, { recursive: true });
  const { spawn } = await import('node:child_process');
  console.log(`Fetching ${pin.package}@${pin.version} from the npm registry…`);
  await new Promise((resolve, reject) => {
    // `npm pack` writes <name>-<version>.tgz into cwd; run it inside VENDOR.
    const child = spawn('npm', ['pack', `${pin.package}@${pin.version}`, '--silent'], {
      cwd: VENDOR,
      shell: false,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`npm pack exited ${code} for ${pin.package}`)),
    );
  });

  // npm names the file after the package; normalise to our pinned file name.
  const produced = (await readdir(VENDOR)).find(
    (f) => f.endsWith('.tgz') && f.includes(pin.package.split('/').pop()),
  );
  if (!produced) throw new Error(`npm pack produced no tarball for ${pin.package}`);
  const producedPath = path.join(VENDOR, produced);
  if (producedPath !== dest) await rename(producedPath, dest);
  return dest;
}

async function extractTarball(tgz, dest) {
  await mkdir(dest, { recursive: true });
  await new Promise((resolve, reject) => {
    // tar is ubiquitous on Linux/macOS and ships with Windows 10+.
    const child = spawn('tar', ['xzf', tgz, '-C', dest], { shell: false });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`tar exited ${code} for ${path.basename(tgz)}`)),
    );
  });
}

/** 7z is already required by the upstream fetch script, so reuse it here. */
async function extract7z(archive, dest) {
  await mkdir(dest, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn('7z', ['x', '-y', `-o${dest}`, archive], { shell: false });
    child.on('error', () =>
      reject(
        new Error(
          'The `7z` command is required to unpack the core .data files.\n' +
            '  Debian/Ubuntu : sudo apt install p7zip-full\n' +
            '  macOS         : brew install p7zip\n' +
            '  Windows       : winget install 7zip.7zip',
        ),
      ),
    );
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`7z exited ${code}`))));
  });
}

async function copyTree(from, to, filter = () => true) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (!filter(entry.name)) continue;
    if (entry.isDirectory()) await copyTree(src, dst, filter);
    else if (entry.isFile()) await copyFile(src, dst);
  }
}

async function main() {
  try {
    for (const pin of PINNED) await fetchTarball(pin);
  } catch (error) {
    if (!OPTIONAL) throw error;
    console.warn(`!  PlayStation core not installed: ${error.message}`);
    console.warn('   The build will continue without it; the UI reports the engine as unavailable.');
    return;
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  const tmp = path.join(ROOT, 'node_modules/.cache/recompa-emulatorjs');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });

  const verified = [];
  for (const pin of PINNED) {
    const tgz = path.join(VENDOR, pin.file);
    const bytes = await import('node:fs').then((fs) => fs.readFileSync(tgz));
    const actual = sha1(bytes);
    if (actual !== pin.sha1) {
      throw new Error(
        `Integrity check failed for ${pin.package}@${pin.version}\n` +
          `  expected sha1 ${pin.sha1}\n  actual   sha1 ${actual}\n` +
          'Refusing to extract. Re-fetch the tarball from the npm registry.',
      );
    }
    verified.push({ ...pin, sha1: actual });

    const dest = path.join(tmp, pin.id);
    await extractTarball(tgz, dest);
    const pkg = path.join(dest, 'package');
    if (!existsSync(pkg)) throw new Error(`Unexpected tarball layout in ${pin.file} (no package/ dir)`);

    if (pin.id === 'emulatorjs') {
      // The npm package ships data/ at its root; loader.js expects exactly that.
      const dataSrc = path.join(pkg, 'data');
      const srcDir = existsSync(dataSrc) ? dataSrc : pkg;
      await copyTree(
        srcDir,
        DATA_DIR,
        // emulator.min.js is not published to npm; the loader falls back to
        // individual src/*.js files when EJS_DEBUG_XX is set, which we do.
        (name) => name !== 'node_modules',
      );
    } else {
      await mkdir(CORE_OUT, { recursive: true });
      // Ship the modern build plus the legacy fallback; skip the thread builds
      // unless the deployment is cross-origin isolated (probed at runtime).
      for (const name of CORE_FILES) {
        const src = path.join(pkg, name);
        if (existsSync(src)) await copyFile(src, path.join(CORE_OUT, name));
      }
      // Named distinctly: data/cores/README.md already belongs to EmulatorJS.
      if (existsSync(path.join(pkg, 'README.md'))) {
        await copyFile(path.join(pkg, 'README.md'), path.join(CORE_OUT, 'README.pcsx_rearmed.md'));
      }
      // reports/<core>.json tells EmulatorJS the core's supported extensions
      // and whether it needs threads/WebGL2.
      const report = path.join(pkg, 'reports', 'pcsx_rearmed.json');
      if (existsSync(report)) {
        await mkdir(path.join(CORE_OUT, 'reports'), { recursive: true });
        await copyFile(report, path.join(CORE_OUT, 'reports/pcsx_rearmed.json'));
      }
      // The core's licence and build metadata live *inside* each .data
      // archive (a 7z container), not beside it in the npm tarball. GPL
      // requires the licence to travel with the binary, so unpack both the
      // licence and core.json (the authoritative extension list) next to it.
      const licenceTmp = path.join(tmp, `${pin.id}-licence`);
      const primaryData = path.join(CORE_OUT, CORE_FILES[0]);
      if (existsSync(primaryData)) {
        try {
          await extract7z(primaryData, licenceTmp);
          const licenceSrc = path.join(licenceTmp, 'license.txt');
          if (existsSync(licenceSrc)) {
            await copyFile(licenceSrc, path.join(CORE_OUT, 'LICENSE.pcsx_rearmed.txt'));
          }
          const coreJson = path.join(licenceTmp, 'core.json');
          if (existsSync(coreJson)) {
            await copyFile(coreJson, path.join(CORE_OUT, 'core.json'));
          }
        } catch (error) {
          // Non-fatal: the core still works, but say so plainly rather than
          // shipping a binary with no licence beside it.
          console.warn(`!  Could not extract licence text from the core payload: ${error.message}`);
          console.warn('   The core is installed, but licence.txt was not copied next to it.');
        }
      }
    }
  }

  for (const required of ['data/loader.js', 'data/version.json']) {
    if (!existsSync(path.join(OUT_DIR, required))) {
      throw new Error(`Extraction finished but ${required} is missing — tarball layout changed?`);
    }
  }
  if (!existsSync(path.join(DATA_DIR, 'cores', 'pcsx_rearmed-wasm.data'))) {
    throw new Error('PlayStation core payload pcsx_rearmed-wasm.data was not installed.');
  }

  const coreSize = (await stat(path.join(DATA_DIR, 'cores/pcsx_rearmed-wasm.data'))).size;

  await writeFile(
    MANIFEST,
    JSON.stringify(
      {
        installedAt: new Date().toISOString(),
        runtime: 'EmulatorJS',
        runtimeVersion: '4.2.3',
        cores: ['pcsx_rearmed'],
        corePayloadBytes: coreSize,
        licences: verified.map((v) => ({ id: v.id, licence: v.licence, source: v.source })),
        verifiedSha1: Object.fromEntries(verified.map((v) => [v.package, v.sha1])),
        warning:
          'GPL-3.0 / GPL-2.0 binaries. Serving these files makes your deployment a distributor; ' +
          'you must offer the corresponding source. See docs/PLAYSTATION.md.',
      },
      null,
      2,
    ),
  );

  await rm(tmp, { recursive: true, force: true });

  console.log(`✓ EmulatorJS 4.2.3 + pcsx_rearmed installed into public/cores/emulatorjs`);
  console.log(`  PlayStation core payload: ${(coreSize / 1024 / 1024).toFixed(2)} MiB`);
  console.log('  Licence: GPL-2.0 / GPL-3.0 — see docs/PLAYSTATION.md before deploying.');
}

main().catch((error) => {
  if (OPTIONAL) {
    console.warn(`!  PlayStation core not installed: ${error.message}`);
    console.warn('   Continuing build without it (npm run build -- --optional).');
    return;
  }
  console.error(`\n✗ EmulatorJS setup failed: ${error.message}`);
  process.exitCode = 1;
});
