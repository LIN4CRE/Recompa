import 'fake-indexeddb/auto';
/**
 * `storePayloads` used to be a switch that wrote a boolean and changed nothing:
 * ROM bytes were always written to IndexedDB. These tests drive the real ingest
 * path (`useLibrary.addReport`) and assert the stored state matches the setting,
 * so the "Store ROM bytes after analysis" control cannot silently regress into a
 * no-op again.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestRom } from '@/core/testrom';
import { analyzeBytes } from '@/core/analyze';
import { hasPayload, clearAllData } from '@/db/database';
import { useLibrary } from '@/state/library';
import { useSettings } from '@/state/settings';

async function analyse() {
  const bytes = buildTestRom();
  const report = await analyzeBytes(bytes, 'storage-setting-test.nes');
  return { bytes, report };
}

describe('storePayloads setting', () => {
  beforeEach(async () => {
    await clearAllData();
    useLibrary.setState({ games: [], reports: [], jobs: [], toasts: [], loading: false, analyzing: false });
  });

  it('keeps the ROM bytes when the setting is on', async () => {
    useSettings.setState({ settings: { ...useSettings.getState().settings, storePayloads: true } });
    const { bytes, report } = await analyse();

    const { game } = await useLibrary.getState().addReport(report, bytes);

    expect(await hasPayload(report.checksums.sha256)).toBe(true);
    expect(game.payloadId).toBe(report.checksums.sha256);
    // Stored bytes must round-trip intact through the Blob write path.
    const read = await useLibrary.getState().loadRom(game.id);
    expect(read).not.toBeNull();
    expect(read!.length).toBe(bytes.length);
    expect(Array.from(read!.subarray(0, 16))).toEqual(Array.from(bytes.subarray(0, 16)));
  });

  it('writes no payload when the setting is off, but still records the analysis', async () => {
    useSettings.setState({ settings: { ...useSettings.getState().settings, storePayloads: false } });
    const { bytes, report } = await analyse();

    const { game, job } = await useLibrary.getState().addReport(report, bytes);

    expect(await hasPayload(report.checksums.sha256)).toBe(false);
    // The report and the plan survive — this is analysis without storage, not a
    // failed ingest.
    expect(useLibrary.getState().games.some((g) => g.id === game.id)).toBe(true);
    expect(job.reportId).toBe(report.id);
    // And the player is told honestly, rather than being handed a broken launch.
    expect(await useLibrary.getState().loadRom(game.id)).toBeNull();
  });

  it('still deduplicates on SHA-256 when payloads are not stored', async () => {
    useSettings.setState({ settings: { ...useSettings.getState().settings, storePayloads: false } });
    const first = await analyse();
    await useLibrary.getState().addReport(first.report, first.bytes);

    const second = await analyse();
    const { duplicate } = await useLibrary.getState().addReport(second.report, second.bytes);

    expect(duplicate?.payloadId).toBe(second.report.checksums.sha256);
  });
});
