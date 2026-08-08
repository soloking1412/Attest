import { concat, fromBase64Url, toBase64Url } from './bytes.js';
import { AttestError } from './errors.js';

/**
 * The subset of the CESR Matter code table used by Attest. CESR is the primitive
 * encoding KERI uses for identifiers, digests and signatures; keeping to the
 * standard table is what lets Attest documents be consumed by KERI tooling.
 */
export const MatterCode = {
  Ed25519Seed: 'A',
  Ed25519N: 'B',
  X25519: 'C',
  Ed25519: 'D',
  Blake3_256: 'E',
  Blake2b_256: 'F',
  Blake2s_256: 'G',
  SHA3_256: 'H',
  SHA2_256: 'I',
  Ed25519Sig: '0B',
} as const;

export type MatterCodeValue = (typeof MatterCode)[keyof typeof MatterCode];

interface CodeSpec {
  readonly rawSize: number;
  readonly padSize: number;
  readonly fullSize: number;
}

function specFor(code: string, rawSize: number): CodeSpec {
  const padSize = (3 - (rawSize % 3)) % 3;
  if (padSize !== code.length) {
    throw new AttestError('INVALID_ENCODING', 'Matter code length must equal its pad size', {
      code,
      rawSize,
    });
  }
  const base64Length = ((rawSize + padSize) / 3) * 4;
  return { rawSize, padSize, fullSize: code.length + base64Length - padSize };
}

const CODE_TABLE = new Map<string, CodeSpec>([
  [MatterCode.Ed25519Seed, specFor(MatterCode.Ed25519Seed, 32)],
  [MatterCode.Ed25519N, specFor(MatterCode.Ed25519N, 32)],
  [MatterCode.X25519, specFor(MatterCode.X25519, 32)],
  [MatterCode.Ed25519, specFor(MatterCode.Ed25519, 32)],
  [MatterCode.Blake3_256, specFor(MatterCode.Blake3_256, 32)],
  [MatterCode.Blake2b_256, specFor(MatterCode.Blake2b_256, 32)],
  [MatterCode.Blake2s_256, specFor(MatterCode.Blake2s_256, 32)],
  [MatterCode.SHA3_256, specFor(MatterCode.SHA3_256, 32)],
  [MatterCode.SHA2_256, specFor(MatterCode.SHA2_256, 32)],
  [MatterCode.Ed25519Sig, specFor(MatterCode.Ed25519Sig, 64)],
]);

/** Digest codes, in the order a verifier should try them when the code is unknown. */
export const DIGEST_CODES: readonly string[] = [
  MatterCode.Blake3_256,
  MatterCode.Blake2b_256,
  MatterCode.Blake2s_256,
  MatterCode.SHA3_256,
  MatterCode.SHA2_256,
];

export function codeSpec(code: string): CodeSpec {
  const spec = CODE_TABLE.get(code);
  if (!spec) {
    throw new AttestError('INVALID_ENCODING', 'Unsupported CESR Matter code', { code });
  }
  return spec;
}

/** Length in characters of a fully qualified primitive with the given code. */
export function qb64Length(code: string): number {
  return codeSpec(code).fullSize;
}

export function encodeMatter(code: string, raw: Uint8Array): string {
  const spec = codeSpec(code);
  if (raw.length !== spec.rawSize) {
    throw new AttestError('INVALID_ENCODING', 'Raw length does not match Matter code', {
      code,
      expected: spec.rawSize,
      actual: raw.length,
    });
  }
  const padded = concat(new Uint8Array(spec.padSize), raw);
  return code + toBase64Url(padded).slice(spec.padSize);
}

export function decodeMatter(qb64: string): { code: string; raw: Uint8Array } {
  const code = resolveCode(qb64);
  const spec = codeSpec(code);
  if (qb64.length !== spec.fullSize) {
    throw new AttestError('INVALID_ENCODING', 'Fully qualified primitive has wrong length', {
      code,
      expected: spec.fullSize,
      actual: qb64.length,
    });
  }
  const padChars = 'A'.repeat(spec.padSize);
  const decoded = fromBase64Url(padChars + qb64.slice(code.length));
  const raw = decoded.slice(spec.padSize);
  // The lead bytes are dropped on decode, so re-encoding is the check that the
  // pad bits really were zero rather than silently truncated.
  if (encodeMatter(code, raw) !== qb64) {
    throw new AttestError('INVALID_ENCODING', 'Primitive has non-zero pad bits', { code });
  }
  return { code, raw };
}

function resolveCode(qb64: string): string {
  const first = qb64[0];
  if (first === undefined) {
    throw new AttestError('INVALID_ENCODING', 'Empty CESR primitive');
  }
  // Codes beginning with a digit are two characters wide in the selector table.
  return first >= '0' && first <= '9' ? qb64.slice(0, 2) : first;
}

export function isQb64(value: unknown, allowedCodes?: readonly string[]): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const { code } = decodeMatter(value);
    return allowedCodes ? allowedCodes.includes(code) : true;
  } catch {
    return false;
  }
}

/** Codes an autonomic identifier prefix may carry. */
export const AID_CODES: readonly string[] = [
  MatterCode.Blake3_256,
  MatterCode.Blake2b_256,
  MatterCode.Ed25519N,
  MatterCode.Ed25519,
];

export function assertAid(value: unknown, field: string): asserts value is string {
  if (!isQb64(value, AID_CODES)) {
    throw new AttestError('INVALID_DOCUMENT', `Field "${field}" is not a valid KERI identifier`, {
      value,
    });
  }
}

export function assertDigest(value: unknown, field: string): asserts value is string {
  if (!isQb64(value, DIGEST_CODES)) {
    throw new AttestError('INVALID_DOCUMENT', `Field "${field}" is not a valid CESR digest`, {
      value,
    });
  }
}
