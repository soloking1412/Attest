import { buildMetadata } from '@attest/cardano';
import { CIP170_LABEL, type Metadatum } from '@attest/core';
import { StaticKelResolver } from '@attest/keri';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  auditAttestation,
  buildAttestation,
  FakeProvider,
  IMPOSTOR,
  ISSUER,
  resolverFor,
  revocationOf,
  SCRIPT_HASH,
} from './__fixtures__/chain.js';
import { AttestationStore } from './store.js';
import { verifyTransaction } from './verify.js';

const statusOf = (report: { checks: readonly { name: string; status: string }[] }, name: string) =>
  report.checks.find((check) => check.name === name)?.status;

describe('verifying a published attestation', () => {
  const attestation = buildAttestation();
  const provider = new FakeProvider().withScript(SCRIPT_HASH);
  const txHash = provider.publish(attestation, '1');
  const resolver = resolverFor({ aid: ISSUER, digests: [attestation.d] });

  it('reaches a verified verdict when the issuer committed to the document', async () => {
    const report = await verifyTransaction(provider, txHash, { resolver, provider });
    expect(report.verdict).toBe('verified');
    expect(report.issuer).toBe(ISSUER);
    expect(report.digest).toBe(attestation.d);
    expect(report.sequence).toBe('1');
  });

  it('recovers the document from the transaction itself', async () => {
    const report = await verifyTransaction(provider, txHash, { resolver });
    expect(report.attestation).toEqual(attestation);
    expect(report.scripts).toEqual([SCRIPT_HASH]);
  });

  it('confirms the script is on chain when a provider is supplied', async () => {
    const report = await verifyTransaction(provider, txHash, { resolver, provider });
    expect(statusOf(report, 'script')).toBe('pass');
  });

  it('skips the script check without a provider', async () => {
    const report = await verifyTransaction(provider, txHash, { resolver });
    expect(statusOf(report, 'script')).toBe('skipped');
  });

  it('reports a script that has not appeared on chain', async () => {
    const bare = new FakeProvider();
    const hash = bare.publish(attestation, '1');
    const report = await verifyTransaction(bare, hash, { resolver, provider: bare });
    expect(statusOf(report, 'script')).toBe('fail');
    expect(report.verdict).toBe('verified');
  });
});

describe('rejecting attestations the issuer never committed to', () => {
  const attestation = buildAttestation();

  it('refuses a record citing a sequence with a different digest', async () => {
    const provider = new FakeProvider();
    const txHash = provider.publish(attestation, '2');
    const resolver = resolverFor({ aid: ISSUER, digests: [attestation.d, 'E' + 'A'.repeat(43)] });

    const report = await verifyTransaction(provider, txHash, { resolver });
    expect(report.verdict).toBe('unanchored');
    expect(statusOf(report, 'anchor')).toBe('fail');
  });

  it('refuses a record whose issuer has no key event log', async () => {
    const provider = new FakeProvider();
    const txHash = provider.publish(attestation, '1');

    const report = await verifyTransaction(provider, txHash, {
      resolver: new StaticKelResolver(),
    });
    expect(report.verdict).toBe('unanchored');
  });

  it('refuses a document replayed under another identifier', async () => {
    const provider = new FakeProvider();
    const txHash = provider.publish(attestation, '1');
    const resolver = resolverFor({ aid: IMPOSTOR, digests: [attestation.d] });

    const report = await verifyTransaction(provider, txHash, { resolver });
    expect(report.verdict).toBe('unanchored');
  });

  it('rejects a transaction whose metadata is not a publication', async () => {
    const provider = new FakeProvider();
    const txHash = provider.publishRaw({ '674': { msg: ['gm'] } });

    const report = await verifyTransaction(provider, txHash, {
      resolver: new StaticKelResolver(),
    });
    expect(report.verdict).toBe('invalid');
    expect(statusOf(report, 'document')).toBe('fail');
  });

  it('rejects a record whose inline document was swapped', async () => {
    const provider = new FakeProvider();
    const forged = buildMetadata({ attestation, sequence: '1' });
    const other = buildMetadata({ attestation: auditAttestation(), sequence: '1' });
    forged[String(CIP170_LABEL)] = other[String(CIP170_LABEL)] as Metadatum;
    const txHash = provider.publishRaw(forged);

    const report = await verifyTransaction(provider, txHash, {
      resolver: resolverFor({ aid: ISSUER, digests: [attestation.d] }),
    });
    expect(report.verdict).toBe('invalid');
  });
});

describe('revocation', () => {
  let store: AttestationStore;

  beforeEach(() => {
    store = new AttestationStore();
  });

  it('marks an attestation revoked by its own issuer', async () => {
    const attestation = buildAttestation();
    const revocation = revocationOf(attestation.d, ISSUER);
    const provider = new FakeProvider();
    const buildTx = provider.publish(attestation, '1');
    const revokeTx = provider.publish(revocation, '2');
    const resolver = resolverFor({ aid: ISSUER, digests: [attestation.d, revocation.d] });

    store.record(await verifyTransaction(provider, buildTx, { resolver }));
    store.record(await verifyTransaction(provider, revokeTx, { resolver }));

    expect(store.isRevoked(attestation.d)).toBe(true);
    expect(store.get(attestation.d)?.revoked).toBe(true);
  });

  it('ignores a revocation issued by a different identifier', async () => {
    const attestation = buildAttestation();
    const revocation = revocationOf(attestation.d, IMPOSTOR);
    const provider = new FakeProvider();
    const buildTx = provider.publish(attestation, '1');
    const revokeTx = provider.publish(revocation, '1');
    const resolver = resolverFor(
      { aid: ISSUER, digests: [attestation.d] },
      { aid: IMPOSTOR, digests: [revocation.d] },
    );

    store.record(await verifyTransaction(provider, buildTx, { resolver }));
    store.record(await verifyTransaction(provider, revokeTx, { resolver }));

    expect(store.isRevoked(attestation.d)).toBe(false);
    expect(store.get(attestation.d)?.revoked).toBe(false);
  });

  it('reports a revoked verdict when the index is consulted during verification', async () => {
    const attestation = buildAttestation();
    const revocation = revocationOf(attestation.d, ISSUER);
    const provider = new FakeProvider();
    const buildTx = provider.publish(attestation, '1');
    const revokeTx = provider.publish(revocation, '2');
    const resolver = resolverFor({ aid: ISSUER, digests: [attestation.d, revocation.d] });

    store.record(await verifyTransaction(provider, buildTx, { resolver }));
    store.record(await verifyTransaction(provider, revokeTx, { resolver }));

    const recheck = await verifyTransaction(provider, buildTx, { resolver, revocations: store });
    expect(recheck.verdict).toBe('revoked');
  });
});
