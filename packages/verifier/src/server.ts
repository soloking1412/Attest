#!/usr/bin/env node
import { serve } from '@hono/node-server';

import { AttestError, type Network, NETWORKS } from '@attest/core';
import { BlockfrostProvider } from '@attest/cardano';
import { KeriaResolver } from '@attest/keri';

import { createApi } from './api.js';
import { Indexer } from './indexer.js';
import { AttestationStore } from './store.js';

interface ServerConfig {
  readonly network: Network;
  readonly projectId: string;
  readonly database: string;
  readonly port: number;
  readonly keriaUrl: string;
  readonly keriaPasscode: string;
  readonly intervalMs: number;
}

function readConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const network = env.ATTEST_NETWORK ?? 'preview';
  if (!(NETWORKS as readonly string[]).includes(network)) {
    throw new AttestError('PROVIDER_ERROR', 'ATTEST_NETWORK must name a Cardano network', {
      network,
      supported: NETWORKS,
    });
  }

  return {
    network: network as Network,
    projectId: required(env, 'BLOCKFROST_PROJECT_ID'),
    database: env.ATTEST_DB ?? 'attest.sqlite',
    port: Number.parseInt(env.ATTEST_PORT ?? '8787', 10),
    keriaUrl: required(env, 'KERIA_URL'),
    keriaPasscode: required(env, 'KERIA_PASSCODE'),
    intervalMs: Number.parseInt(env.ATTEST_INDEX_INTERVAL ?? '60000', 10),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new AttestError('PROVIDER_ERROR', `${name} is required`, { variable: name });
  }
  return value;
}

async function main(): Promise<void> {
  const config = readConfig(process.env);
  const store = new AttestationStore(config.database);
  const provider = new BlockfrostProvider({
    projectId: config.projectId,
    network: config.network,
  });
  const resolver = await KeriaResolver.connect({
    url: config.keriaUrl,
    passcode: config.keriaPasscode,
  });

  const indexer = new Indexer({ provider, resolver, store });
  const controller = new AbortController();

  const shutdown = () => {
    controller.abort();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  void indexer.follow(config.intervalMs, controller.signal).catch((error: unknown) => {
    console.error('indexer stopped:', error);
    controller.abort();
  });

  serve(
    { fetch: createApi({ store, network: config.network }).fetch, port: config.port },
    (info) => {
      console.log(`attest verifier listening on :${info.port} (${config.network})`);
    },
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
