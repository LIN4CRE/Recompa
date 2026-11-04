/**
 * Packaging a disc set for EmulatorJS.
 *
 * EmulatorJS takes exactly **one** game file (or one URL). A PlayStation disc
 * is frequently several files — a `.cue` plus one `.bin` per track — and
 * pcsx_rearmed is explicitly excluded from EmulatorJS's cue auto-generation
 * (it appears in the `disableCue` list in emulator.js), so a set cannot be
 * smuggled in as a lone `.bin` and left for the runtime to figure out.
 *
 * The well-trodden path is therefore: build a ZIP containing the cue sheet and
 * every track it references, with the cue at the archive root. EmulatorJS
 * unpacks it into its virtual filesystem and opens the .cue.
 *
 * Written with fflate in streaming mode so a 700 MB disc never materialises as
 * one giant contiguous buffer: chunks are pushed into the sink and collected.
 */

import { Zip, ZipPassThrough } from 'fflate';

export interface ArchiveInputFile {
  name: string;
  bytes: Uint8Array;
}

export interface DiscArchiveResult {
  blob: Blob;
  /** Name of the entry EmulatorJS should open first. */
  entry: string;
  /** Total uncompressed bytes that went in. */
  totalBytes: number;
  /** Entries that were skipped because the name collided. */
  skipped: string[];
}

/**
 * ZIP a disc set.
 *
 * `entry` must be the cue sheet (or playlist) — EmulatorJS resolves the other
 * members relative to it once decompressed.
 *
 * Compression is deliberately "store" (level 0) for track files: CD images are
 * mostly incompressible, and deflating a 700 MB image burns CPU for a few per
 * cent. Cue sheets are tiny either way.
 */
export function buildDiscArchive(files: ArchiveInputFile[], entry: string): Promise<DiscArchiveResult> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const skipped: string[] = [];
    const seen = new Set<string>();

    // Put the entry file first so a naive extractor also sees it first.
    // Both branches must be tested: a comparator that only checks `a`
    // returns 0 for every pair after the first, which silently leaves the
    // entry wherever it was in the input order.
    const entryKey = entry.toLowerCase();
    const sorted = [...files].sort((a, b) => {
      const aIsEntry = a.name.toLowerCase() === entryKey;
      const bIsEntry = b.name.toLowerCase() === entryKey;
      if (aIsEntry === bIsEntry) return 0;
      return aIsEntry ? -1 : 1;
    });
    const totalBytes = sorted.reduce((n, f) => n + f.bytes.length, 0);

    let zip: Zip;
    try {
      zip = new Zip((err, chunk, final) => {
        if (err) {
          reject(err);
          return;
        }
        if (chunk) chunks.push(chunk);
        if (final) {
          resolve({
            blob: new Blob(chunks as BlobPart[], { type: 'application/zip' }),
            entry,
            totalBytes,
            skipped,
          });
        }
      });
    } catch (error) {
      reject(error);
      return;
    }

    for (const file of sorted) {
      const key = file.name.toLowerCase();
      if (seen.has(key)) {
        skipped.push(file.name);
        continue;
      }
      seen.add(key);
      const stream = new ZipPassThrough(file.name);
      zip.add(stream);
      try {
        stream.push(file.bytes, true);
      } catch (error) {
        reject(error);
        return;
      }
    }
    zip.end();
  });
}

/**
 * Should this disc set be repackaged at all?
 *
 * A single file is passed to the engine directly — there is no reason to ZIP a
 * lone `.bin`, and doing so would defeat EmulatorJS's own progress reporting.
 */
export function needsArchive(fileCount: number): boolean {
  return fileCount > 1;
}
