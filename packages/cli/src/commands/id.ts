import { writeFile } from 'node:fs/promises';

import { AttestError } from '@attest/core';

import { boolFlag, flag, flags, positional } from '../args.js';
import { connectKeria, type Command, type CommandContext } from '../context.js';

export const id: Command = async (context) => {
  const action = context.args.positional[0] ?? 'list';
  switch (action) {
    case 'create':
      return create(context);
    case 'list':
      return list(context);
    case 'show':
      return show(context);
    case 'oobi':
      return oobi(context);
    case 'export':
      return exportLog(context);
    default:
      throw new AttestError('INVALID_DOCUMENT', 'Unknown id action', {
        action,
        supported: ['create', 'list', 'show', 'oobi', 'export'],
      });
  }
};

async function create(context: CommandContext): Promise<void> {
  const name = positional(context.args, 1, 'name');
  const witnesses = flags(context.args, 'witness');
  const client = await connectKeria(context, boolFlag(context.args, 'boot'));

  const identity = await client.createIdentity(name, {
    ...(witnesses.length > 0 ? { witnesses } : {}),
  });
  await client.authorizeAgent(name);

  context.reporter.line(`Created identifier ${name}`);
  context.reporter.detail('aid', identity.aid);
  context.reporter.detail('witnesses', witnesses.length > 0 ? witnesses.join(', ') : 'none');
  context.reporter.result(identity);
}

async function list(context: CommandContext): Promise<void> {
  const identities = await (await connectKeria(context)).identities();
  for (const identity of identities) {
    context.reporter.line(`${identity.name.padEnd(20)}${identity.aid}`);
  }
  if (identities.length === 0) context.reporter.line('No identifiers yet');
  context.reporter.result(identities);
}

async function show(context: CommandContext): Promise<void> {
  const name = context.args.positional[1] ?? context.config.issuer;
  const client = await connectKeria(context);
  const identity = await client.identity(name);
  const log = await client.keyEventLog(identity.aid);
  const latest = log[log.length - 1];

  context.reporter.line(`Identifier ${identity.name}`);
  context.reporter.detail('aid', identity.aid);
  context.reporter.detail('transferable', String(identity.transferable));
  context.reporter.detail('events', String(log.length));
  context.reporter.detail('sequence', latest?.sequence ?? '0');
  context.reporter.result({ ...identity, events: log.length, sequence: latest?.sequence ?? '0' });
}

async function oobi(context: CommandContext): Promise<void> {
  const name = context.args.positional[1] ?? context.config.issuer;
  const url = await (await connectKeria(context)).oobi(name);

  context.reporter.line(url);
  context.reporter.result({ name, oobi: url });
}

/**
 * Writes an identifier's key event log to a file, keyed by identifier.
 *
 * A log is public and append-only, so a copy of one carries the same weight
 * wherever it is served from. Exporting lets attestations already published
 * stay verifiable without the agent that issued them having to stay reachable.
 */
async function exportLog(context: CommandContext): Promise<void> {
  const name = context.args.positional[1] ?? context.config.issuer;
  const client = await connectKeria(context);
  const identity = await client.identity(name);
  const records = await client.keyEventRecords(identity.aid);
  const log = { [identity.aid]: records };

  const path = flag(context.args, 'out');
  if (path !== undefined) {
    await writeFile(path, `${JSON.stringify(log, null, 2)}\n`);
    context.reporter.line(`Wrote ${records.length} events to ${path}`);
    context.reporter.detail('aid', identity.aid);
  } else {
    context.reporter.line(JSON.stringify(log, null, 2));
  }
  context.reporter.result(log);
}
