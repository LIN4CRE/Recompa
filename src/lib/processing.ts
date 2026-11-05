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

/** Hostnames that resolve to the machine running the browser. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * Validate and parse the configured endpoint.
 *
 * Recompa only ever sends ROM bytes to a service on the user's own machine.
 * This is enforced in the client as well as in the CSP: a remote endpoint is
 * blocked by `connect-src` on the deployed site anyway, and allowing one here
 * would contradict the confirmation dialog's promise that nothing goes to a
 * third party. Operators who need a remote service reach it through an SSH
 * tunnel or an authenticated local reverse proxy (see docs/DEPLOYMENT.md §4),
 * which still presents as a loopback endpoint to the browser.
 */
export function processingEndpoint(raw: string): URL {
  const value = raw.trim().replace(/\/$/, '');
  if (!value) throw new ProcessingError('No processing endpoint configured.', 'unavailable');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProcessingError(`"${value}" is not a valid URL.`, 'bad-request');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProcessingError('Processing endpoints must use http or https.', 'bad-request');
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new ProcessingError(
      `Only loopback endpoints are allowed (localhost, 127.0.0.1 or [::1]). "${url.hostname}" would send ROM bytes to another machine; use an SSH tunnel or a local reverse proxy instead.`,
      'bad-request',
    );
  }
  return url;
}

/** Human-readable host for the confirmation dialog; never throws during render. */
export function endpointLabel(raw: string): string {
  try {
    return new URL(raw).host || 'local service';
  } catch {
    return raw.trim() || 'local service';
  }
}

function baseUrl(settings: AppSettings): string {
  return processingEndpoint(settings.externalProcessingEndpoint).toString().replace(/\/$/, '');
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
