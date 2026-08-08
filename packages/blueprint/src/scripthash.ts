import { AttestError, blake2b224, concat, fromHex, toHex, type PlutusVersion } from '@attest/core';

/** Language tag prefixed to a script before hashing, per the ledger specification. */
export const LANGUAGE_TAGS: Readonly<Record<PlutusVersion, number>> = {
  v1: 0x01,
  v2: 0x02,
  v3: 0x03,
};

const MAJOR_BYTES = 2;

interface ByteStringHeader {
  readonly headerLength: number;
  readonly payloadLength: number;
}

function readByteStringHeader(bytes: Uint8Array): ByteStringHeader | undefined {
  const initial = bytes[0];
  if (initial === undefined || initial >> 5 !== MAJOR_BYTES) return undefined;

  const additional = initial & 0x1f;
  if (additional < 24) return { headerLength: 1, payloadLength: additional };

  const width = additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : 0;
  if (width === 0 || bytes.length < 1 + width) return undefined;

  let payloadLength = 0;
  for (let index = 1; index <= width; index += 1) {
    payloadLength = payloadLength * 256 + (bytes[index] as number);
  }
  return { headerLength: 1 + width, payloadLength };
}

/** True when the buffer is exactly one CBOR byte string and nothing else. */
export function isCborWrapped(bytes: Uint8Array): boolean {
  const header = readByteStringHeader(bytes);
  return header !== undefined && header.headerLength + header.payloadLength === bytes.length;
}

/**
 * Returns the script exactly as it appears in a transaction witness set: the
 * flat-encoded program inside a single CBOR byte string.
 *
 * Toolchains disagree on how many wrappers `compiledCode` already carries, and
 * hashing the wrong form silently produces a hash that matches nothing on
 * chain, so the wrapping is normalised rather than assumed.
 */
export function normalizeScriptBytes(compiledCode: string | Uint8Array): Uint8Array {
  const bytes = typeof compiledCode === 'string' ? fromHex(compiledCode) : compiledCode;
  if (bytes.length === 0) {
    throw new AttestError('INVALID_ENCODING', 'Compiled code is empty');
  }
  return isCborWrapped(bytes) ? bytes : wrap(bytes);
}

function wrap(payload: Uint8Array): Uint8Array {
  const length = payload.length;
  let header: Uint8Array;
  if (length < 24) {
    header = Uint8Array.of((MAJOR_BYTES << 5) | length);
  } else if (length < 0x100) {
    header = Uint8Array.of((MAJOR_BYTES << 5) | 24, length);
  } else if (length < 0x10000) {
    header = Uint8Array.of((MAJOR_BYTES << 5) | 25, length >> 8, length & 0xff);
  } else {
    header = Uint8Array.of(
      (MAJOR_BYTES << 5) | 26,
      (length >>> 24) & 0xff,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
    );
  }
  return concat(header, payload);
}

/** Blake2b-224 over the language tag and the serialized script. */
export function computeScriptHash(
  compiledCode: string | Uint8Array,
  plutusVersion: PlutusVersion,
): string {
  const tag = LANGUAGE_TAGS[plutusVersion];
  if (tag === undefined) {
    throw new AttestError('INVALID_ENCODING', 'Unknown Plutus version', { plutusVersion });
  }
  const script = normalizeScriptBytes(compiledCode);
  return toHex(blake2b224(concat(Uint8Array.of(tag), script)));
}

/** Recovers the Plutus version a hash was produced under, when one matches. */
export function inferPlutusVersion(
  compiledCode: string | Uint8Array,
  expectedHash: string,
): PlutusVersion | undefined {
  for (const version of Object.keys(LANGUAGE_TAGS) as PlutusVersion[]) {
    if (computeScriptHash(compiledCode, version) === expectedHash) return version;
  }
  return undefined;
}
