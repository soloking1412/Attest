import { assertAid, AttestError, isQb64 } from '@attest/core';
import { KeriaClient } from '@attest/keri';

import type { ParsedArgs } from './args.js';
import { flag } from './args.js';
import { requirePasscode, type AttestConfig, type Secrets } from './config.js';
import type { Reporter } from './output.js';

export interface CommandContext {
  readonly args: ParsedArgs;
  readonly config: AttestConfig;
  readonly secrets: Secrets;
  readonly reporter: Reporter;
  readonly cwd: string;
}

export type Command = (context: CommandContext) => Promise<void>;

export async function connectKeria(context: CommandContext, boot = false): Promise<KeriaClient> {
  const { keria } = context.config;
  return KeriaClient.connect({
    url: keria.url,
    ...(keria.bootUrl !== undefined ? { bootUrl: keria.bootUrl } : {}),
    passcode: requirePasscode(context.secrets),
    boot,
  });
}

/**
 * Resolves the identifier attestations are issued under.
 *
 * `--issuer` accepts a fully qualified identifier so a document can be prepared
 * without an agent — useful in a build step that hands off to a separate,
 * key-holding publish step.
 */
export async function resolveIssuer(context: CommandContext): Promise<string> {
  const override = flag(context.args, 'issuer');
  if (override !== undefined && isQb64(override)) {
    assertAid(override, 'issuer');
    return override;
  }

  const name = override ?? context.config.issuer;
  const client = await connectKeria(context);
  const identity = await client.identity(name);
  return identity.aid;
}

export function requireNetworkMatch(context: CommandContext, network: string): void {
  if (network !== context.config.network) {
    throw new AttestError('PROVIDER_ERROR', 'Provider network does not match the configuration', {
      configured: context.config.network,
      provider: network,
    });
  }
}
