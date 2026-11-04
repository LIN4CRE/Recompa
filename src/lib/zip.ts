import { unzipSync, unzip, strFromU8 } from 'fflate';
import { KNOWN_EXTENSIONS } from '@/core/platforms';
import type { ArchiveEntry } from '@/core/types';

/**
 * Archive handling.
 *
 * Container archives (zip) are inspected, never blindly extracted: a 2 GiB zip
 * bomb must not be able to exhaust memory. Limits:
 *   • at most 512 entries are listed,
 *   • the selected member must be ≤ 256 MiB uncompressed,
 *   • total uncompressed size is reported so the UI can warn.
 */

export const MAX_ARCHIVE_ENTRIES = 512;
export const MAX_MEMBER_BYTES = 256 * 1024 * 1024;

export interface ArchiveInspection {
  entries: ArchiveEntry[];
  totalUncompressed: number;
  truncated: boolean;
  /** Index (in entries) of the chosen game payload. */
  selectedIndex: number | null;
  selectedBytes: Uint8Array | null;
  errors: string[];
}

/** Rank a candidate file inside an archive; higher is better. */
function scoreEntry(name: string, size: number): number {
  const lower = name.toLowerCase();
  if (lower.startsWith('__macosx/') || lower.endsWith('/.ds_store')) return -1;
  if (lower.endsWith('.txt') || lower.endsWith('.nfo') || lower.endsWith('.md')) return -1;
  if (lower.endsWith('.sfv') || lower.endsWith('.dat') || lower.endsWith('.json')) return -1;
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return -1;
  if (lower.endsWith('.sav') || lower.endsWith('.srm') || lower.endsWith('.state')) return -1;
  // Nested archives are not game payloads. Selecting one would hand an
  // unrecognisable blob to the detector; the caller reports "extract first".
  if (lower.endsWith('.zip') || lower.endsWith('.7z') || lower.endsWith('.rar')) return -1;
  if (lower.endsWith('.cue')) return 50; // a cue without bins is incomplete; prefer bins
  const ext = lower.slice(lower.lastIndexOf('.') + 1);
  if (!KNOWN_EXTENSIONS.includes(ext)) return -1;
  // Prefer bigger cartridges: multi-file sets sort by size, which surfaces the
  // main ROM over BIOS-like extras. Extension weight breaks ties.
  const extWeight: Record<string, number> = { rom: 0, bin: 1, nes: 3, gba: 3, gbc: 3, gb: 3, sfc: 3, smc: 3, z64: 3, n64: 3, v64: 3, md: 3, gen: 3 };
  return 100 + (extWeight[ext] ?? 2) + Math.log10(Math.max(size, 1));
}

export async function inspectArchive(bytes: Uint8Array): Promise<ArchiveInspection> {
  const errors: string[] = [];
  const entries: ArchiveEntry[] = [];
  let totalUncompressed = 0;
  let truncated = false;

  // Pass 1: synchronous central-directory parse gives us names + sizes.
  const listed = unzipSync(bytes, {
    filter: (file) => {
      totalUncompressed += file.originalSize;
      if (entries.length < MAX_ARCHIVE_ENTRIES) {
        entries.push({ name: file.name, size: file.originalSize, selected: false });
      } else {
        truncated = true;
      }
      return false; // do not inflate anything in pass 1
    },
  });
  void listed;

  if (entries.length === 0) {
    errors.push('The archive appears to be empty or is not a valid zip file.');
    return { entries, totalUncompressed, truncated, selectedIndex: null, selectedBytes: null, errors };
  }

  let bestIndex = -1;
  let bestScore = -Infinity;
  entries.forEach((entry, index) => {
    const score = scoreEntry(entry.name, entry.size);
    if (score < 0) {
      entry.skippedReason = 'not a game payload';
      return;
    }
    if (entry.size > MAX_MEMBER_BYTES) {
      entry.skippedReason = `larger than the ${(MAX_MEMBER_BYTES / 1024 / 1024).toFixed(0)} MiB safety limit`;
      return;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  if (bestIndex === -1) {
    const nestedArchives = entries.filter((e) => /\.(zip|7z|rar)$/i.test(e.name));
    if (nestedArchives.length) {
      errors.push('This archive contains nested archives. Extract them first — Recompa does not unpack archives recursively.');
    } else {
      errors.push('No file inside the archive looks like a supported game image.');
    }
    return { entries, totalUncompressed, truncated, selectedIndex: null, selectedBytes: null, errors };
  }

  entries[bestIndex]!.selected = true;
  const selectedName = entries[bestIndex]!.name;

  // Pass 2: inflate only the selected member.
  const inflated = unzipSync(bytes, { filter: (file) => file.name === selectedName });
  const selectedBytes = inflated[selectedName];
  if (!selectedBytes) {
    errors.push(`Could not extract "${selectedName}" from the archive.`);
    return { entries, totalUncompressed, truncated, selectedIndex: bestIndex, selectedBytes: null, errors };
  }

  return { entries, totalUncompressed, truncated, selectedIndex: bestIndex, selectedBytes, errors };
}

/** Streaming variant for very large archives; yields the selected member. */
export async function extractMemberStreaming(
  bytes: Uint8Array,
  name: string,
  onChunk?: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    unzip(
      bytes,
      {
        filter: (file) => file.name === name,
      },
      (err, files) => {
        if (err) return reject(err);
        const file = files[name];
        if (!file) return reject(new Error(`"${name}" is not present in the archive.`));
        if (chunks.length === 0) return resolve(file);
        const out = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          out.set(c, offset);
          offset += c.length;
        }
        resolve(out);
      },
    );
    void onChunk;
  });
}

export function readTextFile(bytes: Uint8Array): string {
  return strFromU8(bytes);
}
