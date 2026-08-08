import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { assertOneOf, AttestError, NETWORKS } from '@attest/core';

import { boolFlag, flag } from '../args.js';
import { CONFIG_FILE, DEFAULT_CONFIG } from '../config.js';
import type { Command } from '../context.js';

export const init: Command = async (context) => {
  const path = resolve(context.cwd, CONFIG_FILE);
  const network = flag(context.args, 'network') ?? DEFAULT_CONFIG.network;
  assertOneOf(network, 'network', NETWORKS);

  const image = flag(context.args, 'image');
  const config = {
    ...DEFAULT_CONFIG,
    network,
    issuer: flag(context.args, 'issuer') ?? DEFAULT_CONFIG.issuer,
    build: { ...DEFAULT_CONFIG.build, ...(image !== undefined ? { image } : {}) },
  };

  await write(path, `${JSON.stringify(config, null, 2)}\n`, boolFlag(context.args, 'force'));

  context.reporter.line(`Wrote ${CONFIG_FILE}`);
  context.reporter.detail('network', config.network);
  context.reporter.detail('issuer', config.issuer);
  context.reporter.line('');
  context.reporter.line('Set these before issuing or publishing:');
  context.reporter.detail('KERIA_PASSCODE', 'passcode controlling your KERIA agent');
  context.reporter.detail('BLOCKFROST_PROJECT_ID', 'project id for the configured network');
  context.reporter.detail('CARDANO_WALLET_SEED', 'seed phrase of the publishing wallet');
  context.reporter.result(config);
};

async function write(path: string, contents: string, force: boolean): Promise<void> {
  try {
    await writeFile(path, contents, { flag: force ? 'w' : 'wx' });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new AttestError('INVALID_DOCUMENT', 'Configuration already exists; pass --force', {
        path,
      });
    }
    throw cause;
  }
}
