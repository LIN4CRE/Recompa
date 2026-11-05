/**
 * Core domain types for Recompa.
 *
 * Everything here is measurable fact: file bytes, computed hashes, capability
 * declarations read from adapters. There is deliberately no field that stores a
 * "score" the UI can invent — compatibility states are derived from recorded
 * test runs, never estimated.
 */

export type PlatformId =
  | 'nes'
  | 'snes'
  | 'gb'
  | 'gbc'
  | 'gba'
  | 'n64'
  | 'nds'
  | 'genesis'
  | 'sms'
  | 'gg'
  | 'pce'
  | 'psx'
  | 'psp'
  | 'atari2600'
  | 'atari7800'
  | 'lynx'
  | 'ws'
  | 'vb'
  | 'ngp'
  | 'arcade'
  | 'unknown';

export interface Platform {
  id: PlatformId;
  name: string;
  manufacturer: string;
  generation: number;
  releaseYear: number;
  /** Human list of media/file containers the console used. */
  mediaFormats: string[];
  /** Extensions we will attempt to identify (lower-case, without dot). */
  extensions: string[];
  /** Typical ROM size range in bytes, used only to *warn* on odd sizes. */
  romSizeRange?: [number, number];
  /** Firmware the platform needs to boot software (user must supply). */
  requiredFirmware?: FirmwareRequirement[];
  notes?: string;
}

export interface FirmwareRequirement {
  /** Short name, e.g. "PS1 BIOS (SCPH-5501)". */
  name: string;
  /** Byte size(s) known to be valid. */
  sizes: number[];
  /** Known SHA-1 values used to recognise a supplied file (never downloaded by us). */
  knownHashes?: Record<string, string>;
  reason: string;
  /** Whether the platform/engine can run without it (partial support). */
  optional: boolean;
}

export type ChecksumAlgorithm = 'crc32' | 'md5' | 'sha1' | 'sha256';

export interface Checksums {
  crc32: string;
  md5: string;
  sha1: string;
  sha256: string;
  /** Size of the hashed payload (after header stripping where relevant). */
  size: number;
}

export type DependencyStatus = 'missing' | 'supplied' | 'not-required';

export interface RomDependency {
  id: string;
  name: string;
  reason: string;
  required: boolean;
  /** What file the user should add (e.g. "scph5501.bin"). */
  expectedFileName?: string;
  acceptedSizes?: number[];
  /** Where the dependency is satisfied from — set once a file is attached. */
  suppliedBy?: string;
}

export interface DetectedFormat {
  /** Stable detector id, e.g. "ines", "n64-be", "gb". */
  id: string;
  label: string;
  /** Container vs raw payload. */
  kind: 'container' | 'raw' | 'archive' | 'executable';
  confidence: 'certain' | 'probable' | 'possible';
  evidence: string[];
}

export interface HeaderInfo {
  /** Number of bytes stripped to reach the canonical ROM payload. */
  strippedBytes: number;
  /** Extra structured fields the detector could read (mapper, region, ...). */
  fields: Record<string, string | number | boolean | null>;
  /** Non-fatal findings worth showing in the report. */
  warnings: string[];
}

export type RegionCode =
  | 'JP'
  | 'US'
  | 'EU'
  | 'AU'
  | 'KR'
  | 'CN'
  | 'BR'
  | 'WORLD'
  | 'UNKNOWN';

export interface Identification {
  title: string | null;
  /** How the title was obtained — never claim more certainty than we have. */
  titleSource: 'database' | 'header' | 'filename' | 'none';
  region: RegionCode;
  regionSource: 'header' | 'filename' | 'database' | 'none';
  version: string | null;
  serial: string | null;
  /** Catalogue entry the hashes matched, if any. */
  catalogueMatch: CatalogueMatch | null;
}

export interface CatalogueMatch {
  entryId: string;
  name: string;
  region: string;
  version: string;
  /** Which checksum matched. */
  matchedOn: ChecksumAlgorithm;
  /** True when the matched entry is not a commercial game (homebrew/test ROM). */
  kind: 'commercial' | 'homebrew' | 'test-rom' | 'public-domain';
  licence: string | null;
  source: string;
}

export interface AnalysisReport {
  schemaVersion: 1;
  id: string;
  createdAt: number;
  /** Original file name as supplied by the user. */
  fileName: string;
  fileSize: number;
  /** Detected platform, or null with reason when undetermined. */
  platform: Platform | null;
  platformConfidence: 'certain' | 'probable' | 'unknown';
  platformEvidence: string[];
  format: DetectedFormat | null;
  /** Unknown/ambiguous formats carry an actionable error, not a guess. */
  errors: TechnicalError[];
  header: HeaderInfo;
  checksums: Checksums;
  identification: Identification;
  dependencies: RomDependency[];
  /** Entries describing what the payload *is* (e.g. "iNES mapper 4"). */
  facts: Array<{ label: string; value: string }>;
  /** Zip member info when the upload was an archive. */
  archive?: { entries: ArchiveEntry[]; selectedEntry: string | null };
  /**
   * Set when the upload was a disc set (a cue sheet plus its tracks, or a
   * multi-disc playlist). Records which files belonged together so the library
   * can show the real disc rather than one track of it.
   */
  discSet?: {
    entry: string;
    files: string[];
    multiTrack: boolean;
    trackCount: number;
  };
  /** Folder (relative to a scanned root) this game was found in, if any. */
  folder?: string;
}

export interface ArchiveEntry {
  name: string;
  size: number;
  /** CRC32 from the zip directory, when present. */
  crc32?: number;
  /** Whether Recompa chose this entry as the game payload. */
  selected: boolean;
  /** Why it was skipped (e.g. "not a ROM extension"). */
  skippedReason?: string;
}

export type TechnicalErrorSeverity = 'info' | 'warning' | 'error' | 'fatal';

export interface TechnicalError {
  code: string;
  severity: TechnicalErrorSeverity;
  message: string;
  detail?: string;
  /** Concrete next step for the user. */
  remedy?: string;
}

/* ------------------------------------------------------------------ */
/* Catalogue of known ROM fingerprints                                 */
/* ------------------------------------------------------------------ */

export interface CatalogueEntry {
  id: string;
  platform: PlatformId;
  title: string;
  region: string;
  version: string;
  kind: CatalogueMatch['kind'];
  licence: string | null;
  source: string;
  /** Hashes of the canonical payload. At least one is required. */
  hashes: Partial<Record<ChecksumAlgorithm, string>>;
  /** Byte size of the canonical payload (strong pre-filter). */
  size: number;
  notes?: string;
}

export interface CatalogueFile {
  schemaVersion: 1;
  /** Where the data came from and when it was generated. */
  generatedAt: string;
  entries: CatalogueEntry[];
}

/* ------------------------------------------------------------------ */
/* Execution engines                                                   */
/* ------------------------------------------------------------------ */

export type ExecutionKind =
  | 'browser-native-recompilation'
  | 'static-recompilation'
  | 'source-port-wasm'
  | 'wasm-emulator'
  | 'js-emulator'
  | 'external-tool';

/**
 * Every engine declares exactly what it is. The planner refuses to present a
 * `wasm-emulator` as a recompiler, and the UI prints this value verbatim
 * ("Emulation — mGBA 0.10 (WASM)") so there is never a claim mismatch.
 */
export interface EngineDescriptor {
  id: string;
  name: string;
  /** e.g. "mGBA", "jsnes", "N64Recomp". */
  project: string;
  version: string;
  kind: ExecutionKind;
  licence: string;
  homepage: string;
  /** Platforms this adapter genuinely executes. */
  platforms: PlatformId[];
  /** Containers it accepts (extension list, lower-case). */
  accepts: string[];
  needsFirmware: boolean;
  supports: {
    saveStates: boolean;
    sramSaves: boolean;
    screenshots: boolean;
    gamepad: boolean;
    touch: boolean;
    rewind: boolean;
    audio: boolean;
    /** Runs inside a Web Worker (main thread stays responsive). */
    worker: boolean;
    /** Utilises WebGL/WebGPU for output. */
    gpu: boolean;
    /** Uses WebAssembly. */
    wasm: boolean;
  };
  /** Measured or documented performance notes, never marketing. */
  performanceNotes: string;
  /** Where the finished binary lives, relative to the site root. */
  assetPath?: string;
  /** Installed at build/serve time by scripts/fetch-*.mjs. */
  installHint?: string;
  available: boolean;
  unavailableReason?: string;
  /** Engine-specific limitations we have verified. */
  limitations: string[];
}

/** What an engine adapter can actually do at runtime. */
export interface EngineRunOptions {
  /** Canonical ROM payload (header stripped where the format defines one). */
  rom: Uint8Array;
  /** Original file name, used by engines that key save files on it. */
  fileName: string;
  /** Extra files keyed by dependency id. */
  dependencies?: Record<string, Uint8Array>;
  /** Host element that the adapter may attach a canvas to. */
  canvas: HTMLCanvasElement;
  audio: boolean;
  volume: number;
  /**
   * Requested audio buffer in frames for cores that use a ScriptProcessorNode
   * fallback (see `src/engines/audio.ts`). Adapters that render audio inside
   * their own worklet ignore it rather than pretending to honour it.
   */
  audioBufferSamples?: number;
  /** Persisted SRAM (battery save) if the user has one. */
  savedSram?: Uint8Array | null;
  /** Region/format facts from the analysis report. */
  format: DetectedFormat | null;
  header: HeaderInfo;
  signal: AbortSignal;
}

export interface EngineCallbacks {
  onFrame?: (timing: FrameTiming) => void;
  onAudio?: (latencyMs: number) => void;
  onSramChanged?: (sram: Uint8Array) => void;
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
  onError?: (error: Error) => void;
}

export interface FrameTiming {
  /** Monotonic timestamp of the frame callback (ms). */
  at: number;
  /** Emulated frames produced since last report. */
  frames: number;
}

export interface EngineSession {
  descriptor: EngineDescriptor;
  /** Engine-native state (emulator handle), opaque to the shell. */
  readonly raw: unknown;
  pause(): void;
  resume(): void;
  reset(): void;
  setVolume(v: number): void;
  setInput(port: number, button: string, pressed: boolean): void;
  /** Capture a full save state; null when unsupported by the engine. */
  saveState(): Promise<Uint8Array | null>;
  loadState(state: Uint8Array): Promise<boolean>;
  /** Battery-backed save (SRAM), if the engine exposes it. */
  readSram(): Promise<Uint8Array | null>;
  writeSram(sram: Uint8Array): Promise<void>;
  screenshot(): Promise<Blob | null>;
  setFastForward(multiplier: number): void;
  setQuality?(setting: 'auto' | 'native' | 'smooth'): void;
  /** Real measurements accumulated by the adapter. */
  stats(): EngineStats;
  destroy(): Promise<void>;
}

export interface EngineStats {
  fps: number;
  frameTimeMs: number;
  /** Emulated audio sample rate actually delivered. */
  audioSampleRate: number | null;
  /** Milliseconds of audio buffered ahead of playback (null if unmeasurable). */
  audioLatencyMs: number | null;
  videoMode: string;
  extra: Record<string, string | number | null>;
}

export type EngineFactory = (options: EngineRunOptions, callbacks: EngineCallbacks) => Promise<EngineSession>;

export interface EngineAdapter {
  descriptor: EngineDescriptor;
  /**
   * Cheap pre-flight check: can this adapter run the given ROM right now in
   * this browser? Must not allocate emulator memory.
   */
  canRun(input: EngineCandidateInput): EngineCandidate;
  create: EngineFactory;
}

export interface EngineCandidateInput {
  report: AnalysisReport;
  platform: Platform | null;
  /** Feature flags discovered at runtime. */
  environment: RuntimeEnvironment;
  /**
   * Whether the platform's firmware requirement is already satisfied on this
   * device. Resolved asynchronously by the caller (IndexedDB read) because
   * `canRun` is synchronous and must stay allocation-free.
   */
  biosInstalled?: boolean;
}

export interface EngineCandidate {
  engineId: string;
  runnable: boolean;
  /** Blocking reasons (dependency missing, unsupported mapper...). */
  blockers: string[];
  /** Non-blocking caveats. */
  notes: string[];
}

export interface RuntimeEnvironment {
  webAssembly: boolean;
  wasmSimd: boolean;
  wasmThreads: boolean;
  sharedArrayBuffer: boolean;
  crossOriginIsolated: boolean;
  webgpu: boolean;
  webgl2: boolean;
  webgl1: boolean;
  audioWorklet: boolean;
  indexedDb: boolean;
  offscreenCanvas: boolean;
  gamepadApi: boolean;
  touch: boolean;
  cores: number | null;
  deviceMemoryGb: number | null;
  gpuRenderer: string | null;
  userAgentClass: 'desktop' | 'mobile' | 'tablet';
}

/* ------------------------------------------------------------------ */
/* Recompilation jobs                                                  */
/* ------------------------------------------------------------------ */

export type JobStageId =
  | 'fingerprint'
  | 'structure'
  | 'catalogue'
  | 'analysis'
  | 'transpile'
  | 'validate';

export interface JobStage {
  id: JobStageId;
  label: string;
  /** Tool actually responsible, e.g. "N64Recomp 1.x". */
  tool: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'blocked';
  startedAt?: number;
  finishedAt?: number;
  /** Real records produced, not simulated percentages. */
  output: string[];
  error?: string;
  /** True when the stage cannot run in this deployment (needs external tool). */
  requiresService?: boolean;
}

export interface JobPlan {
  id: string;
  reportId: string;
  createdAt: number;
  target: {
    descriptor: EngineDescriptor;
    method: ExecutionKind;
    /** Human verb for the method: "Static recompilation", "WebAssembly emulation". */
    methodLabel: string;
    runnable: boolean;
  } | null;
  /** Ordered considered options with hard reasons for rejection. */
  considered: Array<{
    engineId: string;
    engineName: string;
    kind: ExecutionKind | 'tool-chain';
    priority: number;
    accepted: boolean;
    blockers: string[];
    notes: string[];
  }>;
  stages: JobStage[];
  summary: string;
  /** Explicit statement of what will happen when PLAY is pressed. */
  executionStatement: string;
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled';

export interface Job {
  id: string;
  reportId: string;
  gameId: string | null;
  createdAt: number;
  updatedAt: number;
  status: JobStatus;
  plan: JobPlan;
  stages: JobStage[];
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Games, saves, tests                                                 */
/* ------------------------------------------------------------------ */

export type CompatibilityState =
  | 'not-tested'
  | 'analysis-complete'
  | 'compatible'
  | 'partially-compatible'
  | 'incompatible'
  | 'requires-files'
  | 'recompilation-available';

export interface StoredPayload {
  id: string;
  /** Always the canonical (header-stripped) payload. */
  bytes: Blob;
  size: number;
  sha256: string;
}

/**
 * A user-supplied firmware image (e.g. a PlayStation BIOS dump).
 *
 * Recompa never bundles, downloads or substitutes these: the user must own the
 * hardware. They are stored locally in IndexedDB and never leave the device.
 */
export interface BiosRecord {
  /** Stable id: `${platformId}:${kind}` — one image per console. */
  id: string;
  platformId: PlatformId;
  /** Human label, e.g. "Sony PlayStation BIOS". */
  label: string;
  /** Original file name as supplied by the user. */
  fileName: string;
  size: number;
  sha256: string;
  /** Bytes, held as a Blob so large images are not kept as live arrays. */
  bytes: Blob;
  addedAt: number;
  /** What we could prove about it at import time. */
  validation: {
    sizeAccepted: boolean;
    /** Notes shown in the UI — e.g. which SCPH model this size usually is. */
    notes: string[];
  };
}

export interface GameRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  lastPlayedAt: number | null;
  favourite: boolean;
  title: string;
  platformId: PlatformId;
  /** Report id this game was created from. */
  reportId: string;
  /** Payload key in IndexedDB (`payloads`). */
  payloadId: string;
  /** Engine used last time, null before first run. */
  engineId: string | null;
  compatibility: CompatibilityState;
  /** Id of the test-run record that justified `compatibility`. */
  verifiedBy?: string | null;
  cover: CoverRecord | null;
  playSeconds: number;
  playCount: number;
  /** Last analysis facts needed to plan without re-reading the ROM. */
  facts: Array<{ label: string; value: string }>;
  region: RegionCode;
  notes?: string;
}

export interface CoverRecord {
  kind: 'none' | 'url' | 'user' | 'capture';
  value: string | null;
  /** Provenance so nothing appears out of nowhere. */
  source: string;
  updatedAt: number;
}

/**
 * A recorded, real test execution. `observations` are produced by the test
 * pipeline from actual frames/samples, never typed in by hand.
 */
export interface TestRun {
  id: string;
  gameId: string | null;
  reportId: string;
  engineId: string;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'passed' | 'failed' | 'error' | 'skipped';
  checks: TestCheck[];
  environment: {
    userAgent: string;
    cores: number | null;
    webgpu: boolean;
    crossOriginIsolated: boolean;
    fps: number;
  };
  log: string[];
}

export interface TestCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'skip';
  /** Measured value that justified the status. */
  measured: string;
  detail?: string;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface AppSettings {
  /**
   * 'auto' fits the stage, 'native' is one canvas pixel per CSS pixel and
   * 'pixel-perfect' takes the largest integer multiple that fits.
   * See `src/ui/player/layout.ts`.
   */
  videoScale: 'auto' | 'native' | 'pixel-perfect';
  /** 'auto' resolves per platform in `resolveAspect()`. */
  aspect: 'auto' | '4:3' | '16:9' | 'stretch';
  filters: 'off' | 'scanlines' | 'smooth';
  audioEnabled: boolean;
  volume: number;
  audioBufferSamples: 512 | 1024 | 2048;
  showFps: boolean;
  /** Fullscreen on PLAY. */
  autoFullscreen: boolean;
  touchControls: 'auto' | 'on' | 'off';
  keybindings: Keybindings;
  gamepadDeadzone: number;
  /** Hold a Screen Wake Lock while a game is running. */
  keepScreenAwake: boolean;
  /** Analyse dropped files immediately; off = confirm before hashing. */
  autoAnalyze: boolean;
  /** Keep ROM bytes in IndexedDB after analysis (required to play later). */
  storePayloads: boolean;
  /** Keep save states in IndexedDB. */
  storeStates: boolean;
  testDurationSeconds: number;
  externalProcessingEndpoint: string;
  enableExternalProcessing: boolean;
}

export interface Keybindings {
  /** Map of engine button name -> keyboard code. */
  [action: string]: string;
}

export interface SaveStateRecord {
  id: string;
  gameId: string;
  engineId: string;
  createdAt: number;
  slot: number;
  thumbnail: string | null;
  bytes: Uint8Array;
}

export interface SramRecord {
  gameId: string;
  engineId: string;
  updatedAt: number;
  bytes: Uint8Array;
}
