import { describe, expect, it } from 'vitest';
import { describeStorageError, isQuotaError, QUOTA_ERROR_MESSAGE } from '@/lib/storage-errors';

describe('storage error mapping', () => {
  it('recognises a DOMException-style QuotaExceededError', () => {
    const error = new Error('The quota has been exceeded.');
    error.name = 'QuotaExceededError';
    expect(isQuotaError(error)).toBe(true);
    expect(describeStorageError(error)).toBe(QUOTA_ERROR_MESSAGE);
  });

  it('recognises the legacy numeric code 22', () => {
    expect(isQuotaError({ code: 22, message: 'write failed' })).toBe(true);
  });

  it('recognises a quota phrase when only the message survives', () => {
    expect(isQuotaError(new Error('IndexedDB write failed: quota exceeded'))).toBe(true);
  });

  it('leaves unrelated failures to the caller', () => {
    const error = new Error('The archive did not contain a recognisable game image.');
    expect(isQuotaError(error)).toBe(false);
    expect(describeStorageError(error)).toBeNull();
  });

  it('is defensive about non-error values', () => {
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
    expect(isQuotaError('quota')).toBe(false);
    expect(isQuotaError(42)).toBe(false);
  });

  it('tells the user what to actually do about it', () => {
    // The message must be actionable, not a stack trace.
    expect(QUOTA_ERROR_MESSAGE).toMatch(/storage/i);
    expect(QUOTA_ERROR_MESSAGE).toMatch(/Settings/);
    expect(QUOTA_ERROR_MESSAGE).not.toMatch(/\[object|undefined|Error:/);
  });
});
