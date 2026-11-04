import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  putPayload,
  getPayloadBytes,
  hasPayload,
  deletePayload,
  totalPayloadBytes,
  putGame,
  getGame,
  getAllGames,
  deleteGameCascade,
  putSram,
  getSram,
  putState,
  listStates,
  putTest,
  listTests,
  setMeta,
  getMeta,
  saveSettings,
  loadSettings,
  exportBackup,
  importBackup,
  clearAllData,
} from '@/db/database';
import { DEFAULT_SETTINGS } from '@/state/settings';
import type { GameRecord, TestRun } from '@/core/types';

/** Creates the same shape the library store persists. */
function game(id: string, payloadId: string): GameRecord {
  const now = Date.now();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    lastPlayedAt: null,
    favourite: false,
    title: `Game ${id}`,
    platformId: 'nes',
    reportId: `report-${id}`,
    payloadId,
    engineId: 'jsnes',
    compatibility: 'analysis-complete',
    verifiedBy: null,
    cover: null,
    playSeconds: 0,
    playCount: 0,
    facts: [],
    region: 'US',
  };
}

beforeEach(async () => {
  await clearAllData();
});

describe('payload storage', () => {
  it('round-trips ROM bytes through a Blob without corruption', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 255]);
    await putPayload(bytes, 'sha-a');
    expect(await hasPayload('sha-a')).toBe(true);
    const restored = await getPayloadBytes('sha-a');
    expect(restored).not.toBeNull();
    expect(Array.from(restored!)).toEqual(Array.from(bytes));
  });

  it('reports stored size and deletes cleanly', async () => {
    await putPayload(new Uint8Array(1024), 'sha-b');
    expect(await totalPayloadBytes()).toBe(1024);
    await deletePayload('sha-b');
    expect(await totalPayloadBytes()).toBe(0);
    expect(await getPayloadBytes('sha-b')).toBeNull();
  });

  it('keeps bytes for a 1 MiB payload', async () => {
    const big = new Uint8Array(1024 * 1024);
    for (let i = 0; i < big.length; i += 4096) big[i] = i & 0xff;
    await putPayload(big, 'sha-big');
    const back = await getPayloadBytes('sha-big');
    expect(back!.length).toBe(big.length);
    expect(back![4096]).toBe(big[4096]);
  });
});

describe('games', () => {
  it('stores, lists and updates a game record', async () => {
    await putGame(game('g1', 'p1'));
    const all = await getAllGames();
    expect(all).toHaveLength(1);
    expect(all[0]?.title).toBe('Game g1');

    const stored = await getGame('g1');
    await putGame({ ...stored!, favourite: true, lastPlayedAt: Date.now() });
    expect((await getGame('g1'))!.favourite).toBe(true);
  });

  it('deletes the shared payload only when no other game references it', async () => {
    await putPayload(new Uint8Array(64), 'shared');
    await putGame(game('g1', 'shared'));
    await putGame(game('g2', 'shared'));

    await deleteGameCascade('g1');
    expect(await hasPayload('shared')).toBe(true);

    await deleteGameCascade('g2');
    expect(await hasPayload('shared')).toBe(false);
  });

  it('cascades save states and tests with the game', async () => {
    await putGame(game('g1', 'p1'));
    await putState({ id: 's1', gameId: 'g1', engineId: 'jsnes', createdAt: Date.now(), slot: 0, thumbnail: null, bytes: new Uint8Array(8) });
    await putTest({
      id: 't1',
      gameId: 'g1',
      reportId: 'r1',
      engineId: 'jsnes',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      status: 'passed',
      checks: [],
      environment: { userAgent: 'test', cores: 4, webgpu: false, crossOriginIsolated: false, fps: 60 },
      log: [],
    });
    expect(await listStates('g1')).toHaveLength(1);
    expect(await listTests('g1')).toHaveLength(1);

    await deleteGameCascade('g1');
    expect(await listStates('g1')).toHaveLength(0);
    expect(await listTests('g1')).toHaveLength(0);
  });
});

describe('saves', () => {
  it('stores SRAM per game', async () => {
    await putSram({ gameId: 'g1', engineId: 'jsnes', updatedAt: Date.now(), bytes: new Uint8Array([9, 8, 7]) });
    const record = await getSram('g1');
    expect(record?.bytes.length).toBe(3);
  });

  it('orders save states newest first', async () => {
    await putState({ id: 'a', gameId: 'g1', engineId: 'jsnes', createdAt: 1, slot: 0, thumbnail: null, bytes: new Uint8Array(1) });
    await putState({ id: 'b', gameId: 'g1', engineId: 'jsnes', createdAt: 2, slot: 1, thumbnail: null, bytes: new Uint8Array(1) });
    const states = await listStates('g1');
    expect(states.map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('settings', () => {
  it('persists and reloads the settings object', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, volume: 0.33, touchControls: 'on' });
    const loaded = await loadSettings();
    expect(loaded?.volume).toBe(0.33);
    expect(loaded?.touchControls).toBe('on');
  });

  it('stores typed metadata', async () => {
    await setMeta('probe', { a: 1 });
    expect(await getMeta<{ a: number }>('probe')).toEqual({ a: 1 });
  });
});

describe('backup and restore', () => {
  it('exports metadata but never ROM bytes', async () => {
    await putPayload(new Uint8Array([1, 2, 3]), 'p1');
    await putGame(game('g1', 'p1'));
    await putSram({ gameId: 'g1', engineId: 'jsnes', updatedAt: Date.now(), bytes: new Uint8Array([5, 5]) });
    await saveSettings(DEFAULT_SETTINGS);

    const blob = await exportBackup();
    const text = await blob.text();
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(2);
    expect(Array.isArray(parsed.games)).toBe(true);
    // ROM payloads must never appear in a backup artefact.
    expect(text).not.toContain('"payloads"');
    expect(text).not.toContain('"sha256"');
    // The game record may reference its payload id, but no bytes are included.
    expect(JSON.stringify(parsed.games)).toContain('"payloadId"');
  });

  it('round-trips save bytes losslessly through base64', async () => {
    await putSram({ gameId: 'g9', engineId: 'jsnes', updatedAt: 5, bytes: new Uint8Array([0, 255, 128, 7]) });
    const text = await (await exportBackup()).text();
    await clearAllData();
    await importBackup(new File([text], 'b.json'));
    const restored = await getSram('g9');
    expect(Array.from(restored!.bytes)).toEqual([0, 255, 128, 7]);
  });

  it('repairs a v1 backup whose bytes were stringified as an indexed object', async () => {
    const v1 = {
      schemaVersion: 1,
      games: [],
      reports: [],
      sram: [{ gameId: 'legacy', engineId: 'jsnes', updatedAt: 0, bytes: { 0: 1, 1: 2, 2: 3 } }],
    };
    const result = await importBackup(new File([JSON.stringify(v1)], 'v1.json'));
    expect(result.warnings.join(' ')).toMatch(/Legacy backup/);
    expect(Array.from((await getSram('legacy'))!.bytes)).toEqual([1, 2, 3]);
  });

  it('imports a v2 backup and warns about missing payloads', async () => {
    const backup = {
      schemaVersion: 2,
      games: [game('imported', 'missing-payload')],
      reports: [],
      sram: [{ gameId: 'imported', engineId: 'jsnes', updatedAt: Date.now(), bytesBase64: btoa(String.fromCharCode(1, 2, 3)) }],
      settings: { ...DEFAULT_SETTINGS, volume: 0.5 },
    };
    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
    const result = await importBackup(file);
    expect(result.games).toBe(1);
    expect(result.sram).toBe(1);
    expect(result.warnings.join(' ')).toMatch(/re-add the file/i);
    expect((await getSram('imported'))?.bytes.length).toBe(3);
    expect((await loadSettings())?.volume).toBe(0.5);
  });

  it('accepts a v2 backup whose save bytes are a plain array (tolerant import)', async () => {
    const backup = {
      schemaVersion: 2,
      games: [],
      reports: [],
      sram: [{ gameId: 'g', engineId: 'x', updatedAt: 0, bytes: [255, 0, 128] }],
    };
    const file = new File([JSON.stringify(backup)], 'b.json');
    await importBackup(file);
    const record = await getSram('g');
    expect(record?.bytes).toBeInstanceOf(Uint8Array);
    expect(record?.bytes[0]).toBe(255);
  });
});

describe('test records', () => {
  it('orders test runs newest first', async () => {
    const base: Omit<TestRun, 'id' | 'startedAt'> = {
      gameId: 'g1',
      reportId: 'r1',
      engineId: 'jsnes',
      finishedAt: 0,
      status: 'passed',
      checks: [],
      environment: { userAgent: 'u', cores: 2, webgpu: false, crossOriginIsolated: false, fps: 60 },
      log: [],
    };
    await putTest({ ...base, id: 'old', startedAt: 100 });
    await putTest({ ...base, id: 'new', startedAt: 200 });
    expect((await listTests('g1')).map((t) => t.id)).toEqual(['new', 'old']);
  });
});
