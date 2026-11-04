import { create } from 'zustand';
import type { AnalysisReport, GameRecord, Job, PlatformId } from '@/core/types';
import {
  deleteGameCascade,
  getAllGames,
  getAllReports,
  getPayloadBytes,
  getSram,
  putGame,
  putJob,
  putPayload,
  putReport,
  putSram,
  listJobs,
} from '@/db/database';
import { plan } from '@/core/planner';
import { detectEnvironment } from '@/core/environment';
import { fetchInstalledEngines } from '@/engines/install-check';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error' | 'warning';
  title: string;
  message?: string;
  action?: { label: string; to: string };
}

interface LibraryState {
  games: GameRecord[];
  reports: AnalysisReport[];
  jobs: Job[];
  toasts: Toast[];
  loading: boolean;
  analyzing: boolean;

  hydrate: () => Promise<void>;
  addReport: (report: AnalysisReport, payload: Uint8Array) => Promise<{ game: GameRecord; job: Job; duplicate: GameRecord | null }>;
  refresh: () => Promise<void>;
  toggleFavourite: (gameId: string) => Promise<void>;
  updateGame: (gameId: string, patch: Partial<GameRecord>) => Promise<void>;
  removeGame: (gameId: string) => Promise<void>;
  recordPlay: (gameId: string, engineId: string, seconds: number) => Promise<void>;
  loadRom: (gameId: string) => Promise<Uint8Array | null>;
  loadSram: (gameId: string) => Promise<Uint8Array | null>;
  saveSram: (gameId: string, engineId: string, bytes: Uint8Array) => Promise<void>;
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const useLibrary = create<LibraryState>((set, get) => ({
  games: [],
  reports: [],
  jobs: [],
  toasts: [],
  loading: true,
  analyzing: false,

  async hydrate() {
    set({ loading: true });
    const [games, reports, jobs] = await Promise.all([getAllGames(), getAllReports(), listJobs()]);
    set({ games, reports, jobs, loading: false });
  },

  async addReport(report, payload) {
    set({ analyzing: true });
    try {
      const environment = await detectEnvironment();
      const installed = await fetchInstalledEngines();
      const { plan: jobPlan } = plan({ report, environment, installedEngines: installed });

      const existing = get().games.find((g) => g.reportId === report.id) ??
        get().games.find((g) => g.payloadId === report.checksums.sha256);
      const duplicate = existing ?? null;

      await putReport(report);
      await putPayload(payload, report.checksums.sha256);

      const now = Date.now();
      const game: GameRecord = duplicate
        ? { ...duplicate, reportId: report.id, updatedAt: now }
        : {
            id: uid(),
            createdAt: now,
            updatedAt: now,
            lastPlayedAt: null,
            favourite: false,
            title: report.identification.title ?? report.fileName,
            platformId: (report.platform?.id ?? 'unknown') as PlatformId,
            reportId: report.id,
            payloadId: report.checksums.sha256,
            engineId: jobPlan.target?.descriptor.id ?? null,
            compatibility: 'analysis-complete',
            verifiedBy: null,
            cover: null,
            playSeconds: 0,
            playCount: 0,
            facts: report.facts.filter((f) =>
              ['Mapper', 'ROM size', 'PRG ROM', 'CHR ROM', 'Mirroring', 'Battery', 'Byte order', 'Game code'].includes(f.label),
            ),
            region: report.identification.region,
          };
      await putGame(game);

      const job: Job = {
        id: jobPlan.id,
        reportId: report.id,
        gameId: game.id,
        createdAt: now,
        updatedAt: now,
        status: jobPlan.target ? 'completed' : 'blocked',
        plan: jobPlan,
        stages: jobPlan.stages,
      };
      await putJob(job);

      await get().refresh();
      if (!duplicate) set({ jobs: [job, ...get().jobs.filter((j) => j.id !== job.id)] });
      return { game, job, duplicate };
    } finally {
      set({ analyzing: false });
    }
  },

  async refresh() {
    const [games, reports, jobs] = await Promise.all([getAllGames(), getAllReports(), listJobs()]);
    set({ games, reports, jobs });
  },

  async toggleFavourite(gameId) {
    const game = get().games.find((g) => g.id === gameId);
    if (!game) return;
    const updated = { ...game, favourite: !game.favourite, updatedAt: Date.now() };
    await putGame(updated);
    set({ games: get().games.map((g) => (g.id === gameId ? updated : g)) });
  },

  async updateGame(gameId, patch) {
    const game = get().games.find((g) => g.id === gameId);
    if (!game) return;
    const updated = { ...game, ...patch, updatedAt: Date.now() };
    await putGame(updated);
    set({ games: get().games.map((g) => (g.id === gameId ? updated : g)) });
  },

  async removeGame(gameId) {
    await deleteGameCascade(gameId);
    set({ games: get().games.filter((g) => g.id !== gameId) });
  },

  async recordPlay(gameId, engineId, seconds) {
    const game = get().games.find((g) => g.id === gameId);
    if (!game) return;
    await get().updateGame(gameId, {
      lastPlayedAt: Date.now(),
      playSeconds: Math.round(game.playSeconds + seconds),
      playCount: game.playCount + 1,
      engineId,
    });
  },

  async loadRom(gameId) {
    const game = get().games.find((g) => g.id === gameId);
    if (!game) return null;
    return getPayloadBytes(game.payloadId);
  },

  async loadSram(gameId) {
    const record = await getSram(gameId);
    return record?.bytes ?? null;
  },

  async saveSram(gameId, engineId, bytes) {
    await putSram({ gameId, engineId, updatedAt: Date.now(), bytes });
  },

  pushToast(toast) {
    const id = uid();
    set({ toasts: [...get().toasts, { ...toast, id }] });
    const ttl = toast.kind === 'error' ? 9000 : 5000;
    setTimeout(() => get().dismissToast(id), ttl);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
