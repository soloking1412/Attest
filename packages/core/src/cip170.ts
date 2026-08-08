import { assertAid, assertDigest, isQb64 } from './cesr.js';
import { AttestError } from './errors.js';
import { fromHex, utf8 } from './bytes.js';
import { assertArray, assertOneOf, assertRecord, assertString } from './validate.js';

/** Transaction metadata label reserved by CIP-170 for KERI-backed attestations. */
export const CIP170_LABEL = 170;

/**
 * Label carrying the attestation document itself, so verification needs no
 * off-chain fetch. Provisional pending CIP-10 registration.
 */
export const ATTEST_DOCUMENT_LABEL = 1701;

/** Cardano rejects transaction metadata strings longer than 64 bytes. */
export const METADATA_STRING_LIMIT = 64;

/**
 * Prefix marking a metadata string that stands for bytes rather than text.
 *
 * This is the basic conversion rule Cardano tooling applies when turning JSON
 * into metadata, so `0x` followed by 128 hex digits is 64 bytes on chain, not
 * 130. Anything measuring or converting a metadatum has to apply the same rule
 * or it will disagree with the ledger.
 */
export const BYTES_PREFIX = '0x';

/** Decodes a metadatum string that denotes bytes, or undefined when it is text. */
export function decodeBytesString(value: string): Uint8Array | undefined {
  if (!value.startsWith(BYTES_PREFIX)) return undefined;
  const hex = value.slice(BYTES_PREFIX.length);
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return undefined;
  return fromHex(hex);
}

/** Size a metadatum string occupies on chain. */
export function metadatumSize(value: string): number {
  return decodeBytesString(value)?.length ?? utf8(value).length;
}

export const CIP170_VERSION = '1.0';
export const KERI_VERSION = 'KERI10';
export const ACDC_VERSION = 'ACDC10';

export const CIP170_TYPES = ['AUTH_BEGIN', 'ATTEST', 'AUTH_END'] as const;
export type Cip170Type = (typeof CIP170_TYPES)[number];

export type Metadatum = string | number | Metadatum[] | { [key: string]: Metadatum };

/**
 * Non-authoritative hints that let an indexer filter transactions without
 * resolving every document. A verifier re-derives these from the document and
 * treats a mismatch as an unindexed record, never as a valid claim.
 */
export interface AttestIndex {
  /** Attestation type, mirroring the document's `t`. */
  readonly t: string;
  /** Script hashes the attestation makes claims about. */
  readonly h?: readonly string[];
}

export interface AttestRecord {
  readonly type: 'ATTEST';
  readonly issuer: string;
  /** SAID of the attestation document, anchored in the issuer's KEL. */
  readonly digest: string;
  /** Sequence number of the anchoring key event, lowercase hex. */
  readonly sequence: string;
  readonly index?: AttestIndex;
}

export interface AuthRecord {
  readonly type: 'AUTH_BEGIN' | 'AUTH_END';
  readonly issuer: string;
  /** SAID of the leaf credential schema. */
  readonly schema: string;
  /** CESR stream of the credential chain or its revocation events. */
  readonly credential: string;
  readonly index?: AttestIndex;
}

export type Cip170Record = AttestRecord | AuthRecord;

export function encodeRecord(record: Cip170Record): Metadatum {
  return record.type === 'ATTEST' ? encodeAttest(record) : encodeAuth(record);
}

function encodeAttest(record: AttestRecord): Metadatum {
  assertAid(record.issuer, 'i');
  assertDigest(record.digest, 'd');
  assertSequence(record.sequence);

  return {
    t: record.type,
    i: record.issuer,
    d: record.digest,
    s: record.sequence,
    v: { v: CIP170_VERSION },
    ...(record.index !== undefined ? { m: encodeIndex(record.index) } : {}),
  };
}

function encodeAuth(record: AuthRecord): Metadatum {
  assertAid(record.issuer, 'i');
  assertDigest(record.schema, 's');
  assertString(record.credential, 'c');

  return {
    t: record.type,
    s: record.schema,
    i: record.issuer,
    c: chunk(record.credential),
    v: { v: CIP170_VERSION, k: KERI_VERSION, a: ACDC_VERSION },
    ...(record.index !== undefined ? { m: encodeIndex(record.index) } : {}),
  };
}

export function decodeRecord(value: unknown): Cip170Record {
  assertRecord(value, '170');
  assertOneOf(value.t, '170.t', CIP170_TYPES);
  assertAid(value.i, '170.i');

  if (value.t === 'ATTEST') {
    assertDigest(value.d, '170.d');
    assertString(value.s, '170.s');
    assertSequence(value.s);
    const index = decodeIndex(value.m);
    return {
      type: 'ATTEST',
      issuer: value.i,
      digest: value.d,
      sequence: value.s,
      ...(index !== undefined ? { index } : {}),
    };
  }

  assertDigest(value.s, '170.s');
  const index = decodeIndex(value.m);
  return {
    type: value.t,
    issuer: value.i,
    schema: value.s,
    credential: unchunk(value.c, '170.c'),
    ...(index !== undefined ? { index } : {}),
  };
}

/** Wraps a record in the label map a transaction carries it under. */
export function toMetadata(record: Cip170Record): Record<string, Metadatum> {
  return { [String(CIP170_LABEL)]: encodeRecord(record) };
}

/** Splits a serialized document into chunks a transaction can carry. */
export function encodeDocument(serialized: string): Metadatum {
  return chunk(serialized);
}

export function decodeDocument(value: unknown): string {
  return unchunk(value, String(ATTEST_DOCUMENT_LABEL));
}

function encodeIndex(index: AttestIndex): Metadatum {
  assertString(index.t, 'm.t');
  const hashes = index.h;
  if (hashes === undefined) return { t: index.t };
  hashes.forEach((hash, position) => assertString(hash, `m.h[${position}]`));
  return { t: index.t, h: [...hashes] };
}

function decodeIndex(value: unknown): AttestIndex | undefined {
  if (value === undefined || value === null) return undefined;
  assertRecord(value, '170.m');
  assertString(value.t, '170.m.t');
  if (value.h === undefined) return { t: value.t };
  assertArray(value.h, '170.m.h');
  const hashes = value.h.map((item, position) => {
    assertString(item, `170.m.h[${position}]`);
    return item;
  });
  return { t: value.t, h: hashes };
}

const SEQUENCE_PATTERN = /^(?:0|[1-9a-f][0-9a-f]*)$/;

export function formatSequence(value: number | bigint): string {
  const sequence = BigInt(value);
  if (sequence < 0n) {
    throw new AttestError('INVALID_METADATA', 'Sequence number must not be negative', { value });
  }
  return sequence.toString(16);
}

export function parseSequence(value: string): bigint {
  assertSequence(value);
  return BigInt(`0x${value}`);
}

function assertSequence(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SEQUENCE_PATTERN.test(value)) {
    throw new AttestError('INVALID_METADATA', 'Sequence number must be lowercase hex', { value });
  }
}

/**
 * Splits a string on UTF-8 byte boundaries so no chunk exceeds the metadata
 * limit. Returns the string unchanged when it already fits, which keeps short
 * fields readable in explorers.
 */
export function chunk(value: string, limit: number = METADATA_STRING_LIMIT): string | string[] {
  const encoded = utf8(value);
  if (encoded.length <= limit) return value;

  const chunks: string[] = [];
  let start = 0;
  while (start < encoded.length) {
    let end = Math.min(start + limit, encoded.length);
    while (end > start && end < encoded.length && isContinuation(encoded[end] as number)) {
      end -= 1;
    }
    chunks.push(new TextDecoder().decode(encoded.subarray(start, end)));
    start = end;
  }
  return chunks;
}

export function unchunk(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) {
    throw new AttestError('INVALID_METADATA', `Field "${field}" must be a string or string array`, {
      field,
    });
  }
  return value
    .map((part, index) => {
      if (typeof part !== 'string') {
        throw new AttestError('INVALID_METADATA', `Chunk ${index} of "${field}" is not a string`, {
          field,
        });
      }
      return part;
    })
    .join('');
}

function isContinuation(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

/** Rejects metadata that would be refused by the ledger before it is submitted. */
export function assertMetadataLimits(value: Metadatum, path = '$'): void {
  if (typeof value === 'string') {
    const size = metadatumSize(value);
    if (size > METADATA_STRING_LIMIT) {
      throw new AttestError('INVALID_METADATA', 'Metadata string exceeds 64 bytes', { path, size });
    }
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new AttestError('INVALID_METADATA', 'Metadata numbers must be safe integers', { path });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMetadataLimits(item, `${path}[${index}]`));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    assertMetadataLimits(key, `${path}.${key}`);
    assertMetadataLimits(item, `${path}.${key}`);
  }
}

/** True when `value` is plausibly a CIP-170 payload, used to filter chain scans. */
export function looksLikeCip170(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.t === 'string' &&
    (CIP170_TYPES as readonly string[]).includes(record.t) &&
    isQb64(record.i)
  );
}
