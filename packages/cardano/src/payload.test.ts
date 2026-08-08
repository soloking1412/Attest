import {
  ATTEST_DOCUMENT_LABEL,
  CIP170_LABEL,
  createAuditAttestation,
  createBuildAttestation,
  createRevocationAttestation,
  decodeDocument,
  serialize,
  type BuildBody,
  type Metadatum,
} from '@attest/core';
import { CIP171_LABEL } from '@attest/blueprint';
import { describe, expect, it } from 'vitest';

import { buildMetadata, readPublication, verificationRecordFor } from './payload.js';

const ISSUER = 'EKtQ1lymrnrh3qv5S18PBzQ7ukHGFJ7EXkH7B22XEMIL';
const DIGEST = 'ELC5L3iBVD77d_MYbYGGCUQgqQBju1o4x1Ud-z2sL-ux';
const SCRIPT_HASH = 'd7a75e29fc699c832922e4594b5ac04ed4701b06f680ed9d39a8e5b6';
const COMMIT = '9f8e7d6c5b4a39281706f5e4d3c2b1a099887766';

const buildBody: BuildBody = {
  script: { hash: SCRIPT_HASH, plutusVersion: 'v2', title: 'vault.spend' },
  source: { url: 'https://github.com/example/vault', commit: COMMIT, path: 'validators/vault.ak' },
  compiler: { name: 'aiken', version: 'v1.1.9+e2fb28b' },
  blueprint: DIGEST,
};

const build = createBuildAttestation(buildBody, { issuer: ISSUER });

describe('publication assembly', () => {
  const metadata = buildMetadata({
    attestation: build,
    sequence: '1',
    verification: verificationRecordFor(build),
  });

  it('carries the CIP-170 record, the document and the CIP-171 record', () => {
    expect(Object.keys(metadata).sort()).toEqual(
      [String(CIP170_LABEL), String(ATTEST_DOCUMENT_LABEL), String(CIP171_LABEL)].sort(),
    );
  });

  it('anchors the document digest in the CIP-170 record', () => {
    const record = metadata[String(CIP170_LABEL)] as Record<string, Metadatum>;
    expect(record.d).toBe(build.d);
    expect(record.s).toBe('1');
  });

  it('reproduces the document byte for byte', () => {
    expect(decodeDocument(metadata[String(ATTEST_DOCUMENT_LABEL)])).toBe(serialize(build));
  });

  it('indexes the script hashes the attestation covers', () => {
    const record = metadata[String(CIP170_LABEL)] as Record<string, Metadatum>;
    expect(record.m).toEqual({ t: 'build', h: [SCRIPT_HASH] });
  });

  it('omits the document when publication is record-only', () => {
    const lean = buildMetadata({ attestation: build, sequence: '1', includeDocument: false });
    expect(lean[String(ATTEST_DOCUMENT_LABEL)]).toBeUndefined();
  });

  it('omits script hints for attestations that name no script', () => {
    const revocation = createRevocationAttestation(
      { target: build.d, reason: 'superseded' },
      { issuer: ISSUER },
    );
    const record = buildMetadata({ attestation: revocation, sequence: '2' })[
      String(CIP170_LABEL)
    ] as Record<string, Metadatum>;
    expect(record.m).toEqual({ t: 'revocation' });
  });
});

describe('reading a publication back', () => {
  it('recovers every part of a build publication', () => {
    const metadata = buildMetadata({
      attestation: build,
      sequence: '1',
      verification: verificationRecordFor(build),
    });
    const publication = readPublication(metadata);

    expect(publication.record.digest).toBe(build.d);
    expect(publication.attestation).toEqual(build);
    expect(publication.verification?.commit).toBe(COMMIT);
  });

  it('reads a record published without its document', () => {
    const metadata = buildMetadata({
      attestation: build,
      sequence: '1',
      includeDocument: false,
    });
    const publication = readPublication(metadata);
    expect(publication.attestation).toBeUndefined();
    expect(publication.record.digest).toBe(build.d);
  });

  it('rejects a document swapped for a different one', () => {
    const other = createAuditAttestation(
      {
        scripts: [buildBody.script],
        source: buildBody.source,
        report: { title: 'Review', digest: DIGEST },
        outcome: 'clean',
      },
      { issuer: ISSUER },
    );
    const metadata = buildMetadata({ attestation: build, sequence: '1' });
    metadata[String(ATTEST_DOCUMENT_LABEL)] = serialize(other);

    expect(() => readPublication(metadata)).toThrow(/does not match the CIP-170 digest/);
  });

  it('rejects index hints that contradict the document', () => {
    const metadata = buildMetadata({ attestation: build, sequence: '1' });
    const record = metadata[String(CIP170_LABEL)] as Record<string, Metadatum>;
    record.m = { t: 'build', h: ['ab'.repeat(28)] };

    expect(() => readPublication(metadata)).toThrow(/Index hints do not match/);
  });

  it('rejects a CIP-171 record that contradicts the attestation', () => {
    const metadata = buildMetadata({
      attestation: build,
      sequence: '1',
      verification: { ...verificationRecordFor(build), commit: 'ab'.repeat(20) },
    });
    expect(() => readPublication(metadata)).toThrow(/contradicts the attestation/);
  });

  it('rejects metadata with no CIP-170 record', () => {
    expect(() => readPublication({ '674': { msg: ['hello'] } })).toThrow(/no CIP-170 record/);
  });
});

describe('CIP-171 derivation', () => {
  it('mirrors the source and compiler the attestation records', () => {
    expect(verificationRecordFor(build)).toEqual({
      compiler: 'aiken',
      sourceUrl: 'https://github.com/example/vault',
      commit: COMMIT,
      sourcePath: 'validators/vault.ak',
      compilerVersion: 'v1.1.9+e2fb28b',
    });
  });

  it('carries applied parameters keyed by the resulting script hash', () => {
    const parameterized = createBuildAttestation(
      { ...buildBody, parameters: ['182a'] },
      { issuer: ISSUER },
    );
    expect(verificationRecordFor(parameterized).parameters).toEqual({ [SCRIPT_HASH]: ['182a'] });
  });
});
