import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { AttestError } from '@attest/core';

const run = promisify(execFile);

export interface RunOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxBuffer?: number;
}

export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Runs a command with an argument vector and no shell. Source URLs and commit
 * hashes reach these calls from attestations written by third parties, so they
 * must never be interpolated into a shell string.
 */
export async function exec(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await run(command, [...args], {
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.env !== undefined ? { env: { ...process.env, ...options.env } } : {}),
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
      encoding: 'utf8',
    });
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    throw new AttestError('BUILD_FAILED', `Command failed: ${command} ${args.join(' ')}`, {
      code: error.code,
      stderr: (error.stderr ?? '').trim().slice(-4000),
      stdout: (error.stdout ?? '').trim().slice(-2000),
    });
  }
}

export async function which(command: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec('command', ['-v', command], { timeoutMs: 5000 });
    const path = stdout.trim();
    return path.length > 0 ? path : undefined;
  } catch {
    return undefined;
  }
}
