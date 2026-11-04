import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

/**
 * Cross-origin isolation headers.
 *
 * Recompa runs emulator cores in Web Workers and passes large buffers between
 * threads. With COOP/COEP set, SharedArrayBuffer becomes available and
 * `crossOriginIsolated === true`, which unlocks:
 *   - zero-copy transferable/SharedArrayBuffer video + audio rings
 *   - Atomics-based workers (audio pacing, frame queue)
 *
 * The whole app is same-origin (fonts, cores, covers are all local), so
 * require-corp does not break anything. Hosting configs for Netlify / Vercel /
 * Cloudflare Pages mirror these headers in `public/_headers`, `vercel.json`.
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export default defineConfig({
  // `BASE_PATH` lets CI deploy under a sub-path (GitHub Pages serves from
  // /<repo>/). Defaults to '/' for root-hosted deployments.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // Explicit vendor split keeps the emulator cores out of the entry chunk
        // so the first paint does not wait on them. `mgba` is imported lazily by
        // its adapter, so it lands in its own chunk automatically.
        manualChunks(id: string) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          if (id.includes('node_modules/zustand')) return 'state';
          if (id.includes('node_modules/lucide-react')) return 'icons';
          return undefined;
        },
      },
    },
  },
  // Allow the sandbox preview proxy hosts (*.e2b.app) in addition to localhost.
  // Vite rejects unknown Host headers by default (DNS-rebinding protection); the
  // platform serves the app through a generated subdomain, so it must be listed.
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    headers: crossOriginIsolation,
    allowedHosts: ['.e2b.app', '.e2b.dev', 'localhost', '127.0.0.1'],
    fs: { strict: true },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    headers: crossOriginIsolation,
    allowedHosts: ['.e2b.app', '.e2b.dev', 'localhost', '127.0.0.1'],
  },
  optimizeDeps: {
    // mgba ships a prebuilt Emscripten glue file; keep it out of dep pre-bundling.
    exclude: ['@thenick775/mgba-wasm'],
  },
});
