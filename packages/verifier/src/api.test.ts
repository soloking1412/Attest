import { describe, expect, it } from 'vitest';

import {
  auditAttestation,
  buildAttestation,
  FakeProvider,
  ISSUER,
  OTHER_SCRIPT,
  resolverFor,
  revocationOf,
  SCRIPT_HASH,
} from './__fixtures__/chain.js';
import { createApi, summarize } from './api.js';
import { Indexer } from './indexer.js';
import { AttestationStore } from './store.js';
import { verifyTransaction } from './verify.js';

async function indexedChain() {
  const build = buildAttestation();
  const audit = auditAttestation();
  const provider = new FakeProvider().withScript(SCRIPT_HASH);
  provider.publish(build, '1');
  provider.publish(audit, '2');

  const store = new AttestationStore();
  const resolver = resolverFor({ aid: ISSUER, digests: [build.d, audit.d] });
  const run = await new Indexer({ provider, resolver, store }).runOnce();

  return { build, audit, provider, store, resolver, run };
}

describe('indexer', () => {
  it('records every publication it scans', async () => {
    const { run, store } = await indexedChain();
    expect(run.scanned).toBe(2);
    expect(run.recorded).toBe(2);
    expect(run.verified).toBe(2);
    expect(store.stats()).toMatchObject({ total: 2, verified: 2, issuers: 1 });
  });

  it('is idempotent across runs', async () => {
    const { provider, store, resolver } = await indexedChain();
    store.setCursor(170, 1);
    await new Indexer({ provider, resolver, store }).runOnce();
    expect(store.stats().total).toBe(2);
  });

  it('resumes from the page it stopped inside', async () => {
    const { provider, store, resolver } = await indexedChain();
    const run = await new Indexer({ provider, resolver, store, pageSize: 1 }).runOnce();
    expect(run.resumeFrom).toBeGreaterThan(1);
  });
});

describe('script summary', () => {
  it('reports build and audit separately', async () => {
    const { store } = await indexedChain();
    const summary = summarize(SCRIPT_HASH, store.byScript(SCRIPT_HASH));
    expect(summary.build).toBe('verified');
    expect(summary.audit).toBe('verified');
    expect(summary.issuers).toEqual([ISSUER]);
  });

  it('reports nothing for a script with no attestations', () => {
    expect(summarize(OTHER_SCRIPT, []).build).toBe('none');
  });

  it('surfaces a withdrawn claim as revoked rather than absent', async () => {
    const build = buildAttestation();
    const revocation = revocationOf(build.d, ISSUER);
    const provider = new FakeProvider();
    provider.publish(build, '1');
    provider.publish(revocation, '2');

    const store = new AttestationStore();
    const resolver = resolverFor({ aid: ISSUER, digests: [build.d, revocation.d] });
    await new Indexer({ provider, resolver, store }).runOnce();

    expect(summarize(SCRIPT_HASH, store.byScript(SCRIPT_HASH)).build).toBe('revoked');
  });
});

describe('lookup API', () => {
  it('answers health checks', async () => {
    const app = createApi({ store: new AttestationStore(), network: 'preview' });
    const response = await app.request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', network: 'preview' });
  });

  it('summarizes a script', async () => {
    const { store } = await indexedChain();
    const app = createApi({ store, network: 'preview' });
    const response = await app.request(`/v1/scripts/${SCRIPT_HASH}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      scriptHash: SCRIPT_HASH,
      build: 'verified',
      audit: 'verified',
    });
  });

  it('rejects a malformed script hash', async () => {
    const app = createApi({ store: new AttestationStore(), network: 'preview' });
    expect((await app.request('/v1/scripts/nonsense')).status).toBe(400);
  });

  it('returns an attestation by its identifier', async () => {
    const { store, build } = await indexedChain();
    const app = createApi({ store, network: 'preview' });
    const response = await app.request(`/v1/attestations/${build.d}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ said: build.d, verdict: 'verified' });
  });

  it('reports 404 for an unknown attestation', async () => {
    const app = createApi({ store: new AttestationStore(), network: 'preview' });
    expect((await app.request(`/v1/attestations/E${'A'.repeat(43)}`)).status).toBe(404);
  });

  it('lists attestations by issuer', async () => {
    const { store } = await indexedChain();
    const app = createApi({ store, network: 'preview' });
    const body = (await (await app.request(`/v1/issuers/${ISSUER}`)).json()) as {
      attestations: unknown[];
    };
    expect(body.attestations).toHaveLength(2);
  });

  it('caps the requested page size', async () => {
    const { store } = await indexedChain();
    const app = createApi({ store, network: 'preview' });
    const body = (await (await app.request('/v1/attestations?limit=99999')).json()) as {
      attestations: unknown[];
    };
    expect(body.attestations.length).toBeLessThanOrEqual(500);
  });
});

describe('store', () => {
  it('keeps the newest verdict for an attestation seen twice', async () => {
    const store = new AttestationStore();
    const build = buildAttestation();
    const provider = new FakeProvider();
    const txHash = provider.publish(build, '1');

    store.record(await verifyTransaction(provider, txHash, { resolver: resolverFor() }));
    expect(store.get(build.d)?.verdict).toBe('unanchored');

    store.record(
      await verifyTransaction(provider, txHash, {
        resolver: resolverFor({ aid: ISSUER, digests: [build.d] }),
      }),
    );
    expect(store.get(build.d)?.verdict).toBe('verified');
  });

  it('tracks the scan cursor', () => {
    const store = new AttestationStore();
    expect(store.cursor(170)).toBeUndefined();
    store.setCursor(170, 4);
    expect(store.cursor(170)).toBe(4);
  });
});
