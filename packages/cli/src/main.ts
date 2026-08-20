#!/usr/bin/env node
import { AttestError } from '@attest/core';

import { boolFlag, parseArgs } from './args.js';
import { audit } from './commands/audit.js';
import { build } from './commands/build.js';
import { id } from './commands/id.js';
import { init } from './commands/init.js';
import { publish } from './commands/publish.js';
import { verify } from './commands/verify.js';
import { loadConfig, readSecrets } from './config.js';
import type { Command } from './context.js';
import { createReporter, describeError } from './output.js';

const COMMANDS: Readonly<Record<string, Command>> = { init, id, build, audit, publish, verify };

const USAGE = `attest — build and audit attestations for Cardano contracts

Usage
  attest <command> [options]

Commands
  init                      Write attest.config.json
  id create <name>          Create a KERI identifier and authorize the agent
  id list                   List local identifiers
  id show [name]            Show an identifier and its key event log length
  id oobi [name]            Print the OOBI others resolve to reach the log
  id export [name]          Write the key event log out for offline verification
  build                     Compile and attest a validator
  audit                     Attest an audit report over one or more scripts
  publish <file>            Commit an attestation to the log and submit it
  verify <tx-hash>          Verify a published attestation
  verify --file <path>      Check a document offline
  verify --script <hash>    Ask a verifier what is known about a script

Common options
  --json                    Emit machine-readable output
  --issuer <name|aid>       Override the configured issuer
  --help                    Show this message

Id options
  --out <path>              File to write the exported log to

Build options
  --validator <title>       Validator to attest when the blueprint holds several
  --blueprint <path>        Blueprint path, default plutus.json
  --image <ref>             Build inside a container image
  --no-compile              Attest a blueprint already on disk
  --allow-dirty             Attest despite uncommitted changes
  --out <path>              Where to write the document

Audit options
  --report <path>           Report file whose digest is recorded
  --script <hash[:version]> Script in scope, repeatable
  --outcome <outcome>       clean, findings-resolved, findings-open or failed
  --title <text>            Human-readable report title
  --uri <uri>               Where the report can be fetched
  --critical/--high/...     Finding counts by severity

Publish options
  --dry-run                 Commit to the log and print the transaction
  --no-document             Publish the record without the inline document
  --no-cip171               Skip the CIP-171 verification record

Verify options
  --reproduce               Rebuild from source and compare the script hash
  --allow-host-build        Reproduce without a container
  --api <url>               Verifier to query for --script lookups

Environment
  KERIA_PASSCODE            Passcode controlling the KERIA agent
  BLOCKFROST_PROJECT_ID     Project id for the configured network
  CARDANO_WALLET_SEED       Seed phrase of the publishing wallet
`;

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const name = args.positional[0];

  if (name === undefined || boolFlag(args, 'help') || name === 'help') {
    process.stdout.write(USAGE);
    return name === undefined && !boolFlag(args, 'help') ? 1 : 0;
  }

  const command = COMMANDS[name];
  if (command === undefined) {
    process.stderr.write(`attest: unknown command '${name}'\n\n${USAGE}`);
    return 1;
  }

  const reporter = createReporter(boolFlag(args, 'json'));
  const cwd = process.cwd();

  await command({
    args: { positional: args.positional.slice(1), flags: args.flags },
    config: await loadConfig(cwd),
    secrets: readSecrets(),
    reporter,
    cwd,
  });

  return process.exitCode === undefined ? 0 : Number(process.exitCode);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`attest: ${describeError(error)}\n`);
    process.exitCode = error instanceof AttestError ? 2 : 1;
  });
