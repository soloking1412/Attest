import {
  assertHex,
  assertString,
  AttestError,
  BYTES_PREFIX,
  COMPILERS,
  concat,
  fromHex,
  fromUtf8,
  SCRIPT_HASH_BYTES,
  toHex,
  utf8,
  type Compiler,
} from '@attest/core';

import { decodePlutusData, encodePlutusData, type PlutusData } from './plutus.js';

/** Transaction metadata label CIP-171 registers for bytecode verification. */
export const CIP171_LABEL = 1984;

/** Ledger limit on a single metadata byte string. */
export const CHUNK_SIZE = 64;

/** Constructor ids CIP-171 assigns to each compiler and schema version. */
export const COMPILER_CONSTRUCTORS: Readonly<Record<Compiler, number>> = {
  aiken: 0,
  plutarch: 1,
  plutustx: 2,
  scalus: 3,
  'plu-ts': 4,
  opshin: 5,
};

const CONSTRUCTOR_COMPILERS = new Map<number, Compiler>(
  Object.entries(COMPILER_CONSTRUCTORS).map(([name, id]) => [id, name as Compiler]),
);

const COMMIT_SIZES = [20, 32];

export interface VerificationRecord {
  readonly compiler: Compiler;
  readonly sourceUrl: string;
  /** Git commit hash, 20 or 32 bytes. */
  readonly commit: string;
  readonly sourcePath?: string;
  readonly compilerVersion: string;
  /** Applied parameters keyed by the resulting script hash, CBOR PlutusData in hex. */
  readonly parameters?: Readonly<Record<string, readonly string[]>>;
}

export function encodeVerificationRecord(record: VerificationRecord): PlutusData {
  assertString(record.sourceUrl, 'sourceUrl');
  assertString(record.compilerVersion, 'compilerVersion');
  assertHex(record.commit, 'commit');
  if (!COMMIT_SIZES.includes(record.commit.length / 2)) {
    throw new AttestError('INVALID_METADATA', 'Commit hash must be 20 or 32 bytes', {
      bytes: record.commit.length / 2,
    });
  }

  const alternative = COMPILER_CONSTRUCTORS[record.compiler];
  if (alternative === undefined) {
    throw new AttestError('INVALID_METADATA', 'Compiler is outside the CIP-171 registry', {
      compiler: record.compiler,
      registry: COMPILERS,
    });
  }

  const fields: PlutusData[] = [
    { kind: 'bytes', value: utf8(record.sourceUrl) },
    { kind: 'bytes', value: fromHex(record.commit) },
    record.sourcePath === undefined
      ? { kind: 'null' }
      : { kind: 'bytes', value: utf8(record.sourcePath) },
    { kind: 'bytes', value: utf8(record.compilerVersion) },
  ];

  if (record.parameters !== undefined) {
    fields.push(encodeParameters(record.parameters));
  }

  return { kind: 'constr', tag: alternative, fields };
}

export function decodeVerificationRecord(data: PlutusData): VerificationRecord {
  if (data.kind !== 'constr') {
    throw new AttestError('INVALID_METADATA', 'CIP-171 record must be a constructor');
  }
  const compiler = CONSTRUCTOR_COMPILERS.get(data.tag);
  if (compiler === undefined) {
    throw new AttestError('INVALID_METADATA', 'Unknown compiler constructor id', { tag: data.tag });
  }

  const [sourceUrl, commit, sourcePath, compilerVersion, parameters] = data.fields;
  if (sourceUrl === undefined || commit === undefined || compilerVersion === undefined) {
    throw new AttestError('INVALID_METADATA', 'CIP-171 record is missing required fields', {
      present: data.fields.length,
    });
  }

  return {
    compiler,
    sourceUrl: readText(sourceUrl, 'sourceUrl'),
    commit: toHex(readBytes(commit, 'commit')),
    ...(sourcePath !== undefined && sourcePath.kind !== 'null'
      ? { sourcePath: readText(sourcePath, 'sourcePath') }
      : {}),
    compilerVersion: readText(compilerVersion, 'compilerVersion'),
    ...(parameters !== undefined ? { parameters: decodeParameters(parameters) } : {}),
  };
}

/** Serializes a record into the chunked metadata a transaction carries. */
export function toCip171Metadata(record: VerificationRecord): Record<string, string[]> {
  const encoded = encodePlutusData(encodeVerificationRecord(record));
  const chunks: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += CHUNK_SIZE) {
    chunks.push(BYTES_PREFIX + toHex(encoded.subarray(offset, offset + CHUNK_SIZE)));
  }
  return { [String(CIP171_LABEL)]: chunks };
}

export function decodeCip171Metadata(value: unknown): VerificationRecord {
  if (!Array.isArray(value)) {
    throw new AttestError('INVALID_METADATA', 'CIP-171 metadata must be an array of chunks');
  }
  const parts = value.map((chunk, index) => {
    if (typeof chunk !== 'string') {
      throw new AttestError('INVALID_METADATA', 'CIP-171 chunk is not a string', { index });
    }
    const hex = chunk.startsWith(BYTES_PREFIX) ? chunk.slice(BYTES_PREFIX.length) : chunk;
    return fromHex(hex);
  });
  return decodeVerificationRecord(decodePlutusData(concat(...parts)));
}

function encodeParameters(parameters: Readonly<Record<string, readonly string[]>>): PlutusData {
  const entries = Object.entries(parameters).map(([scriptHash, values]) => {
    assertHex(scriptHash, 'parameters key', SCRIPT_HASH_BYTES);
    const items = values.map((value, index) => {
      assertHex(value, `parameters[${scriptHash}][${index}]`);
      return decodePlutusData(fromHex(value));
    });
    return [
      { kind: 'bytes', value: fromHex(scriptHash) },
      { kind: 'list', items },
    ] as const satisfies readonly [PlutusData, PlutusData];
  });
  return { kind: 'map', entries };
}

function decodeParameters(data: PlutusData): Record<string, string[]> {
  if (data.kind !== 'map') {
    throw new AttestError('INVALID_METADATA', 'Parameters field must be a map');
  }
  const out: Record<string, string[]> = {};
  for (const [key, value] of data.entries) {
    if (value.kind !== 'list') {
      throw new AttestError('INVALID_METADATA', 'Parameter list must be an array');
    }
    out[toHex(readBytes(key, 'parameters key'))] = value.items.map((item) =>
      toHex(encodePlutusData(item)),
    );
  }
  return out;
}

function readBytes(data: PlutusData, field: string): Uint8Array {
  if (data.kind !== 'bytes') {
    throw new AttestError('INVALID_METADATA', `Field "${field}" must be a byte string`, { field });
  }
  return data.value;
}

function readText(data: PlutusData, field: string): string {
  return fromUtf8(readBytes(data, field));
}
