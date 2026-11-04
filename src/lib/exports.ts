import { zipSync, strToU8 } from 'fflate';
import type { GameRecord, SaveStateRecord } from '@/core/types';

/** Save export helpers. Everything is generated locally and downloaded as a file. */

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (value: string) => value.replace(/[^\w\-.]+/g, '_').slice(0, 64) || 'save';

export function downloadSram(game: GameRecord, bytes: Uint8Array): void {
  const ext = game.platformId === 'gba' ? 'sav' : game.platformId === 'nes' ? 'sav' : 'srm';
  download(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' }), `${slug(game.title)}.${ext}`);
}

export function downloadStateBundle(game: GameRecord, states: SaveStateRecord[]): void {
  const files: Record<string, Uint8Array> = {};
  const manifest = {
    format: 'recompa-save-states',
    version: 1,
    game: { title: game.title, platformId: game.platformId, sha256: game.payloadId },
    exportedAt: new Date().toISOString(),
    entries: [] as Array<{ file: string; engineId: string; createdAt: string }>,
  };
  states.forEach((state, index) => {
    const name = `states/${String(index + 1).padStart(3, '0')}-${state.engineId}-${new Date(state.createdAt).toISOString().replace(/[:.]/g, '-')}.state`;
    files[name] = new Uint8Array(state.bytes);
    if (state.thumbnail?.startsWith('data:')) {
      const base64 = state.thumbnail.split(',')[1];
      if (base64) {
        const binary = atob(base64);
        const arr = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
        files[name.replace(/\.state$/, '.png')] = arr;
      }
    }
    manifest.entries.push({ file: name, engineId: state.engineId, createdAt: new Date(state.createdAt).toISOString() });
  });
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  const zipped = zipSync(files, { level: 6 });
  download(new Blob([zipped.slice().buffer as ArrayBuffer], { type: 'application/zip' }), `${slug(game.title)}-states.zip`);
}
