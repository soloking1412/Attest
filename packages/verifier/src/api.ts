import { AttestError, SCRIPT_HASH_BYTES } from '@attest/core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import type { AttestationStore, StoredAttestation } from './store.js';

export type ClaimState = 'verified' | 'revoked' | 'unverified' | 'none';

export interface ScriptSummary {
  readonly scriptHash: string;
  /** Whether a reproducible build has been attested for this script. */
  readonly build: ClaimState;
  /** Whether an audit has been attested for this script. */
  readonly audit: ClaimState;
  readonly issuers: readonly string[];
  readonly attestations: readonly StoredAttestation[];
}

export interface ApiOptions {
  readonly store: AttestationStore;
  readonly network: string;
  readonly cors?: boolean;
}

export function createApi(options: ApiOptions): Hono {
  const app = new Hono();
  const { store } = options;

  if (options.cors !== false) {
    app.use('/v1/*', cors({ origin: '*', allowMethods: ['GET'] }));
  }

  app.get('/health', (context) => context.json({ status: 'ok', network: options.network }));

  app.get('/v1/stats', (context) => context.json(store.stats()));

  app.get('/v1/attestations', (context) =>
    context.json({ attestations: store.recent(limitOf(context.req.query('limit'))) }),
  );

  app.get('/v1/attestations/:said', (context) => {
    const found = store.get(context.req.param('said'));
    return found === undefined
      ? context.json({ error: 'Attestation not found' }, 404)
      : context.json(found);
  });

  app.get('/v1/scripts/:hash', (context) => {
    const scriptHash = context.req.param('hash').toLowerCase();
    if (!isScriptHash(scriptHash)) {
      return context.json({ error: 'Script hash must be 28 hex-encoded bytes' }, 400);
    }
    return context.json(summarize(scriptHash, store.byScript(scriptHash)));
  });

  app.get('/v1/issuers/:aid', (context) => {
    const issuer = context.req.param('aid');
    return context.json({
      issuer,
      attestations: store.byIssuer(issuer, limitOf(context.req.query('limit'))),
    });
  });

  app.onError((error, context) => {
    if (error instanceof AttestError) {
      return context.json({ error: error.message, code: error.code, details: error.details }, 400);
    }
    return context.json({ error: 'Internal error' }, 500);
  });

  return app;
}

/**
 * Reduces every attestation naming a script to the two questions a caller
 * actually has: was this built from source anyone can check, and has anyone
 * audited it. A revoked claim is reported as revoked rather than dropped, so a
 * withdrawn audit never reads as an absent one.
 */
export function summarize(
  scriptHash: string,
  attestations: readonly StoredAttestation[],
): ScriptSummary {
  return {
    scriptHash,
    build: stateOf(attestations, 'build'),
    audit: stateOf(attestations, 'audit'),
    issuers: [...new Set(attestations.map((entry) => entry.issuer))],
    attestations,
  };
}

function stateOf(attestations: readonly StoredAttestation[], type: string): ClaimState {
  const matching = attestations.filter((entry) => entry.type === type);
  if (matching.length === 0) return 'none';
  if (matching.some((entry) => entry.verdict === 'verified' && !entry.revoked)) return 'verified';
  if (matching.some((entry) => entry.revoked)) return 'revoked';
  return 'unverified';
}

function isScriptHash(value: string): boolean {
  return new RegExp(`^[0-9a-f]{${SCRIPT_HASH_BYTES * 2}}$`).test(value);
}

function limitOf(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(parsed, 500);
}
