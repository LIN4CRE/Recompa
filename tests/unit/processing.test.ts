import { describe, expect, it } from 'vitest';
import {
  endpointLabel,
  isProcessingAvailable,
  processingEndpoint,
  ProcessingError,
} from '@/lib/processing';
import type { AppSettings } from '@/core/types';

/** Only the two fields the endpoint logic reads are needed here. */
const settings = (endpoint: string) =>
  ({
    externalProcessingEndpoint: endpoint,
    enableExternalProcessing: true,
  }) as unknown as AppSettings;

describe('processing endpoint validation', () => {
  it('accepts loopback hosts on http and https', () => {
    for (const raw of [
      'http://127.0.0.1:7333',
      'http://localhost:7333',
      'http://[::1]:7333',
      'https://localhost:7333/',
    ]) {
      expect(processingEndpoint(raw).host, raw).toBeTruthy();
    }
  });

  it('rejects remote hosts, so ROM bytes cannot leave the machine', () => {
    for (const raw of [
      'https://api.example.com',
      'http://192.168.1.50:7333',
      'https://127.0.0.1.evil.example',
    ]) {
      expect(() => processingEndpoint(raw), raw).toThrow(ProcessingError);
      try {
        processingEndpoint(raw);
      } catch (error) {
        expect((error as ProcessingError).kind).toBe('bad-request');
        expect((error as Error).message).toMatch(/loopback/i);
      }
    }
  });

  it('rejects non-http schemes, malformed URLs and empty values', () => {
    for (const raw of ['file:///tmp/x', 'javascript:alert(1)', 'not a url']) {
      expect(() => processingEndpoint(raw), raw).toThrow(ProcessingError);
    }
    expect(() => processingEndpoint('')).toThrow(/No processing endpoint configured/);
  });

  it('reports availability only when enabled and configured', () => {
    expect(isProcessingAvailable(settings('http://127.0.0.1:7333'))).toBe(true);
    expect(isProcessingAvailable({ ...settings(''), enableExternalProcessing: false } as AppSettings)).toBe(false);
    expect(isProcessingAvailable(settings('   '))).toBe(false);
  });

  it('endpointLabel never throws on malformed input (used during render)', () => {
    expect(endpointLabel('http://127.0.0.1:7333')).toBe('127.0.0.1:7333');
    expect(endpointLabel('nonsense')).toBe('nonsense');
    expect(endpointLabel('')).toBe('local service');
  });
});
