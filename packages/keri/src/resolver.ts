import { AttestError } from '@attest/core';

import { KeriaClient, type KeriaOptions } from './client.js';
import { assertContiguous, parseKeyEventLog, type KeyEvent } from './kel.js';

/**
 * Supplies the key event log for an identifier. Verification depends only on
 * this, so a caller can point it at a KERIA agent, a watcher, or a log captured
 * ahead of time.
 */
export interface KelResolver {
  readonly name: string;
  resolve(aid: string): Promise<readonly KeyEvent[]>;
}

/** Serves logs collected in advance, for offline or reproducible verification. */
export class StaticKelResolver implements KelResolver {
  readonly name = 'static';

  private readonly logs = new Map<string, readonly KeyEvent[]>();

  constructor(logs: Readonly<Record<string, unknown>> = {}) {
    for (const [aid, log] of Object.entries(logs)) {
      this.add(aid, parseKeyEventLog(log));
    }
  }

  add(aid: string, log: readonly KeyEvent[]): this {
    assertContiguous(log, aid);
    this.logs.set(aid, log);
    return this;
  }

  async resolve(aid: string): Promise<readonly KeyEvent[]> {
    const log = this.logs.get(aid);
    if (log === undefined) {
      throw new AttestError('ANCHOR_NOT_FOUND', 'No key event log available for that identifier', {
        aid,
        known: [...this.logs.keys()],
      });
    }
    return log;
  }
}

export interface KeriaResolverOptions extends KeriaOptions {
  /** OOBIs resolved before lookups, so unknown issuers can be reached. */
  readonly oobis?: Readonly<Record<string, string>>;
}

/** Reads logs from a KERIA agent, which validates them as it ingests them. */
export class KeriaResolver implements KelResolver {
  readonly name = 'keria';

  private constructor(private readonly client: KeriaClient) {}

  static async connect(options: KeriaResolverOptions): Promise<KeriaResolver> {
    const client = await KeriaClient.connect(options);
    for (const [alias, oobi] of Object.entries(options.oobis ?? {})) {
      await client.resolveOobi(oobi, alias);
    }
    return new KeriaResolver(client);
  }

  static fromClient(client: KeriaClient): KeriaResolver {
    return new KeriaResolver(client);
  }

  async resolve(aid: string): Promise<readonly KeyEvent[]> {
    const log = await this.client.keyEventLog(aid);
    if (log.length === 0) {
      throw new AttestError('ANCHOR_NOT_FOUND', 'Agent returned an empty key event log', { aid });
    }
    return log;
  }
}

/** Caches resolved logs for the lifetime of a scan. */
export class CachingKelResolver implements KelResolver {
  readonly name: string;

  private readonly cache = new Map<string, Promise<readonly KeyEvent[]>>();

  constructor(private readonly inner: KelResolver) {
    this.name = `caching:${inner.name}`;
  }

  resolve(aid: string): Promise<readonly KeyEvent[]> {
    const cached = this.cache.get(aid);
    if (cached !== undefined) return cached;

    const pending = this.inner.resolve(aid).catch((error: unknown) => {
      this.cache.delete(aid);
      throw error;
    });
    this.cache.set(aid, pending);
    return pending;
  }
}

/**
 * Tries resolvers in order and returns the first log one supplies.
 *
 * Verification needs a log, not a particular way of getting one. A live agent
 * holds the current log and is tried first; a log captured earlier stands in
 * when that agent is unreachable, which keeps published attestations
 * verifiable independently of anyone's uptime.
 */
export class FallbackKelResolver implements KelResolver {
  readonly name: string;

  private readonly resolvers: readonly KelResolver[];

  constructor(resolvers: readonly KelResolver[]) {
    if (resolvers.length === 0) {
      throw new AttestError('ANCHOR_NOT_FOUND', 'A resolver chain needs at least one resolver');
    }
    this.resolvers = resolvers;
    this.name = resolvers.map((resolver) => resolver.name).join('|');
  }

  async resolve(aid: string): Promise<readonly KeyEvent[]> {
    let last: unknown;
    for (const resolver of this.resolvers) {
      try {
        return await resolver.resolve(aid);
      } catch (error) {
        last = error;
      }
    }
    throw last;
  }
}
