import { CIP170_LABEL, looksLikeCip170 } from '@attest/core';
import type { ChainProvider } from '@attest/cardano';
import { CachingKelResolver, type KelResolver } from '@attest/keri';

import type { AttestationStore } from './store.js';
import { verifyMetadata, type VerificationReport } from './verify.js';

export interface IndexerOptions {
  readonly provider: ChainProvider;
  readonly resolver: KelResolver;
  readonly store: AttestationStore;
  readonly label?: number;
  readonly pageSize?: number;
  readonly onReport?: (report: VerificationReport) => void;
}

export interface IndexRun {
  readonly scanned: number;
  readonly recorded: number;
  readonly verified: number;
  readonly resumeFrom: number;
}

const DEFAULT_PAGE_SIZE = 100;

export class Indexer {
  private readonly label: number;
  private readonly pageSize: number;

  constructor(private readonly options: IndexerOptions) {
    this.label = options.label ?? CIP170_LABEL;
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  }

  /**
   * Scans forward from the stored cursor and records what it finds.
   *
   * The cursor is a page number rather than a position, and the run resumes on
   * the page it stopped inside rather than after it, because the newest page
   * gains entries as blocks arrive. Records are written by upsert, so re-reading
   * a page changes nothing.
   */
  async runOnce(): Promise<IndexRun> {
    const { provider, store } = this.options;
    const resolver = new CachingKelResolver(this.options.resolver);
    const startPage = store.cursor(this.label) ?? 1;

    let scanned = 0;
    let recorded = 0;
    let verified = 0;

    for await (const entry of provider.scanLabel(this.label, {
      fromPage: startPage,
      pageSize: this.pageSize,
      order: 'asc',
    })) {
      scanned += 1;
      if (!looksLikeCip170(entry.payload)) continue;

      const metadata = await provider.metadata(entry.transaction.hash);
      const report = await verifyMetadata(metadata, entry.transaction, {
        resolver,
        provider,
        revocations: store,
      });

      store.record(report);
      recorded += 1;
      if (report.verdict === 'verified') verified += 1;
      this.options.onReport?.(report);
    }

    const resumeFrom = startPage + Math.floor(scanned / this.pageSize);
    store.setCursor(this.label, resumeFrom);

    return { scanned, recorded, verified, resumeFrom };
  }

  /** Runs until the signal aborts, pausing between passes. */
  async follow(intervalMs = 60_000, signal?: AbortSignal): Promise<void> {
    while (signal?.aborted !== true) {
      await this.runOnce();
      await sleep(intervalMs, signal);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
