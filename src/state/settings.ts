import { create } from 'zustand';
import type { AppSettings, Keybindings } from '@/core/types';
import { DEFAULT_KEYBINDINGS } from '@/engines/input';
import { loadSettings, saveSettings } from '@/db/database';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'obsidian',
  videoScale: 'auto',
  aspect: 'auto',
  filters: 'off',
  audioEnabled: true,
  volume: 0.8,
  audioBufferSamples: 1024,
  showFps: true,
  autoFullscreen: false,
  touchControls: 'auto',
  keybindings: DEFAULT_KEYBINDINGS,
  gamepadDeadzone: 0.35,
  performanceMode: 'auto',
  keepScreenAwake: false,
  autoAnalyze: true,
  storePayloads: true,
  storeStates: true,
  testDurationSeconds: 12,
  externalProcessingEndpoint: '',
  enableExternalProcessing: false,
  telemetry: false,
};

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => void;
  setKeybinding: (button: string, code: string) => void;
  resetKeybindings: () => void;
  reset: () => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async load() {
    const stored = await loadSettings();
    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...(stored ?? {}),
      keybindings: { ...DEFAULT_KEYBINDINGS, ...(stored?.keybindings ?? {}) },
    };
    set({ settings: merged, loaded: true });
  },
  update(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => void saveSettings(settings), 250);
  },
  setKeybinding(button, code) {
    const keybindings: Keybindings = { ...get().settings.keybindings };
    // Remove the code from any other action first: bindings must stay unique.
    for (const [key, value] of Object.entries(keybindings)) if (value === code) delete keybindings[key];
    keybindings[button] = code;
    get().update({ keybindings });
  },
  resetKeybindings() {
    get().update({ keybindings: { ...DEFAULT_KEYBINDINGS } });
  },
  reset() {
    // A pending debounced update() would otherwise fire ~250 ms later and
    // write the pre-reset values back over the defaults.
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    set({ settings: { ...DEFAULT_SETTINGS } });
    void saveSettings(DEFAULT_SETTINGS);
  },
}));

/** Non-hook access for imperative code paths (player, engine lifecycle). */
export function settingsSnapshot(): AppSettings {
  return useSettings.getState().settings;
}
