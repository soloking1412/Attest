import {
  AttestError,
  BYTES_PREFIX,
  decodeBytesString,
  METADATA_STRING_LIMIT,
  toHex,
  utf8,
  type Metadatum,
} from '@attest/core';

/**
 * The detailed metadata representation used by cardano-cli, Blockfrost and the
 * serialization libraries. Attest keeps plain JSON in memory and converts at
 * the edge, so a transaction builder is handed an unambiguous structure rather
 * than one that depends on the builder's own coercion rules.
 */
export type DetailedMetadatum =
  | { readonly int: number }
  | { readonly bytes: string }
  | { readonly string: string }
  | { readonly list: readonly DetailedMetadatum[] }
  | { readonly map: readonly { readonly k: DetailedMetadatum; readonly v: DetailedMetadatum }[] };

export function toDetailedSchema(value: Metadatum): DetailedMetadatum {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new AttestError('INVALID_METADATA', 'Metadata numbers must be safe integers', {
        value,
      });
    }
    return { int: value };
  }

  if (typeof value === 'string') {
    const bytes = decodeBytesString(value);
    if (bytes !== undefined) {
      assertSize(bytes.length, 'bytes');
      return { bytes: toHex(bytes) };
    }
    assertSize(utf8(value).length, 'string');
    return { string: value };
  }

  if (Array.isArray(value)) {
    return { list: value.map(toDetailedSchema) };
  }

  return {
    map: Object.entries(value).map(([key, item]) => ({
      k: toDetailedSchema(key),
      v: toDetailedSchema(item),
    })),
  };
}

export function fromDetailedSchema(value: DetailedMetadatum): Metadatum {
  if ('int' in value) return value.int;
  if ('bytes' in value) return BYTES_PREFIX + value.bytes;
  if ('string' in value) return value.string;
  if ('list' in value) return value.list.map(fromDetailedSchema);

  const out: Record<string, Metadatum> = {};
  for (const entry of value.map) {
    const key = fromDetailedSchema(entry.k);
    if (typeof key !== 'string') {
      throw new AttestError('INVALID_METADATA', 'Metadata map keys must decode to strings');
    }
    out[key] = fromDetailedSchema(entry.v);
  }
  return out;
}

/** Converts an entire label map, keeping the labels as decimal strings. */
export function toDetailedMetadata(
  metadata: Record<string, Metadatum>,
): Record<string, DetailedMetadatum> {
  const out: Record<string, DetailedMetadatum> = {};
  for (const [label, value] of Object.entries(metadata)) {
    assertLabel(label);
    out[label] = toDetailedSchema(value);
  }
  return out;
}

export function fromDetailedMetadata(
  metadata: Record<string, DetailedMetadatum>,
): Record<string, Metadatum> {
  const out: Record<string, Metadatum> = {};
  for (const [label, value] of Object.entries(metadata)) {
    out[label] = fromDetailedSchema(value);
  }
  return out;
}

function assertSize(size: number, kind: string): void {
  if (size > METADATA_STRING_LIMIT) {
    throw new AttestError('INVALID_METADATA', `Metadata ${kind} exceeds 64 bytes`, { size });
  }
}

function assertLabel(label: string): void {
  if (!/^(?:0|[1-9][0-9]*)$/.test(label)) {
    throw new AttestError('INVALID_METADATA', 'Metadata label must be a non-negative integer', {
      label,
    });
  }
}
