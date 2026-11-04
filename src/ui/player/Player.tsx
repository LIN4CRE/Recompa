import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  Camera,
  ChevronLeft,
  Gauge,
  Gamepad2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import type { AnalysisReport, GameRecord, SaveStateRecord } from '@/core/types';
import { useEmulator, mapButton } from './useEmulator';
import { EmulatorStage } from './EmulatorStage';
import { TouchControls } from './TouchControls';
import { useSettings } from '@/state/settings';
import { useLibrary } from '@/state/library';
import { GamepadInput, KeyboardInput, type LogicalButton } from '@/engines/input';
import { listStates, putState, deleteState } from '@/db/database';
import { bytes, CompatBadge, MethodBadge, Spinner } from '../components/primitives';
import { navigate } from '@/lib/router';
import { runVerification } from '@/core/verification';

const NES_BUTTONS: LogicalButton[] = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'START', 'SELECT'];
const GBA_BUTTONS: LogicalButton[] = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'L', 'R', 'START', 'SELECT'];
/**
 * PlayStation pad. EmulatorJS draws and handles its own on-screen pad inside
 * the emulator frame, so these are the logical buttons Recompa maps onto
 * keyboard/gamepad when it owns input; the frame keeps focus for the core.
 */
const PSX_BUTTONS: LogicalButton[] = [
  'UP',
  'DOWN',
  'LEFT',
  'RIGHT',
  'A',
  'B',
  'X',
  'Y',
  'L',
  'R',
  'L2',
  'R2',
  'START',
  'SELECT',
];

export function Player({ game, report }: { game: GameRecord; report: AnalysisReport }) {
  const settings = useSettings((s) => s.settings);
  const updateSettings = useSettings((s) => s.update);
  const loadRom = useLibrary((s) => s.loadRom);
  const loadSram = useLibrary((s) => s.loadSram);
  const saveSram = useLibrary((s) => s.saveSram);
  const recordPlay = useLibrary((s) => s.recordPlay);
  const updateGame = useLibrary((s) => s.updateGame);
  const pushToast = useLibrary((s) => s.pushToast);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const emulator = useEmulator();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [panel, setPanel] = useState<'none' | 'settings' | 'states' | 'perf'>('none');
  const [states, setStates] = useState<SaveStateRecord[]>([]);
  const [savingState, setSavingState] = useState(false);
  const [capture, setCapture] = useState<string | null>(null);
  const startedRef = useRef(false);
  const sessionStartRef = useRef<number>(0);
  const keyboardRef = useRef<KeyboardInput | null>(null);
  const gamepadRef = useRef<GamepadInput | null>(null);
  const [audioOn, setAudioOn] = useState(settings.audioEnabled);
  const [speed, setSpeed] = useState(1);
  const [verification, setVerification] = useState<{ running: boolean; summary?: string }>({ running: false });
  // Precedence matters here: `a ?? b ? x : y` parses as `(a ?? b) ? x : y`,
  // so the previous form sent *every* game that had an engineId to jsnes.
  const engineId = game.engineId ?? (report.platform?.id === 'nes' ? 'jsnes' : 'mgba-wasm');

  const buttons = useMemo(() => {
    if (game.platformId === 'nes') return NES_BUTTONS;
    if (game.platformId === 'gba' || game.platformId === 'gb' || game.platformId === 'gbc') return GBA_BUTTONS;
    if (game.platformId === 'psx') return PSX_BUTTONS;
    return NES_BUTTONS;
  }, [game.platformId]);

  /* ----------------------------- boot ----------------------------- */
  const boot = useCallback(async () => {
    setError(null);
    setReady(false);
    const rom = await loadRom(game.id);
    if (!rom) {
      setError(
        'The ROM bytes for this entry are not in local storage. They were removed or the entry was imported without payload data — re-upload the file.',
      );
      return;
    }
    const sram = await loadSram(game.id);
    sessionStartRef.current = Date.now();
    await emulator.start({
      engineId: engineId as string,
      rom,
      fileName: game.title.replace(/[^\w.\- ]+/g, '_') + extensionFor(game.platformId),
      canvas: canvasRef.current!,
      savedSram: sram,
      audio: audioOn,
      volume: settings.volume,
      onSram: (sramBytes) => void saveSram(game.id, engineId as string, sramBytes),
      onReady: () => setReady(true),
      onStatus: (status) => {
        if (status === 'running') void recordPlay(game.id, engineId as string, 0);
      },
    });
  }, [audioOn, emulator, engineId, game.id, game.platformId, game.title, loadRom, loadSram, recordPlay, saveSram, settings.volume]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (emulator.error) setError(emulator.error);
  }, [emulator.error]);

  /* --------------------- input wiring ---------------------------- */
  useEffect(() => {
    const shouldIgnore = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
    };
    const keyboard = new KeyboardInput(
      settings.keybindings,
      (event) => {
        if (emulator.status === 'paused') return;
        const mapped = mapButton(engineId as string, event.button);
        if (mapped) emulator.actions.input(event.button, event.pressed);
      },
      window,
      shouldIgnore,
    );
    keyboardRef.current = keyboard;

    const gamepad = new GamepadInput((event) => {
      if (emulator.status === 'paused') return;
      emulator.actions.input(event.button, event.pressed);
    }, settings.gamepadDeadzone);
    gamepadRef.current = gamepad;
    let raf = 0;
    const poll = () => {
      gamepad.poll();
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);

    const onBlur = () => {
      keyboard.releaseAll();
      gamepad.releaseAll();
    };
    const onVisibility = () => {
      if (document.hidden) {
        onBlur();
        emulator.actions.pause();
      }
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      keyboard.destroy();
      gamepad.releaseAll();
      cancelAnimationFrame(raf);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [emulator, engineId, settings.keybindings, settings.gamepadDeadzone]);

  useEffect(() => {
    keyboardRef.current?.setBindings(settings.keybindings);
  }, [settings.keybindings]);

  /* --------------------- lifecycle bookkeeping ------------------- */
  useEffect(() => {
    const onBeforeUnload = () => {
      if (sessionStartRef.current) {
        const seconds = (Date.now() - sessionStartRef.current) / 1000;
        void recordPlay(game.id, engineId as string, seconds);
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (sessionStartRef.current) {
        const seconds = (Date.now() - sessionStartRef.current) / 1000;
        void recordPlay(game.id, engineId as string, seconds);
        sessionStartRef.current = 0;
      }
      void emulator.stop();
    };
  }, [emulator, engineId, game.id, recordPlay]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    void listStates(game.id).then(setStates);
  }, [game.id]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shellRef.current?.requestFullscreen({ navigationUI: 'hide' });
    } catch (err) {
      pushToast({ kind: 'warning', title: 'Fullscreen unavailable', message: (err as Error).message });
    }
  };

  const doScreenshot = async () => {
    const blob = await emulator.actions.screenshot();
    if (!blob) {
      pushToast({ kind: 'warning', title: 'Screenshot failed', message: 'This engine could not read back the video surface.' });
      return;
    }
    const url = URL.createObjectURL(blob);
    setCapture(url);
    // Also save a durable copy to the user's downloads.
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitize(game.title)}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    a.click();
    // Offer it as cover art if none is set yet.
    if (!game.cover) {
      const reader = new FileReader();
      reader.onload = () => void updateGame(game.id, { cover: { kind: 'capture', value: String(reader.result), source: 'captured from your session', updatedAt: Date.now() } });
      reader.readAsDataURL(blob);
    }
  };

  const doSaveState = async () => {
    setSavingState(true);
    try {
      const state = await emulator.actions.saveState();
      if (!state) {
        pushToast({ kind: 'warning', title: 'Save state unsupported', message: 'This engine does not expose serialisable state.' });
        return;
      }
      const thumbnail = await captureThumbnail();
      const record: SaveStateRecord = {
        id: `${game.id}_${Date.now()}`,
        gameId: game.id,
        engineId: engineId as string,
        createdAt: Date.now(),
        slot: states.length,
        thumbnail,
        bytes: state,
      };
      await putState(record);
      setStates(await listStates(game.id));
      pushToast({ kind: 'success', title: 'Save state stored', message: `${bytes(state.length)} saved locally.` });
    } finally {
      setSavingState(false);
    }
  };

  const loadStateRecord = async (record: SaveStateRecord) => {
    const ok = await emulator.actions.loadState(record.bytes);
    pushToast({
      kind: ok ? 'success' : 'error',
      title: ok ? 'State restored' : 'State rejected',
      message: ok ? 'Resumed from your save state.' : 'The engine refused this state (wrong game or engine version).',
    });
    if (ok) setPanel('none');
  };

  const captureThumbnail = async (): Promise<string | null> => {
    const blob = await emulator.actions.screenshot();
    if (!blob) return null;
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  };

  const startVerification = async () => {
    setVerification({ running: true });
    const result = await runVerification({
      game,
      report,
      engineId: engineId as string,
      emulator,
      durationSeconds: settings.testDurationSeconds,
      environment: {
        userAgent: navigator.userAgent,
        cores: navigator.hardwareConcurrency ?? null,
        webgpu: false,
        crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
        fps: emulator.stats?.fps ?? 0,
      },
    });
    setVerification({ running: false, summary: result.summary });
    await updateGame(game.id, {
      compatibility: result.compatibility,
      verifiedBy: result.testRunId,
    });
    pushToast({
      kind: result.compatibility === 'compatible' ? 'success' : 'warning',
      title: `Verification: ${result.compatibility.replace(/-/g, ' ')}`,
      message: result.summary,
      action: { label: 'Open test log', to: `/game/${game.id}` },
    });
  };

  const fps = emulator.stats?.fps ?? 0;
  const touchEnabled = settings.touchControls === 'on' || (settings.touchControls === 'auto' && matchMedia('(pointer: coarse)').matches);
  const playing = emulator.status === 'running' || emulator.status === 'paused';

  return (
    <div ref={shellRef} className={clsx('player-shell flex min-h-dvh flex-col bg-void', fullscreen && 'p-0')}>
      {/* Header */}
      <header className={clsx('flex items-center gap-3 border-b border-line bg-abyss/80 px-3 py-2 backdrop-blur', fullscreen && 'absolute inset-x-0 top-0 z-40 bg-black/60')}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            void emulator.stop();
            navigate(`/game/${game.id}`);
          }}
          aria-label="Exit game"
        >
          <ChevronLeft className="size-4" /> <span className="hidden sm:inline">Exit</span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-ink">{game.title}</h1>
            {emulator.session && (
              <MethodBadge
                kind={emulator.session.descriptor.kind}
                label={emulator.session.descriptor.kind === 'wasm-emulator' ? 'WASM emulation' : 'JS emulation'}
              />
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-ink-4">
            <span className={clsx('flex items-center gap-1', emulator.status === 'running' ? 'text-mint' : emulator.status === 'error' ? 'text-rose' : 'text-amber')}>
              <span className="size-1.5 rounded-full bg-current" />
              {emulator.status}
            </span>
            <span>·</span>
            <span>{fps ? `${fps.toFixed(1)} fps` : 'measuring'}</span>
            {emulator.stats?.frameTimeMs ? (
              <>
                <span>·</span>
                <span>{emulator.stats.frameTimeMs.toFixed(1)} ms/frame</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <IconBtn label={emulator.status === 'paused' ? 'Resume' : 'Pause'} onClick={() => (emulator.status === 'paused' ? emulator.actions.resume() : emulator.actions.pause())} disabled={!playing}>
            {emulator.status === 'paused' ? <Play className="size-4" /> : <Pause className="size-4" />}
          </IconBtn>
          <IconBtn label="Restart" onClick={() => emulator.actions.reset()} disabled={!playing}>
            <RotateCcw className="size-4" />
          </IconBtn>
          <IconBtn label={audioOn ? 'Mute' : 'Unmute'} onClick={() => {
            const next = !audioOn;
            setAudioOn(next);
            updateSettings({ audioEnabled: next });
            emulator.actions.setVolume(next ? settings.volume : 0);
          }}>
            {audioOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </IconBtn>
          <IconBtn label="Save state" onClick={() => void doSaveState()} disabled={!playing || savingState}>
            <Save className="size-4" />
          </IconBtn>
          <IconBtn label="Screenshot" onClick={() => void doScreenshot()} disabled={!playing}>
            <Camera className="size-4" />
          </IconBtn>
          <IconBtn label="Performance" onClick={() => setPanel(panel === 'perf' ? 'none' : 'perf')} active={panel === 'perf'}>
            <Gauge className="size-4" />
          </IconBtn>
          <IconBtn label="Settings" onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')} active={panel === 'settings'}>
            <SlidersHorizontal className="size-4" />
          </IconBtn>
          <IconBtn label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => void toggleFullscreen()}>
            {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </IconBtn>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-3 p-3 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className="relative">
            <EmulatorStage
              canvasRef={canvasRef}
              aspect={settings.aspect === 'auto' ? (game.platformId === 'gba' ? '4:3' : '4:3') : settings.aspect}
              scale={settings.videoScale === '1x' ? 1 : settings.videoScale === '2x' ? 1 : 1}
              filters={settings.filters}
              playing={playing}
            >
              {!ready && !error && (
                <div className="absolute inset-0 grid place-items-center bg-black/70 backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <Spinner className="size-6 text-lime" />
                    <div>
                      <p className="text-sm font-medium text-ink">Loading {emulator.session?.descriptor.name ?? 'core'}…</p>
                      <p className="mt-1 font-mono text-[10px] text-ink-4">The emulator core runs locally in this tab.</p>
                    </div>
                  </div>
                </div>
              )}
              {emulator.status === 'paused' && (
                <div className="absolute inset-0 grid place-items-center bg-black/65 backdrop-blur-[2px]">
                  <div className="flex flex-col items-center gap-3">
                    <p className="font-display text-lg font-semibold">Paused</p>
                    <div className="flex gap-2">
                      <button className="btn btn-primary btn-sm" onClick={() => emulator.actions.resume()}>
                        <Play className="size-3.5" /> Resume
                      </button>
                      <button className="btn btn-sm" onClick={() => void doSaveState()}>
                        <Save className="size-3.5" /> Save state
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {error && (
                <div className="absolute inset-0 grid place-items-center bg-black/85 p-6">
                  <div className="max-w-md text-center">
                    <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full border border-rose/40 bg-rose/10">
                      <X className="size-5 text-rose" />
                    </div>
                    <h3 className="text-sm font-semibold text-ink">The engine could not start</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{error}</p>
                    <div className="mt-4 flex justify-center gap-2">
                      <button className="btn btn-sm" onClick={() => void boot()}>
                        Retry
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/game/${game.id}`)}>
                        Open analysis
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </EmulatorStage>
          </div>

          {/* Under-video bar */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel/60 px-2.5 py-1.5">
            <div className="flex items-center gap-2 font-mono text-[10px] text-ink-4">
              <Gamepad2 className="size-3.5" />
              <span>{gamepadRef.current?.state.connected ? 'gamepad connected' : 'keyboard · gamepad · touch'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CompatBadge state={game.compatibility} />
              <select
                className="input h-7 w-auto px-2 font-mono text-[10px]"
                value={String(speed)}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setSpeed(value);
                  emulator.actions.setSpeed(value);
                }}
                aria-label="Playback speed"
              >
                <option value="1">1×</option>
                <option value="2">2×</option>
                <option value="3">3×</option>
                <option value="4">4×</option>
              </select>
              <button className="btn btn-ghost btn-sm" onClick={() => setPanel(panel === 'states' ? 'none' : 'states')}>
                <Zap className="size-3.5" /> States
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void startVerification()}
                disabled={verification.running || !playing}
                title="Run the automated verification pass on this session"
              >
                {verification.running ? <Spinner className="size-3.5" /> : <Gauge className="size-3.5" />}
                {verification.running ? 'Testing…' : 'Verify'}
              </button>
            </div>
          </div>

          {touchEnabled && !fullscreen && (
            <div className="mt-3 lg:hidden">
              <TouchControls buttons={buttons} onInput={(button, pressed) => emulator.actions.input(button, pressed)} layout="portrait" />
            </div>
          )}
        </div>

        {/* Side panel */}
        {panel !== 'none' && (
          <aside className="scroll-area w-full shrink-0 overflow-y-auto rounded-xl border border-line bg-panel/70 p-3 lg:w-[320px]">
            {panel === 'perf' && <PerformancePanel emulator={emulator} />}
            {panel === 'settings' && (
              <SettingsPanel
                fullscreen={fullscreen}
                onToggleFullscreen={() => void toggleFullscreen()}
                speed={speed}
                onSpeed={(v) => {
                  setSpeed(v);
                  emulator.actions.setSpeed(v);
                }}
              />
            )}
            {panel === 'states' && (
              <StatesPanel
                states={states}
                onSave={() => void doSaveState()}
                onLoad={(record) => void loadStateRecord(record)}
                onDelete={async (id) => {
                  await deleteState(id);
                  setStates(await listStates(game.id));
                }}
                busy={savingState}
              />
            )}
          </aside>
        )}
      </div>

      {touchEnabled && (
        <div className="lg:hidden">
          <TouchControls buttons={buttons} onInput={(button, pressed) => emulator.actions.input(button, pressed)} />
        </div>
      )}

      {capture && <ScreenshotPreview url={capture} onClose={() => setCapture(null)} />}
      {verification.summary && (
        <div className="pointer-events-none fixed bottom-3 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-line-bright bg-panel/95 px-3 py-1.5 font-mono text-[10px] text-ink-2 shadow-xl">
          {verification.summary}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      className={clsx('btn btn-ghost btn-icon btn-sm', active && 'bg-white/8 text-lime')}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function PerformancePanel({ emulator }: { emulator: ReturnType<typeof useEmulator> }) {
  const stats = emulator.stats;
  const history = emulator.frameRateHistory;
  const max = Math.max(75, ...history);
  const bars = history.slice(-60);
  const average = history.length ? history.reduce((a, b) => a + b, 0) / history.length : 0;
  const fpsTarget = 60;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Performance</h2>
        <span className="font-mono text-[10px] text-ink-4">measured</span>
      </div>
      <div className="rounded-lg border border-line bg-black/25 p-2.5">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="mono-label">frame rate</span>
          <span className="font-mono text-lg leading-none font-semibold text-lime">{stats ? stats.fps.toFixed(1) : '—'}</span>
        </div>
        <svg viewBox="0 0 120 28" className="h-9 w-full" preserveAspectRatio="none" aria-label="Frame rate history">
          <line x1="0" y1={28 - (fpsTarget / max) * 28} x2="120" y2={28 - (fpsTarget / max) * 28} stroke="#27364a" strokeDasharray="2 2" strokeWidth="0.5" />
          {bars.map((v, i) => {
            const h = Math.max(1, (v / max) * 28);
            return <rect key={i} x={(i / Math.max(bars.length - 1, 1)) * 119} y={28 - h} width={Math.max(119 / Math.max(bars.length, 1) - 0.6, 0.6)} height={h} fill={v >= fpsTarget * 0.95 ? '#d6ff4b' : v >= fpsTarget * 0.8 ? '#ffbe5c' : '#ff5f7a'} opacity="0.85" />;
          })}
        </svg>
        <div className="mt-1 flex justify-between font-mono text-[9px] text-ink-4">
          <span>avg {average.toFixed(1)} fps</span>
          <span>target {fpsTarget}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Frame time" value={stats?.frameTimeMs ? `${stats.frameTimeMs.toFixed(2)} ms` : '—'} />
        <Metric label="Audio rate" value={stats?.audioSampleRate ? `${(stats.audioSampleRate / 1000).toFixed(1)} kHz` : '—'} />
        <Metric label="Audio latency" value={stats?.audioLatencyMs != null ? `${stats.audioLatencyMs.toFixed(0)} ms` : 'n/a'} />
        <Metric label="Video" value={stats?.videoMode ?? '—'} small />
      </div>
      {stats && Object.keys(stats.extra).length > 0 && (
        <div className="rounded-lg border border-line bg-black/20 p-2">
          <div className="mono-label mb-1.5">engine telemetry</div>
          <dl className="space-y-1 font-mono text-[10px]">
            {Object.entries(stats.extra).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-2">
                <dt className="text-ink-4">{key}</dt>
                <dd className="text-right text-ink-2">{value === null ? '—' : String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <div className="rounded-lg border border-line bg-black/20 p-2">
        <div className="mono-label mb-1.5">log</div>
        <ul className="scroll-area max-h-40 space-y-0.5 overflow-y-auto font-mono text-[10px]">
          {emulator.logs.length === 0 && <li className="text-ink-4">no entries yet</li>}
          {emulator.logs.slice(-40).map((entry, i) => (
            <li key={i} className={clsx(entry.level === 'error' ? 'text-rose' : entry.level === 'warn' ? 'text-amber' : 'text-ink-3')}>
              <span className="text-ink-4">{new Date(entry.at).toLocaleTimeString()} </span>
              {entry.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Metric({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-black/20 p-2">
      <div className="mono-label">{label}</div>
      <div className={clsx('mt-0.5 font-mono text-ink', small ? 'text-[10px] leading-tight' : 'text-sm')}>{value}</div>
    </div>
  );
}

function SettingsPanel({
  fullscreen,
  onToggleFullscreen,
  speed,
  onSpeed,
}: {
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  speed: number;
  onSpeed: (v: number) => void;
}) {
  const { settings, update } = useSettings();
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold">Player settings</h2>
      <Field label="Aspect ratio">
        <select className="input h-8 text-xs" value={settings.aspect} onChange={(e) => update({ aspect: e.target.value as never })}>
          <option value="auto">Auto (native)</option>
          <option value="4:3">4:3</option>
          <option value="16:9">16:9</option>
          <option value="stretch">Stretch to fill</option>
        </select>
      </Field>
      <Field label="Filters">
        <select className="input h-8 text-xs" value={settings.filters} onChange={(e) => update({ filters: e.target.value as never })}>
          <option value="off">Off (sharp pixels)</option>
          <option value="scanlines">Scanlines</option>
          <option value="smooth">Smooth (bilinear)</option>
        </select>
      </Field>
      <Field label={`Volume · ${Math.round(settings.volume * 100)}%`}>
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
      <Field label="Speed">
        <div className="flex gap-1">
          {[1, 2, 3, 4].map((v) => (
            <button key={v} className={clsx('btn btn-sm flex-1', speed === v && 'btn-primary')} onClick={() => onSpeed(v)}>
              {v}×
            </button>
          ))}
        </div>
      </Field>
      <Field label="Touch controls">
        <select className="input h-8 text-xs" value={settings.touchControls} onChange={(e) => update({ touchControls: e.target.value as never })}>
          <option value="auto">Auto-detect pointer type</option>
          <option value="on">Always on</option>
          <option value="off">Off</option>
        </select>
      </Field>
      <label className="flex items-center justify-between gap-2 text-xs text-ink-2">
        Show FPS overlay
        <input type="checkbox" checked={settings.showFps} onChange={(e) => update({ showFps: e.target.checked })} className="accent-[#d6ff4b]" />
      </label>
      <button className="btn btn-sm w-full" onClick={onToggleFullscreen}>
        {fullscreen ? <Minimize className="size-3.5" /> : <Maximize className="size-3.5" />}
        {fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      </button>
      <div className="rounded-lg border border-line bg-black/20 p-2 font-mono text-[10px] leading-relaxed text-ink-4">
        Settings are saved on this device and applied to every game. Keybindings live in Settings → Controls.
      </div>
    </div>
  );
}

function StatesPanel({
  states,
  onSave,
  onLoad,
  onDelete,
  busy,
}: {
  states: SaveStateRecord[];
  onSave: () => void;
  onLoad: (state: SaveStateRecord) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Save states</h2>
        <button className="btn btn-sm" onClick={onSave} disabled={busy}>
          <Save className="size-3.5" /> Capture
        </button>
      </div>
      {states.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-bright p-3 text-xs leading-relaxed text-ink-3">
          No states yet. Capture one at any point — it is stored in IndexedDB with a thumbnail and your engine version, so it can be
          restored after a reload.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {states.map((record) => (
            <li key={record.id} className="flex items-center gap-2 rounded-lg border border-line bg-black/20 p-1.5">
              {record.thumbnail ? (
                <img src={record.thumbnail} alt="" className="h-10 w-14 rounded object-cover" />
              ) : (
                <div className="h-10 w-14 rounded bg-panel-3" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[10px] text-ink-2">{new Date(record.createdAt).toLocaleString()}</div>
                <div className="font-mono text-[9px] text-ink-4">
                  {bytes(record.bytes.length)} · {record.engineId}
                </div>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => onLoad(record)} title="Restore">
                <Play className="size-3" />
              </button>
              <button className="btn btn-sm btn-ghost text-rose/70 hover:text-rose" onClick={() => onDelete(record.id)} title="Delete">
                <Trash2 className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mono-label mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function ScreenshotPreview({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" onClick={onClose} role="dialog" aria-modal>
      <div className="max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt="Captured screenshot" className="max-h-[75dvh] rounded-lg border border-line-bright" style={{ imageRendering: 'pixelated' }} />
        <div className="mt-2 flex justify-between gap-2">
          <p className="font-mono text-[10px] text-ink-4">Saved to downloads · usable as cover art</p>
          <button className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function extensionFor(platformId: string): string {
  switch (platformId) {
    case 'gba':
      return '.gba';
    case 'gb':
      return '.gb';
    case 'gbc':
      return '.gbc';
    default:
      return '.nes';
  }
}

function sanitize(value: string): string {
  return value.replace(/[^\w\-]+/g, '_').slice(0, 60) || 'game';
}
