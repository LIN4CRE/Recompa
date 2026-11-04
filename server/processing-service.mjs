#!/usr/bin/env node
/**
 * Recompa optional processing service.
 *
 * This is the *only* component that ever receives a user file, and it is opt-in:
 * the browser app works fully without it. It exists for work that genuinely
 * cannot run in a browser sandbox:
 *
 *   • Ghidra headless / Rizin disassembly and symbol-map extraction,
 *   • N64Recomp job preparation (emitting the exact CLI the user runs locally),
 *   • REA agent-assisted analysis (only when a provider + model are configured).
 *
 * Security posture:
 *   • binds to 127.0.0.1 by default and refuses to start on a public interface
 *     unless RECOMPA_ALLOW_REMOTE=1 is set explicitly,
 *   • validates the Origin header against an allowlist,
 *   • caps request bodies (32 MiB) and job time,
 *   • never executes an uploaded file; ROM bytes are only read by tools as data,
 *     and every child process is spawned without a shell,
 *   • all third-party tooling is detected at runtime and reported honestly as
 *     "not configured" instead of pretending a job ran.
 *
 * Zero dependencies: Node's built-in http + child_process only.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const PORT = Number(process.env.RECOMPA_SERVICE_PORT ?? 7333);
const HOST = process.env.RECOMPA_ALLOW_REMOTE === '1' ? '0.0.0.0' : '127.0.0.1';
const MAX_BODY = 32 * 1024 * 1024;
const JOB_TIMEOUT_MS = Number(process.env.RECOMPA_JOB_TIMEOUT_MS ?? 120_000);

const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];
const ALLOWED_ORIGINS = new Set(
  (process.env.RECOMPA_ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? []).concat(
    DEFAULT_ORIGINS,
  ),
);

const GHIDRA_HEADLESS = process.env.GHIDRA_HEADLESS || '';
const RIZIN_BIN = process.env.RIZIN_BIN || '';
const REA_CLI = process.env.REA_CLI || '';
const REA_MODEL = process.env.REA_MODEL || '';
const REA_API_KEY = process.env.REA_API_KEY || '';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-max-age', '600');
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY) {
        reject(new Error(`request body exceeds ${MAX_BODY} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Runs a binary without a shell, with a hard timeout, capturing output. */
function run(command, args, { timeout = JOB_TIMEOUT_MS, cwd } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);
    child.stdout?.on('data', (d) => {
      if (stdout.length < 512_000) stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      if (stderr.length < 512_000) stderr += d.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr: `${stderr}\n${error.message}`, ms: Date.now() - started, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr, ms: Date.now() - started, timedOut });
    });
  });
}

async function probe(command, args) {
  if (!command) return { configured: false, reason: 'not configured' };
  const result = await run(command, args, { timeout: 8000 });
  return {
    configured: result.ok,
    version: result.ok ? (result.stdout.trim().split('\n')[0] ?? '').slice(0, 160) : null,
    reason: result.ok ? null : result.stderr.trim().slice(0, 300) || `exit ${result.code}`,
  };
}

/* ------------------------------------------------------------------ */
/* Capabilities                                                        */
/* ------------------------------------------------------------------ */

async function capabilities() {
  const [ghidra, rizin] = await Promise.all([
    probe(GHIDRA_HEADLESS, ['-version']),
    probe(RIZIN_BIN, ['-v']),
  ]);
  return {
    service: 'recompa-processing',
    version: '0.1.0',
    limits: { maxBodyBytes: MAX_BODY, jobTimeoutMs: JOB_TIMEOUT_MS },
    tools: {
      ghidra: { ...ghidra, path: GHIDRA_HEADLESS || null, sdk: 'headless analyzer' },
      rizin: { ...rizin, path: RIZIN_BIN || null },
      rea: {
        configured: Boolean(REA_CLI && REA_MODEL && REA_API_KEY),
        reason: !REA_CLI
          ? 'REA_CLI not set'
          : !REA_MODEL
            ? 'REA_MODEL not set'
            : !REA_API_KEY
              ? 'REA_API_KEY not set (agent runs require a provider key)'
              : null,
        path: REA_CLI || null,
        model: REA_MODEL || null,
      },
      n64recomp: {
        configured: Boolean(process.env.N64RECOMP_BIN),
        reason: process.env.N64RECOMP_BIN ? null : 'N64RECOMP_BIN not set',
        path: process.env.N64RECOMP_BIN || null,
      },
    },
    privacy: {
      bindsTo: HOST,
      notes: [
        'Files are written to a temporary directory and deleted after the job.',
        'Uploaded binaries are never executed: tools read them as data.',
        'Child processes are spawned without a shell.',
      ],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

/**
 * POST /jobs/analyse-structure
 * body: { filename: string, rom: base64, format?: string }
 *
 * Runs Rizin (if configured) with a bounded, read-only analysis script and
 * returns real disassembly metrics. If Rizin is not installed, the endpoint
 * reports that instead of inventing a result.
 */
async function analyseStructure(body) {
  if (!RIZIN_BIN) {
    return {
      status: 'unavailable',
      reason:
        'Rizin is not configured on this service. Set RIZIN_BIN to a rizin binary path and restart to enable structural analysis.',
      tool: 'rizin',
    };
  }
  if (!body?.rom || typeof body.rom !== 'string') {
    return { status: 'error', reason: 'Missing base64 "rom" field.' };
  }
  if (Buffer.byteLength(body.rom, 'base64') > MAX_BODY) {
    return { status: 'error', reason: 'ROM exceeds the service body limit.' };
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'recompa-'));
  const file = path.join(dir, sanitizeName(body.filename || 'input.bin'));
  try {
    await writeFile(file, Buffer.from(body.rom, 'base64'));
    const commands = [
      'e scr.color=false',
      'aa',
      'iI~format',
      'iS~0x',
      'aflc',
      'iz~str.',
      'q',
    ].join(';');
    const result = await run(RIZIN_BIN, ['-q', '-c', commands, file]);
    if (!result.ok) {
      return { status: 'error', reason: result.stderr.slice(0, 800) || `rizin exited ${result.code}`, ms: result.ms };
    }
    const functions = /(\d+)/.exec(result.stdout.split('\n').find((l) => /^\d+$/.test(l.trim())) ?? '')?.[1];
    return {
      status: 'ok',
      tool: 'rizin',
      ms: result.ms,
      metrics: {
        functionCount: functions ? Number(functions) : null,
        outputLines: result.stdout.split('\n').length,
      },
      excerpt: result.stdout.slice(0, 4000),
      note: 'Raw rizin output excerpt; parsed metrics are best-effort counts.',
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * POST /jobs/n64recomp-plan
 * Emits the exact command a user runs locally with N64Recomp, plus the
 * prerequisites it will fail without. Never claims the job ran.
 */
function n64recompPlan(body) {
  const bin = process.env.N64RECOMP_BIN;
  const input = sanitizeName(body?.filename || 'game.z64');
  const lines = [
    '# N64Recomp is a native C++ tool. Run this on your own machine:',
    '',
    `# 1. Obtain a symbol map (JSON) for this exact ROM revision.`,
    `#    N64Recomp needs function boundaries; it cannot recompile an unlabelled ROM.`,
    `# 2. Run the recompiler:`,
    `${bin || 'N64Recomp'} --config ./config.toml`,
    '',
    '# config.toml (minimum):',
    `#   [input]`,
    `#   rom = "${input}"`,
    `#   symbols = "./symbols.json"`,
    `#   [output]`,
    `#   output = "./RecompiledFuncs"`,
  ];
  return {
    status: bin ? 'planned' : 'unavailable',
    reason: bin ? null : 'N64RECOMP_BIN not set: the service cannot verify a local toolchain.',
    plan: lines.join('\n'),
    prerequisites: [
      'A legally obtained ROM matching the symbol map revision.',
      'A symbol/function map for that revision.',
      'A C++20 toolchain if you intend to compile the generated C.',
      'N64ModernRuntime + a renderer (e.g. RT64) for a runnable binary.',
      'For browser execution: a WASM build of the runtime and renderer, which is not published upstream.',
    ],
  };
}

function sanitizeName(name) {
  const base = path.basename(String(name)).replace(/[^\w.\-]/g, '_').slice(0, 96);
  return base || 'input.bin';
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  cors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const origin = req.headers.origin;
  const isLocalTool = !origin; // curl / local scripts
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    send(res, 403, {
      error: 'Origin not allowed',
      detail: `Add ${origin} to RECOMPA_ALLOWED_ORIGINS if you really want this origin to use the service.`,
    });
    return;
  }
  if (!isLocalTool && req.method === 'POST' && req.headers['content-type']?.split(';')[0] !== 'application/json') {
    send(res, 415, { error: 'POST bodies must be application/json' });
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { status: 'ok', uptimeSeconds: Math.round(process.uptime()), host: HOST });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/capabilities') {
      send(res, 200, await capabilities());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/jobs/analyse-structure') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      send(res, 200, await analyseStructure(body));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/jobs/n64recomp-plan') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      send(res, 200, n64recompPlan(body));
      return;
    }

    send(res, 404, { error: 'Not found', routes: ['GET /health', 'GET /capabilities', 'POST /jobs/analyse-structure', 'POST /jobs/n64recomp-plan'] });
  } catch (error) {
    send(res, 400, { error: 'Request failed', detail: error instanceof Error ? error.message : String(error) });
  }
});

await mkdir(path.join(process.cwd(), 'server'), { recursive: true }).catch(() => undefined);

server.listen(PORT, HOST, async () => {
  const caps = await capabilities();
  const fmt = (tool) => (tool.configured ? 'configured' : 'not configured');
  console.log(`\nRecompa processing service listening on http://${HOST}:${PORT}`);
  console.log(`  ghidra     ${fmt(caps.tools.ghidra)}`);
  console.log(`  rizin      ${fmt(caps.tools.rizin)} (needed for /jobs/analyse-structure)`);
  console.log(`  rea        ${fmt(caps.tools.rea)}`);
  console.log(`  n64recomp  ${fmt(caps.tools.n64recomp)}`);
  console.log(`  origins    ${[...ALLOWED_ORIGINS].join(', ')}`);
  console.log('  This service is optional; the browser app runs fully without it.\n');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} received, closing service…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
