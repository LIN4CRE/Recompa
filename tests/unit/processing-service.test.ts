import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

/**
 * Integration tests for the optional loopback processing service.
 *
 * These start the real zero-dependency server on an ephemeral port and talk to
 * it over HTTP. They exist to prove two things that a source-only check cannot:
 * that it binds to loopback by default, and that it reports *only* tools that
 * have a real job endpoint instead of a phantom "configured" capability.
 */

const root = resolve(__dirname, '../..');
let child: ChildProcess;
let port: number;
let base: string;

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const picked = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(picked));
    });
  });
}

async function startService(chosen: number): Promise<ChildProcess> {
  // Explicitly clear every optional tool so the result does not depend on the
  // machine running the tests.
  const env = {
    ...process.env,
    RECOMPA_SERVICE_PORT: String(chosen),
    RECOMPA_ALLOW_REMOTE: '',
    RIZIN_BIN: '',
    GHIDRA_HEADLESS: '',
    N64RECOMP_BIN: '',
    REA_CLI: '',
    REA_MODEL: '',
    REA_API_KEY: '',
  };
  const proc = spawn(process.execPath, ['server/processing-service.mjs'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  proc.stdout?.on('data', (d) => (output += d.toString()));
  proc.stderr?.on('data', (d) => (output += d.toString()));

  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${chosen}/health`);
      if (res.ok) return proc;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  proc.kill('SIGKILL');
  throw new Error(`processing service did not start:\n${output}`);
}

beforeAll(async () => {
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = await startService(port);
}, 20_000);

afterAll(() => {
  child?.kill('SIGTERM');
});

describe('processing service over real HTTP', () => {
  it('binds to loopback and answers /health', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; host: string };
    expect(body.status).toBe('ok');
    expect(body.host).toBe('127.0.0.1');
  });

  it('reports only tools with real job endpoints, all honestly "not configured"', async () => {
    const res = await fetch(`${base}/capabilities`);
    expect(res.status).toBe(200);
    const caps = (await res.json()) as {
      tools: Record<string, { configured: boolean; reason: string | null }>;
      limits: { maxBodyBytes: number; jobTimeoutMs: number };
      privacy: { bindsTo: string };
    };
    expect(Object.keys(caps.tools).sort()).toEqual(['ghidra', 'n64recomp', 'rizin']);
    expect(caps.tools.rea).toBeUndefined();
    for (const tool of Object.values(caps.tools)) {
      expect(tool.configured).toBe(false);
      expect(tool.reason).toBeTruthy();
    }
    expect(caps.limits.maxBodyBytes).toBeGreaterThan(0);
    expect(caps.privacy.bindsTo).toBe('127.0.0.1');
  });

  it('rejects a disallowed Origin', async () => {
    const res = await fetch(`${base}/capabilities`, {
      headers: { origin: 'https://unrelated.example' },
    });
    expect(res.status).toBe(403);
  });

  it('rejects a POST with the wrong content type', async () => {
    const res = await fetch(`${base}/jobs/analyse-structure`, {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'text/plain' },
      body: 'x',
    });
    expect(res.status).toBe(415);
  });

  it('reports an honest "unavailable" state instead of inventing analysis metrics', async () => {
    const res = await fetch(`${base}/jobs/analyse-structure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'game.nes', rom: 'AAEC' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; tool: string; metrics?: unknown };
    expect(body.status).toBe('unavailable');
    expect(body.tool).toBe('rizin');
    expect(body.metrics).toBeUndefined();
  });

  it('emits a plan with prerequisites, never a completed job', async () => {
    const res = await fetch(`${base}/jobs/n64recomp-plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'game.z64' }),
    });
    const body = (await res.json()) as { status: string; prerequisites: string[]; plan: string };
    expect(body.status).toBe('unavailable');
    expect(body.plan).toContain('N64Recomp');
    expect(body.prerequisites.length).toBeGreaterThan(2);
  });

  it('returns 404 for an unknown route', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });
});
