/**
 * Turns raw storage failures into messages a user can act on.
 *
 * IndexedDB writes fail with a `QuotaExceededError` when the origin's storage
 * allowance runs out — entirely plausible here, because Recompa stores whole
 * ROM and disc images. Surfacing "QuotaExceededError: ..." tells nobody what to
 * do; the message below names the cause and the three real remedies.
 */

const QUOTA_MESSAGE =
  'This device has no storage left for the file, so it was not saved. Free space with Settings → Data & storage → Erase, delete other games, or turn off “Store ROM bytes after analysis” and re-add the file (you can analyse without keeping it).';

/** True when the error is a storage-quota failure rather than any other fault. */
export function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  if (candidate.name === 'QuotaExceededError') return true;
  // Legacy numeric code (22 = QUOTA_EXCEEDED_ERR) still appears in some engines.
  if (candidate.code === 22) return true;
  return typeof candidate.message === 'string' && /quota/i.test(candidate.message);
}

/**
 * A user-facing message for a storage failure, or `null` when the error is not
 * storage-related so the caller can keep its own message.
 */
export function describeStorageError(error: unknown): string | null {
  return isQuotaError(error) ? QUOTA_MESSAGE : null;
}

export const QUOTA_ERROR_MESSAGE = QUOTA_MESSAGE;
