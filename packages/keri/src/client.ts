import { AttestError, formatSequence } from '@attest/core';

import { parseKeyEventLog, type KeyEvent, type Seal } from './kel.js';

const PACKAGE = 'signify-ts';

export type SecurityTier = 'low' | 'med' | 'high';

export interface KeriaOptions {
  /** Admin interface of the KERIA agent. */
  readonly url: string;
  /** Boot interface, required only the first time an agent is created. */
  readonly bootUrl?: string;
  /** Passcode controlling the client's key material. */
  readonly passcode: string;
  readonly tier?: SecurityTier;
  /** Creates the agent when it does not exist yet. */
  readonly boot?: boolean;
  readonly timeoutMs?: number;
}

export interface Identity {
  readonly name: string;
  readonly aid: string;
  readonly transferable: boolean;
}

export interface CreateIdentityOptions {
  readonly witnesses?: readonly string[];
  /** Witness threshold; defaults to a majority of the supplied witnesses. */
  readonly threshold?: number;
  readonly transferable?: boolean;
}

export interface AnchorReceipt {
  readonly identifier: string;
  /** Sequence number of the interaction event, lowercase hex. */
  readonly sequence: string;
  readonly eventSaid: string;
}

interface SerderLike {
  readonly sad: Record<string, unknown>;
  readonly said: string;
  readonly pre: string;
  readonly sn: number;
}

interface EventResultLike {
  readonly serder: SerderLike;
  op(): Promise<unknown>;
}

interface HabStateLike {
  readonly name: string;
  readonly prefix: string;
  readonly transferable: boolean;
}

interface SignifyClientLike {
  boot(): Promise<Response>;
  connect(): Promise<void>;
  identifiers(): {
    create(name: string, args?: Record<string, unknown>): Promise<EventResultLike>;
    interact(name: string, data?: unknown): Promise<EventResultLike>;
    get(name: string): Promise<HabStateLike>;
    list(start?: number, end?: number): Promise<{ aids: HabStateLike[] }>;
    addEndRole(name: string, role: string, eid?: string): Promise<EventResultLike>;
  };
  oobis(): {
    get(name: string, role?: string): Promise<{ oobis: string[] }>;
    resolve(oobi: string, alias?: string): Promise<unknown>;
  };
  operations(): {
    wait(op: never, options?: { signal?: AbortSignal }): Promise<unknown>;
  };
  keyEvents(): {
    get(pre: string): Promise<unknown[]>;
  };
  agent: { pre: string } | null;
}

interface SignifyModule {
  ready(): Promise<void>;
  SignifyClient: new (
    url: string,
    bran: string,
    tier: string,
    bootUrl?: string,
  ) => SignifyClientLike;
  randomPasscode(): string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Client for a KERIA agent, which holds the issuer's key material and
 * validates key event logs on ingest.
 *
 * Loaded on demand: verifying an attestation needs a log, not an agent, so
 * consumers that only read the chain never pull in the KERI runtime.
 */
export class KeriaClient {
  private constructor(
    private readonly client: SignifyClientLike,
    private readonly timeoutMs: number,
  ) {}

  static async connect(options: KeriaOptions): Promise<KeriaClient> {
    const signify = await load();
    await signify.ready();

    const client = new signify.SignifyClient(
      options.url,
      options.passcode,
      options.tier ?? 'low',
      options.bootUrl ?? options.url,
    );

    if (options.boot === true) {
      await client.boot();
    }

    try {
      await client.connect();
    } catch (cause) {
      throw new AttestError('PROVIDER_ERROR', 'Could not connect to the KERIA agent', {
        url: options.url,
        hint: options.boot === true ? undefined : 'Pass boot to create the agent first',
        cause: (cause as Error).message,
      });
    }

    return new KeriaClient(client, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  /** Generates a passcode suitable for controlling a new agent. */
  static async randomPasscode(): Promise<string> {
    const signify = await load();
    await signify.ready();
    return signify.randomPasscode();
  }

  async createIdentity(name: string, options: CreateIdentityOptions = {}): Promise<Identity> {
    const witnesses = options.witnesses ?? [];
    const result = await this.client.identifiers().create(name, {
      transferable: options.transferable ?? true,
      ...(witnesses.length > 0
        ? { wits: [...witnesses], toad: options.threshold ?? majority(witnesses.length) }
        : {}),
    });
    await this.wait(result);
    return this.identity(name);
  }

  async identity(name: string): Promise<Identity> {
    const hab = await this.client.identifiers().get(name);
    return { name: hab.name, aid: hab.prefix, transferable: hab.transferable };
  }

  async identities(): Promise<Identity[]> {
    const { aids } = await this.client.identifiers().list();
    return aids.map((hab) => ({
      name: hab.name,
      aid: hab.prefix,
      transferable: hab.transferable,
    }));
  }

  /** Publishes the agent as an endpoint for the identifier so its log is reachable. */
  async authorizeAgent(name: string): Promise<void> {
    const agent = this.client.agent;
    if (agent === null) {
      throw new AttestError('PROVIDER_ERROR', 'Agent is not connected');
    }
    const result = await this.client.identifiers().addEndRole(name, 'agent', agent.pre);
    await this.wait(result);
  }

  /**
   * Commits a digest to the identifier's log with an interaction event and
   * returns the sequence number the on-chain record must cite.
   */
  async anchor(name: string, said: string): Promise<AnchorReceipt> {
    const seal: Seal = { d: said };
    const result = await this.client.identifiers().interact(name, seal);
    await this.wait(result);

    return {
      identifier: result.serder.pre,
      sequence: formatSequence(result.serder.sn),
      eventSaid: result.serder.said,
    };
  }

  async keyEventLog(aid: string): Promise<KeyEvent[]> {
    return parseKeyEventLog(await this.keyEventRecords(aid));
  }

  /**
   * The agent's key event records as it serves them, unparsed.
   *
   * Exporting a log has to keep every field the events carry — key lists,
   * thresholds, witness configuration — and not just the parts this package
   * reads, so that a captured copy stays a copy rather than a summary.
   */
  async keyEventRecords(aid: string): Promise<unknown[]> {
    const records = await this.client.keyEvents().get(aid);
    return records.map((record) =>
      record !== null && typeof record === 'object' && 'ked' in record
        ? (record as { ked: unknown }).ked
        : record,
    );
  }

  async oobi(name: string, role = 'agent'): Promise<string> {
    const { oobis } = await this.client.oobis().get(name, role);
    const oobi = oobis[0];
    if (oobi === undefined) {
      throw new AttestError('PROVIDER_ERROR', 'Identifier has no OOBI for that role', {
        name,
        role,
      });
    }
    return oobi;
  }

  async resolveOobi(oobi: string, alias?: string): Promise<void> {
    const operation = await this.client.oobis().resolve(oobi, alias);
    await this.client
      .operations()
      .wait(operation as never, { signal: AbortSignal.timeout(this.timeoutMs) });
  }

  private async wait(result: EventResultLike): Promise<void> {
    const operation = await result.op();
    await this.client
      .operations()
      .wait(operation as never, { signal: AbortSignal.timeout(this.timeoutMs) });
  }
}

function majority(count: number): number {
  return Math.floor(count / 2) + 1;
}

async function load(): Promise<SignifyModule> {
  const specifier = PACKAGE;
  try {
    return (await import(specifier)) as SignifyModule;
  } catch (cause) {
    throw new AttestError('PROVIDER_ERROR', `Issuing attestations requires ${PACKAGE}`, {
      package: PACKAGE,
      cause: (cause as Error).message,
    });
  }
}
