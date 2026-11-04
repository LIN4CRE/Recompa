import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertOctagon,
  Check,
  Download,
  HardDriveDownload,
  Keyboard,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useSettings } from '@/state/settings';
import { useLibrary } from '@/state/library';
import { DEFAULT_KEYBINDINGS, RESERVED_CODES, type LogicalButton } from '@/engines/input';
import { clearAllData, estimateStorage, exportBackup, importBackup, totalPayloadBytes } from '@/db/database';
import { bytes, Panel, SectionHeader, Tabs } from '../components/primitives';
import { ProcessingPanel } from '../components/ProcessingPanel';
import { detectEnvironment } from '@/core/environment';
import type { RuntimeEnvironment } from '@/core/types';

type Tab = 'playback' | 'controls' | 'data' | 'advanced';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('playback');
  const { settings, update, reset, resetKeybindings } = useSettings();
  const games = useLibrary((s) => s.games);
  const hydrate = useLibrary((s) => s.hydrate);
  const pushToast = useLibrary((s) => s.pushToast);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [payloadBytes, setPayloadBytes] = useState<number | null>(null);
  const [env, setEnv] = useState<RuntimeEnvironment | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  useEffect(() => {
    void estimateStorage().then(setStorage);
    void totalPayloadBytes().then(setPayloadBytes);
    void detectEnvironment().then(setEnv);
  }, [games.length]);

  return (
    <div className="space-y-4">
      <div>
        <div className="mono-label mb-1">Configuration</div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-3">
          Everything is stored on this device. There is no account, no sync and no telemetry.
        </p>
      </div>

      <Tabs
        tabs={[
          { id: 'playback', label: 'Playback & video' },
          { id: 'controls', label: 'Controls' },
          { id: 'data', label: 'Data & storage' },
          { id: 'advanced', label: 'Advanced' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'playback' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="p-4">
            <SectionHeader eyebrow="Video" title="Presentation" />
            <Field label="Scaling">
              <select className="input" value={settings.videoScale} onChange={(e) => update({ videoScale: e.target.value as never })}>
                <option value="auto">Auto — fit the container</option>
                <option value="native">Native resolution</option>
                <option value="pixel-perfect">Pixel perfect (integer)</option>
              </select>
            </Field>
            <Field label="Aspect ratio">
              <select className="input" value={settings.aspect} onChange={(e) => update({ aspect: e.target.value as never })}>
                <option value="auto">Auto (per platform)</option>
                <option value="4:3">4:3</option>
                <option value="16:9">16:9</option>
                <option value="stretch">Stretch</option>
              </select>
            </Field>
            <Field label="Filters">
              <select className="input" value={settings.filters} onChange={(e) => update({ filters: e.target.value as never })}>
                <option value="off">Off — sharp nearest-neighbour</option>
                <option value="scanlines">Scanlines overlay</option>
                <option value="smooth">Smooth (bilinear)</option>
              </select>
            </Field>
            <Toggle
              label="Show FPS overlay"
              description="Draws the measured frame rate on the video surface."
              checked={settings.showFps}
              onChange={(v) => update({ showFps: v })}
            />
            <Toggle
              label="Enter fullscreen on launch"
              description="Some browsers require a click first; Recompa falls back gracefully."
              checked={settings.autoFullscreen}
              onChange={(v) => update({ autoFullscreen: v })}
            />
          </Panel>

          <Panel className="p-4">
            <SectionHeader eyebrow="Audio & input" title="Feel" />
            <Field label={`Volume — ${Math.round(settings.volume * 100)}%`}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.volume}
                onChange={(e) => update({ volume: Number(e.target.value) })}
                className="w-full accent-[#d6ff4b]"
              />
            </Field>
            <Toggle
              label="Audio enabled"
              description="Disabling audio removes the audio thread entirely (frees CPU)."
              checked={settings.audioEnabled}
              onChange={(v) => update({ audioEnabled: v })}
            />
            <Field label="Audio buffer">
              <select
                className="input"
                value={String(settings.audioBufferSamples)}
                onChange={(e) => update({ audioBufferSamples: Number(e.target.value) as never })}
              >
                <option value="512">512 samples — lowest latency</option>
                <option value="1024">1024 samples — balanced</option>
                <option value="2048">2048 samples — most stable</option>
              </select>
            </Field>
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-ink-4">
              Effective latency ≈ {(settings.audioBufferSamples / 44.1).toFixed(1)} ms buffer + output device latency. Cross-origin
              isolation changes the path to an AudioWorklet ring buffer.
            </p>
            <Field label="Touch controls">
              <select className="input" value={settings.touchControls} onChange={(e) => update({ touchControls: e.target.value as never })}>
                <option value="auto">Auto-detect pointer type</option>
                <option value="on">Always show</option>
                <option value="off">Never show</option>
              </select>
            </Field>
            <Field label={`Gamepad deadzone — ${settings.gamepadDeadzone.toFixed(2)}`}>
              <input
                type="range"
                min={0}
                max={0.8}
                step={0.05}
                value={settings.gamepadDeadzone}
                onChange={(e) => update({ gamepadDeadzone: Number(e.target.value) })}
                className="w-full accent-[#6fd3ff]"
              />
            </Field>
          </Panel>
        </div>
      )}

      {tab === 'controls' && <ControlsTab />}

      {tab === 'data' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="p-4">
            <SectionHeader eyebrow="Storage" title="What is on this device" />
            <div className="space-y-2">
              <StatRow label="Games in library" value={String(games.length)} />
              <StatRow label="ROM bytes stored" value={payloadBytes !== null ? bytes(payloadBytes) : 'reading…'} />
              <StatRow label="Origin usage" value={storage ? bytes(storage.usage) : 'unavailable'} />
              <StatRow label="Origin quota" value={storage ? bytes(storage.quota) : 'unavailable'} />
              <StatRow label="Database" value="IndexedDB · non-persistent" />
            </div>
            {storage && (
              <div className="mt-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
                  <div className="h-full rounded-full bg-ice" style={{ width: `${Math.min(100, (storage.usage / storage.quota) * 100)}%` }} />
                </div>
                {storage.quota - storage.usage < 200 * 1024 * 1024 && (
                  <p className="mt-1.5 flex items-center gap-1 text-[10px] text-amber">
                    <AlertOctagon className="size-3" /> Little headroom left — large ROMs may fail to store.
                  </p>
                )}
              </div>
            )}
            <Toggle
              label="Store ROM bytes after analysis"
              description="Required to play from the library. Turning this off keeps analysis reports only."
              checked={settings.storePayloads}
              onChange={(v) => update({ storePayloads: v })}
            />
            <Toggle
              label="Store save states"
              description="States are kept in IndexedDB with thumbnails."
              checked={settings.storeStates}
              onChange={(v) => update({ storeStates: v })}
            />
            <Toggle
              label="Analyse immediately when a file is dropped"
              description="Off = you confirm each file before hashing."
              checked={settings.autoAnalyze}
              onChange={(v) => update({ autoAnalyze: v })}
            />
          </Panel>

          <Panel className="p-4">
            <SectionHeader eyebrow="Portability" title="Backup & restore" description="Saves, metadata and settings — never ROM bytes." />
            <div className="flex flex-wrap gap-2">
              <button
                className="btn btn-sm"
                onClick={async () => {
                  const blob = await exportBackup();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `recompa-backup-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="size-3.5" /> Export backup
              </button>
              <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                <Upload className="size-3.5" /> Import backup
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const result = await importBackup(file);
                    await hydrate();
                    pushToast({
                      kind: 'success',
                      title: `Imported ${result.games} games, ${result.sram} saves`,
                      message: result.warnings[0],
                    });
                  } catch (error) {
                    pushToast({ kind: 'error', title: 'Import failed', message: (error as Error).message });
                  }
                  e.target.value = '';
                }}
              />
            </div>
            <div className="mt-4 rounded-lg border border-rose/25 bg-rose/[0.05] p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-rose">
                <HardDriveDownload className="size-3.5" /> Erase local data
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
                Deletes every stored ROM, report, save, state and setting in this browser. This cannot be undone.
              </p>
              {confirmWipe ? (
                <div className="mt-2 flex gap-2">
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={async () => {
                      await clearAllData();
                      await hydrate();
                      setConfirmWipe(false);
                      pushToast({ kind: 'success', title: 'Local data erased' });
                    }}
                  >
                    <Trash2 className="size-3.5" /> Yes, erase everything
                  </button>
                  <button className="btn btn-sm" onClick={() => setConfirmWipe(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="btn btn-sm mt-2" onClick={() => setConfirmWipe(true)}>
                  Erase…
                </button>
              )}
            </div>
          </Panel>
        </div>
      )}

      {tab === 'advanced' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="p-4">
            <SectionHeader eyebrow="Runtime" title="Measured capabilities" description="Values read from the live browser APIs, not from a product name." />
            {env ? (
              <div className="space-y-1">
                <StatRow label="WebAssembly" value={env.webAssembly ? 'supported' : 'missing'} />
                <StatRow label="WASM SIMD" value={env.wasmSimd ? 'supported' : 'not detected'} />
                <StatRow label="WASM threads" value={env.wasmThreads ? 'supported' : 'not detected'} />
                <StatRow label="SharedArrayBuffer" value={env.sharedArrayBuffer ? 'available' : 'blocked'} />
                <StatRow label="Cross-origin isolated" value={env.crossOriginIsolated ? 'yes' : 'no'} />
                <StatRow label="WebGPU" value={env.webgpu ? 'adapter available' : 'unavailable'} />
                <StatRow label="WebGL2 / WebGL1" value={`${env.webgl2 ? 'yes' : 'no'} / ${env.webgl1 ? 'yes' : 'no'}`} />
                <StatRow label="AudioWorklet" value={env.audioWorklet ? 'yes' : 'no'} />
                <StatRow label="IndexedDB" value={env.indexedDb ? 'yes' : 'no'} />
                <StatRow label="OffscreenCanvas" value={env.offscreenCanvas ? 'yes' : 'no'} />
                <StatRow label="Gamepad API" value={env.gamepadApi ? 'yes' : 'no'} />
                <StatRow label="Logical cores" value={env.cores ? String(env.cores) : 'unknown'} />
                <StatRow label="Device memory" value={env.deviceMemoryGb ? `${env.deviceMemoryGb} GB` : 'not exposed'} />
                <StatRow label="GPU renderer" value={env.gpuRenderer ?? 'masked by browser'} />
              </div>
            ) : (
              <p className="text-xs text-ink-3">Probing…</p>
            )}
          </Panel>

          <Panel className="p-4">
            <SectionHeader eyebrow="Verification" title="Test window" />
            <Field label={`Observation window — ${settings.testDurationSeconds}s`}>
              <input
                type="range"
                min={6}
                max={60}
                step={2}
                value={settings.testDurationSeconds}
                onChange={(e) => update({ testDurationSeconds: Number(e.target.value) })}
                className="w-full accent-[#d6ff4b]"
              />
            </Field>
            <p className="text-[11px] leading-relaxed text-ink-3">
              Longer windows catch hangs that only appear after an intro. The harness samples video twice per second and records each
              measurement.
            </p>

            <div className="mt-4 rounded-lg border border-line bg-black/20 p-3">
              <Field label="Service endpoint">
                <input
                  className="input font-mono text-xs"
                  placeholder="http://127.0.0.1:7333"
                  value={settings.externalProcessingEndpoint}
                  onChange={(e) => update({ externalProcessingEndpoint: e.target.value })}
                />
              </Field>
              <Toggle
                label="Allow explicit server-side processing"
                description="Off = the UI never offers to send a file anywhere."
                checked={settings.enableExternalProcessing}
                onChange={(v) => update({ enableExternalProcessing: v })}
              />
              <p className="mt-1 font-mono text-[10px] leading-relaxed text-ink-4">
                Start with <code className="text-ink-2">npm run serve:processing</code>. Loopback-only by default.
              </p>
            </div>

            <div className="mt-4 flex gap-2">
              <button className="btn btn-sm" onClick={resetKeybindings}>
                <RotateCcw className="size-3.5" /> Reset keybindings
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => reset()}>
                Reset all settings
              </button>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'advanced' && (
        <div className="mt-3">
          <ProcessingPanel />
        </div>
      )}
    </div>
  );
}

function ControlsTab() {
  const { settings, setKeybinding, resetKeybindings } = useSettings();
  const [listening, setListening] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    if (!listening) return;
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setListening(null);
        return;
      }
      if (RESERVED_CODES.has(event.code) || event.code === 'Escape') {
        setConflict(`${event.code} is reserved by the browser or the app.`);
        return;
      }
      const existing = Object.entries(settings.keybindings).find(([button, code]) => code === event.code && button !== listening);
      setKeybinding(listening, event.code);
      setConflict(existing ? `${event.code} was reassigned from ${existing[0]}.` : null);
      setListening(null);
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true } as never);
  }, [listening, setKeybinding, settings.keybindings]);

  const buttons = Object.keys(DEFAULT_KEYBINDINGS) as LogicalButton[];

  return (
    <Panel className="p-4">
      <SectionHeader
        eyebrow="Input"
        title="Keyboard bindings"
        description="Click a binding and press a key. Bindings are shared across every game; gamepads use the standard W3C layout automatically."
        actions={
          <button className="btn btn-sm" onClick={resetKeybindings}>
            <RotateCcw className="size-3.5" /> Defaults
          </button>
        }
      />
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {buttons.map((button) => (
          <div key={button} className="flex items-center justify-between rounded-lg border border-line bg-black/20 px-2.5 py-2">
            <span className="font-mono text-[11px] text-ink-2">{labelFor(button)}</span>
            <button
              onClick={() => {
                setListening(button);
                setConflict(null);
              }}
              className={clsx(
                'min-w-24 rounded border px-2 py-1 font-mono text-[10px] transition-colors',
                listening === button
                  ? 'animate-pulse border-lime/60 bg-lime/15 text-lime'
                  : 'border-line-bright bg-panel-2 text-ink-2 hover:border-ice/50 hover:text-ice',
              )}
            >
              {listening === button ? 'press a key…' : prettyKey(settings.keybindings[button] ?? '—')}
            </button>
          </div>
        ))}
      </div>
      {conflict && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber">
          <AlertOctagon className="size-3" /> {conflict}
        </p>
      )}
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-black/20 p-2.5">
        <Keyboard className="mt-0.5 size-3.5 shrink-0 text-ink-4" />
        <p className="text-[10px] leading-relaxed text-ink-4">
          Player shortcuts: <span className="kbd">Esc</span> exits fullscreen, <span className="kbd">P</span> pauses,{' '}
          <span className="kbd">F2</span> saves a state, <span className="kbd">F4</span> loads the newest state. These are handled by
          the player shell, not the emulator, so they cannot clash with in-game input.
        </p>
      </div>
    </Panel>
  );
}

function labelFor(button: string): string {
  const map: Record<string, string> = {
    UP: 'D-pad up',
    DOWN: 'D-pad down',
    LEFT: 'D-pad left',
    RIGHT: 'D-pad right',
    A: 'A button',
    B: 'B button',
    X: 'X button',
    Y: 'Y button',
    L: 'L shoulder',
    R: 'R shoulder',
    L2: 'L2 trigger',
    R2: 'R2 trigger',
    START: 'Start',
    SELECT: 'Select',
    L3: 'L3 stick',
    R3: 'R3 stick',
  };
  return map[button] ?? button;
}

function prettyKey(code: string): string {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Arrow/, '')
    .replace('ShiftRight', 'R-Shift')
    .replace('ShiftLeft', 'L-Shift')
    .replace('Space', 'Space')
    .replace('Enter', 'Enter');
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mono-label mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="mb-2 flex w-full items-start justify-between gap-3 rounded-lg border border-line bg-black/15 px-2.5 py-2 text-left transition-colors hover:border-line-bright"
    >
      <span className="min-w-0">
        <span className="block text-[11px] font-medium text-ink-2">{label}</span>
        {description && <span className="mt-0.5 block text-[10px] leading-relaxed text-ink-4">{description}</span>}
      </span>
      <span
        className={clsx(
          'mt-0.5 grid h-4 w-7 shrink-0 place-items-center rounded-full border transition-colors',
          checked ? 'border-lime/60 bg-lime/25' : 'border-line-bright bg-panel-2',
        )}
      >
        <span className={clsx('size-2 rounded-full transition-transform', checked ? 'translate-x-1 bg-lime' : '-translate-x-1 bg-ink-4')}>
          {checked && <Check className="size-2 text-[#10160a]" />}
        </span>
      </span>
    </button>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1 last:border-0">
      <span className="text-[11px] text-ink-3">{label}</span>
      <span className="font-mono text-[10px] break-all text-right text-ink-2">{value}</span>
    </div>
  );
}
