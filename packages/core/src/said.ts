import { canonicalBytes, canonicalize, type JsonValue } from './canonical.js';
import { decodeMatter, qb64Length } from './cesr.js';
import {
  algorithmForCode,
  DEFAULT_DIGEST,
  digestCode,
  qb64Digest,
  type DigestAlgorithm,
} from './digest.js';
import { AttestError, invariant } from './errors.js';
import { formatVersion, parseVersion } from './version.js';

const PLACEHOLDER_CHAR = '#';

export interface SelfAddressing {
  readonly v: string;
  readonly d: string;
}

/**
 * Documents reach this module as typed values rather than as `JsonValue`.
 * `canonicalize` walks and rejects anything that is not JSON, so the cast is
 * checked at runtime where it matters.
 */
function asJson(document: SelfAddressing): JsonValue {
  return document as unknown as JsonValue;
}

/**
 * Fills in the version string and the self-addressing identifier of a document.
 *
 * The digest covers the document with `d` replaced by a placeholder of equal
 * length, so substituting the result back leaves the serialized size unchanged
 * and the size recorded in `v` stays accurate.
 */
export function saidify<T extends SelfAddressing>(
  document: T,
  algorithm: DigestAlgorithm = DEFAULT_DIGEST,
): T {
  const draft = withPlaceholder(document, algorithm);
  const size = canonicalBytes(asJson({ ...draft, v: formatVersion(0) })).length;
  const sized = { ...draft, v: formatVersion(size) };
  return { ...sized, d: qb64Digest(canonicalBytes(asJson(sized)), algorithm) };
}

export function computeSaid(document: SelfAddressing, algorithm?: DigestAlgorithm): string {
  return saidify(document, algorithm).d;
}

/** Throws unless the document's version string and `d` field match its contents. */
export function verifySaid(document: SelfAddressing): void {
  invariant(
    typeof document.d === 'string' && document.d.length > 0,
    'INVALID_DOCUMENT',
    'Document has no self-addressing identifier',
  );

  const { code } = decodeMatter(document.d);
  const algorithm = algorithmForCode(code);
  const expected = parseVersion(document.v).size;
  const actual = canonicalBytes(asJson(document)).length;
  if (expected !== actual) {
    throw new AttestError('INVALID_DOCUMENT', 'Version string size does not match the document', {
      expected,
      actual,
    });
  }

  const recomputed = computeSaid(document, algorithm);
  if (recomputed !== document.d) {
    throw new AttestError('SAID_MISMATCH', 'Document does not hash to its stated identifier', {
      stated: document.d,
      computed: recomputed,
    });
  }
}

/** Serialized form of a document, byte-identical to what its SAID commits to. */
export function serialize(document: SelfAddressing): string {
  return canonicalize(asJson(document));
}

function withPlaceholder<T extends SelfAddressing>(document: T, algorithm: DigestAlgorithm): T {
  const placeholder = PLACEHOLDER_CHAR.repeat(qb64Length(digestCode(algorithm)));
  return { ...document, d: placeholder };
}
