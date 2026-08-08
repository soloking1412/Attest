import { AttestError, type SourceRef } from '@attest/core';

import { exec } from './exec.js';

export interface GitContext {
  readonly url: string;
  readonly commit: string;
  readonly branch?: string;
  /** True when the working tree differs from the commit, making the build unreproducible. */
  readonly dirty: boolean;
}

const SCP_LIKE = /^(?:[\w.-]+@)?([\w.-]+):(.+?)(?:\.git)?$/;
const SSH_URL = /^ssh:\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/(.+?)(?:\.git)?$/;

/**
 * Rewrites a remote into a form anyone can clone. Attestations are read by
 * parties without access to the issuer's SSH keys, so scp-style and ssh remotes
 * are normalised to https.
 */
export function normalizeRemoteUrl(url: string): string {
  const trimmed = url.trim();

  const ssh = SSH_URL.exec(trimmed);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;

  const scp = SCP_LIKE.exec(trimmed);
  if (scp && !trimmed.includes('://')) return `https://${scp[1]}/${scp[2]}`;

  return trimmed.replace(/\.git$/, '');
}

export async function readGitContext(cwd: string, remote = 'origin'): Promise<GitContext> {
  const [url, commit, branch, status] = await Promise.all([
    capture(cwd, ['remote', 'get-url', remote]),
    capture(cwd, ['rev-parse', 'HEAD']),
    capture(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ''),
    capture(cwd, ['status', '--porcelain']).catch(() => ''),
  ]);

  if (url.length === 0) {
    throw new AttestError('BUILD_FAILED', 'Repository has no remote to record in an attestation', {
      remote,
    });
  }

  return {
    url: normalizeRemoteUrl(url),
    commit: commit.toLowerCase(),
    ...(branch.length > 0 && branch !== 'HEAD' ? { branch } : {}),
    dirty: status.length > 0,
  };
}

/** Clones a single commit into `destination` without executing repository hooks. */
export async function cloneAtCommit(
  source: SourceRef,
  destination: string,
  timeoutMs?: number,
): Promise<void> {
  const options = timeoutMs !== undefined ? { timeoutMs } : {};
  await exec('git', ['init', '--quiet', destination], options);
  await exec('git', ['remote', 'add', 'origin', source.url], { cwd: destination, ...options });
  await exec('git', ['fetch', '--quiet', '--depth', '1', 'origin', source.commit], {
    cwd: destination,
    ...options,
  });
  await exec('git', ['checkout', '--quiet', 'FETCH_HEAD'], { cwd: destination, ...options });
}

export function toSourceRef(context: GitContext, path?: string): SourceRef {
  return {
    url: context.url,
    commit: context.commit,
    ...(path !== undefined ? { path } : {}),
  };
}

async function capture(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, timeoutMs: 30_000 });
  return stdout.trim();
}
