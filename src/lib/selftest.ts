import { analyzeBytes } from '@/core/analyze';
import { buildTestRom, TEST_ROM_META, TEST_ROM_NAME } from '@/core/testrom';
import { useLibrary } from '@/state/library';
import type { GameRecord, Job } from '@/core/types';

/**
 * Engine self-test.
 *
 * Adds Recompa's own generated cartridge to the library through the *normal*
 * intake path (analysis → planner → job → game record), then the caller can
 * launch it and run verification. This proves the whole pipeline end to end
 * without any third-party ROM.
 */
export interface SelfTestResult {
  game: GameRecord;
  job: Job;
  duplicate: boolean;
}

export async function runSelfTest(): Promise<SelfTestResult> {
  const rom = buildTestRom();
  const report = await analyzeBytes(rom, TEST_ROM_NAME);
  report.facts.push({ label: 'Origin', value: TEST_ROM_META.licence });
  const { game, job, duplicate } = await useLibrary.getState().addReport(report, rom);
  return { game, job, duplicate: Boolean(duplicate) };
}

export { TEST_ROM_META };
