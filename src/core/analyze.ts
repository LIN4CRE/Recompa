import { computeChecksums, sha256 } from './hash';
import { detectFormat, toBigEndianN64, type DetectionResult } from './detect';
import { fingerprint } from './catalogue';
import { ByteReader, formatBytes, formatHex, looksCompressed } from './binary';
import { PLATFORM_BY_ID, extensionOf } from './platforms';
import type {
  AnalysisReport,
  DetectedFormat,
  RegionCode,
  RomDependency,
  TechnicalError,
} from './types';

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `rep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/**
 * Headless analysis: bytes in, structured report out.
 *
 * This module never touches the DOM, IndexedDB or the network (except to read
 * the local catalogue JSON), which is what makes it testable and lets the same
 * code run inside a worker later.
 */
export async function analyzeBytes(
  payload: Uint8Array,
  fileName: string,
  options: { catalogue?: boolean; archiveSize?: number } = {},
): Promise<AnalysisReport> {
  const started = performance.now();
  const detection = detectFormat(payload, fileName);
  const canonical = canonicalise(detection);
  const checksums = await computeChecksums(canonical.bytes);

  const platform = detection.platformId ? (PLATFORM_BY_ID.get(detection.platformId) ?? null) : null;

  // The catalogue is keyed on the canonical payload of the *system* — for N64
  // that is big-endian .z64, which we produce before hashing.
  let match = null as AnalysisReport['identification']['catalogueMatch'];
  let catalogueConsulted: Array<{ platform: string; loaded: boolean; count: number }> = [];
  let catalogueUnavailable = false;
  if (options.catalogue !== false && detection.platformId) {
    const fp = await fingerprint({
      platform: detection.platformId,
      size: checksums.size,
      crc32: checksums.crc32,
      sha1: checksums.sha1,
    });
    match = fp.match;
    catalogueConsulted = fp.consulted;
    catalogueUnavailable = fp.unavailable;
  }

  const errors: TechnicalError[] = [...detection.errors];
  const facts = [...detection.facts];

  facts.push(
    { label: 'Payload size', value: `${formatBytes(checksums.size)} (${checksums.size.toLocaleString()} bytes)` },
    { label: 'CRC32', value: checksums.crc32.toUpperCase() },
    { label: 'SHA-1', value: checksums.sha1 },
    { label: 'SHA-256', value: checksums.sha256 },
    { label: 'MD5', value: checksums.md5 },
  );

  if (detection.header.strippedBytes > 0) {
    facts.push({
      label: 'Header stripped',
      value: `${detection.header.strippedBytes} bytes (hashed and stored payload excludes it)`,
    });
  }
  if (canonical.converted) {
    facts.push({ label: 'Byte order normalised', value: canonical.converted });
  }
  for (const [k, v] of Object.entries(detection.header.fields)) {
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'object') continue;
    const label = k
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (c) => c.toUpperCase());
    facts.push({ label, value: String(v) });
  }
  for (const w of detection.header.warnings) {
    errors.push({
      code: 'HEADER_WARNING',
      severity: 'warning',
      message: w,
    });
  }
  if (catalogueConsulted.length) {
    facts.push({
      label: 'Catalogue',
      value: catalogueUnavailable
        ? 'not installed — run `npm run fetch:dat` to enable exact identification'
        : catalogueConsulted
            .map((c) => `${c.platform}: ${c.loaded ? `${c.count.toLocaleString()} fingerprints` : 'not installed'}`)
            .join(', '),
    });
  }

  // Payload sanity checks that catch mis-identified files.
  if (canonical.bytes.length > 0) {
    if (looksCompressed(canonical.bytes)) {
      errors.push({
        code: 'PAYLOAD_HIGH_ENTROPY',
        severity: 'warning',
        message:
          'The payload has very high entropy (looks compressed or encrypted). Emulators will likely reject it unless it is an expected compressed container.',
        remedy: 'If this is a patched ROM, verify the patch was applied as unheadered/linear data.',
      });
    }
    const range = platform?.romSizeRange;
    if (range && (canonical.bytes.length < range[0] || canonical.bytes.length > range[1])) {
      errors.push({
        code: 'SIZE_OUT_OF_RANGE',
        severity: 'warning',
        message: `Payload size ${formatBytes(canonical.bytes.length)} is outside the typical ${platform?.name} range (${formatBytes(range[0])}–${formatBytes(range[1])}).`,
        remedy: 'Check for a truncated download or an over-dump with padding.',
      });
    }
  }

  // Dependencies — firmware and companion files, never bundled by Recompa.
  const dependencies: RomDependency[] = [];
  if (platform?.requiredFirmware) {
    platform.requiredFirmware.forEach((fw, idx) => {
      dependencies.push({
        id: `${platform.id}-firmware-${idx}`,
        name: fw.name,
        reason: fw.reason,
        required: !fw.optional,
        acceptedSizes: fw.sizes,
      });
    });
  }
  if (detection.format?.id === 'cue') {
    const tracks = String(detection.header.fields.trackCount ?? '0');
    dependencies.push({
      id: 'cue-tracks',
      name: `Referenced .bin track data (${tracks} file${tracks === '1' ? '' : 's'})`,
      reason: 'A cue sheet indexes audio/data tracks but contains no game data itself.',
      required: true,
      expectedFileName: 'same directory as the .cue',
    });
  }

  if (!detection.platformId) {
    errors.push({
      code: 'NO_PLATFORM',
      severity: 'fatal',
      message: 'Platform could not be determined — no execution method can be offered.',
      remedy: 'See the format error above. Recompa does not guess platforms: a wrong guess produces broken gameplay.',
    });
  }

  // Title identification: database beats embedded header beats filename.
  const embeddedTitle = detection.embeddedTitle?.trim() || null;
  const titleFromFile = titleFromFileName(fileName);
  const title = match?.name ?? embeddedTitle ?? titleFromFile;
  const titleSource: AnalysisReport['identification']['titleSource'] = match
    ? 'database'
    : embeddedTitle
      ? 'header'
      : titleFromFile
        ? 'filename'
        : 'none';

  const region: RegionCode = match
    ? (match.region as RegionCode)
    : (detection.regionHint ?? 'UNKNOWN');

  const format: DetectedFormat | null = detection.format;

  const report: AnalysisReport = {
    schemaVersion: 1,
    id: newId(),
    createdAt: Date.now(),
    fileName,
    fileSize: options.archiveSize ?? payload.length,
    platform,
    platformConfidence: detection.platformConfidence,
    platformEvidence: format?.evidence ?? [],
    format,
    errors,
    header: detection.header,
    checksums,
    identification: {
      title,
      titleSource,
      region,
      regionSource: match ? 'database' : detection.regionHint ? 'header' : 'none',
      version: match?.version ?? (detection.header.fields.version !== undefined ? `v${String(detection.header.fields.version)}` : null),
      serial: detection.serial,
      catalogueMatch: match,
    },
    dependencies,
    facts,
  };

  if (import.meta.env?.DEV) {
    const ms = performance.now() - started;
    if (ms > 400) console.debug(`[analyze] ${fileName} took ${ms.toFixed(0)}ms`);
  }
  return report;
}

/** Normalise a payload to the canonical form used for hashing and storage. */
function canonicalise(detection: DetectionResult): { bytes: Uint8Array; converted: string | null } {
  if (detection.platformId === 'n64') {
    const order = detection.header.fields.byteOrder as 'big' | 'little' | 'byteswapped' | undefined;
    if (order && order !== 'big') {
      return {
        bytes: toBigEndianN64(detection.payload, order),
        converted: `${order} → big endian (.z64 canonical)`,
      };
    }
  }
  if (detection.header.strippedBytes > 0 && detection.platformId !== 'n64') {
    // Detectors already return the stripped payload for their platform.
    return { bytes: detection.payload, converted: null };
  }
  return { bytes: detection.payload, converted: null };
}

export function titleFromFileName(fileName: string): string | null {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  // No-Intro style names end with one or more parenthesised tags:
  // "(USA)", "(Rev 1)", "(Proto)", "(En,Fr,De)". Strip every trailing tag group,
  // then any square-bracket markers ("[!]", "[b]").
  let cleaned = base;
  // Loop on the *combined* pattern: "[!]" after "(Europe)" only becomes a
  // trailing tag once the bracket group has been removed.
  for (let guard = 0; guard < 16; guard++) {
    const next = cleaned
      .replace(/\s*\([^()]*\)\s*$/, '')
      .replace(/\s*\[[^\]]*\]\s*$/, '')
      .trim();
    if (next === cleaned) break;
    cleaned = next;
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length < 2) return null;
  return cleaned;
}

/** Human summary used by the UI headline; contains no invented claims. */
export function summarize(report: AnalysisReport): string {
  if (!report.platform) return 'Unrecognised file — no platform could be verified from its contents.';
  const title = report.identification.title ?? 'Unidentified title';
  const how = report.identification.titleSource === 'database' ? '' : ' (title from file, not verified)';
  return `${title}${how} — ${report.platform.name}`;
}

/** Hexdump used by the technical report viewer. */
export function hexdump(bytes: Uint8Array, limit = 256): string[] {
  const lines: string[] = [];
  const max = Math.min(bytes.length, limit);
  for (let off = 0; off < max; off += 16) {
    const slice = bytes.subarray(off, Math.min(off + 16, max));
    const hex = Array.from(slice, (b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47);
    const ascii = new ByteReader(slice).ascii(0, slice.length);
    lines.push(`${formatHex(off, 6)}  ${hex}  |${ascii}|`);
  }
  if (bytes.length > max) lines.push(`… ${bytes.length - max} more bytes`);
  return lines;
}

export { sha256, extensionOf };
