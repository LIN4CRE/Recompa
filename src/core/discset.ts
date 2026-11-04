/**
 * Disc-set resolution: links the files a user actually dropped into complete,
 * launchable games.
 *
 * The rules, in order of reliability:
 *
 *  1. A `.cue` names its `.bin` siblings — trust the sheet, not the filename.
 *  2. A `.m3u` names `.cue` sheets (multi-disc / multi-track playlists).
 *  3. A `.ccd` implies a matching `.img` and usually a `.sub`.
 *  4. A bare `.bin` with no sheet gets a *basename* match against a sibling
 *     `.cue`, because rips are overwhelmingly named
 *     `Game (Track 1).bin` + `Game (Track 1).cue`.
 *  5. Failing all that, a lone `.bin` is treated as a single-track disc
 *     candidate and flagged as such — sometimes that is genuinely all there is.
 *
 * Pure module: no DOM, no I/O. `File`-shaped inputs are described by the
 * `DroppedFile` interface so this is unit-testable in Node.
 */

import { isMultiTrack, normaliseCuePath, parseCue, referencedFiles, type CueSheet } from './cue';

export interface DroppedFile {
  /** File name only — no directory. */
  name: string;
  size: number;
  /** Lower-case extension without the dot, or '' when there is none. */
  ext: string;
  /** Relative path when a folder was dropped (Chromium `webkitRelativePath`). */
  relativePath?: string;
  /**
   * Text content, for sheets only. Callers read the first kilobytes of a
   * `.cue`/`.m3u`; the resolver never asks for binary payloads.
   */
  textContent?: string;
}

export type DiscSetStatus =
  | 'ready'
  | 'missing-companion'
  | 'invalid-sheet'
  | 'ambiguous'
  | 'not-a-disc-set';

export interface DiscSetMember {
  name: string;
  role: 'sheet' | 'data-track' | 'subchannel' | 'playlist' | 'unknown';
  /** Bytes, when known. */
  size: number | null;
  /** Present for sheets we managed to parse. */
  sheet?: CueSheet;
}

export interface DiscSet {
  /** Stable key: the launch entry point's lower-cased name. */
  id: string;
  /** The file a user would click PLAY on. */
  entry: string;
  status: DiscSetStatus;
  /** Every file the set is made of, entry first. */
  members: DiscSetMember[];
  /** Human-readable explanation shown when status !== 'ready'. */
  problems: string[];
  /** Non-blocking notes worth surfacing (warnings from the sheet, guessed links). */
  notes: string[];
  /** Tracks per the parsed sheet, when there is one. */
  trackCount: number;
  multiTrack: boolean;
  /** True when we inferred the link rather than reading it from a sheet. */
  inferred: boolean;
}

const SHEET_EXT = new Set(['cue', 'm3u', 'ccd', 'toc']);
const TRACK_EXT = new Set(['bin', 'img', 'iso', 'chd', 'pbp', 'mdf', 'cbn']);
const SUB_EXT = new Set(['sub']);

/** Strip a trailing extension: `Game (Track 1).bin` → `Game (Track 1)`. */
export function stemOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i <= 0 ? name : name.slice(0, i);
}

/** Case-insensitive name lookup that ignores any dropped directory prefix. */
function byName(files: DroppedFile[]): Map<string, DroppedFile> {
  const map = new Map<string, DroppedFile>();
  for (const f of files) {
    map.set(f.name.toLowerCase(), f);
    if (f.relativePath) {
      const base = f.relativePath.replace(/\\/g, '/').split('/').pop();
      if (base) map.set(base.toLowerCase(), f);
    }
  }
  return map;
}

/** Replace a path/lookup failure with a helpful, specific sentence. */
function missingMessage(sheetName: string, wanted: string, present: string[]): string {
  const hint =
    present.length > 0
      ? `The drop contained: ${present.join(', ')}.`
      : 'No other files were selected at the same time.';
  return (
    `"${sheetName}" references "${wanted}", which was not included. ` +
    `Add "${wanted}" to the same selection (or drop the whole game folder) and try again. ${hint}`
  );
}

/**
 * Resolve a set of dropped files into disc sets.
 *
 * Files that are already standalone (a cartridge image, a single `.chd`) are
 * returned as their own single-member "set" so callers have one uniform type.
 */
export function resolveDiscSets(files: DroppedFile[]): DiscSet[] {
  const lookup = byName(files);
  const claimed = new Set<string>();
  const sets: DiscSet[] = [];

  const claim = (f: DroppedFile) => claimed.add(nameKey(f));
  const nameKey = (f: DroppedFile) => f.name.toLowerCase();

  /* ---------------------------------------------------------------- */
  /* 1. Playlists (.m3u) — highest precedence, they point at sheets.   */
  /* ---------------------------------------------------------------- */
  for (const file of files) {
    if (file.ext !== 'm3u') continue;
    const text = file.textContent ?? '';
    const targets = text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map(normaliseCuePath);

    const members: DiscSetMember[] = [{ name: file.name, role: 'playlist', size: file.size }];
    const problems: string[] = [];
    let totalTracks = 0;
    let multiTrack = false;

    for (const target of targets) {
      const child = lookup.get(target.toLowerCase());
      if (!child) {
        problems.push(missingMessage(file.name, target, files.map((f) => f.name)));
        continue;
      }
      claim(child);
      const childSheet = child.textContent ? parseCue(child.textContent) : undefined;
      if (childSheet) {
        totalTracks += childSheet.files.reduce((n, b) => n + b.tracks.length, 0);
        multiTrack ||= isMultiTrack(childSheet);
      }
      members.push({
        name: child.name,
        role: 'sheet',
        size: child.size,
        sheet: childSheet,
      });
      // Pull in the data files the child sheet names.
      for (const wanted of childSheet ? referencedFiles(childSheet) : []) {
        const track = lookup.get(wanted.toLowerCase());
        if (!track) {
          problems.push(missingMessage(child.name, wanted, files.map((f) => f.name)));
          continue;
        }
        if (claimed.has(nameKey(track))) continue;
        claim(track);
        members.push({
          name: track.name,
          role: 'data-track',
          size: track.size,
        });
      }
    }

    claim(file);
    sets.push({
      id: file.name.toLowerCase(),
      entry: file.name,
      status: problems.length ? 'missing-companion' : 'ready',
      members,
      problems,
      notes: targets.length === 0 ? ['The playlist lists no files.'] : [],
      trackCount: totalTracks,
      multiTrack,
      inferred: false,
    });
  }

  /* ---------------------------------------------------------------- */
  /* 2. CUE sheets — the normal PlayStation case.                      */
  /* ---------------------------------------------------------------- */
  for (const file of files) {
    if (file.ext !== 'cue' || claimed.has(nameKey(file))) continue;
    const text = file.textContent ?? '';
    const sheet = parseCue(text);
    const members: DiscSetMember[] = [{ name: file.name, role: 'sheet', size: file.size, sheet }];
    const problems: string[] = [];
    const notes: string[] = sheet.warnings.map((w) => `Line ${w.line}: ${w.message}`);

    if (!sheet.hasFileBlock) {
      problems.push(
        `"${file.name}" is not a usable cue sheet: it contains no FILE command. ` +
          'A CUE must name at least one BINARY track, e.g. FILE "Game.bin" BINARY.',
      );
    }
    for (const issue of sheet.errors) {
      const where = issue.line ? `line ${issue.line}: ` : '';
      problems.push(`${where}${issue.message}`);
    }

    let totalTracks = 0;
    for (const wanted of referencedFiles(sheet)) {
      totalTracks += sheet.files.find((f) => f.name === wanted)?.tracks.length ?? 0;
      const track = lookup.get(wanted.toLowerCase());
      if (!track) {
        problems.push(missingMessage(file.name, wanted, files.map((f) => f.name)));
        continue;
      }
      claim(track);
      members.push({ name: track.name, role: 'data-track', size: track.size });
      // A matching .sub is optional but worth attaching for completeness.
      const sub = lookup.get(`${stemOf(track.name)}.sub`.toLowerCase());
      if (sub && !claimed.has(nameKey(sub))) {
        claim(sub);
        members.push({ name: sub.name, role: 'subchannel', size: sub.size });
      }
    }

    claim(file);
    // "Invalid" means the sheet itself is unusable; "missing companion" means
    // the sheet is fine but the files it names were not supplied. Those are
    // very different remedies, so they get different statuses.
    const sheetBroken = !sheet.hasFileBlock || sheet.errors.length > 0;
    const status: DiscSetStatus = sheetBroken
      ? 'invalid-sheet'
      : problems.length
        ? 'missing-companion'
        : 'ready';

    sets.push({
      id: file.name.toLowerCase(),
      entry: file.name,
      status,
      members,
      problems,
      notes,
      trackCount: totalTracks,
      multiTrack: isMultiTrack(sheet),
      inferred: false,
    });
  }

  /* ---------------------------------------------------------------- */
  /* 3. CCD (+ IMG + SUB).                                             */
  /* ---------------------------------------------------------------- */
  for (const file of files) {
    if (file.ext !== 'ccd' || claimed.has(nameKey(file))) continue;
    const members: DiscSetMember[] = [{ name: file.name, role: 'sheet', size: file.size }];
    const problems: string[] = [];
    const base = stemOf(file.name).toLowerCase();
    for (const ext of ['img', 'sub'] as const) {
      const companion = lookup.get(`${base}.${ext}`);
      if (companion) {
        claim(companion);
        members.push({
          name: companion.name,
          role: ext === 'sub' ? 'subchannel' : 'data-track',
          size: companion.size,
        });
      } else if (ext === 'img') {
        problems.push(missingMessage(file.name, `${stemOf(file.name)}.img`, files.map((f) => f.name)));
      }
    }
    claim(file);
    sets.push({
      id: file.name.toLowerCase(),
      entry: file.name,
      status: problems.length ? 'missing-companion' : 'ready',
      members,
      problems,
      notes: [],
      trackCount: 1,
      multiTrack: false,
      inferred: true,
    });
  }

  /* ---------------------------------------------------------------- */
  /* 4. Bare .bin — is there a sibling sheet that owns it?             */
  /* ---------------------------------------------------------------- */
  const unclaimedSheets = files.filter((f) => f.ext === 'cue' && !claimed.has(nameKey(f)));
  for (const sheetFile of unclaimedSheets) {
    const sheet = sheetFile.textContent ? parseCue(sheetFile.textContent) : null;
    if (!sheet) continue;
    for (const wanted of referencedFiles(sheet)) {
      const track = lookup.get(wanted.toLowerCase());
      if (track) claim(track);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 5. Everything still unclaimed stands on its own.                  */
  /* ---------------------------------------------------------------- */
  for (const file of files) {
    if (claimed.has(nameKey(file))) continue;
    if (SHEET_EXT.has(file.ext)) {
      // A sheet we could not pair up at all.
      sets.push({
        id: file.name.toLowerCase(),
        entry: file.name,
        status: 'invalid-sheet',
        members: [{ name: file.name, role: 'sheet', size: file.size }],
        problems: [
          `"${file.name}" could not be resolved to any data file. ` +
            'Select the sheet together with the track files it names.',
        ],
        notes: [],
        trackCount: 0,
        multiTrack: false,
        inferred: false,
      });
      claim(file);
      continue;
    }
    if (TRACK_EXT.has(file.ext)) {
      // A lone track: fine as a single-track disc, but say so plainly.
      const isBin = file.ext === 'bin' || file.ext === 'img';
      sets.push({
        id: file.name.toLowerCase(),
        entry: file.name,
        status: 'ready',
        members: [{ name: file.name, role: 'data-track', size: file.size }],
        problems: [],
        notes: isBin
          ? [
              'No cue sheet was included, so this is treated as a single-track disc. ' +
                'If the game has more than one track (CD audio, FMV), add the .cue and its other tracks.',
            ]
          : [],
        trackCount: 1,
        multiTrack: false,
        inferred: true,
      });
      claim(file);
      continue;
    }
    if (SUB_EXT.has(file.ext)) {
      // Orphan .sub with no home; harmless, but do not create a game from it.
      claim(file);
      continue;
    }
    sets.push({
      id: file.name.toLowerCase(),
      entry: file.name,
      status: 'not-a-disc-set',
      members: [{ name: file.name, role: 'unknown', size: file.size }],
      problems: [],
      notes: [],
      trackCount: 0,
      multiTrack: false,
      inferred: false,
    });
  }

  return sets;
}

/**
 * Convenience for the UI: the set a given file belongs to, if any.
 * Returns null when the file was not part of the input.
 */
export function discSetFor(sets: DiscSet[], fileName: string): DiscSet | null {
  const key = fileName.toLowerCase();
  return (
    sets.find((s) => s.id === key) ??
    sets.find((s) => s.members.some((m) => m.name.toLowerCase() === key)) ??
    null
  );
}
