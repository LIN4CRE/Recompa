/**
 * Firmware (BIOS) handling.
 *
 * Emulators that need real firmware cannot boot without it, and Recompa will
 * never ship or download one — the user must dump their own console. This
 * module validates a supplied image as far as is honestly possible, stores it
 * locally, and answers "is the requirement for this platform satisfied?".
 *
 * What we can and cannot verify:
 *   • Size is checkable and meaningful — PS1 BIOS images are all exactly
 *     512 KiB, so a wrong size is a certain failure and is rejected.
 *   • Filename hints (scph5501.bin etc.) are useful for the user but are not
 *     proof; a rename must not make an invalid file pass. We record the hint
 *     separately from validity.
 *   • Content cannot be authenticated offline: there is no open database that
 *     maps every legitimate BIOS revision to a hash that we could fetch, and
 *     inventing one would be worse than admitting the gap. We therefore report
 *     "size valid, model unconfirmed" rather than claiming a verified match.
 */

import { putBios, getBiosForPlatform, deleteBios as dbDeleteBios } from '@/db/database';
import { sha256 } from '@/core/hash';
import type { BiosRecord, PlatformId } from '@/core/types';

const PS1_BIOS_BYTES = 512 * 1024;

/** SCPH model numbers keyed by the region they are normally paired with. */
const PS1_MODEL_HINTS = ['scph5500', 'scph5501', 'scph5502', 'scph1001', 'scph7001', 'scph7003', 'scph7502'];

export interface BiosValidation {
  ok: boolean;
  sizeAccepted: boolean;
  notes: string[];
  /** Hard reason the file cannot be used, when ok is false. */
  problem?: string;
}

/**
 * Validate a candidate firmware image for a platform.
 *
 * Deliberately refuses rather than guesses: a file that is the wrong size
 * cannot be a PS1 BIOS, and accepting it would produce a confusing black
 * screen later.
 */
export function validateBios(platformId: PlatformId, fileName: string, size: number): BiosValidation {
  const notes: string[] = [];

  if (platformId !== 'psx') {
    return {
      ok: false,
      sizeAccepted: false,
      notes,
      problem: 'Recompa has no firmware requirement defined for this platform.',
    };
  }

  const lower = fileName.toLowerCase();
  const hintedModel = PS1_MODEL_HINTS.find((m) => lower.includes(m));
  if (hintedModel) {
    notes.push(`File name suggests ${hintedModel.toUpperCase()}.`);
  } else {
    notes.push('File name does not match a known SCPH model; this is not itself a problem.');
  }

  const sizeAccepted = size === PS1_BIOS_BYTES;
  if (!sizeAccepted) {
    return {
      ok: false,
      sizeAccepted: false,
      notes,
      problem:
        `A PlayStation BIOS is exactly 512 KiB (524,288 bytes); this file is ${size.toLocaleString()} bytes. ` +
        'Most BIOS dumps are 512 KiB — if yours is not, it is likely truncated, padded, or a different console\'s firmware.',
    };
  }

  notes.push('Size correct (512 KiB). The image contents cannot be authenticated offline, so the exact revision is unconfirmed.');
  return { ok: true, sizeAccepted, notes };
}

/** Persist a validated image, replacing any existing one for the platform. */
export async function importBios(
  platformId: PlatformId,
  fileName: string,
  bytes: Uint8Array,
): Promise<BiosRecord> {
  const validation = validateBios(platformId, fileName, bytes.length);
  if (!validation.ok) {
    throw new Error(validation.problem ?? 'This file cannot be used as firmware.');
  }

  const record: BiosRecord = {
    // One image per platform: a second import replaces the first rather than
    // leaving the user guessing which one the emulator will pick.
    id: `${platformId}:bios`,
    platformId,
    label: platformId === 'psx' ? 'Sony PlayStation BIOS' : `${platformId} firmware`,
    fileName,
    size: bytes.length,
    sha256: await sha256(bytes),
    bytes: new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' }),
    addedAt: Date.now(),
    validation: { sizeAccepted: validation.sizeAccepted, notes: validation.notes },
  };
  await putBios(record);
  return record;
}

export interface BiosStatus {
  installed: boolean;
  record: BiosRecord | null;
}

export async function biosStatus(platformId: PlatformId): Promise<BiosStatus> {
  const record = (await getBiosForPlatform(platformId)) ?? null;
  return { installed: Boolean(record), record };
}

export async function readBiosBytes(platformId: PlatformId): Promise<Uint8Array | null> {
  const record = await getBiosForPlatform(platformId);
  if (!record) return null;
  return new Uint8Array(await record.bytes.arrayBuffer());
}

export async function removeBios(platformId: PlatformId): Promise<void> {
  await dbDeleteBios(`${platformId}:bios`);
}

/** True when this platform's engine requires firmware at all. */
export function platformNeedsBios(platformId: PlatformId): boolean {
  return platformId === 'psx';
}
