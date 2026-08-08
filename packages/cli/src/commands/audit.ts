import { readFile } from 'node:fs/promises';

import {
  assertOneOf,
  AttestError,
  AUDIT_OUTCOMES,
  createAuditAttestation,
  qb64Digest,
  SCRIPT_HASH_BYTES,
  type PlutusVersion,
  type ScriptRef,
} from '@attest/core';
import { readGitContext } from '@attest/blueprint';

import { flag, flags, requireFlag } from '../args.js';
import { resolveIssuer, type Command, type CommandContext } from '../context.js';
import { DEFAULT_DIRECTORY, documentPath, writeAttestation } from '../document.js';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'] as const;

export const audit: Command = async (context) => {
  const { args, reporter } = context;

  const reportPath = requireFlag(args, 'report');
  const report = await readFile(reportPath);
  const outcome = flag(args, 'outcome') ?? 'clean';
  assertOneOf(outcome, 'outcome', AUDIT_OUTCOMES);

  const scripts = readScripts(flags(args, 'script'), flag(args, 'plutus'));
  const source = await readSource(context);
  const findings = readFindings(context);
  const uri = flag(args, 'uri');
  const issuer = await resolveIssuer(context);

  const attestation = createAuditAttestation(
    {
      scripts,
      source,
      report: {
        title: flag(args, 'title') ?? reportPath,
        digest: qb64Digest(new Uint8Array(report)),
        ...(uri !== undefined ? { uri } : {}),
      },
      outcome,
      ...(findings !== undefined ? { findings } : {}),
    },
    { issuer },
  );

  const path = await writeAttestation(
    attestation,
    flag(args, 'out') ?? documentPath(attestation, DEFAULT_DIRECTORY),
  );

  reporter.line(`Attested audit of ${scripts.length} script(s)`);
  reporter.detail('outcome', outcome);
  reporter.detail('report', attestation.a.report.digest);
  reporter.detail('commit', source.commit);
  reporter.detail('said', attestation.d);
  reporter.detail('file', path);
  reporter.result({ attestation, path });
};

function readScripts(values: readonly string[], plutusVersion: string | undefined): ScriptRef[] {
  if (values.length === 0) {
    throw new AttestError('INVALID_DOCUMENT', 'Pass --script for every script in scope');
  }
  const version = (plutusVersion ?? 'v3') as PlutusVersion;

  return values.map((value) => {
    const [hash, declared] = value.split(':');
    if (hash === undefined || hash.length !== SCRIPT_HASH_BYTES * 2) {
      throw new AttestError('INVALID_DOCUMENT', 'Script must be 28 hex-encoded bytes', { value });
    }
    return { hash: hash.toLowerCase(), plutusVersion: (declared ?? version) as PlutusVersion };
  });
}

async function readSource(context: CommandContext) {
  const url = flag(context.args, 'source-url');
  const commit = flag(context.args, 'source-commit');
  if (url !== undefined && commit !== undefined) {
    return { url, commit: commit.toLowerCase() };
  }

  const git = await readGitContext(context.cwd);
  return { url: url ?? git.url, commit: (commit ?? git.commit).toLowerCase() };
}

/** Counts are recorded only when the auditor supplies at least one. */
function readFindings(context: CommandContext) {
  const present = SEVERITIES.some((severity) => flag(context.args, severity) !== undefined);
  if (!present) return undefined;

  const counts = {} as Record<(typeof SEVERITIES)[number], number>;
  for (const severity of SEVERITIES) {
    const raw = flag(context.args, severity) ?? '0';
    const value = Number.parseInt(raw, 10);
    if (!Number.isInteger(value) || value < 0) {
      throw new AttestError('INVALID_DOCUMENT', `--${severity} must be a non-negative integer`, {
        value: raw,
      });
    }
    counts[severity] = value;
  }
  return counts;
}
