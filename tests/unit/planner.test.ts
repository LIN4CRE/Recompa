import { describe, expect, it } from 'vitest';
import { plan, EXECUTION_PRIORITY, METHOD_LABELS, executionStatement } from '@/core/planner';
import { detectFormat } from '@/core/detect';
import type { AnalysisReport, RuntimeEnvironment } from '@/core/types';
import { PLATFORM_BY_ID } from '@/core/platforms';
import { MGBA_DESCRIPTOR, JSNES_DESCRIPTOR, N64RECOMP_DESCRIPTOR } from '@/engines/descriptors';

const modernEnvironment: RuntimeEnvironment = {
  webAssembly: true,
  wasmSimd: true,
  wasmThreads: true,
  sharedArrayBuffer: true,
  crossOriginIsolated: true,
  webgpu: true,
  webgl2: true,
  webgl1: true,
  audioWorklet: true,
  indexedDb: true,
  offscreenCanvas: true,
  gamepadApi: true,
  touch: false,
  cores: 8,
  deviceMemoryGb: 8,
  gpuRenderer: 'Apple M1',
  userAgentClass: 'desktop',
};

const noWebgl2Environment: RuntimeEnvironment = { ...modernEnvironment, webgl2: false, webgl1: true, webgpu: false };

/** Build a minimal-but-complete report for a given platform + format. */
function reportFor(
  platformId: keyof typeof PLATFORM_BY_ID extends never ? never : string,
  formatId: string,
  extra: Partial<AnalysisReport> = {},
): AnalysisReport {
  const platform = PLATFORM_BY_ID.get(platformId as never) ?? null;
  return {
    schemaVersion: 1,
    id: 'report-1',
    createdAt: Date.now(),
    fileName: 'test.rom',
    fileSize: 1024,
    platform,
    platformConfidence: 'certain',
    platformEvidence: [],
    format: {
      id: formatId,
      label: `${formatId} image`,
      kind: 'container',
      confidence: 'certain',
      evidence: [],
    },
    errors: [],
    header: { strippedBytes: 0, fields: {}, warnings: [] },
    checksums: { crc32: '0', md5: '', sha1: 'a'.repeat(40), sha256: 'b'.repeat(64), size: 1024 },
    identification: {
      title: 'Test',
      titleSource: 'database',
      region: 'US',
      regionSource: 'database',
      version: '1.0',
      serial: null,
      catalogueMatch: null,
    },
    dependencies: [],
    facts: [],
    ...extra,
  };
}

describe('planner priority ladder', () => {
  it('orders recompilation above emulation, exactly as specified', () => {
    const order = EXECUTION_PRIORITY.map((p) => p.kind);
    expect(order.indexOf('browser-native-recompilation')).toBeLessThan(order.indexOf('static-recompilation'));
    expect(order.indexOf('static-recompilation')).toBeLessThan(order.indexOf('source-port-wasm'));
    expect(order.indexOf('source-port-wasm')).toBeLessThan(order.indexOf('wasm-emulator'));
    expect(order.indexOf('wasm-emulator')).toBeLessThan(order.indexOf('js-emulator'));
  });

  it('labels every execution kind and never calls emulation recompilation', () => {
    expect(METHOD_LABELS['wasm-emulator']).toBe('Emulation (WebAssembly core)');
    expect(METHOD_LABELS['js-emulator']).toBe('Emulation (JavaScript core)');
    expect(METHOD_LABELS['static-recompilation']).toContain('recompilation');
    const emulationStatement = executionStatement('wasm-emulator', MGBA_DESCRIPTOR);
    expect(emulationStatement).toContain('emulation');
    expect(emulationStatement).toContain('No recompilation');
  });
});

describe('planner selection — NES', () => {
  it('selects jsnes for a mapper-0 iNES image on a capable device', () => {
    const { plan: jobPlan, engine } = plan({
      report: reportFor('nes', 'ines'),
      environment: modernEnvironment,
      installedEngines: new Set(['jsnes', 'mgba-wasm']),
    });
    expect(engine?.id).toBe('jsnes');
    expect(jobPlan.target?.method).toBe('js-emulator');
    expect(jobPlan.target?.runnable).toBe(true);
    expect(jobPlan.executionStatement).toContain('emulation');
  });

  it('rejects jsnes for an unsupported mapper and explains why', () => {
    const report = reportFor('nes', 'ines', {
      header: { strippedBytes: 16, fields: { mapper: 69 }, warnings: [] },
    });
    const { plan: jobPlan, engine } = plan({ report, environment: modernEnvironment });
    const jsnesCandidate = jobPlan.considered.find((c) => c.engineId === 'jsnes');
    expect(jsnesCandidate?.accepted).toBe(false);
    expect(jsnesCandidate?.blockers.join(' ')).toContain('mapper 69');
    expect(engine).toBeNull();
    expect(jobPlan.target).toBeNull();
    expect(jobPlan.executionStatement).toContain('No runnable path');
  });

  it('marks the recompilation stage as skipped when emulating', () => {
    const { plan: jobPlan } = plan({ report: reportFor('nes', 'ines'), environment: modernEnvironment });
    const transpile = jobPlan.stages.find((s) => s.id === 'transpile');
    expect(transpile?.status).toBe('skipped');
    expect(transpile?.output.join(' ')).toContain('Not applicable');
  });

  it('records fingerprint, structure and catalogue stages as really done', () => {
    const { plan: jobPlan } = plan({ report: reportFor('nes', 'ines'), environment: modernEnvironment });
    const byId = Object.fromEntries(jobPlan.stages.map((s) => [s.id, s]));
    expect(byId.fingerprint?.status).toBe('done');
    expect(byId.structure?.status).toBe('done');
    expect(byId.catalogue?.status).toBe('done');
    expect(byId.validate?.status).toBe('pending');
  });
});

describe('planner selection — GBA', () => {
  it('selects the WebAssembly mGBA core over any JS fallback', () => {
    const { plan: jobPlan, engine } = plan({ report: reportFor('gba', 'gba'), environment: modernEnvironment });
    expect(engine?.id).toBe('mgba-wasm');
    expect(jobPlan.target?.method).toBe('wasm-emulator');
  });

  it('blocks mGBA when WebGL2 is unavailable, with the real reason', () => {
    const { plan: jobPlan, engine } = plan({ report: reportFor('gba', 'gba'), environment: noWebgl2Environment });
    const candidate = jobPlan.considered.find((c) => c.engineId === 'mgba-wasm');
    expect(candidate?.accepted).toBe(false);
    expect(candidate?.blockers.join(' ')).toMatch(/WebGL2/);
    expect(engine).toBeNull();
  });

  it('blocks mGBA when WebAssembly is missing entirely', () => {
    const env = { ...modernEnvironment, webAssembly: false };
    const { plan: jobPlan } = plan({ report: reportFor('gba', 'gba'), environment: env });
    const candidate = jobPlan.considered.find((c) => c.engineId === 'mgba-wasm');
    expect(candidate?.accepted).toBe(false);
  });
});

describe('planner selection — N64', () => {
  it('never claims a runnable recompilation and lists the real prerequisites', () => {
    const { plan: jobPlan, engine } = plan({ report: reportFor('n64', 'n64-be'), environment: modernEnvironment });
    expect(engine).toBeNull();
    expect(jobPlan.target).toBeNull();
    const n64 = jobPlan.considered.find((c) => c.engineId === N64RECOMP_DESCRIPTOR.id);
    expect(n64?.accepted).toBe(false);
    expect(n64?.blockers.join(' ')).toMatch(/symbol/i);
    expect(n64?.blockers.join(' ')).toMatch(/WebAssembly/);
    const transpile = jobPlan.stages.find((s) => s.id === 'transpile');
    expect(transpile?.status).toBe('blocked');
    expect(transpile?.requiresService).toBe(true);
  });
});

describe('planner selection — unknown platform', () => {
  it('produces a blocking plan instead of guessing', () => {
    const report = reportFor('nes', 'ines', { platform: null, format: null });
    const { plan: jobPlan, engine } = plan({ report, environment: modernEnvironment });
    expect(engine).toBeNull();
    expect(jobPlan.target).toBeNull();
    expect(jobPlan.summary).toContain('No execution path');
    expect(jobPlan.stages[0]?.status).toBe('failed');
  });
});

describe('planner honesty guarantees', () => {
  it('every considered candidate carries either blockers or notes', () => {
    const { plan: jobPlan } = plan({ report: reportFor('nes', 'ines'), environment: modernEnvironment });
    for (const candidate of jobPlan.considered) {
      const hasReason = candidate.blockers.length > 0 || candidate.notes.length > 0;
      expect(hasReason).toBe(true);
    }
  });

  it('selected target kind always matches the engine descriptor kind', () => {
    const { plan: jobPlan, engine } = plan({ report: reportFor('nes', 'ines'), environment: modernEnvironment });
    expect(jobPlan.target?.descriptor.kind).toBe(engine?.kind);
    expect(jobPlan.target?.method).toBe(engine?.kind);
  });

  it('uses detected format evidence, not the file name, to gate engines', () => {
    const rom = new Uint8Array(40976);
    rom.set([0x4e, 0x45, 0x53, 0x1a, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    const detection = detectFormat(rom, 'definitely-a-gba-game.gba');
    // The detector must not be fooled by the extension.
    expect(detection.platformId).toBe('nes');
  });
});

describe('descriptor invariants', () => {
  it('jsnes and mGBA declare themselves as emulators, never recompilers', () => {
    expect(JSNES_DESCRIPTOR.kind).toBe('js-emulator');
    expect(MGBA_DESCRIPTOR.kind).toBe('wasm-emulator');
  });

  it('every live engine has a licence and a homepage', () => {
    for (const descriptor of [JSNES_DESCRIPTOR, MGBA_DESCRIPTOR, N64RECOMP_DESCRIPTOR]) {
      expect(descriptor.licence.length).toBeGreaterThan(0);
      expect(descriptor.homepage).toMatch(/^https:\/\//);
      expect(descriptor.version.length).toBeGreaterThan(0);
    }
  });
});
