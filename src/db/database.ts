import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AnalysisReport,
  AppSettings,
  BiosRecord,
  GameRecord,
  Job,
  SaveStateRecord,
  SramRecord,
  StoredPayload,
  TestRun,
} from '@/core/types';

/**
 * Local database (IndexedDB).
 *
 * Everything Recompa knows about your library lives here — including the ROM
 * bytes themselves. There is no server component; the only network requests the
 * app makes are for its own static assets (cores, catalogue, fonts).
 */

interface RecompaDB extends DBSchema {
  payloads: { key: string; value: StoredPayload };
  bios: { key: string; value: BiosRecord };
  folders: { key: string; value: WatchedFolderRecord };
  games: { key: string; value: GameRecord; indexes: { 'by-updated': number; 'by-platform': string } };
  reports: { key: string; value: AnalysisReport; indexes: { 'by-created': number } };
  jobs: { key: string; value: Job; indexes: { 'by-created': number; 'by-report': string } };
  sram: { key: string; value: SramRecord };
  states: { key: string; value: SaveStateRecord; indexes: { 'by-game': string } };
  tests: { key: string; value: TestRun; indexes: { 'by-game': string; 'by-started': number } };
  meta: { key: string; value: unknown };
}

export const DB_NAME = 'recompa';
export const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<RecompaDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<RecompaDB>> {
  if (!dbPromise) {
    dbPromise = openDB<RecompaDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('payloads')) db.createObjectStore('payloads', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('games')) {
          const games = db.createObjectStore('games', { keyPath: 'id' });
          games.createIndex('by-updated', 'updatedAt');
          games.createIndex('by-platform', 'platformId');
        }
        if (!db.objectStoreNames.contains('reports')) {
          const reports = db.createObjectStore('reports', { keyPath: 'id' });
          reports.createIndex('by-created', 'createdAt');
        }
        if (!db.objectStoreNames.contains('jobs')) {
          const jobs = db.createObjectStore('jobs', { keyPath: 'id' });
          jobs.createIndex('by-created', 'createdAt');
          jobs.createIndex('by-report', 'reportId');
        }
        if (!db.objectStoreNames.contains('sram')) db.createObjectStore('sram', { keyPath: 'gameId' });
        if (!db.objectStoreNames.contains('states')) {
          const states = db.createObjectStore('states', { keyPath: 'id' });
          states.createIndex('by-game', 'gameId');
        }
        if (!db.objectStoreNames.contains('tests')) {
          const tests = db.createObjectStore('tests', { keyPath: 'id' });
          tests.createIndex('by-game', 'gameId');
          tests.createIndex('by-started', 'startedAt');
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        // v2: user-supplied firmware (BIOS) images. Added so the PlayStation
        // adapter's BIOS requirement can actually be satisfied; previously the
        // blocker existed with no way to clear it.
        if (!db.objectStoreNames.contains('bios')) db.createObjectStore('bios', { keyPath: 'id' });
        // v2: folders the user granted access to, so a rescan can re-walk the
        // same handle without asking them to locate it again.
        if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      },
      blocked() {
        console.warn('[db] upgrade blocked by another tab — close other Recompa tabs.');
      },
    });
  }
  return dbPromise;
}

/* ------------------------------- payloads ------------------------------- */

export async function putPayload(bytes: Uint8Array, sha256: string): Promise<StoredPayload> {
  const db = await getDb();
  const id = sha256;
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const record: StoredPayload = { id, bytes: blob, size: bytes.length, sha256 };
  await db.put('payloads', record);
  return record;
}

export async function getPayloadBytes(id: string): Promise<Uint8Array | null> {
  const db = await getDb();
  const rec = await db.get('payloads', id);
  if (!rec) return null;
  return new Uint8Array(await rec.bytes.arrayBuffer());
}

export async function hasPayload(id: string): Promise<boolean> {
  const db = await getDb();
  const rec = await db.get('payloads', id);
  return Boolean(rec);
}

export async function deletePayload(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('payloads', id);
}

export async function totalPayloadBytes(): Promise<number> {
  const db = await getDb();
  let total = 0;
  let cursor = await db.transaction('payloads').store.openCursor();
  while (cursor) {
    total += cursor.value.size;
    cursor = await cursor.continue();
  }
  return total;
}

/* ---------------------------------- bios --------------------------------- */

export async function putBios(record: BiosRecord): Promise<void> {
  const db = await getDb();
  await db.put('bios', record);
}

export async function getBiosForPlatform(platformId: string): Promise<BiosRecord | undefined> {
  const db = await getDb();
  return db.get('bios', `${platformId}:bios`);
}

export async function deleteBios(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('bios', id);
}

/* -------------------------------- folders -------------------------------- */

export interface WatchedFolderRecord {
  id: string;
  /** Display name. */
  name: string;
  /** The retained directory handle. */
  handle: FileSystemDirectoryHandle;
  addedAt: number;
  lastScannedAt: number | null;
  /** Relative paths imported so far, so a rescan can skip unchanged files. */
  knownPaths: string[];
}

export async function putWatchedFolder(record: WatchedFolderRecord): Promise<void> {
  const db = await getDb();
  await db.put('folders', record);
}

export async function listWatchedFolders(): Promise<WatchedFolderRecord[]> {
  const db = await getDb();
  return db.getAll('folders');
}

export async function deleteWatchedFolder(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('folders', id);
}

/* --------------------------------- games -------------------------------- */

export async function putGame(game: GameRecord): Promise<void> {
  const db = await getDb();
  await db.put('games', game);
}

export async function getGame(id: string): Promise<GameRecord | undefined> {
  const db = await getDb();
  return db.get('games', id);
}

export async function getAllGames(): Promise<GameRecord[]> {
  const db = await getDb();
  const games = await db.getAll('games');
  return games.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteGameCascade(gameId: string): Promise<void> {
  const db = await getDb();
  const game = await db.get('games', gameId);
  const tx = db.transaction(['games', 'payloads', 'sram', 'states', 'tests'], 'readwrite');
  await tx.objectStore('games').delete(gameId);
  if (game) {
    const payload = await tx.objectStore('payloads').get(game.payloadId);
    if (payload) {
      // Only delete bytes if no other game record shares them.
      const allGames = await tx.objectStore('games').getAll();
      if (!allGames.some((g) => g.payloadId === game.payloadId)) {
        await tx.objectStore('payloads').delete(game.payloadId);
      }
    }
  }
  await tx.objectStore('sram').delete(gameId);
  const states = await tx.objectStore('states').index('by-game').getAllKeys(gameId);
  for (const key of states) await tx.objectStore('states').delete(key);
  const tests = await tx.objectStore('tests').index('by-game').getAllKeys(gameId);
  for (const key of tests) await tx.objectStore('tests').delete(key);
  await tx.done;
}

/* -------------------------------- reports ------------------------------- */

export async function putReport(report: AnalysisReport): Promise<void> {
  const db = await getDb();
  await db.put('reports', report);
}

export async function getReport(id: string): Promise<AnalysisReport | undefined> {
  const db = await getDb();
  return db.get('reports', id);
}

export async function getAllReports(limit = 50): Promise<AnalysisReport[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('reports', 'by-created');
  return all.reverse().slice(0, limit);
}

/* ---------------------------------- jobs -------------------------------- */

export async function putJob(job: Job): Promise<void> {
  const db = await getDb();
  await db.put('jobs', job);
}

export async function getJob(id: string): Promise<Job | undefined> {
  const db = await getDb();
  return db.get('jobs', id);
}

export async function listJobs(limit = 40): Promise<Job[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('jobs', 'by-created');
  return all.reverse().slice(0, limit);
}

/* ---------------------------------- saves ------------------------------- */

export async function putSram(record: SramRecord): Promise<void> {
  const db = await getDb();
  await db.put('sram', record);
}

export async function getSram(gameId: string): Promise<SramRecord | undefined> {
  const db = await getDb();
  return db.get('sram', gameId);
}

export async function listStates(gameId: string): Promise<SaveStateRecord[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('states', 'by-game', gameId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function putState(record: SaveStateRecord): Promise<void> {
  const db = await getDb();
  await db.put('states', record);
}

export async function deleteState(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('states', id);
}

/* ---------------------------------- tests ------------------------------- */

export async function putTest(test: TestRun): Promise<void> {
  const db = await getDb();
  await db.put('tests', test);
}

export async function listTests(gameId?: string): Promise<TestRun[]> {
  const db = await getDb();
  const all = gameId ? await db.getAllFromIndex('tests', 'by-game', gameId) : await db.getAll('tests');
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

/* ----------------------------------- meta ------------------------------- */

export async function setMeta<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.put('meta', value as unknown, key);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  return (await db.get('meta', key)) as T | undefined;
}

/* -------------------------------- settings ------------------------------ */

export const SETTINGS_KEY = 'settings';

export async function loadSettings(): Promise<Partial<AppSettings> | null> {
  const db = await getDb();
  return (await db.get('meta', SETTINGS_KEY)) as Partial<AppSettings> | undefined ?? null;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await setMeta(SETTINGS_KEY, settings);
}

/* ------------------------------ maintenance ----------------------------- */

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}

export async function clearAllData(): Promise<void> {
  const db = await getDb();
  const stores: Array<keyof RecompaDB & string> = ['payloads', 'games', 'reports', 'jobs', 'sram', 'states', 'tests'];
  const tx = db.transaction(stores as never[], 'readwrite');
  for (const store of stores) await tx.objectStore(store as never).clear();
  await tx.done;
}

/**
 * Backup format (schemaVersion 2).
 *
 * Deliberately excludes ROM payloads: a backup should be small, and copying
 * game images between devices is the user's decision, not a side effect of
 * "export my saves". Byte arrays are base64-encoded so they survive JSON
 * exactly — `JSON.stringify(new Uint8Array([1]))` silently becomes `{"0":1}`,
 * which is not a Uint8Array on the way back.
 */
export async function exportBackup(): Promise<Blob> {
  const db = await getDb();
  const sram = await db.getAll('sram');
  const data = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    games: await db.getAll('games'),
    reports: await db.getAll('reports'),
    sram: sram.map((record) => ({
      gameId: record.gameId,
      engineId: record.engineId,
      updatedAt: record.updatedAt,
      bytesBase64: bytesToBase64(record.bytes),
    })),
    settings: await db.get('meta', SETTINGS_KEY),
  };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

interface BackupSramV2 {
  gameId: string;
  engineId: string;
  updatedAt: number;
  bytesBase64: string;
}

export async function importBackup(file: File): Promise<{ games: number; sram: number; warnings: string[] }> {
  const text = await file.text();
  const data = JSON.parse(text) as {
    schemaVersion?: number;
    games?: GameRecord[];
    reports?: AnalysisReport[];
    sram?: Array<SramRecord | BackupSramV2>;
    settings?: AppSettings;
  };
  const warnings: string[] = [];
  if (data.schemaVersion !== 2) {
    warnings.push(
      data.schemaVersion === 1
        ? 'Legacy backup (v1) imported: save bytes may be lossy because v1 stored them as a JSON object.'
        : 'Unknown backup schema version; importing what is recognised.',
    );
  }
  const db = await getDb();
  let games = 0;
  for (const game of data.games ?? []) {
    // Payload bytes are never part of a backup: tell the user what is missing.
    const payloadExists = await db.get('payloads', game.payloadId);
    if (!payloadExists) {
      warnings.push(`"${game.title}" has no ROM bytes in this backup — re-add the file to play it.`);
    }
    await db.put('games', game);
    games++;
  }
  for (const report of data.reports ?? []) await db.put('reports', report);
  let sram = 0;
  for (const save of data.sram ?? []) {
    if ('bytesBase64' in save) {
      await db.put('sram', {
        gameId: save.gameId,
        engineId: save.engineId,
        updatedAt: save.updatedAt,
        bytes: base64ToBytes(save.bytesBase64),
      });
      sram++;
      continue;
    }
    // v1 fallback: accept a real Uint8Array, a plain number array, or the
    // index-keyed object that JSON.stringify produces for typed arrays.
    const raw = save.bytes as unknown;
    let bytes: Uint8Array;
    if (raw instanceof Uint8Array) bytes = raw;
    else if (Array.isArray(raw)) bytes = new Uint8Array(raw as number[]);
    else if (raw && typeof raw === 'object') {
      const values = Object.keys(raw as Record<string, number>)
        .filter((k) => /^\d+$/.test(k))
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => (raw as Record<string, number>)[k]! & 0xff);
      bytes = new Uint8Array(values);
    } else continue;
    await db.put('sram', { ...save, bytes });
    sram++;
  }
  if (data.settings) await db.put('meta', data.settings, SETTINGS_KEY);
  return { games, sram, warnings };
}

/* --------------------------- base64 helpers ---------------------------- */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...(bytes.subarray(i, i + chunk) as unknown as number[]));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
