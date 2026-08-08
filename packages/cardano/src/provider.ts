import type { Metadatum, Network } from '@attest/core';

export interface Tip {
  readonly slot: number;
  readonly height: number;
  readonly epoch: number;
}

export interface TransactionRef {
  readonly hash: string;
  readonly slot: number;
  readonly height: number;
  /** Unix seconds of the block that carries the transaction. */
  readonly time: number;
}

export interface LabelledMetadata {
  readonly transaction: TransactionRef;
  readonly label: number;
  readonly payload: Metadatum;
}

export interface ScanOptions {
  /** Resume point, expressed as the provider's page cursor. */
  readonly fromPage?: number;
  readonly pageSize?: number;
  readonly order?: 'asc' | 'desc';
}

/**
 * Read access to chain data. Verification only ever needs these four calls, so
 * an operator can run the verifier against whichever backend they trust.
 */
export interface ChainProvider {
  readonly name: string;
  readonly network: Network;

  tip(): Promise<Tip>;

  /** Transactions carrying a metadata label, oldest first by default. */
  scanLabel(label: number, options?: ScanOptions): AsyncIterable<LabelledMetadata>;

  /** All metadata attached to one transaction, keyed by label. */
  metadata(txHash: string): Promise<Record<string, Metadatum>>;

  transaction(txHash: string): Promise<TransactionRef | undefined>;

  /** Whether a script with this hash has been seen on chain. */
  hasScript(scriptHash: string): Promise<boolean>;
}

/** Write access, kept separate so a verifier never needs signing capability. */
export interface Submitter {
  readonly network: Network;
  submit(metadata: Record<string, Metadatum>): Promise<string>;
  address(): Promise<string>;
}
