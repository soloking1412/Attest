import { AttestError, SCRIPT_HASH_BYTES } from '@attest/core';
import { reproduce } from '@attest/blueprint';
import { KeriaResolver } from '@attest/keri';
// Imported by subpath: the package root also exports the SQLite-backed store,
// which the command line has no use for.
import { verifyTransaction, type Check, type VerificationReport } from '@attest/verifier/verify';

import { boolFlag, flag } from '../args.js';
import { createProvider, requirePasscode } from '../config.js';
import { type Command, type CommandContext } from '../context.js';
import { readAttestation } from '../document.js';

const MARKS: Record<Check['status'], string> = { pass: 'ok', fail: 'FAIL', skipped: '--' };

export const verify: Command = async (context) => {
  const script = flag(context.args, 'script');
  if (script !== undefined) return byScript(context, script);

  const file = flag(context.args, 'file');
  if (file !== undefined) return fromFile(context, file);

  const txHash = context.args.positional[0];
  if (txHash === undefined) {
    throw new AttestError('INVALID_DOCUMENT', 'Pass a transaction hash, --file or --script');
  }
  return onChain(context, txHash);
};

async function onChain(context: CommandContext, txHash: string): Promise<void> {
  const provider = createProvider(context.config, context.secrets);
  const resolver = await KeriaResolver.connect({
    url: context.config.keria.url,
    passcode: requirePasscode(context.secrets),
  });

  const report = await verifyTransaction(provider, txHash, { resolver, provider });
  present(context, report);

  if (report.verdict !== 'verified') process.exitCode = 1;
}

/**
 * Checks a document without touching the chain. This proves only that the
 * document is internally consistent, so the verdict is reported as such rather
 * than as verification.
 */
async function fromFile(context: CommandContext, path: string): Promise<void> {
  const attestation = await readAttestation(path);

  context.reporter.line(`Document is well formed and hashes to its identifier`);
  context.reporter.detail('said', attestation.d);
  context.reporter.detail('type', attestation.t);
  context.reporter.detail('issuer', attestation.i);
  context.reporter.detail('issued', attestation.dt);

  if (!boolFlag(context.args, 'reproduce')) {
    context.reporter.line('');
    context.reporter.line('Not checked: whether the issuer committed to it on chain.');
    context.reporter.result({ attestation, reproduced: null });
    return;
  }

  if (attestation.t !== 'build') {
    throw new AttestError('INVALID_DOCUMENT', 'Only build attestations can be reproduced', {
      type: attestation.t,
    });
  }

  const image = flag(context.args, 'image') ?? context.config.build.image;
  const outcome = await reproduce({
    source: attestation.a.source,
    expected: attestation.a.script,
    compiler: attestation.a.compiler.name,
    blueprintPath: context.config.build.blueprint,
    ...(image !== undefined ? { image } : {}),
    allowHostBuild: boolFlag(context.args, 'allow-host-build'),
  });

  context.reporter.line('');
  context.reporter.line(outcome.reproduced ? 'Build reproduced' : 'Build did NOT reproduce');
  context.reporter.detail('expected', outcome.expected.hash);
  context.reporter.detail('produced', outcome.produced.map((s) => s.hash).join(', '));
  context.reporter.result({ attestation, reproduced: outcome.reproduced, outcome });

  if (!outcome.reproduced) process.exitCode = 1;
}

async function byScript(context: CommandContext, scriptHash: string): Promise<void> {
  const api = flag(context.args, 'api');
  if (api === undefined) {
    throw new AttestError(
      'INVALID_DOCUMENT',
      'Looking up by script needs --api pointing at a verifier',
      {
        hint: 'Transactions can be verified directly: attest verify <tx-hash>',
      },
    );
  }
  if (!new RegExp(`^[0-9a-f]{${SCRIPT_HASH_BYTES * 2}}$`).test(scriptHash.toLowerCase())) {
    throw new AttestError('INVALID_DOCUMENT', 'Script hash must be 28 hex-encoded bytes');
  }

  const response = await fetch(`${api.replace(/\/+$/, '')}/v1/scripts/${scriptHash.toLowerCase()}`);
  if (!response.ok) {
    throw new AttestError('PROVIDER_ERROR', `Verifier returned ${response.status}`, { api });
  }

  const summary = (await response.json()) as {
    build: string;
    audit: string;
    issuers: string[];
    attestations: unknown[];
  };

  context.reporter.line(`Script ${scriptHash}`);
  context.reporter.detail('build', summary.build);
  context.reporter.detail('audit', summary.audit);
  context.reporter.detail('issuers', summary.issuers.join(', ') || 'none');
  context.reporter.detail('records', String(summary.attestations.length));
  context.reporter.result(summary);

  if (summary.build !== 'verified') process.exitCode = 1;
}

function present(context: CommandContext, report: VerificationReport): void {
  context.reporter.line(`Verdict: ${report.verdict}`);
  context.reporter.detail('tx', report.transaction.hash);
  if (report.issuer !== undefined) context.reporter.detail('issuer', report.issuer);
  if (report.digest !== undefined) context.reporter.detail('said', report.digest);
  if (report.attestation !== undefined) {
    context.reporter.detail('type', report.attestation.t);
  }
  if (report.scripts.length > 0) {
    context.reporter.detail('scripts', report.scripts.join(', '));
  }

  context.reporter.line('');
  for (const check of report.checks) {
    context.reporter.line(`  [${MARKS[check.status].padEnd(4)}] ${check.name}: ${check.detail}`);
  }
  context.reporter.result(report);
}
