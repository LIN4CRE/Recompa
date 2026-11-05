import type {
  AnalysisReport,
  EngineDescriptor,
  ExecutionKind,
  JobPlan,
  JobStage,
  PlatformId,
  RuntimeEnvironment,
} from './types';
import { ENGINE_ADAPTERS } from '@/engines';
import { ALL_DESCRIPTORS, EMULATORJS_DESCRIPTOR, N64RECOMP_DESCRIPTOR } from '@/engines/descriptors';

/**
 * Execution planner.
 *
 * Deterministic, explainable and auditable: for every candidate it records why
 * it was accepted or rejected. The priority ladder is fixed by the product
 * spec and reflected in `PRIORITY`:
 *
 *   1. existing verified browser-native recompilation
 *   2. existing compatible static recompilation
 *   3. source port compiled to WebAssembly
 *   4. optimised WebAssembly emulator
 *   5. other browser-compatible execution (JS emulator)
 *
 * Recompa never claims a higher rung than it can actually deliver: today rungs
 * 1–3 have no shipped, browser-runnable artefact for any supported platform,
 * so commercial ROMs land on rung 4 (WASM emulator) or 5 (JS emulator). N64 is
 * reported as "recompilation available (external toolchain)" without pretending
 * the job has run.
 */

export const EXECUTION_PRIORITY: Array<{ kind: ExecutionKind; priority: number; label: string }> = [
  { kind: 'browser-native-recompilation', priority: 1, label: 'Verified browser-native recompilation' },
  { kind: 'static-recompilation', priority: 2, label: 'Compatible static recompilation' },
  { kind: 'source-port-wasm', priority: 3, label: 'Source port compiled to WebAssembly' },
  { kind: 'wasm-emulator', priority: 4, label: 'Optimised WebAssembly emulator' },
  { kind: 'js-emulator', priority: 5, label: 'JavaScript emulator' },
  { kind: 'external-tool', priority: 6, label: 'External toolchain (not runnable in-browser)' },
];

export const METHOD_LABELS: Record<ExecutionKind, string> = {
  'browser-native-recompilation': 'Recompilation (browser-native)',
  'static-recompilation': 'Static recompilation (external toolchain)',
  'source-port-wasm': 'Source port (WebAssembly)',
  'wasm-emulator': 'Emulation (WebAssembly core)',
  'js-emulator': 'Emulation (JavaScript core)',
  'external-tool': 'External toolchain',
};

/** Statement shown next to PLAY so the method can never be misread. */
export function executionStatement(kind: ExecutionKind, engine: EngineDescriptor): string {
  switch (kind) {
    case 'wasm-emulator':
      return `Plays by **emulation** — the ${engine.project} core loads your ROM and interprets it at runtime. No recompilation is performed or claimed.`;
    case 'js-emulator':
      return `Plays by **emulation** — the ${engine.project} core interprets your ROM in JavaScript. No recompilation is performed or claimed.`;
    case 'browser-native-recompilation':
      return `Plays a **statically recompiled** build compiled to WebAssembly — game code was translated ahead of time.`;
    case 'static-recompilation':
      return `Requires an **external static recompilation** step on your own machine with ${engine.project}; Recompa audits and prepares the job but does not run the native toolchain.`;
    case 'source-port-wasm':
      return `Plays a **source port** compiled to WebAssembly.`;
    default:
      return 'Requires an external toolchain.';
  }
}

export interface PlanInput {
  report: AnalysisReport;
  environment: RuntimeEnvironment;
  /** Ids of engines whose runtime payload is actually present. */
  installedEngines?: Set<string>;
  /** Platforms whose firmware requirement is already satisfied locally. */
  biosInstalledFor?: Set<string>;
}

export interface PlanResult {
  plan: JobPlan;
  engine: EngineDescriptor | null;
}

/**
 * Game-specific recompilation/port catalogue.
 *
 * These are *identifiable projects with real repositories*, matched only by
 * exact catalogue fingerprint (never by fuzzy title). They are reported as
 * "available" only when a browser-runnable artefact genuinely exists.
 */
interface KnownPortProject {
  id: string;
  platform: PlatformId;
  project: string;
  licence: string;
  homepage: string;
  /** Matched by SHA-1 of the canonical ROM, when the project documents it. */
  sha1?: string;
  /** What the artefact is and whether it runs in a browser today. */
  artefact: string;
  browserRunnable: boolean;
  note: string;
}

export const KNOWN_PORT_PROJECTS: KnownPortProject[] = [
  {
    id: 'zelda64recomp-mm',
    platform: 'n64',
    project: "Zelda 64: Recompiled (Majora's Mask)",
    licence: 'GPL-3.0',
    homepage: 'https://github.com/Zelda64Recomp/Zelda64Recomp',
    artefact: 'Native Windows/Linux/macOS build via N64Recomp + N64ModernRuntime + RT64',
    browserRunnable: false,
    note: 'Verified: no WebAssembly build published. Running it in a browser would require porting RT64 and the runtime to Emscripten and supplying the ROM at runtime — outside this release, and not something Recompa will fake.',
  },
  {
    id: 'sm64-decomp',
    platform: 'n64',
    project: 'n64decomp/sm64 (decompilation)',
    licence: 'CC0-1.0 (decompiled source)',
    homepage: 'https://github.com/n64decomp/sm64',
    artefact: 'Matching decompilation that builds native binaries from your own ROM',
    browserRunnable: false,
    note: 'No maintained Emscripten target. Would need a build pipeline plus the user’s own ROM to generate assets.',
  },
];

export function plan(input: PlanInput): PlanResult {
  const { report, environment } = input;
  const considered: JobPlan['considered'] = [];
  const stages = baseStages(report);

  if (!report.platform) {
    stages.forEach((s) => {
      if (s.id === 'fingerprint') s.status = 'failed';
      else s.status = 'skipped';
    });
    stages[0]!.error = 'No platform detected — nothing to plan.';
    return {
      plan: {
        id: `plan_${report.id}`,
        reportId: report.id,
        createdAt: Date.now(),
        target: null,
        considered: [],
        stages,
        summary: 'No execution path: the file format could not be identified.',
        executionStatement: 'Recompa will not guess. Fix the format errors above and retry.',
      },
      engine: null,
    };
  }

  // ---------------------------------------------------------------- rung 1-3
  const knownPorts = KNOWN_PORT_PROJECTS.filter(
    (p) => p.platform === report.platform!.id && (!p.sha1 || p.sha1 === report.checksums.sha1),
  );
  for (const port of knownPorts) {
    considered.push({
      engineId: port.id,
      engineName: port.project,
      kind: 'static-recompilation',
      priority: 2,
      accepted: false,
      blockers: port.browserRunnable
        ? []
        : ['No browser-runnable artefact is published for this project.'],
      notes: [`${port.artefact}. ${port.note} Licence: ${port.licence} · ${port.homepage}`],
    });
  }

  // ---------------------------------------------------------------- rung 4/5
  for (const adapter of ENGINE_ADAPTERS) {
    const candidate = adapter.canRun({
      report,
      platform: report.platform,
      environment,
      biosInstalled: input.biosInstalledFor?.has(report.platform?.id ?? '') ?? false,
    });
    const priority =
      EXECUTION_PRIORITY.find((p) => p.kind === adapter.descriptor.kind)?.priority ?? 99;
    considered.push({
      engineId: adapter.descriptor.id,
      engineName: adapter.descriptor.name,
      kind: adapter.descriptor.kind,
      priority,
      accepted: candidate.runnable,
      blockers: candidate.blockers,
      notes: [
        ...candidate.notes,
        `${adapter.descriptor.licence} · ${adapter.descriptor.version}`,
      ],
    });
  }

  // An execution target must always resolve to a registered adapter. A
  // descriptor that is only *described* (EmulatorJS NES is in PLANNED_ENGINES)
  // must never become the target: the player would fail at launch with
  // "Engine … is not installed in this build" even though the planner marked it
  // runnable. The optional EmulatorJS setup installs the PlayStation core only,
  // so `loader.js` is not evidence of an NES core.
  const adaptableIds = new Set(ENGINE_ADAPTERS.map((a) => a.descriptor.id));
  const emulatorjsAdapterPresent = adaptableIds.has(EMULATORJS_DESCRIPTOR.id);
  const emulatorjsInstalled = input.installedEngines?.has(EMULATORJS_DESCRIPTOR.id) ?? false;
  if (report.platform.id === 'nes') {
    considered.push({
      engineId: EMULATORJS_DESCRIPTOR.id,
      engineName: EMULATORJS_DESCRIPTOR.name,
      kind: 'wasm-emulator',
      priority: 4,
      accepted: emulatorjsAdapterPresent && emulatorjsInstalled,
      blockers: !emulatorjsAdapterPresent
        ? ['No NES adapter for EmulatorJS is integrated in this release; the optional install provides the PlayStation core only.']
        : emulatorjsInstalled
          ? []
          : ['Runtime payload not installed (run `npm run fetch:emulatorjs`).'],
      notes: [
        'Broader mapper coverage than jsnes, but GPL-3.0 and a larger download.',
        EMULATORJS_DESCRIPTOR.unavailableReason ?? '',
      ].filter(Boolean),
    });
  }

  // ---------------------------------------------------------------- N64 audit
  if (report.platform.id === 'n64') {
    considered.push({
      engineId: N64RECOMP_DESCRIPTOR.id,
      engineName: N64RECOMP_DESCRIPTOR.name,
      kind: 'static-recompilation',
      priority: 2,
      accepted: false,
      blockers: [
        'Native C++ toolchain required (cannot execute on the web host by design).',
        'Needs a symbol/function map for this specific ROM.',
        'No official WebAssembly build of N64ModernRuntime or the RT64 renderer.',
      ],
      notes: [
        'Recompa can generate the audit and the exact command line for you to run locally.',
        'N64 emulation in-browser is not shipped in this release — see the compatibility database.',
      ],
    });
  }

  considered.sort((a, b) => a.priority - b.priority);

  // Choose the best accepted candidate (lowest priority number) — but prefer a
  // WASM core over a JS core when both can run, because it is faster.
  // The adapter check is a hard invariant: `getAdapter()` must be able to
  // resolve whatever the planner puts in `game.engineId`.
  const accepted = considered.filter((c) => c.accepted && adaptableIds.has(c.engineId));
  accepted.sort((a, b) => a.priority - b.priority);
  const chosen = accepted[0] ?? null;

  const descriptor = chosen
    ? (ENGINE_ADAPTERS.find((a) => a.descriptor.id === chosen.engineId)?.descriptor ??
        (chosen.engineId === EMULATORJS_DESCRIPTOR.id ? EMULATORJS_DESCRIPTOR : null))
    : null;

  // Stage bookkeeping reflects what actually ran during analysis.
  markStage(stages, 'fingerprint', 'done', [
    `CRC32 ${report.checksums.crc32.toUpperCase()}`,
    `SHA-1 ${report.checksums.sha1}`,
    `${report.checksums.size.toLocaleString()} bytes hashed`,
  ]);
  markStage(stages, 'structure', 'done', [
    `${report.format?.label ?? 'unknown container'}`,
    ...(report.header.strippedBytes ? [`${report.header.strippedBytes} header bytes excluded`] : []),
  ]);
  const catalogueFact = report.facts.find((f) => f.label === 'Catalogue');
  if (report.identification.catalogueMatch) {
    markStage(stages, 'catalogue', 'done', [
      `Matched ${report.identification.catalogueMatch.name}`,
      `on ${report.identification.catalogueMatch.matchedOn.toUpperCase()}`,
      report.identification.catalogueMatch.source,
    ]);
  } else if (catalogueFact?.value.includes('not installed')) {
    markStage(stages, 'catalogue', 'skipped', ['Fingerprint database not installed.']);
  } else {
    markStage(stages, 'catalogue', 'done', [
      'No database fingerprint matched — title is not verified.',
    ]);
  }
  markStage(stages, 'analysis', 'done', [
    `${considered.length} execution path(s) evaluated`,
    `${accepted.length} runnable`,
  ]);

  const recompilerCandidates = considered.filter((c) => c.kind === 'static-recompilation');
  if (descriptor && descriptor.kind === 'static-recompilation') {
    markStage(stages, 'transpile', 'blocked', N64RECOMP_DESCRIPTOR.limitations);
    stages.find((s) => s.id === 'transpile')!.requiresService = true;
  } else if (recompilerCandidates.length > 0) {
    // A recompiler exists for this platform but cannot run here: say so on the
    // stage itself instead of leaving it looking like an unstarted job.
    markStage(
      stages,
      'transpile',
      'blocked',
      recompilerCandidates.flatMap((c) => c.blockers.map((b) => `${c.engineName}: ${b}`)),
    );
    stages.find((s) => s.id === 'transpile')!.requiresService = true;
  } else if (descriptor) {
    markStage(stages, 'transpile', 'skipped', [
      'Not applicable: the selected method is emulation, not recompilation.',
    ]);
  }
  markStage(stages, 'validate', 'pending', [
    'Verification runs on first PLAY (boot, video, audio, input, save).',
  ]);

  const summary = descriptor
    ? `${METHOD_LABELS[descriptor.kind]} selected: ${descriptor.name}.`
    : 'No runnable execution path in this browser/deployment.';

  return {
    plan: {
      id: `plan_${report.id}`,
      reportId: report.id,
      createdAt: Date.now(),
      target: descriptor && chosen
        ? {
            descriptor,
            method: descriptor.kind,
            methodLabel: METHOD_LABELS[descriptor.kind],
            runnable: true,
          }
        : null,
      considered,
      stages,
      summary,
      executionStatement: descriptor
        ? executionStatement(descriptor.kind, descriptor)
        : rejectedStatement(considered),
    },
    engine: descriptor,
  };
}

function rejectedStatement(considered: JobPlan['considered']): string {
  if (!considered.length) return 'No execution engine supports this platform in this release.';
  const lines = considered.slice(0, 4).map((c) => `• ${c.engineName}: ${c.blockers[0] ?? 'unavailable'}`);
  return ['No runnable path was found. Reasons recorded:', ...lines].join('\n');
}

function baseStages(report: AnalysisReport): JobStage[] {
  const hasCatalogue = Boolean(report.identification.catalogueMatch);
  return [
    { id: 'fingerprint', label: 'Fingerprint', tool: 'Recompa checksum engine', status: 'pending', output: [] },
    { id: 'structure', label: 'Container & header structure', tool: 'Recompa format detectors', status: 'pending', output: [] },
    {
      id: 'catalogue',
      label: 'Fingerprint database lookup',
      tool: `No-Intro DAT (${hasCatalogue ? 'match' : 'consulted'})`,
      status: 'pending',
      output: [],
    },
    { id: 'analysis', label: 'Execution path analysis', tool: 'Recompa planner', status: 'pending', output: [] },
    {
      id: 'transpile',
      label: 'Recompilation / translation',
      tool: 'Platform toolchain',
      status: 'pending',
      output: [],
    },
    { id: 'validate', label: 'Runtime validation', tool: 'Recompa test harness', status: 'pending', output: [] },
  ];
}

function markStage(stages: JobStage[], id: JobStage['id'], status: JobStage['status'], output: string[]) {
  const stage = stages.find((s) => s.id === id);
  if (!stage) return;
  stage.status = status;
  stage.output = output;
  if (status === 'done' || status === 'failed' || status === 'skipped' || status === 'blocked') {
    stage.finishedAt = Date.now();
  }
}

export function descriptorsForUi(): EngineDescriptor[] {
  return ALL_DESCRIPTORS;
}
