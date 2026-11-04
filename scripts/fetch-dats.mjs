#!/usr/bin/env node
/**
 * Builds Recompa's offline ROM fingerprint catalogue.
 *
 * Source: libretro/libretro-database — a mirror of the No-Intro DAT sets
 * (CC-BY-SA-4.0). The DATs contain ONLY titles, sizes and hashes: no game
 * data, no cover art, no executable content. They let Recompa answer
 * "which game is this SHA-1?" completely offline, which is exactly the kind of
 * metadata identification this project needs.
 *
 * Why GitHub blob API instead of raw.githubusercontent.com:
 *   1. it works behind egress policies that only allow api.github.com;
 *   2. optionally uses GITHUB_TOKEN for higher rate limits;
 *   3. the tree call gives us the blob SHA so we never re-download unchanged DATs.
 *
 * Usage:
 *   node scripts/fetch-dats.mjs                # fetch every configured platform
 *   node scripts/fetch-dats.mjs nes gba        # fetch a subset
 *   GITHUB_TOKEN=... node scripts/fetch-dats.mjs
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const REPO = 'libretro/libretro-database';
const BRANCH = 'master';
const OUT_DIR = path.resolve('public/data/catalogue');
const CACHE_DIR = path.resolve('node_modules/.cache/recompa-dats');

/** platform id -> No-Intro DAT path inside libretro-database. */
const PLATFORM_DATS = {
  nes: 'metadat/no-intro/Nintendo - Nintendo Entertainment System.dat',
  snes: 'metadat/no-intro/Nintendo - Super Nintendo Entertainment System.dat',
  gb: 'metadat/no-intro/Nintendo - Game Boy.dat',
  gbc: 'metadat/no-intro/Nintendo - Game Boy Color.dat',
  gba: 'metadat/no-intro/Nintendo - Game Boy Advance.dat',
  n64: 'metadat/no-intro/Nintendo - Nintendo 64.dat',
  genesis: 'metadat/no-intro/Sega - Mega Drive - Genesis.dat',
  sms: 'metadat/no-intro/Sega - Master System - Mark III.dat',
  gg: 'metadat/no-intro/Sega - Game Gear.dat',
};

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const headers = {
  'user-agent': 'recompa-catalogue-builder/1.0',
  accept: 'application/vnd.github+json',
  ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
};

async function api(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status} for ${url}\n${body.slice(0, 300)}`);
  }
  return res.json();
}

/* ------------------------------------------------------------------ */
/* ClrMamePro DAT parsing (tolerant: quoted strings, nested blocks)     */
/* ------------------------------------------------------------------ */

function parseDat(text) {
  const games = [];
  const header = {};
  let i = 0;
  const len = text.length;

  const skipWs = () => {
    while (i < len && /\s/.test(text[i])) i++;
  };
  const readString = () => {
    if (text[i] === '"') {
      i++;
      let s = '';
      while (i < len && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < len) {
          i++;
        }
        s += text[i++];
      }
      i++;
      return s;
    }
    let s = '';
    while (i < len && !/[\s()]/.test(text[i])) s += text[i++];
    return s;
  };

  while (i < len) {
    skipWs();
    if (i >= len) break;
    const key = readString();
    skipWs();
    if (text[i] !== '(') {
      i++;
      continue;
    }
    i++; // consume '('
    const fields = {};
    while (i < len) {
      skipWs();
      if (text[i] === ')') {
        i++;
        break;
      }
      if (i >= len) break;
      const k = readString();
      skipWs();
      if (text[i] === '(') {
        i++;
        const sub = {};
        while (i < len) {
          skipWs();
          if (text[i] === ')') {
            i++;
            break;
          }
          const sk = readString();
          skipWs();
          const sv = readString();
          sub[sk] = sv;
        }
        if (k === 'rom') {
          if (!fields.roms) fields.roms = [];
          fields.roms.push(sub);
        }
      } else {
        fields[k] = readString();
      }
    }
    if (key === 'game' || key === 'machine') games.push(fields);
    else Object.assign(header, fields);
  }
  return { header, games };
}

/* ------------------------------------------------------------------ */
/* Name parsing                                                        */
/* ------------------------------------------------------------------ */

const REGION_TAGS = [
  ['USA', 'US'],
  ['Europe', 'EU'],
  ['Japan', 'JP'],
  ['World', 'WORLD'],
  ['Australia', 'AU'],
  ['Korea', 'KR'],
  ['China', 'CN'],
  ['Brazil', 'BR'],
  ['Canada', 'US'],
  ['Spain', 'EU'],
  ['Germany', 'EU'],
  ['France', 'EU'],
  ['Italy', 'EU'],
  ['Netherlands', 'EU'],
  ['Sweden', 'EU'],
  ['Asia', 'WORLD'],
];

function parseTitle(fullName) {
  let name = fullName.trim();
  const tags = [];
  // Trailing parenthesised tags come after the title proper.
  const m = name.match(/^(.*?)((?:\s\([^)]*\))+)$/);
  if (m) {
    name = m[1].trim();
    tags.push(...(m[2].match(/\(([^)]*)\)/g) || []).map((t) => t.slice(1, -1)));
  }
  let region = 'UNKNOWN';
  for (const [tag, code] of REGION_TAGS) {
    if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      region = code;
      break;
    }
  }
  let version = '1.0';
  const rev = tags.find((t) => /^Rev\s/i.test(t));
  const ver = tags.find((t) => /^v\d/i.test(t));
  if (ver) version = ver;
  else if (rev) version = rev.replace(/^Rev\s*/i, 'rev ');
  const isProto = tags.some((t) => /^Proto/i.test(t));
  const isBeta = tags.some((t) => /^Beta/i.test(t));
  const isAftermarket = tags.some((t) => /Aftermarket|Unl/i.test(t));
  const isPirate = tags.some((t) => /Pirate/i.test(t));
  return {
    title: name,
    region,
    version: isProto ? `${version} prototype` : isBeta ? `${version} beta` : version,
    tags,
    kind: isAftermarket || isPirate ? 'homebrew' : 'commercial',
  };
}

/* ------------------------------------------------------------------ */
/* Build compact per-platform fingerprint tables                       */
/* ------------------------------------------------------------------ */

function buildPlatform(platformId, datText, sourceMeta, rawSize) {
  const { header, games } = parseDat(datText);
  const rows = new Map(); // key = `${size}:${crc}` -> row
  for (const game of games) {
    const meta = parseTitle(game.name || '');
    for (const rom of game.roms || []) {
      const size = Number(rom.size);
      const crc = (rom.crc || '').toUpperCase();
      if (!Number.isFinite(size) || !/^[0-9A-F]{8}$/.test(crc)) continue;
      const sha1 = (rom.sha1 || '').toUpperCase();
      const key = `${size}:${crc}`;
      if (rows.has(key)) continue; // first entry wins (keep catalogue order)
      rows.set(key, {
        c: crc,
        s: size,
        h: /^[0-9A-F]{40}$/.test(sha1) ? sha1 : undefined,
        t: meta.title,
        r: meta.region,
        v: meta.version,
        k: meta.kind === 'homebrew' ? 'h' : 'c',
      });
    }
  }
  return {
    schemaVersion: 1,
    platform: platformId,
    generatedAt: new Date().toISOString(),
    source: sourceMeta,
    datVersion: header.version || null,
    datName: header.name || platformId,
    datSize: rawSize,
    count: rows.size,
    // Array form keeps the payload small; decoded into a Map on the client.
    entries: [...rows.values()],
  };
}

async function fetchBlob(sha) {
  const cacheFile = path.join(CACHE_DIR, sha);
  try {
    const cached = await readFile(cacheFile);
    if (cached.length > 0) return cached.toString('utf8');
  } catch {
    /* cache miss */
  }
  const blob = await api(`https://api.github.com/repos/${REPO}/git/blobs/${sha}`);
  if (blob.encoding !== 'base64') throw new Error(`Unexpected blob encoding ${blob.encoding}`);
  const text = Buffer.from(blob.content, 'base64').toString('utf8');
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cacheFile, text);
  return text;
}

/**
 * Strip the volatile build timestamp so two catalogue documents can be compared
 * for *content* equality. Regenerating always rewrites `generatedAt`, so a plain
 * `git diff` can never distinguish "stale data" from "fetched one second later".
 */
function withoutTimestamp(doc) {
  const { generatedAt: _ignored, ...rest } = doc;
  return JSON.stringify(rest);
}

async function main() {
  // `--check` verifies that the committed catalogue still matches upstream
  // without touching the working tree. Used by CI, so a stale snapshot fails
  // loudly instead of being silently committed over.
  const check = process.argv.includes('--check');
  const stale = [];
  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const targets = requested.length ? requested : Object.keys(PLATFORM_DATS);
  for (const t of targets) {
    if (!PLATFORM_DATS[t]) {
      throw new Error(`Unknown platform "${t}". Known: ${Object.keys(PLATFORM_DATS).join(', ')}`);
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Resolving ${REPO}@${BRANCH} tree…`);
  const tree = await api(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
  if (tree.truncated) console.warn('warning: git tree response was truncated by the API');
  const blobs = new Map(tree.tree.filter((n) => n.type === 'blob').map((n) => [n.path, n]));

  const indexEntries = [];
  for (const platform of targets) {
    const datPath = PLATFORM_DATS[platform];
    const node = blobs.get(datPath);
    if (!node) {
      console.error(`✗ ${platform}: ${datPath} not found in repository tree`);
      continue;
    }
    process.stdout.write(`• ${platform.padEnd(8)} fetching ${(node.size / 1024).toFixed(0)} KiB … `);
    const text = await fetchBlob(node.sha);
    const built = buildPlatform(
      platform,
      text,
      {
        repository: REPO,
        path: datPath,
        commitBlob: node.sha,
        dataset: 'No-Intro (via libretro-database)',
        licence: 'CC-BY-SA-4.0',
        licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        attribution: 'No-Intro DAT data, mirrored by the libretro-database project.',
      },
      node.size,
    );
    const outFile = path.join(OUT_DIR, `${platform}.json`);

    if (check) {
      const committed = await readFile(outFile, 'utf8')
        .then((t) => JSON.parse(t))
        .catch(() => null);
      const upToDate = committed && withoutTimestamp(committed) === withoutTimestamp(built);
      console.log(
        `${upToDate ? '✓' : '✗'} ${platform.padEnd(8)} ${built.count.toLocaleString()} fingerprints ${
          upToDate ? 'match the committed snapshot' : 'DIFFER from the committed snapshot — run npm run fetch:dat'
        }`,
      );
      if (!upToDate) stale.push(platform);
      indexEntries.push({
        platform,
        file: `${platform}.json`,
        count: built.count,
        bytes: committed ? JSON.stringify(committed).length : 0,
        datVersion: built.datVersion,
        datBlob: node.sha,
        licence: 'CC-BY-SA-4.0',
      });
      continue;
    }

    await writeFile(outFile, JSON.stringify(built));
    const written = (await stat(outFile)).size;
    console.log(`✓ ${built.count.toLocaleString()} fingerprints → ${path.relative(process.cwd(), outFile)} (${(written / 1024 / 1024).toFixed(2)} MiB)`);
    indexEntries.push({
      platform,
      file: `${platform}.json`,
      count: built.count,
      bytes: written,
      datVersion: built.datVersion,
      datBlob: node.sha,
      licence: 'CC-BY-SA-4.0',
    });
  }

  if (indexEntries.length === 0) {
    throw new Error('No DAT files were written.');
  }

  if (check) {
    const total = indexEntries.reduce((n, e) => n + e.count, 0);
    if (stale.length) {
      throw new Error(
        `stale catalogue snapshot for ${stale.join(', ')} — run "npm run fetch:dat" and commit the result`,
      );
    }
    console.log(`\n✓ catalogue snapshot is current: ${indexEntries.length} platforms, ${total.toLocaleString()} fingerprints.`);
    return;
  }

  const existing = await readFile(path.join(OUT_DIR, 'index.json'), 'utf8')
    .then((t) => JSON.parse(t))
    .catch(() => ({ entries: [] }));
  const merged = new Map(existing.entries.map((e) => [e.platform, e]));
  for (const e of indexEntries) merged.set(e.platform, e);

  const index = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      repository: REPO,
      branch: BRANCH,
      dataset: 'No-Intro (via libretro-database)',
      licence: 'CC-BY-SA-4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      note:
        'Fingerprint metadata only (title/size/CRC/SHA-1). No game data is distributed. Titles are the property of their respective trademark holders.',
    },
    entries: [...merged.values()].sort((a, b) => a.platform.localeCompare(b.platform)),
  };
  await writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));
  const total = index.entries.reduce((n, e) => n + e.count, 0);
  console.log(`\nCatalogue index written: ${index.entries.length} platforms, ${total.toLocaleString()} fingerprints.`);
}

main().catch((err) => {
  console.error(`\n✗ Catalogue build failed: ${err.message}`);
  process.exitCode = 1;
});
