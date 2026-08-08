import { AttestError, type Metadatum, type Network } from '@attest/core';

import { HttpClient } from './http.js';
import type { ChainProvider, LabelledMetadata, Tip, TransactionRef } from './provider.js';

const ENDPOINTS: Readonly<Record<Network, string>> = {
  mainnet: 'https://api.koios.rest/api/v1',
  preprod: 'https://preprod.koios.rest/api/v1',
  preview: 'https://preview.koios.rest/api/v1',
};

interface KoiosTip {
  readonly abs_slot: number;
  readonly block_no: number;
  readonly epoch_no: number;
}

interface KoiosTxInfo {
  readonly tx_hash: string;
  readonly absolute_slot: number;
  readonly block_height: number;
  readonly tx_timestamp: number;
}

interface KoiosTxMetadata {
  readonly tx_hash: string;
  readonly metadata: Record<string, Metadatum> | null;
}

export interface KoiosOptions {
  readonly network?: Network;
  readonly baseUrl?: string;
  readonly apiToken?: string;
  readonly timeoutMs?: number;
}

export class KoiosProvider implements ChainProvider {
  readonly name = 'koios';
  readonly network: Network;

  private readonly http: HttpClient;

  constructor(options: KoiosOptions = {}) {
    this.network = options.network ?? 'mainnet';
    this.http = new HttpClient({
      baseUrl: options.baseUrl ?? ENDPOINTS[this.network],
      ...(options.apiToken !== undefined
        ? { headers: { authorization: `Bearer ${options.apiToken}` } }
        : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  async tip(): Promise<Tip> {
    const [tip] = await this.http.get<KoiosTip[]>('/tip');
    if (tip === undefined) {
      throw new AttestError('PROVIDER_ERROR', 'Koios returned no tip');
    }
    return { slot: tip.abs_slot, height: tip.block_no, epoch: tip.epoch_no };
  }

  /**
   * Koios exposes no index from a metadata label to the transactions carrying
   * it, so scanning has to run against a provider that does.
   */
  // eslint-disable-next-line require-yield
  async *scanLabel(): AsyncIterable<LabelledMetadata> {
    throw new AttestError(
      'PROVIDER_ERROR',
      'Koios cannot enumerate transactions by metadata label; use a provider with a label index',
      { provider: this.name },
    );
  }

  async metadata(txHash: string): Promise<Record<string, Metadatum>> {
    const [entry] = await this.http.post<KoiosTxMetadata[]>('/tx_metadata', {
      _tx_hashes: [txHash],
    });
    return entry?.metadata ?? {};
  }

  async transaction(txHash: string): Promise<TransactionRef | undefined> {
    const [info] = await this.http.post<KoiosTxInfo[]>('/tx_info', { _tx_hashes: [txHash] });
    if (info === undefined) return undefined;
    return {
      hash: info.tx_hash,
      slot: info.absolute_slot,
      height: info.block_height,
      time: info.tx_timestamp,
    };
  }

  async hasScript(scriptHash: string): Promise<boolean> {
    const entries = await this.http.post<unknown[]>('/script_info', {
      _script_hashes: [scriptHash],
    });
    return entries.length > 0;
  }
}
