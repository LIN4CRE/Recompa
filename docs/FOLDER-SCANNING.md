# Folder scanning and rescanning

Recompa can take a whole ROM folder instead of a hand-picked file list, and it
can **re-walk that same folder later** to pick up anything new.

## The two intake paths

Browser support is not uniform, and Recompa is explicit about which path is
active rather than showing controls that silently do nothing.

| Path | API | Rescan? | Browsers |
| --- | --- | --- | --- |
| Folder picker | `window.showDirectoryPicker()` | **Yes** — the handle is retained | Chromium (Chrome, Edge, Opera, Brave) |
| Directory drop | `DataTransferItem.webkitGetAsEntry()` | No — one-shot | Chromium, Firefox, Safari |
| Directory input | `<input webkitdirectory>` | No — one-shot | Chromium, Firefox, Safari |
| Flat file pick | `<input type="file" multiple>` | No | Everywhere |

The Settings-free truth: `isFolderPickerSupported()` probes for
`showDirectoryPicker` at runtime. Where it is absent, the Rescan button is
**disabled with a tooltip explaining why** — it does not pretend.

## How a scan works

1. **Walk.** `filesFromHandle`, `filesFromDataTransfer` or `filesFromFileList`
   produce a flat `ScanFile[]` carrying the path *relative to the scan root*.
   Directory walking is depth-limited to 12 levels as a guard against
   pathological nesting, and `readEntries` is drained in batches (it returns at
   most 100 entries per call).
2. **Filter.** `isCandidateFile` drops artwork, readmes, `.nfo`/`.sfv`/`.log`,
   `Thumbs.db`, `.DS_Store` and macOS `._` resource forks. Ignored files are
   **reported by path**, not hidden, so the count is auditable.
3. **Group per folder.** Files are bucketed by their containing folder and
   handed to `resolveDiscSets` (`src/core/discset.ts`). This is what stops two
   different games called `game.bin` in two different folders from being merged,
   and what makes a `.cue` claim its own tracks instead of each track becoming a
   separate "game".
4. **Classify.** Incomplete sets are counted (`missing-companion`,
   `invalid-sheet`) and surfaced with their specific problem — Recompa does not
   fabricate a cue sheet to make a broken rip look importable.
5. **Import.** Each group is read, analysed and stored through exactly the same
   path as a manual upload, so scanning cannot bypass validation.

## How rescan works

The `FileSystemDirectoryHandle` is stored in the `folders` object store
(IndexedDB schema v2) alongside `knownPaths`, the relative paths already
imported. Rescan then:

- re-requests permission (`queryPermission` → `requestPermission`), because
  browsers drop handle grants between sessions;
- re-walks the folder and runs `diffScan` against `knownPaths`;
- imports **only** games with at least one previously unseen file;
- reports how many files disappeared from disk — and **never deletes library
  entries**, because removing a user's data is their decision, not a scan's.

### Why a whole game is re-imported when one file is new

A disc that gained a second track is not "one new file"; the previously stored
payload is now the *wrong image*. `diffScan` therefore treats a partially-seen
set as new in its entirety and rebuilds the archive.

## Limits worth stating

- **Chromium only** gets persistent rescan. On Firefox and Safari the folder
  must be re-picked each time, and the UI says so.
- **No filesystem watching.** Rescan is user-initiated; there is no background
  polling, so nothing runs while the tab is closed.
- **Hashes are computed on import**, not during the walk, so scanning a large
  folder is fast but does not deduplicate by content until each game is read.
- **No path traversal escape**: paths are built from the browser's own
  directory entries, never from user-supplied strings.
