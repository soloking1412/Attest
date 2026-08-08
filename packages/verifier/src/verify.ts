import { AttestError, subjectScripts, type Attestation, type Metadatum } from '@attest/core';
import { readPublication, type ChainProvider, type TransactionRef } from '@attest/cardano';
import { assertAnchored, type KelResolver } from '@attest/keri';

export const CHECK_NAMES = ['document', 'anchor', 'script', 'revocation'] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

export type CheckStatus = 'pass' | 'fail' | 'skipped';

export interface Check {
  readonly name: CheckName;
  readonly status: CheckStatus;
  readonly detail: string;
}

/**
 * `verified` requires the document to be intact and the issuer's key event log
 * to commit to it. `unanchored` means the transaction is well formed but the
 * issuer has not committed to it, which is what an impersonation attempt looks
 * like. `invalid` means the transaction does not parse as a publication at all.
 */
export type Verdict = 'verified' | 'revoked' | 'unanchored' | 'invalid';

export interface VerificationReport {
  readonly verdict: Verdict;
  readonly transaction: TransactionRef;
  readonly digest?: string;
  readonly issuer?: string;
  /** Sequence number of the key event the record cites, lowercase hex. */
  readonly sequence?: string;
  readonly attestation?: Attestation;
  readonly scripts: readonly string[];
  readonly checks: readonly Check[];
}

/** Answers whether a revocation has been published against a given attestation. */
export interface RevocationIndex {
  isRevoked(said: string): boolean | Promise<boolean>;
}

export interface VerifyOptions {
  readonly resolver: KelResolver;
  /**
   * Enables the script presence check. Kept separate from the provider a
   * caller reads the transaction with, so fetching a publication never
   * silently implies querying the chain for every script it names.
   */
  readonly provider?: ChainProvider;
  readonly revocations?: RevocationIndex;
}

export async function verifyTransaction(
  provider: ChainProvider,
  txHash: string,
  options: VerifyOptions,
): Promise<VerificationReport> {
  const transaction = await provider.transaction(txHash);
  if (transaction === undefined) {
    throw new AttestError('PROVIDER_ERROR', 'Transaction not found', { txHash });
  }
  const metadata = await provider.metadata(txHash);
  return verifyMetadata(metadata, transaction, options);
}

/**
 * Runs every check against one publication and reduces them to a verdict.
 *
 * Checks are collected rather than short-circuited so a caller can see which
 * part failed; only the document and anchor checks decide the verdict.
 */
export async function verifyMetadata(
  metadata: Record<string, Metadatum>,
  transaction: TransactionRef,
  options: VerifyOptions,
): Promise<VerificationReport> {
  const checks: Check[] = [];

  let publication;
  try {
    publication = readPublication(metadata);
  } catch (error) {
    return {
      verdict: 'invalid',
      transaction,
      scripts: [],
      checks: [{ name: 'document', status: 'fail', detail: describe(error) }],
    };
  }

  const { record, attestation } = publication;
  checks.push({
    name: 'document',
    status: 'pass',
    detail:
      attestation === undefined
        ? 'CIP-170 record is well formed; document published elsewhere'
        : 'Document hashes to the identifier the record cites',
  });

  const anchored = await checkAnchor(record.issuer, record.sequence, record.digest, options);
  checks.push(anchored);

  const scripts = attestation === undefined ? [] : subjectScripts(attestation).map((s) => s.hash);
  checks.push(await checkScripts(scripts, options));
  checks.push(await checkRevocation(record.digest, options));

  return {
    verdict: decide(checks),
    transaction,
    digest: record.digest,
    issuer: record.issuer,
    sequence: record.sequence,
    ...(attestation !== undefined ? { attestation } : {}),
    scripts,
    checks,
  };
}

function decide(checks: readonly Check[]): Verdict {
  const status = (name: CheckName) => checks.find((check) => check.name === name)?.status;
  if (status('document') === 'fail') return 'invalid';
  if (status('anchor') !== 'pass') return 'unanchored';
  if (status('revocation') === 'fail') return 'revoked';
  return 'verified';
}

async function checkAnchor(
  issuer: string,
  sequence: string,
  digest: string,
  options: VerifyOptions,
): Promise<Check> {
  try {
    const log = await options.resolver.resolve(issuer);
    assertAnchored(log, { identifier: issuer, sequence, said: digest });
    return {
      name: 'anchor',
      status: 'pass',
      detail: `Committed by ${issuer} at sequence ${sequence}`,
    };
  } catch (error) {
    return { name: 'anchor', status: 'fail', detail: describe(error) };
  }
}

async function checkScripts(scripts: readonly string[], options: VerifyOptions): Promise<Check> {
  if (options.provider === undefined || scripts.length === 0) {
    return { name: 'script', status: 'skipped', detail: 'No script presence check requested' };
  }
  try {
    const present = await Promise.all(scripts.map((hash) => options.provider!.hasScript(hash)));
    const missing = scripts.filter((_, index) => present[index] !== true);
    return missing.length === 0
      ? { name: 'script', status: 'pass', detail: 'Every script is present on chain' }
      : {
          name: 'script',
          status: 'fail',
          detail: `Not yet seen on chain: ${missing.join(', ')}`,
        };
  } catch (error) {
    return { name: 'script', status: 'skipped', detail: describe(error) };
  }
}

async function checkRevocation(digest: string, options: VerifyOptions): Promise<Check> {
  if (options.revocations === undefined) {
    return { name: 'revocation', status: 'skipped', detail: 'No revocation index supplied' };
  }
  const revoked = await options.revocations.isRevoked(digest);
  return revoked
    ? { name: 'revocation', status: 'fail', detail: 'A revocation names this attestation' }
    : { name: 'revocation', status: 'pass', detail: 'No revocation found' };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
