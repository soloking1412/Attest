import {
  ATTEST_DOCUMENT_LABEL,
  assertMetadataLimits,
  AttestError,
  CIP170_LABEL,
  decodeDocument,
  decodeRecord,
  encodeDocument,
  encodeRecord,
  parseAttestation,
  serialize,
  subjectScripts,
  type Attestation,
  type AttestIndex,
  type AttestRecord,
  type BuildAttestation,
  type Metadatum,
} from '@attest/core';
import {
  CIP171_LABEL,
  decodeCip171Metadata,
  toCip171Metadata,
  type VerificationRecord,
} from '@attest/blueprint';

export interface PublicationInput {
  readonly attestation: Attestation;
  /** Sequence number of the key event anchoring the attestation, lowercase hex. */
  readonly sequence: string;
  /**
   * Carries the document in the same transaction. Without it a verifier has to
   * resolve the document from somewhere else before it can check anything.
   */
  readonly includeDocument?: boolean;
  /** Emitted alongside so CIP-171 verifiers see the build without knowing Attest. */
  readonly verification?: VerificationRecord;
}

export interface Publication {
  readonly record: AttestRecord;
  readonly attestation?: Attestation;
  readonly verification?: VerificationRecord;
}

export function buildMetadata(input: PublicationInput): Record<string, Metadatum> {
  const { attestation } = input;
  const record: AttestRecord = {
    type: 'ATTEST',
    issuer: attestation.i,
    digest: attestation.d,
    sequence: input.sequence,
    index: indexFor(attestation),
  };

  const metadata: Record<string, Metadatum> = {
    [String(CIP170_LABEL)]: encodeRecord(record),
  };

  if (input.includeDocument !== false) {
    metadata[String(ATTEST_DOCUMENT_LABEL)] = encodeDocument(serialize(attestation));
  }

  if (input.verification !== undefined) {
    Object.assign(metadata, toCip171Metadata(input.verification));
  }

  for (const value of Object.values(metadata)) assertMetadataLimits(value);
  return metadata;
}

/**
 * Reads a publication out of a transaction's metadata and checks the parts
 * agree with one another. Agreement is not proof: it only establishes that the
 * transaction is internally coherent, leaving the issuer's authority and the
 * key event anchor still to be verified.
 */
export function readPublication(metadata: Record<string, Metadatum>): Publication {
  const payload = metadata[String(CIP170_LABEL)];
  if (payload === undefined) {
    throw new AttestError('INVALID_METADATA', 'Transaction carries no CIP-170 record');
  }

  const record = decodeRecord(payload);
  if (record.type !== 'ATTEST') {
    throw new AttestError('INVALID_METADATA', 'Publication is not an ATTEST record', {
      type: record.type,
    });
  }

  const document = metadata[String(ATTEST_DOCUMENT_LABEL)];
  const attestation =
    document === undefined ? undefined : parseAttestation(decodeDocument(document));

  if (attestation !== undefined) {
    if (attestation.d !== record.digest) {
      throw new AttestError(
        'DIGEST_MISMATCH',
        'Inline document does not match the CIP-170 digest',
        {
          record: record.digest,
          document: attestation.d,
        },
      );
    }
    if (attestation.i !== record.issuer) {
      throw new AttestError('INVALID_METADATA', 'Inline document names a different issuer', {
        record: record.issuer,
        document: attestation.i,
      });
    }
    assertIndexAgrees(record.index, attestation);
  }

  const verificationPayload = metadata[String(CIP171_LABEL)];
  const verification =
    verificationPayload === undefined ? undefined : decodeCip171Metadata(verificationPayload);

  if (verification !== undefined && attestation?.t === 'build') {
    assertVerificationAgrees(verification, attestation);
  }

  return {
    record,
    ...(attestation !== undefined ? { attestation } : {}),
    ...(verification !== undefined ? { verification } : {}),
  };
}

/** Derives the CIP-171 record a build attestation implies. */
export function verificationRecordFor(attestation: BuildAttestation): VerificationRecord {
  const { source, compiler } = attestation.a;
  return {
    compiler: compiler.name,
    sourceUrl: source.url,
    commit: source.commit,
    ...(source.path !== undefined ? { sourcePath: source.path } : {}),
    compilerVersion: compiler.version,
    ...(attestation.a.parameters !== undefined
      ? { parameters: { [attestation.a.script.hash]: [...attestation.a.parameters] } }
      : {}),
  };
}

function indexFor(attestation: Attestation): AttestIndex {
  const hashes = subjectScripts(attestation).map((script) => script.hash);
  return { t: attestation.t, ...(hashes.length > 0 ? { h: hashes } : {}) };
}

function assertIndexAgrees(index: AttestIndex | undefined, attestation: Attestation): void {
  if (index === undefined) return;
  if (index.t !== attestation.t) {
    throw new AttestError('INVALID_METADATA', 'Index hint names a different attestation type', {
      hint: index.t,
      document: attestation.t,
    });
  }
  if (index.h === undefined) return;

  const expected = new Set(subjectScripts(attestation).map((script) => script.hash));
  const unexpected = index.h.filter((hash) => !expected.has(hash));
  if (unexpected.length > 0 || index.h.length !== expected.size) {
    throw new AttestError('INVALID_METADATA', 'Index hints do not match the document', {
      unexpected,
    });
  }
}

function assertVerificationAgrees(
  verification: VerificationRecord,
  attestation: BuildAttestation,
): void {
  const { source, compiler } = attestation.a;
  const mismatches: string[] = [];
  if (verification.sourceUrl !== source.url) mismatches.push('sourceUrl');
  if (verification.commit !== source.commit) mismatches.push('commit');
  if (verification.compiler !== compiler.name) mismatches.push('compiler');
  if (verification.compilerVersion !== compiler.version) mismatches.push('compilerVersion');

  if (mismatches.length > 0) {
    throw new AttestError('INVALID_METADATA', 'CIP-171 record contradicts the attestation', {
      fields: mismatches,
    });
  }
}
