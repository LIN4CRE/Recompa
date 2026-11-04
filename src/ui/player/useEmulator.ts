import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
  EngineCallbacks,
  EngineDescriptor,
  EngineRunOptions,
  EngineSession,
  EngineStats,
} from '@/core/types';
import { getAdapter } from '@/engines';
import type { LogicalButton } from '@/engines/input';

/**
 * Lifecycle hook around an EngineSession.
 *
 * Responsibilities kept deliberately narrow:
 *   • create/destroy the session exactly once per (engine, game) pair,
 *   • expose imperative actions (pause, reset, save, load, speed),
 *   • stream *measured* stats (the adapter's numbers, not estimates),
 *   • guarantee teardown on unmount, route change and AbortSignal.
 *
 * React StrictMode double-invokes effects in development; the abort guard below
 * ensures the first session is fully destroyed before a second is created, so
 * we never leak an emulator instance.
 */

export type PlayerStatus = 'idle' | 'loading' | 'running' | 'paused' | 'error' | 'stopped';

export interface EmulatorHandle {
  session: EngineSession | null;
  status: PlayerStatus;
  error: string | null;
  stats: EngineStats | null;
  logs: Array<{ at: number; level: string; message: string }>;
  frameRateHistory: number[];
  audioLatencyHistory: number[];
  actions: {
    pause: () => void;
    resume: () => void;
    reset: () => void;
    setVolume: (v: number) => void;
    setSpeed: (x: number) => void;
    saveState: () => Promise<Uint8Array | null>;
    loadState: (state: Uint8Array) => Promise<boolean>;
    screenshot: () => Promise<Blob | null>;
    input: (button: LogicalButton, pressed: boolean) => void;
  };
}

interface StartArgs {
  engineId: string;
  rom: Uint8Array;
  fileName: string;
  canvas: HTMLCanvasElement;
  savedSram: Uint8Array | null;
  audio: boolean;
  volume: number;
  onSram: (sram: Uint8Array) => void;
  onStatus?: (status: PlayerStatus) => void;
  onReady?: (descriptor: EngineDescriptor, session: EngineSession) => void;
}

export function useEmulator(): EmulatorHandle & { start: (args: StartArgs) => Promise<void>; stop: () => Promise<void>; isStarting: boolean } {
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [logs, setLogs] = useState<EmulatorHandle['logs']>([]);
  const [frameRateHistory, setFrameRateHistory] = useState<number[]>([]);
  const [audioLatencyHistory, setAudioLatencyHistory] = useState<number[]>([]);
  const sessionRef = useRef<EngineSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const statsTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  const log = useCallback((level: string, message: string) => {
    setLogs((prev) => [...prev.slice(-199), { at: Date.now(), level, message }]);
  }, []);

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (statsTimer.current) {
      clearInterval(statsTimer.current);
      statsTimer.current = null;
    }
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      try {
        await session.destroy();
      } catch (err) {
        log('warn', `Teardown error: ${(err as Error).message}`);
      }
    }
    forceRender();
    setStatus('stopped');
  }, [log]);

  const start = useCallback(
    async (args: StartArgs) => {
      setIsStarting(true);
      setError(null);
      await stop();
      setStatus('loading');
      args.onStatus?.('loading');

      const adapter = getAdapter(args.engineId);
      if (!adapter) {
        const message = `Engine "${args.engineId}" is not installed in this build.`;
        setError(message);
        setStatus('error');
        setIsStarting(false);
        return;
      }
      if (!(args.canvas instanceof HTMLCanvasElement)) {
        setError('Player canvas was not mounted.');
        setStatus('error');
        setIsStarting(false);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      const callbacks: EngineCallbacks = {
        onFrame: () => undefined,
        onAudio: (latency) => {
          setAudioLatencyHistory((prev) => [...prev.slice(-59), Math.round(latency)]);
        },
        onSramChanged: (sram) => args.onSram(sram),
        onLog: (level, message) => log(level, message),
        onError: (err) => {
          setError(err.message);
          setStatus('error');
        },
      };

      const options: EngineRunOptions = {
        rom: args.rom,
        fileName: args.fileName,
        canvas: args.canvas,
        audio: args.audio,
        volume: args.volume,
        savedSram: args.savedSram,
        format: null,
        header: { strippedBytes: 0, fields: {}, warnings: [] },
        signal: controller.signal,
      };

      try {
        const session = await adapter.create(options, callbacks);
        if (controller.signal.aborted) {
          await session.destroy();
          return;
        }
        sessionRef.current = session;
        setStatus('running');
        args.onStatus?.('running');
        args.onReady?.(adapter.descriptor, session);
        log('info', `${adapter.descriptor.name} started · ${adapter.descriptor.licence}`);
        forceRender();

        statsTimer.current = setInterval(() => {
          const live = sessionRef.current;
          if (!live) return;
          const measured = live.stats();
          setStats(measured);
          setFrameRateHistory((prev) => [...prev.slice(-119), Math.round(measured.fps * 10) / 10]);
        }, 500);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus('error');
        args.onStatus?.('error');
        log('error', message);
      } finally {
        setIsStarting(false);
      }
    },
    [log, stop],
  );

  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  const actions = useRef<EmulatorHandle['actions']>({
    pause: () => {
      sessionRef.current?.pause();
      setStatus('paused');
    },
    resume: () => {
      sessionRef.current?.resume();
      setStatus('running');
    },
    reset: () => sessionRef.current?.reset(),
    setVolume: (v: number) => sessionRef.current?.setVolume(v),
    setSpeed: (x: number) => sessionRef.current?.setFastForward(x),
    saveState: async () => {
      const state = await sessionRef.current?.saveState();
      return state ?? null;
    },
    loadState: async (state: Uint8Array) => (await sessionRef.current?.loadState(state)) ?? false,
    screenshot: async () => (await sessionRef.current?.screenshot()) ?? null,
    input: (button: LogicalButton, pressed: boolean) => {
      const session = sessionRef.current;
      if (!session) return;
      // Map logical buttons to engine-specific names.
      const mapped = mapButton(session.descriptor.id, button);
      if (mapped) session.setInput(1, mapped, pressed);
    },
  }).current;

  return {
    session: sessionRef.current,
    status,
    error,
    stats,
    logs,
    frameRateHistory,
    audioLatencyHistory,
    actions,
    start,
    stop,
    isStarting,
  };
}

export function mapButton(engineId: string, button: LogicalButton): string | null {
  if (engineId === 'mgba-wasm') {
    switch (button) {
      case 'A':
      case 'B':
      case 'L':
      case 'R':
      case 'START':
      case 'SELECT':
      case 'UP':
      case 'DOWN':
      case 'LEFT':
      case 'RIGHT':
        return button;
      default:
        return null; // GBA has no X/Y/L2/R2
    }
  }
  // jsnes
  switch (button) {
    case 'A':
    case 'B':
    case 'START':
    case 'SELECT':
    case 'UP':
    case 'DOWN':
    case 'LEFT':
    case 'RIGHT':
      return button;
    default:
      return null;
  }
}
