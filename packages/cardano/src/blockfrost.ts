import { AttestError, type Metadatum, type Network } from '@attest/core';

import { HttpClient } from './http.js';
import type {
  ChainProvider,
  LabelledMetadata,
  ScanOptions,
  Tip,
  TransactionRef,
} from './provider.js';

const ENDPOINTS: Readonly<Record<Network, string>> = {
  mainnet: 'https://cardano-mainnet.blockfrost.io/api/v0',
  preprod: 'https://cardano-preprod.blockfrost.io/api/v0',
  preview: 'https://cardano-preview.blockfrost.io/api/v0',
};

const MAX_PAGE_SIZE = 100;

interface BlockfrostBlock {
  readonly slot: number;
  readonly height: number;
  readonly epoch: number;
}

interface BlockfrostTransaction {
  readonly hash: string;
  readonly block_height: number;
  readonly block_time: number;
  readonly slot: number;
}

interface BlockfrostLabelEntry {
  readonly tx_hash: string;
  readonly json_metadata: Metadatum | null;
}

interface BlockfrostTxMetadata {
  readonly label: string;
  readonly json_metadata: Metadatum | null;
}

export interface BlockfrostOptions {
  readonly projectId: string;
  readonly network?: Network;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

/** Infers the network a Blockfrost project id is scoped to from its prefix. */
export function networkFromProjectId(projectId: string): Network | undefined {
  for (const network of Object.keys(ENDPOINTS) as Network[]) {
    if (projectId.startsWith(network)) return network;
  }
  return undefined;
}

export class BlockfrostProvider implements ChainProvider {
  readonly name = 'blockfrost';
  readonly network: Network;

  private readonly http: HttpClient;

  constructor(options: BlockfrostOptions) {
    const network = options.network ?? networkFromProjectId(options.projectId);
    if (network === undefined) {
      throw new AttestError('PROVIDER_ERROR', 'Cannot infer the network from the project id', {});
    }
    this.network = network;
    this.http = new HttpClient({
      baseUrl: options.baseUrl ?? ENDPOINTS[network],
      headers: { project_id: options.projectId },
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  async tip(): Promise<Tip> {
    const block = await this.http.get<BlockfrostBlock>('/blocks/latest');
    return { slot: block.slot, height: block.height, epoch: block.epoch };
  }

  async *scanLabel(label: number, options: ScanOptions = {}): AsyncIterable<LabelledMetadata> {
    const count = Math.min(options.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
    const order = options.order ?? 'asc';
    let page = options.fromPage ?? 1;

    for (;;) {
      const entries = await this.http.get<BlockfrostLabelEntry[]>(`/metadata/txs/labels/${label}`, {
        page,
        count,
        order,
      });
      if (entries.length === 0) return;

      for (const entry of entries) {
        if (entry.json_metadata === null) continue;
        const transaction = await this.transaction(entry.tx_hash);
        if (transaction === undefined) continue;
        yield { transaction, label, payload: entry.json_metadata };
      }

      if (entries.length < count) return;
      page += 1;
    }
  }

  async metadata(txHash: string): Promise<Record<string, Metadatum>> {
    const entries =
      (await this.http.getOptional<BlockfrostTxMetadata[]>(`/txs/${txHash}/metadata`)) ?? [];
    const out: Record<string, Metadatum> = {};
    for (const entry of entries) {
      if (entry.json_metadata !== null) out[entry.label] = entry.json_metadata;
    }
    return out;
  }

  async transaction(txHash: string): Promise<TransactionRef | undefined> {
    const tx = await this.http.getOptional<BlockfrostTransaction>(`/txs/${txHash}`);
    if (tx === undefined) return undefined;
    return { hash: tx.hash, slot: tx.slot, height: tx.block_height, time: tx.block_time };
  }

  async hasScript(scriptHash: string): Promise<boolean> {
    return (await this.http.getOptional<unknown>(`/scripts/${scriptHash}`)) !== undefined;
  }
}
