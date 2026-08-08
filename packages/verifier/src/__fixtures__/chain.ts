import {
  createAuditAttestation,
  createBuildAttestation,
  createRevocationAttestation,
  qb64Digest,
  type Attestation,
  type BuildBody,
  type Metadatum,
  type Network,
} from '@attest/core';
import {
  buildMetadata,
  type ChainProvider,
  type LabelledMetadata,
  type ScanOptions,
  type Tip,
  type TransactionRef,
} from '@attest/cardano';
import { parseKeyEventLog, StaticKelResolver, type KeyEvent } from '@attest/keri';

export const ISSUER = 'EKtQ1lymrnrh3qv5S18PBzQ7ukHGFJ7EXkH7B22XEMIL';
export const IMPOSTOR = 'EBcIURLpxmVwahksgrsGW6_dUw0zBhyEHYFk17eWrZfk';
export const SCRIPT_HASH = 'd7a75e29fc699c832922e4594b5ac04ed4701b06f680ed9d39a8e5b6';
export const OTHER_SCRIPT = 'f182984ad1a23d4386df014563c2b1c7d6ee00245872339ad26c4c34';
const COMMIT = '9f8e7d6c5b4a39281706f5e4d3c2b1a099887766';

export const buildBody: BuildBody = {
  script: { hash: SCRIPT_HASH, plutusVersion: 'v2', title: 'vault.spend' },
  source: { url: 'https://github.com/example/vault', commit: COMMIT },
  compiler: { name: 'aiken', version: 'v1.1.9+e2fb28b' },
  blueprint: qb64Digest('blueprint'),
};

export function buildAttestation(issuer = ISSUER): Attestation {
  return createBuildAttestation(buildBody, { issuer });
}

export function auditAttestation(issuer = ISSUER): Attestation {
  return createAuditAttestation(
    {
      scripts: [buildBody.script],
      source: buildBody.source,
      report: { title: 'Vault review', digest: qb64Digest('report') },
      outcome: 'clean',
    },
    { issuer },
  );
}

export function revocationOf(target: string, issuer = ISSUER): Attestation {
  return createRevocationAttestation({ target, reason: 'superseded' }, { issuer });
}

/** Builds a key event log committing each digest in turn, starting at sequence 1. */
export function keyEventLog(identifier: string, digests: readonly string[]): KeyEvent[] {
  const events: Record<string, unknown>[] = [
    {
      v: 'KERI10JSON0000fa_',
      t: 'icp',
      d: qb64Digest(`icp-${identifier}`),
      i: identifier,
      s: '0',
      a: [],
    },
  ];
  digests.forEach((digest, index) => {
    const previous = events[index] as { d: string };
    events.push({
      v: 'KERI10JSON0000cb_',
      t: 'ixn',
      d: qb64Digest(`ixn-${identifier}-${index}`),
      i: identifier,
      s: (index + 1).toString(16),
      p: previous.d,
      a: [{ d: digest }],
    });
  });
  return parseKeyEventLog(events);
}

export function resolverFor(...issuers: { aid: string; digests: readonly string[] }[]) {
  const resolver = new StaticKelResolver();
  for (const { aid, digests } of issuers) resolver.add(aid, keyEventLog(aid, digests));
  return resolver;
}

interface FakeTransaction {
  readonly ref: TransactionRef;
  readonly metadata: Record<string, Metadatum>;
}

/** In-memory chain, so the pipeline can be exercised without a provider. */
export class FakeProvider implements ChainProvider {
  readonly name = 'fake';

  private readonly transactions: FakeTransaction[] = [];
  private readonly scripts = new Set<string>();

  constructor(readonly network: Network = 'preview') {}

  publish(attestation: Attestation, sequence: string): string {
    return this.publishRaw(buildMetadata({ attestation, sequence }));
  }

  publishRaw(metadata: Record<string, Metadatum>): string {
    const height = this.transactions.length + 1;
    const hash = height.toString(16).padStart(64, '0');
    this.transactions.push({
      ref: { hash, slot: height * 20, height, time: 1_760_000_000 + height * 20 },
      metadata,
    });
    return hash;
  }

  withScript(hash: string): this {
    this.scripts.add(hash);
    return this;
  }

  async tip(): Promise<Tip> {
    return { slot: this.transactions.length * 20, height: this.transactions.length, epoch: 1 };
  }

  async *scanLabel(label: number, options: ScanOptions = {}): AsyncIterable<LabelledMetadata> {
    const pageSize = options.pageSize ?? 100;
    const start = ((options.fromPage ?? 1) - 1) * pageSize;
    for (const entry of this.transactions.slice(start)) {
      const payload = entry.metadata[String(label)];
      if (payload !== undefined) yield { transaction: entry.ref, label, payload };
    }
  }

  async metadata(txHash: string): Promise<Record<string, Metadatum>> {
    return this.find(txHash)?.metadata ?? {};
  }

  async transaction(txHash: string): Promise<TransactionRef | undefined> {
    return this.find(txHash)?.ref;
  }

  async hasScript(scriptHash: string): Promise<boolean> {
    return this.scripts.has(scriptHash);
  }

  private find(txHash: string): FakeTransaction | undefined {
    return this.transactions.find((entry) => entry.ref.hash === txHash);
  }
}
