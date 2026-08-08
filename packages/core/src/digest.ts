import { blake2b } from '@noble/hashes/blake2.js';
import { blake2s } from '@noble/hashes/blake2.js';
import { blake3 } from '@noble/hashes/blake3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { sha3_256 } from '@noble/hashes/sha3.js';

import { encodeMatter, MatterCode } from './cesr.js';
import { AttestError } from './errors.js';
import { utf8 } from './bytes.js';

export type DigestAlgorithm =
  'blake3-256' | 'blake2b-256' | 'blake2s-256' | 'sha3-256' | 'sha2-256';

export const DEFAULT_DIGEST: DigestAlgorithm = 'blake3-256';

const ALGORITHMS: Record<
  DigestAlgorithm,
  { readonly code: string; readonly hash: (data: Uint8Array) => Uint8Array }
> = {
  'blake3-256': { code: MatterCode.Blake3_256, hash: (data) => blake3(data) },
  'blake2b-256': { code: MatterCode.Blake2b_256, hash: (data) => blake2b(data, { dkLen: 32 }) },
  'blake2s-256': { code: MatterCode.Blake2s_256, hash: (data) => blake2s(data, { dkLen: 32 }) },
  'sha3-256': { code: MatterCode.SHA3_256, hash: (data) => sha3_256(data) },
  'sha2-256': { code: MatterCode.SHA2_256, hash: (data) => sha256(data) },
};

const CODE_TO_ALGORITHM = new Map<string, DigestAlgorithm>(
  Object.entries(ALGORITHMS).map(([name, spec]) => [spec.code, name as DigestAlgorithm]),
);

export function digestCode(algorithm: DigestAlgorithm): string {
  return spec(algorithm).code;
}

export function algorithmForCode(code: string): DigestAlgorithm {
  const algorithm = CODE_TO_ALGORITHM.get(code);
  if (!algorithm) {
    throw new AttestError('INVALID_ENCODING', 'CESR code is not a supported digest', { code });
  }
  return algorithm;
}

export function digest(data: Uint8Array, algorithm: DigestAlgorithm = DEFAULT_DIGEST): Uint8Array {
  return spec(algorithm).hash(data);
}

/** Digest of `data`, fully qualified as a CESR primitive. */
export function qb64Digest(
  data: Uint8Array | string,
  algorithm: DigestAlgorithm = DEFAULT_DIGEST,
): string {
  const bytes = typeof data === 'string' ? utf8(data) : data;
  return encodeMatter(spec(algorithm).code, spec(algorithm).hash(bytes));
}

/** Blake2b-224, the digest Cardano uses for script and key hashes. */
export function blake2b224(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 28 });
}

function spec(algorithm: DigestAlgorithm) {
  const entry = ALGORITHMS[algorithm];
  if (!entry) {
    throw new AttestError('INVALID_ENCODING', 'Unsupported digest algorithm', { algorithm });
  }
  return entry;
}
