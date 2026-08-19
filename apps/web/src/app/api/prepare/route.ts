import { AttestError, createBuildAttestation, serialize, type PlutusVersion } from '@attest/core';
import { blueprintDigest, blueprintScripts, compilerRef, parseBlueprint } from '@attest/blueprint';
import { buildMetadata, verificationRecordFor } from '@attest/cardano';

import { readServerConfig } from '@/lib/config';
import { anchor, identifierFor } from '@/lib/issuer';

export const runtime = 'nodejs';

interface PrepareRequest {
  address?: string;
  blueprint?: string;
  repository?: string;
  commit?: string;
  validator?: string;
  path?: string;
}

/**
 * Turns a blueprint into a signed, anchored attestation and returns the
 * transaction metadata for the browser to submit.
 *
 * The script hash is recomputed here from the bytecode rather than taken from
 * the blueprint's own `hash` field, so a blueprint that misstates its own hash
 * is rejected instead of attested.
 */
export async function POST(request: Request): Promise<Response> {
  let body: PrepareRequest;
  try {
    body = (await request.json()) as PrepareRequest;
  } catch {
    return fail('Request body must be JSON', 400);
  }

  const { address, blueprint, repository, commit } = body;
  if (!address || !blueprint || !repository || !commit) {
    return fail('address, blueprint, repository and commit are all required', 400);
  }

  try {
    const config = readServerConfig();
    const parsed = parseBlueprint(blueprint);
    const scripts = blueprintScripts(parsed);

    const script = body.validator
      ? scripts.find((entry) => entry.title?.startsWith(body.validator as string))
      : scripts[0];
    if (script === undefined) {
      return fail(
        `No validator matched. Available: ${scripts.map((s) => s.title).join(', ')}`,
        400,
      );
    }
    if (scripts.length > 1 && !body.validator) {
      return fail(
        `Blueprint holds ${scripts.length} validators; choose one: ${scripts
          .map((s) => s.title)
          .join(', ')}`,
        400,
      );
    }

    const issuer = await identifierFor(address);
    const attestation = createBuildAttestation(
      {
        script: {
          hash: script.hash,
          plutusVersion: script.plutusVersion as PlutusVersion,
          ...(script.title !== undefined ? { title: script.title } : {}),
        },
        source: {
          url: repository.trim(),
          commit: commit.trim().toLowerCase(),
          ...(body.path ? { path: body.path.trim() } : {}),
        },
        compiler: compilerRef(parsed),
        blueprint: blueprintDigest(blueprint),
      },
      { issuer: issuer.aid },
    );

    const receipt = await anchor(issuer.name, attestation.d);
    const metadata = buildMetadata({
      attestation,
      sequence: receipt.sequence,
      verification: verificationRecordFor(attestation),
    });

    return Response.json({
      network: config.network,
      issuer: issuer.aid,
      sequence: receipt.sequence,
      said: attestation.d,
      script,
      document: serialize(attestation),
      metadata,
    });
  } catch (error) {
    if (error instanceof AttestError) {
      return fail(error.message, 400, error.code, error.details);
    }
    return fail(error instanceof Error ? error.message : 'Unexpected failure', 500);
  }
}

function fail(
  message: string,
  status: number,
  code?: string,
  details?: Record<string, unknown>,
): Response {
  return Response.json({ error: message, code, details }, { status });
}
