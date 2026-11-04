/**
 * Folder scanning and rescanning.
 *
 * Users point at a folder once; Recompa walks it recursively, groups the files
 * into launchable games, and can re-walk the same folder later to pick up new
 * or changed files without asking them to find it again.
 *
 * Two intake mechanisms exist because browser support differs:
 *
 *   • File System Access API (`showDirectoryPicker`) — gives a persistent
 *     `FileSystemDirectoryHandle` that survives page loads once stored in
 *     IndexedDB. This is what makes *rescan* possible. Chromium only.
 *   • `<input webkitdirectory>` / directory drop — works everywhere, but the
 *     handle is not retained, so "rescan" means picking the folder again.
 *
 * Recompa reports which mode is active rather than showing a Rescan button
 * that silently does nothing.
 */

import { resolveDiscSets, type DroppedFile, type DiscSet } from './discset';

/** Extensions worth reading as text during a scan. */
const SHEET_EXTS = new Set(['cue', 'm3u', 'ccd', 'toc']);

/** Files that are never a game on their own. */
const NOISE_NAMES = new Set([
  'readme.txt',
  'readme.md',
  'license.txt',
  'licence.txt',
  'thumbs.db',
  'desktop.ini',
  '.ds_store',
]);

const NOISE_EXTS = new Set(['txt', 'md', 'nfo', 'sfv', 'log', 'jpg', 'jpeg', 'png', 'webp', 'pdf']);

export function isFolderPickerSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** Extension of a file name, lower-case, without the dot. */
function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
}

/**
 * Should this file be considered part of a game at all?
 *
 * Filters obvious clutter (artwork, readmes, checksums) so a ROM folder with a
 * covers subdirectory does not produce a hundred junk entries. BIOS-sized
 * files are *not* filtered by name here — companion resolution decides what is
 * a track and what is not.
 */
export function isCandidateFile(name: string): boolean {
  const lower = name.toLowerCase();
  const base = lower.split('/').pop() ?? lower;
  if (NOISE_NAMES.has(base)) return false;
  const ext = extOf(base);
  if (!ext) return false;
  if (NOISE_EXTS.has(ext)) return false;
  // macOS resource forks and Windows alternate data streams.
  if (base.startsWith('._')) return false;
  return true;
}

export interface ScanFile {
  /** Name only, no directory. */
  name: string;
  /** Path relative to the scanned root, forward slashes. */
  relativePath: string;
  size: number;
  lastModified: number;
  file: File;
}

export interface ScannedGame {
  /** Folder the entry lives in, relative to the scan root ('' for the root). */
  folder: string;
  /** The disc set as resolved by discset.ts. */
  set: DiscSet;
  /** Every file belonging to this game. */
  files: ScanFile[];
  /** Identity used for rescan diffing: relative paths of the files. */
  key: string;
}

export interface ScanResult {
  root: string;
  files: ScanFile[];
  games: ScannedGame[];
  /** Files skipped as clutter, for transparency. */
  ignored: string[];
  /** Files whose set could not be completed. */
  incomplete: number;
}

/** Walk a `FileSystemDirectoryHandle` recursively. */
async function walkHandle(
  handle: FileSystemDirectoryHandle,
  prefix = '',
  out: ScanFile[] = [],
  depth = 0,
): Promise<ScanFile[]> {
  if (depth > 12) return out; // guard against pathological nesting
  for await (const [name, child] of (handle as unknown as {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }).entries()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (child.kind === 'file') {
      const file = await (child as FileSystemFileHandle).getFile();
      out.push({ name, relativePath: rel, size: file.size, lastModified: file.lastModified, file });
    } else if (child.kind === 'directory') {
      await walkHandle(child as FileSystemDirectoryHandle, rel, out, depth + 1);
    }
  }
  return out;
}

/** Walk a `DataTransferItemList` from a drop (directory-drop capable). */
async function walkEntry(entry: FileSystemEntry, prefix = '', out: ScanFile[] = [], depth = 0): Promise<ScanFile[]> {
  if (depth > 12) return out;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    const rel = prefix ? `${prefix}/${file.name}` : file.name;
    out.push({ name: file.name, relativePath: rel, size: file.size, lastModified: file.lastModified, file });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    // readEntries returns at most 100 at a time; loop until empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      for (const child of batch) await walkEntry(child, rel, out, depth + 1);
    }
  }
  return out;
}

/** Collect files from a dropped DataTransfer, honouring nested directories. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<ScanFile[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => Boolean(e));

  if (entries.length === 0) {
    // Fallback: browsers without webkitGetAsEntry give a flat file list.
    return Array.from(dt.files ?? []).map((file) => ({
      name: file.name,
      relativePath: file.name,
      size: file.size,
      lastModified: file.lastModified,
      file,
    }));
  }

  const all: ScanFile[] = [];
  for (const entry of entries) await walkEntry(entry, '', all);
  return all;
}

/** Collect files from an `<input webkitdirectory>` FileList. */
export function filesFromFileList(files: FileList | File[]): ScanFile[] {
  return Array.from(files).map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    return {
      name: file.name,
      relativePath: rel.replace(/\\/g, '/'),
      size: file.size,
      lastModified: file.lastModified,
      file,
    };
  });
}

/** Walk a retained directory handle. */
export async function filesFromHandle(handle: FileSystemDirectoryHandle): Promise<ScanFile[]> {
  return walkHandle(handle);
}

/**
 * Group scanned files into games.
 *
 * Grouping is per folder: a `.cue` and its tracks live together, and two games
 * in different subfolders must not be merged even if their file names collide.
 * Within a folder the existing disc-set resolver does the real work.
 */
export async function groupScannedFiles(files: ScanFile[], root = ''): Promise<ScanResult> {
  const ignored: string[] = [];
  const byFolder = new Map<string, ScanFile[]>();

  for (const file of files) {
    if (!isCandidateFile(file.name)) {
      ignored.push(file.relativePath);
      continue;
    }
    const folder = file.relativePath.includes('/')
      ? file.relativePath.slice(0, file.relativePath.lastIndexOf('/'))
      : '';
    const list = byFolder.get(folder) ?? [];
    list.push(file);
    byFolder.set(folder, list);
  }

  const games: ScannedGame[] = [];
  let incomplete = 0;

  for (const [folder, folderFiles] of byFolder) {
    // Read sheet text (small files only) so the resolver can follow references.
    const described: DroppedFile[] = [];
    for (const f of folderFiles) {
      const ext = extOf(f.name);
      const textContent = SHEET_EXTS.has(ext) && f.size <= 256 * 1024
        ? await f.file.slice(0, 256 * 1024).text()
        : undefined;
      described.push({ name: f.name, size: f.size, ext, relativePath: f.relativePath, textContent });
    }

    const sets = resolveDiscSets(described);
    for (const set of sets) {
      if (set.status === 'not-a-disc-set' && set.members.length === 1) {
        // Still surface it: the detector may identify a cartridge or a lone
        // image. The import step decides; we do not silently drop files.
      }
      if (set.status === 'missing-companion' || set.status === 'invalid-sheet') incomplete += 1;

      const memberNames = new Set(set.members.map((m) => m.name.toLowerCase()));
      const setFiles = folderFiles.filter((f) => memberNames.has(f.name.toLowerCase()));
      games.push({
        folder,
        set,
        files: setFiles.length ? setFiles : folderFiles,
        key: set.members.map((m) => (folder ? `${folder}/${m.name}` : m.name)).sort().join('|'),
      });
    }
  }

  return { root, files, games, ignored, incomplete };
}

/** Persisted record of a folder the user granted access to. */
export interface WatchedFolder {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  addedAt: number;
  lastScannedAt: number | null;
  /** Relative paths already imported, used to skip unchanged files on rescan. */
  knownPaths: string[];
}

/** A game found on rescan that was not present last time. */
export interface RescanDiff {
  newGames: ScannedGame[];
  unchanged: number;
  removed: number;
  errors: string[];
}

/**
 * Compare a fresh scan against what was previously imported.
 *
 * Cheap path-level comparison avoids re-reading and re-hashing hundreds of
 * megabytes of unchanged disc images on every rescan.
 */
export function diffScan(previousPaths: string[], current: ScannedGame[]): RescanDiff {
  const known = new Set(previousPaths.map((p) => p.toLowerCase()));
  const newGames: ScannedGame[] = [];
  let unchanged = 0;

  for (const game of current) {
    // A game counts as new when *any* of its files is one we have not imported
    // before: a disc that gained a second track must be re-imported whole,
    // because the previously stored payload is now the wrong image.
    const paths = game.files.map((f) => f.relativePath.toLowerCase());
    const unseen = paths.length === 0 || paths.some((p) => !known.has(p));
    if (unseen) newGames.push(game);
    else unchanged += 1;
  }

  // Files that were imported before and are no longer on disk. Reported, never
  // auto-deleted: removing a user's library entry is their call, not ours.
  const currentPaths = new Set(
    current.flatMap((g) => g.files.map((f) => f.relativePath.toLowerCase())),
  );
  const removed = previousPaths.filter((p) => !currentPaths.has(p.toLowerCase())).length;
  return { newGames, unchanged, removed, errors: [] };
}
