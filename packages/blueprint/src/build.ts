import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  AttestError,
  type Compiler,
  type CompilerRef,
  type DigestAlgorithm,
  type ScriptRef,
  type SourceRef,
} from '@attest/core';

import {
  blueprintDigest,
  blueprintScripts,
  compilerRef,
  parseBlueprint,
  type Blueprint,
} from './blueprint.js';
import { exec, type RunOptions } from './exec.js';
import { cloneAtCommit } from './git.js';

export const DEFAULT_BLUEPRINT = 'plutus.json';

/** Build commands for toolchains whose defaults are stable enough to assume. */
const DEFAULT_COMMANDS: Partial<Record<Compiler, readonly string[]>> = {
  aiken: ['aiken', 'build'],
};

export interface BuildRequest {
  readonly cwd: string;
  readonly blueprintPath?: string;
  /** Overrides the toolchain default. Executed without a shell. */
  readonly command?: readonly string[];
  /** Container image to build inside. Pin by digest for a reproducible result. */
  readonly image?: string;
  readonly compiler?: Compiler;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly algorithm?: DigestAlgorithm;
  /** Skips the compile step and reads a blueprint already on disk. */
  readonly skipCompile?: boolean;
}

export interface BuildOutcome {
  readonly blueprint: Blueprint;
  /** Blueprint file exactly as written, the bytes the digest covers. */
  readonly raw: string;
  readonly digest: string;
  readonly scripts: readonly ScriptRef[];
  readonly compiler: CompilerRef;
  readonly environment: Readonly<Record<string, string>>;
}

export async function runBuild(request: BuildRequest): Promise<BuildOutcome> {
  const cwd = resolve(request.cwd);
  const blueprintPath = join(cwd, request.blueprintPath ?? DEFAULT_BLUEPRINT);
  const environment: Record<string, string> = {};

  if (request.skipCompile !== true) {
    const command = resolveCommand(request);
    if (request.image !== undefined) {
      const image = await resolveImage(request.image, request.timeoutMs);
      environment.image = image;
      await exec('docker', containerArgs(image, cwd, command), runOptions(request));
    } else {
      const [program, ...args] = command;
      if (program === undefined) {
        throw new AttestError('BUILD_FAILED', 'Build command is empty');
      }
      await exec(program, args, { cwd, ...runOptions(request) });
    }
    environment.command = command.join(' ');
  }

  const raw = await readBlueprintFile(blueprintPath);
  const blueprint = parseBlueprint(raw);

  return {
    blueprint,
    raw,
    digest: blueprintDigest(raw, request.algorithm),
    scripts: blueprintScripts(blueprint),
    compiler: compilerRef(blueprint),
    environment,
  };
}

export interface ReproduceRequest {
  readonly source: SourceRef;
  readonly expected: ScriptRef;
  readonly blueprintPath?: string;
  readonly command?: readonly string[];
  readonly compiler?: Compiler;
  /**
   * Container image to build inside. Reproducing a build compiles code from an
   * arbitrary repository, so a container is the default and building on the
   * host must be requested explicitly.
   */
  readonly image?: string;
  readonly allowHostBuild?: boolean;
  readonly timeoutMs?: number;
}

export interface ReproduceOutcome {
  readonly reproduced: boolean;
  readonly expected: ScriptRef;
  readonly produced: readonly ScriptRef[];
  readonly compiler: CompilerRef;
  readonly blueprintDigest: string;
}

/**
 * Rebuilds a script from its recorded source and reports whether the hash
 * matches. This is the claim a build attestation makes, checked independently.
 */
export async function reproduce(request: ReproduceRequest): Promise<ReproduceOutcome> {
  if (request.image === undefined && request.allowHostBuild !== true) {
    throw new AttestError(
      'BUILD_FAILED',
      'Reproducing a build runs untrusted code; supply an image or set allowHostBuild',
    );
  }

  const workdir = await mkdtemp(join(tmpdir(), 'attest-'));
  try {
    await cloneAtCommit(request.source, workdir, request.timeoutMs);
    const outcome = await runBuild({
      cwd: workdir,
      ...(request.blueprintPath !== undefined ? { blueprintPath: request.blueprintPath } : {}),
      ...(request.command !== undefined ? { command: request.command } : {}),
      ...(request.compiler !== undefined ? { compiler: request.compiler } : {}),
      ...(request.image !== undefined ? { image: request.image } : {}),
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    });

    return {
      reproduced: outcome.scripts.some((script) => script.hash === request.expected.hash),
      expected: request.expected,
      produced: outcome.scripts,
      compiler: outcome.compiler,
      blueprintDigest: outcome.digest,
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

function resolveCommand(request: BuildRequest): readonly string[] {
  if (request.command !== undefined && request.command.length > 0) return request.command;
  const compiler = request.compiler;
  const fallback = compiler !== undefined ? DEFAULT_COMMANDS[compiler] : DEFAULT_COMMANDS.aiken;
  if (fallback === undefined) {
    throw new AttestError('BUILD_FAILED', 'No default build command for this compiler', {
      compiler,
    });
  }
  return fallback;
}

function containerArgs(image: string, cwd: string, command: readonly string[]): string[] {
  return [
    'run',
    '--rm',
    '--network',
    'none',
    '--volume',
    `${cwd}:/workspace`,
    '--workdir',
    '/workspace',
    image,
    ...command,
  ];
}

/** Resolves a tag to an immutable digest so the recorded environment stays meaningful. */
async function resolveImage(image: string, timeoutMs?: number): Promise<string> {
  if (image.includes('@sha256:')) return image;
  const options: RunOptions = timeoutMs !== undefined ? { timeoutMs } : {};
  await exec('docker', ['pull', '--quiet', image], options);
  const { stdout } = await exec(
    'docker',
    ['image', 'inspect', '--format', '{{index .RepoDigests 0}}', image],
    options,
  );
  const digest = stdout.trim();
  return digest.length > 0 ? digest : image;
}

function runOptions(request: BuildRequest): RunOptions {
  return {
    ...(request.env !== undefined ? { env: request.env } : {}),
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
  };
}

async function readBlueprintFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    throw new AttestError('BUILD_FAILED', 'Build produced no blueprint at the expected path', {
      path,
    });
  }
}
