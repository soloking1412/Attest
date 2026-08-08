import { describe, expect, it } from 'vitest';

import {
  createAuditAttestation,
  createBuildAttestation,
  createReleaseAttestation,
  createRevocationAttestation,
  parseAttestation,
  subjectScripts,
  type BuildBody,
} from './attestation.js';
import { AttestError } from './errors.js';
import { serialize } from './said.js';

const ISSUER = 'EKtQ1lymrnrh3qv5S18PBzQ7ukHGFJ7EXkH7B22XEMIL';
const REPORT_DIGEST = 'ELC5L3iBVD77d_MYbYGGCUQgqQBju1o4x1Ud-z2sL-ux';
const SCRIPT_HASH = 'f182984ad1a23d4386df014563c2b1c7d6ee00245872339ad26c4c34';
const COMMIT = '9f8e7d6c5b4a39281706f5e4d3c2b1a099887766';

const buildBody: BuildBody = {
  script: { hash: SCRIPT_HASH, plutusVersion: 'v3', title: 'vault.spend' },
  source: { url: 'https://github.com/example/vault', commit: COMMIT, path: 'validators/vault.ak' },
  compiler: { name: 'aiken', version: 'v1.1.9+e2fb28b' },
  blueprint: REPORT_DIGEST,
};

describe('build attestations', () => {
  it('issues a document that validates and verifies', () => {
    const attestation = createBuildAttestation(buildBody, { issuer: ISSUER });
    expect(attestation.t).toBe('build');
    expect(attestation.i).toBe(ISSUER);
    expect(() => parseAttestation(serialize(attestation))).not.toThrow();
  });

  it('reports the script it makes a claim about', () => {
    const attestation = createBuildAttestation(buildBody, { issuer: ISSUER });
    expect(subjectScripts(attestation).map((script) => script.hash)).toEqual([SCRIPT_HASH]);
  });

  it('carries an optional registry identifier in the envelope', () => {
    const attestation = createBuildAttestation(buildBody, {
      issuer: ISSUER,
      registry: REPORT_DIGEST,
    });
    expect(attestation.ri).toBe(REPORT_DIGEST);
    expect(() => parseAttestation(serialize(attestation))).not.toThrow();
  });

  it('rejects a script hash of the wrong length', () => {
    expect(() =>
      createBuildAttestation(
        { ...buildBody, script: { hash: 'abcd', plutusVersion: 'v3' } },
        {
          issuer: ISSUER,
        },
      ),
    ).toThrow(/28 bytes/);
  });

  it('rejects an uppercase script hash', () => {
    expect(() =>
      createBuildAttestation(
        { ...buildBody, script: { hash: SCRIPT_HASH.toUpperCase(), plutusVersion: 'v3' } },
        { issuer: ISSUER },
      ),
    ).toThrow(/lowercase hexadecimal/);
  });

  it('rejects a source URL git cannot resolve', () => {
    expect(() =>
      createBuildAttestation(
        { ...buildBody, source: { url: 'example/vault', commit: COMMIT } },
        { issuer: ISSUER },
      ),
    ).toThrow(/git-resolvable/);
  });

  it('rejects an unknown compiler', () => {
    expect(() =>
      createBuildAttestation(
        { ...buildBody, compiler: { name: 'solc' as never, version: '0.8.0' } },
        { issuer: ISSUER },
      ),
    ).toThrow(AttestError);
  });

  it('rejects an issuer that is not a KERI identifier', () => {
    expect(() => createBuildAttestation(buildBody, { issuer: 'did:web:example.com' })).toThrow(
      /valid KERI identifier/,
    );
  });
});

describe('audit attestations', () => {
  const attestation = createAuditAttestation(
    {
      scripts: [{ hash: SCRIPT_HASH, plutusVersion: 'v3' }],
      source: { url: 'https://github.com/example/vault', commit: COMMIT },
      report: { title: 'Vault v1 review', digest: REPORT_DIGEST, uri: 'ipfs://bafy...' },
      outcome: 'findings-resolved',
      findings: { critical: 0, high: 2, medium: 3, low: 5, informational: 9 },
    },
    { issuer: ISSUER },
  );

  it('validates and verifies', () => {
    expect(() => parseAttestation(serialize(attestation))).not.toThrow();
  });

  it('reports every script in scope', () => {
    expect(subjectScripts(attestation)).toHaveLength(1);
  });

  it('rejects a negative finding count', () => {
    const tampered = JSON.parse(serialize(attestation));
    tampered.a.findings.high = -1;
    expect(() => parseAttestation(tampered)).toThrow(/non-negative integer/);
  });

  it('rejects an empty scope', () => {
    expect(() =>
      createAuditAttestation(
        {
          scripts: [],
          source: { url: 'https://github.com/example/vault', commit: COMMIT },
          report: { title: 'Empty', digest: REPORT_DIGEST },
          outcome: 'clean',
        },
        { issuer: ISSUER },
      ),
    ).toThrow(/at least 1/);
  });
});

describe('release and revocation attestations', () => {
  it('issues a release referencing its component attestations', () => {
    const build = createBuildAttestation(buildBody, { issuer: ISSUER });
    const release = createReleaseAttestation(
      {
        project: 'vault',
        version: '1.0.0',
        network: 'mainnet',
        scripts: [buildBody.script],
        includes: [build.d],
      },
      { issuer: ISSUER },
    );
    expect(release.a.includes).toEqual([build.d]);
    expect(() => parseAttestation(serialize(release))).not.toThrow();
  });

  it('issues a revocation naming its target', () => {
    const build = createBuildAttestation(buildBody, { issuer: ISSUER });
    const revocation = createRevocationAttestation(
      { target: build.d, reason: 'superseded', note: 'rebuilt with a pinned toolchain' },
      { issuer: ISSUER },
    );
    expect(revocation.a.target).toBe(build.d);
    expect(subjectScripts(revocation)).toEqual([]);
  });
});

describe('parsing untrusted input', () => {
  it('rejects a document whose body no longer matches its identifier', () => {
    const attestation = createBuildAttestation(buildBody, { issuer: ISSUER });
    const tampered = JSON.parse(serialize(attestation));
    tampered.a.source.commit = 'a'.repeat(40);
    expect(() => parseAttestation(tampered)).toThrow(/does not hash/);
  });

  it('rejects a document with an unknown type', () => {
    const attestation = createBuildAttestation(buildBody, { issuer: ISSUER });
    const tampered = { ...JSON.parse(serialize(attestation)), t: 'deployment' };
    expect(() => parseAttestation(tampered)).toThrow(AttestError);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseAttestation('{')).toThrow();
  });
});
