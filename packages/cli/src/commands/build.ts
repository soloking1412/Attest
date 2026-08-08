import { AttestError, createBuildAttestation, type ScriptRef } from '@attest/core';
import { readGitContext, runBuild, toSourceRef } from '@attest/blueprint';

import { boolFlag, flag, flags } from '../args.js';
import { resolveIssuer, type Command } from '../context.js';
import { DEFAULT_DIRECTORY, documentPath, writeAttestation } from '../document.js';

export const build: Command = async (context) => {
  const { args, config, reporter } = context;

  const image = flag(args, 'image') ?? config.build.image;

  const outcome = await runBuild({
    cwd: context.cwd,
    blueprintPath: flag(args, 'blueprint') ?? config.build.blueprint,
    compiler: config.build.compiler,
    ...(image !== undefined ? { image } : {}),
    ...(config.build.command !== undefined ? { command: config.build.command } : {}),
    skipCompile: boolFlag(args, 'no-compile'),
  });

  const git = await readGitContext(context.cwd);
  if (git.dirty && !boolFlag(args, 'allow-dirty')) {
    throw new AttestError(
      'BUILD_FAILED',
      'Working tree has uncommitted changes, so the commit does not describe this build',
      { hint: 'Commit the changes or pass --allow-dirty' },
    );
  }

  const script = selectScript(outcome.scripts, flag(args, 'validator'));
  const parameters = flags(args, 'parameter');
  const issuer = await resolveIssuer(context);

  const attestation = createBuildAttestation(
    {
      script,
      source: toSourceRef(git, flag(args, 'path')),
      compiler: outcome.compiler,
      blueprint: outcome.digest,
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(Object.keys(outcome.environment).length > 0 ? { environment: outcome.environment } : {}),
    },
    { issuer },
  );

  const path = await writeAttestation(
    attestation,
    flag(args, 'out') ?? documentPath(attestation, DEFAULT_DIRECTORY),
  );

  reporter.line(`Attested build of ${script.title ?? script.hash}`);
  reporter.detail('script', script.hash);
  reporter.detail('plutus', script.plutusVersion);
  reporter.detail('commit', git.commit);
  reporter.detail('compiler', `${outcome.compiler.name} ${outcome.compiler.version}`);
  reporter.detail('said', attestation.d);
  reporter.detail('file', path);
  if (git.dirty) reporter.warn('built from a dirty working tree');
  reporter.result({ attestation, path });
};

/**
 * Picks the validator to attest. A blueprint usually holds several, and
 * guessing which one a release means would produce a confident claim about the
 * wrong script, so an ambiguous blueprint is an error rather than a default.
 */
function selectScript(scripts: readonly ScriptRef[], title: string | undefined): ScriptRef {
  if (title !== undefined) {
    const match =
      scripts.find((script) => script.title === title) ??
      scripts.find((script) => script.title?.startsWith(`${title}.`));
    if (match === undefined) {
      throw new AttestError('INVALID_DOCUMENT', 'Blueprint has no validator with that title', {
        title,
        available: scripts.map((script) => script.title),
      });
    }
    return match;
  }

  const only = scripts[0];
  if (only === undefined) {
    throw new AttestError('BUILD_FAILED', 'Build produced no validators');
  }
  if (scripts.length > 1) {
    throw new AttestError(
      'INVALID_DOCUMENT',
      'Blueprint holds several validators; pass --validator',
      {
        available: scripts.map((script) => script.title),
      },
    );
  }
  return only;
}
