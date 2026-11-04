import type { AppSettings } from '@/core/types';

/**
 * Client for the optional local processing service.
 *
 * Contract:
 *   • nothing is sent unless the user has enabled the feature *and* configured
 *     an endpoint, and the confirmation dialog has been accepted,
 *   • the service reports its real capability set; the UI shows "not configured"
 *     for any tool that is missing rather than offering a fake job.
 */

export interface ServiceCapabilities {
  service: string;
  version: string;
  limits: { maxBodyBytes: number; jobTimeoutMs: number };
  tools: Record<
    string,
    { configured: boolean; reason: string | null; path: string | null; version?: string | null; model?: string | null }
  >;
  privacy: { bindsTo: string; notes: string[] };
}

export class ProcessingError extends Error {
  constructor(
    message: string,
    readonly kind: 'unreachable' | 'rejected' | 'unavailable' | 'bad-request',
  ) {
    super(message);
  }
}

function baseUrl(settings: AppSettings): string {
  const raw = settings.externalProcessingEndpoint.trim().replace(/\/$/, '');
  if (!raw) throw new ProcessingError('No processing endpoint configured.', 'unavailable');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProcessingError(`"${raw}" is not a valid URL.`, 'bad-request');
  }
  // Only loopback endpoints are allowed by default: this prevents a
  // configuration mistake from quietly shipping ROMs to a third party.
  const isLoopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
  if (!isLoopback && url.protocol !== 'https:') {
    throw new ProcessingError('Remote endpoints must use HTTPS.', 'bad-request');
  }
  return url.toString().replace(/\/$/, '');
}

export function isProcessingAvailable(settings: AppSettings): boolean {
  return settings.enableExternalProcessing && Boolean(settings.externalProcessingEndpoint.trim());
}

export async function fetchCapabilities(settings: AppSettings): Promise<ServiceCapabilities> {
  const base = baseUrl(settings);
  let res: Response;
  try {
    res = await fetch(`${base}/capabilities`, { signal: AbortSignal.timeout(5000) });
  } catch (error) {
    throw new ProcessingError(
      `Cannot reach the processing service at ${base}. Start it with "npm run serve:processing". (${(error as Error).message})`,
      'unreachable',
    );
  }
  if (!res.ok) throw new ProcessingError(`Service returned HTTP ${res.status}.`, 'rejected');
  return (await res.json()) as ServiceCapabilities;
}

export async function analyseStructure(
  settings: AppSettings,
  file: { name: string; bytes: Uint8Array },
): Promise<Record<string, unknown>> {
  const base = baseUrl(settings);
  const rom = bytesToBase64(file.bytes);
  const res = await fetch(`${base}/jobs/analyse-structure`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: file.name, rom }),
    signal: AbortSignal.timeout(180_000),
  }).catch((error: Error) => {
    throw new ProcessingError(`Request failed: ${error.message}`, 'unreachable');
  });
  if (!res.ok) throw new ProcessingError(`Service returned HTTP ${res.status}.`, 'rejected');
  return (await res.json()) as Record<string, unknown>;
}

export async function planN64Recomp(settings: AppSettings, fileName: string): Promise<Record<string, unknown>> {
  const base = baseUrl(settings);
  const res = await fetch(`${base}/jobs/n64recomp-plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: fileName }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new ProcessingError(`Service returned HTTP ${res.status}.`, 'rejected');
  return (await res.json()) as Record<string, unknown>;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...(bytes.subarray(i, i + chunk) as unknown as number[]));
  }
  return btoa(binary);
}
