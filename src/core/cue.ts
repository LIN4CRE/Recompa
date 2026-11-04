/**
 * CUE sheet parsing and disc-set resolution.
 *
 * A `.cue` is not a game image — it is an index that names one or more data
 * files (`FILE "Track 01.bin" BINARY`) plus the track layout inside them.
 * Getting this wrong is the single most common reason a PlayStation import
 * "does nothing": the user drops a `.bin`, the app has no idea a sibling
 * `.cue` exists, and a single track of a multi-track disc looks like a
 * corrupt image.
 *
 * This module is pure data-in/data-out so it can be unit tested without a DOM,
 * a filesystem or an emulator. It never mutates the caller's bytes.
 */

/** One `FILE` stanza with every `TRACK` that belongs to it. */
export interface CueFileBlock {
  /** Name exactly as written in the sheet, quotes removed. */
  name: string;
  /** BINARY, MOTOROLA, WAVE, MP3, AIFF … */
  type: string;
  tracks: CueTrack[];
}

export interface CueTrack {
  /** Track number as written (`01` → 1). */
  number: number;
  /** AUDIO, MODE1/2352, MODE2/2352, CDI/2336 … */
  mode: string;
  /** `INDEX 00..99` positions as `mm:ss:ff` strings. */
  indexes: Array<{ index: number; msf: string }>;
}

export interface CueSheet {
  files: CueFileBlock[];
  /** Problems that make the sheet unusable, with the offending line. */
  errors: CueSheetIssue[];
  /** Recoverable oddities (unknown commands, missing INDEX 01 …). */
  warnings: CueSheetIssue[];
  /** True when at least one FILE block parsed. */
  hasFileBlock: boolean;
}

export interface CueSheetIssue {
  message: string;
  /** 1-based line number in the original text. */
  line: number;
  text: string;
}

const KNOWN_COMMANDS = new Set([
  'FILE',
  'TRACK',
  'INDEX',
  'PREGAP',
  'POSTGAP',
  'FLAGS',
  'REM',
  'CATALOG',
  'PERFORMER',
  'TITLE',
  'SONGWRITER',
  'ISRC',
  'CDTEXTFILE',
]);

/** Bytes at sector level for the modes a PS1 disc may use. */
const SECTOR_SIZE_BY_MODE: Record<string, number> = {
  AUDIO: 2352,
  'MODE1/2048': 2048,
  'MODE1/2352': 2352,
  'MODE2/2048': 2048,
  'MODE2/2324': 2324,
  'MODE2/2336': 2336,
  'MODE2/2352': 2352,
  'CDI/2336': 2336,
  'CDI/2352': 2352,
};

export function sectorSizeForMode(mode: string): number {
  return SECTOR_SIZE_BY_MODE[mode.toUpperCase()] ?? 2352;
}

/**
 * Parse a CUE sheet.
 *
 * Deliberately tolerant in the same places real-world sheets are sloppy
 * (BOM, CRLF, tabs, lower-case keywords, unquoted single-word names) but
 * strict about the things that actually break playback: a `TRACK` outside a
 * `FILE`, a track with no `INDEX 01`, or a `FILE` with no tracks.
 */
export function parseCue(input: string): CueSheet {
  const errors: CueSheetIssue[] = [];
  const warnings: CueSheetIssue[] = [];
  const files: CueFileBlock[] = [];

  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  let currentFile: CueFileBlock | null = null;
  let currentTrack: CueTrack | null = null;

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line) return;

    // COMMENT-style `;` and `//` lines are accepted by every parser in the wild.
    if (line.startsWith(';') || line.startsWith('//')) return;

    const match = /^([A-Za-z]+)\s*(.*)$/.exec(line);
    if (!match) {
      warnings.push({ message: 'Line is not a CUE command', line: lineNo, text: line });
      return;
    }
    const command = match[1]!.toUpperCase();
    const rest = match[2]!.trim();

    if (!KNOWN_COMMANDS.has(command)) {
      warnings.push({ message: `Unknown CUE command "${command}" ignored`, line: lineNo, text: line });
      return;
    }

    if (command === 'FILE') {
      // FILE "name with spaces.bin" BINARY  |  FILE name.bin BINARY
      const quoted = /^"([^"]*)"\s*([A-Za-z0-9/]+)?\s*$/.exec(rest);
      const bare = /^(\S+)\s+([A-Za-z0-9/]+)\s*$/.exec(rest);
      const name = quoted?.[1] ?? bare?.[1];
      const type = (quoted?.[2] ?? bare?.[2] ?? 'BINARY').toUpperCase();
      if (!name) {
        errors.push({ message: 'FILE command has no file name', line: lineNo, text: line });
        return;
      }
      if (currentFile && currentFile.tracks.length === 0) {
        warnings.push({
          message: `FILE "${currentFile.name}" has no tracks`,
          line: lineNo,
          text: currentFile.name,
        });
      }
      currentFile = { name: normaliseCuePath(name), type, tracks: [] };
      currentTrack = null;
      files.push(currentFile);
      return;
    }

    if (command === 'TRACK') {
      const m = /^(\d{1,2})\s+(\S+)/.exec(rest);
      if (!currentFile) {
        errors.push({ message: 'TRACK appears before any FILE command', line: lineNo, text: line });
        return;
      }
      if (!m) {
        errors.push({ message: 'TRACK needs a number and a mode', line: lineNo, text: line });
        return;
      }
      currentTrack = { number: Number(m[1]), mode: m[2]!.toUpperCase(), indexes: [] };
      currentFile.tracks.push(currentTrack);
      return;
    }

    if (command === 'INDEX') {
      const m = /^(\d{1,2})\s+(\d{1,3}:\d{2}:\d{2})/.exec(rest);
      if (!currentTrack) {
        errors.push({ message: 'INDEX appears before any TRACK command', line: lineNo, text: line });
        return;
      }
      if (!m) {
        errors.push({ message: 'INDEX needs an index number and an mm:ss:ff position', line: lineNo, text: line });
        return;
      }
      currentTrack.indexes.push({ index: Number(m[1]), msf: m[2]! });
      return;
    }

    // PREGAP/POSTGAP/FLAGS/TITLE/… are informational for our purposes.
    if (command === 'TRACK' || command === 'FILE') return;
  });

  for (const file of files) {
    if (file.tracks.length === 0) {
      errors.push({ message: `FILE "${file.name}" has no TRACK`, line: 0, text: file.name });
    }
    for (const track of file.tracks) {
      if (!track.indexes.some((i) => i.index === 1)) {
        errors.push({
          message: `Track ${String(track.number).padStart(2, '0')} in "${file.name}" has no INDEX 01`,
          line: 0,
          text: file.name,
        });
      }
    }
  }

  return { files, errors, warnings, hasFileBlock: files.length > 0 };
}

/**
 * Normalise a path written inside a CUE sheet.
 *
 * Sheets are authored on Windows as often as not, so backslashes are turned
 * into forward slashes and the directory part is dropped: browsers give us a
 * flat `File` list from a picker, and folder drops carry a relative path we
 * compare against separately. Case is preserved — matching is done
 * case-insensitively by the caller.
 */
export function normaliseCuePath(name: string): string {
  const slashed = name.replace(/\\/g, '/').trim();
  const withoutDir = slashed.split('/').pop() ?? slashed;
  return withoutDir.replace(/^["']|["']$/g, '').trim();
}

/** `mm:ss:ff` → absolute sector number (75 frames per second). */
export function msfToSectors(msf: string): number {
  const [m, s, f] = msf.split(':').map((n) => Number(n) || 0);
  return (m ?? 0) * 60 * 75 + (s ?? 0) * 75 + (f ?? 0);
}

/**
 * Total sector count the sheet expects, summed over every track's extent.
 *
 * Used to sanity-check that the referenced `.bin` is the right size: a
 * truncated or mismatched track file is a real failure mode (partial
 * downloads, single-track rips) and produces an unhelpful emulator hang
 * rather than a clear error.
 */
export function expectedSectors(sheet: CueSheet): number {
  let total = 0;
  for (const file of sheet.files) {
    for (const track of file.tracks) {
      const start = track.indexes.find((i) => i.index === 1);
      if (start) total += msfToSectors(start.msf);
    }
  }
  return total;
}

/** True when the sheet describes more than one data track (a real multi-track disc). */
export function isMultiTrack(sheet: CueSheet): boolean {
  return sheet.files.length > 1 || sheet.files.some((f) => f.tracks.length > 1);
}

/** Every file name a sheet needs, de-duplicated, in declaration order. */
export function referencedFiles(sheet: CueSheet): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of sheet.files) {
    const key = f.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f.name);
  }
  return out;
}
