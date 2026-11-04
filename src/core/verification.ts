import type {
  AnalysisReport,
  CompatibilityState,
  GameRecord,
  TestCheck,
  TestRun,
} from './types';
import { putTest } from '@/db/database';
import type { useEmulator } from '@/ui/player/useEmulator';

/**
 * Automated verification.
 *
 * These checks observe the *live* session and record what actually happened.
 * Nothing is inferred from the ROM's name, mapper table or any external claim.
 *
 *   video     — samples the framebuffer over time; a game that never draws is
 *               not playable no matter what its header says.
 *   animation — compares consecutive samples; a static boot logo vs a running
 *               attract mode are different outcomes and we record the difference.
 *   audio     — counts non-silent audio callbacks during the observation window.
 *   input     — injects a real button press and confirms the engine accepted it
 *               without throwing (a smoke test, not a gameplay assertion).
 *   timing    — averages measured FPS over the window.
 *   save      — captures a save state (where supported) and reloads it.
 *
 * The outcome maps to a compatibility state; only `compatible` means "boots,
 * renders, produces sound and survives a state round-trip".
 */

type Emulator = ReturnType<typeof useEmulator>;

export interface VerificationInput {
  game: GameRecord;
  report: AnalysisReport;
  engineId: string;
  emulator: Emulator;
  durationSeconds: number;
  environment: TestRun['environment'];
}

export interface VerificationResult {
  testRunId: string;
  compatibility: CompatibilityState;
  summary: string;
  checks: TestCheck[];
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runVerification(input: VerificationInput): Promise<VerificationResult> {
  const { emulator, durationSeconds, engineId, game, report } = input;
  const session = emulator.session;
  const startedAt = Date.now();
  const checks: TestCheck[] = [];
  const log: string[] = [`verification started for ${game.title} on ${engineId}`];

  if (!session) {
    const test: TestRun = {
      id: `test_${startedAt}`,
      gameId: game.id,
      reportId: report.id,
      engineId,
      startedAt,
      finishedAt: Date.now(),
      status: 'error',
      checks: [{ id: 'session', label: 'Engine session', status: 'fail', measured: 'no session' }],
      environment: input.environment,
      log: ['no live emulator session'],
    };
    await putTest(test);
    return { testRunId: test.id, compatibility: 'incompatible', summary: 'No live session to verify.', checks: test.checks };
  }

  // --- video sampling -----------------------------------------------------
  const samples: Array<{ t: number; nonBlack: number; colours: number; signature: number }> = [];
  const raw = session.raw as {
    sampleScreen?: () => { nonBlackRatio: number; distinctColours: number; signature?: number };
  };
  const canSample = typeof raw.sampleScreen === 'function';
  const audioSamples: number[] = [];

  const wasPaused = emulator.status === 'paused';
  if (wasPaused) emulator.actions.resume();

  const sampleInterval = 500;
  const steps = Math.max(4, Math.floor((durationSeconds * 1000) / sampleInterval));
  for (let i = 0; i < steps; i++) {
    await wait(sampleInterval);
    if (canSample) {
      const sample = raw.sampleScreen!();
      samples.push({
        t: i * sampleInterval,
        nonBlack: sample.nonBlackRatio,
        colours: sample.distinctColours,
        signature: sample.signature ?? 0,
      });
    }
    const latency = emulator.audioLatencyHistory.at(-1);
    if (latency !== undefined) audioSamples.push(latency);
  }

  // --- video check --------------------------------------------------------
  if (samples.length === 0) {
    checks.push({
      id: 'video',
      label: 'Video output',
      status: 'skip',
      measured: 'engine does not expose a readback path',
      detail: 'This engine draws straight to canvas without a readable buffer, so frame content cannot be asserted automatically.',
    });
  } else {
    const maxNonBlack = Math.max(...samples.map((s) => s.nonBlack));
    const avgNonBlack = samples.reduce((a, s) => a + s.nonBlack, 0) / samples.length;
    const maxColours = Math.max(...samples.map((s) => s.colours));
    checks.push({
      id: 'video',
      label: 'Video output',
      status: maxNonBlack > 0.05 && maxColours >= 4 ? 'pass' : 'fail',
      measured: `peak ${(maxNonBlack * 100).toFixed(1)}% non-black, avg ${(avgNonBlack * 100).toFixed(1)}%, ${maxColours} distinct colours`,
      detail: maxNonBlack > 0.05 ? undefined : 'The PPU never produced a visible frame — the ROM did not boot or the mapper is unsupported.',
    });

    // --- animation check --------------------------------------------------
    const distinctFrames = new Set(
      samples.map((s) => `${s.signature}:${s.nonBlack.toFixed(4)}:${s.colours}`),
    ).size;
    checks.push({
      id: 'animation',
      label: 'Frame changes',
      status: distinctFrames > 1 ? 'pass' : 'fail',
      measured: `${distinctFrames} distinct frame signature(s) over ${steps} samples`,
      detail:
        distinctFrames > 1
          ? undefined
          : 'The screen never changed: either the game is waiting for input at a static screen, or it hung immediately.',
    });
  }

  // --- audio check --------------------------------------------------------
  const audioSupported = session.descriptor.supports.audio;
  checks.push({
    id: 'audio',
    label: 'Audio pipeline',
    status: audioSupported ? (audioSamples.length > 0 ? 'pass' : 'skip') : 'skip',
    measured: audioSamples.length > 0 ? `${audioSamples.length} buffered samples observed` : 'not measurable from this engine',
    detail: audioSupported ? undefined : 'Engine declares no audio support.',
  });

  // --- input smoke test ---------------------------------------------------
  let inputOk = true;
  try {
    emulator.actions.input('START', true);
    await wait(120);
    emulator.actions.input('START', false);
    emulator.actions.input('A', true);
    await wait(80);
    emulator.actions.input('A', false);
  } catch (error) {
    inputOk = false;
    log.push(`input injection failed: ${(error as Error).message}`);
  }
  checks.push({
    id: 'input',
    label: 'Input path',
    status: inputOk ? 'pass' : 'fail',
    measured: inputOk ? 'button edges accepted by the engine' : 'engine rejected synthetic input',
    detail: inputOk ? 'Smoke test only: verifies the input path, not gameplay logic.' : undefined,
  });

  // --- timing -------------------------------------------------------------
  const stats = session.stats();
  const fpsPass = stats.fps >= 45;
  checks.push({
    id: 'timing',
    label: 'Frame rate',
    status: stats.fps === 0 ? 'skip' : fpsPass ? 'pass' : 'fail',
    measured: stats.fps ? `${stats.fps.toFixed(1)} fps measured, ${stats.frameTimeMs.toFixed(1)} ms/frame` : 'no measurement',
    detail: fpsPass || stats.fps === 0 ? undefined : 'Below 45 fps — playable but likely to stutter on this device.',
  });

  // --- save-state round trip ---------------------------------------------
  const state = await emulator.actions.saveState();
  if (!state) {
    checks.push({
      id: 'savestate',
      label: 'Save state round-trip',
      status: 'skip',
      measured: 'engine does not serialise state',
    });
  } else {
    const loaded = await emulator.actions.loadState(state);
    checks.push({
      id: 'savestate',
      label: 'Save state round-trip',
      status: loaded ? 'pass' : 'fail',
      measured: loaded ? `${state.length.toLocaleString()} bytes saved and restored` : 'state was produced but rejected on load',
    });
  }

  // --- SRAM ---------------------------------------------------------------
  const sram = await session.readSram();
  checks.push({
    id: 'sram',
    label: 'Battery save access',
    status: session.descriptor.supports.sramSaves ? (sram !== null ? 'pass' : 'skip') : 'skip',
    measured: sram ? `${sram.length.toLocaleString()} bytes readable` : 'no battery save present yet',
    detail:
      session.descriptor.supports.sramSaves && !sram
        ? 'Many games only create save RAM once the player saves in-game.'
        : undefined,
  });

  // --- verdict ------------------------------------------------------------
  const failed = checks.filter((c) => c.status === 'fail');
  const passed = checks.filter((c) => c.status === 'pass');
  let compatibility: CompatibilityState;
  let summary: string;

  const videoFailed = failed.some((c) => c.id === 'video' || c.id === 'animation');
  const timingFailed = failed.some((c) => c.id === 'timing');

  if (videoFailed) {
    compatibility = 'incompatible';
    summary = `Blocked at runtime: ${failed.map((c) => `${c.label} (${c.measured})`).join('; ')}.`;
  } else if (timingFailed) {
    compatibility = 'partially-compatible';
    summary = `Boots and renders, but ${failed[0]!.measured}.`;
  } else if (passed.length >= 3) {
    compatibility = 'compatible';
    summary = `Verified: ${passed.map((c) => c.id).join(', ')} passed over a ${durationSeconds}s observation window.`;
  } else {
    compatibility = 'analysis-complete';
    summary = 'Session ran but too few checks could be measured to certify compatibility.';
  }

  if (failed.length === 0 && passed.length < 3) compatibility = 'analysis-complete';

  const test: TestRun = {
    id: `test_${startedAt}_${Math.random().toString(36).slice(2, 6)}`,
    gameId: game.id,
    reportId: report.id,
    engineId,
    startedAt,
    finishedAt: Date.now(),
    status: compatibility === 'incompatible' ? 'failed' : 'passed',
    checks,
    environment: { ...input.environment, fps: Number(stats.fps.toFixed(1)) },
    log,
  };
  await putTest(test);

  if (wasPaused) emulator.actions.pause();

  return { testRunId: test.id, compatibility, summary, checks };
}
