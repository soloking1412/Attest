# Attest

Cardano lets anyone read a script hash off the chain. It does not let anyone find out
what that hash came from. There is no way to establish that a deployed validator was
compiled from a particular commit, and no way to establish that anyone has audited it.
In practice this is settled by a link in a Discord message.

Attest closes that gap. It publishes signed, on-chain records that bind a script hash to
a reproducible build and to the audits performed against it, and it makes those records
verifiable by anyone with a chain provider and no trust in Attest itself.

## How it works

Two Cardano standards each solve half the problem, and neither is useful alone.

**CIP-171** (metadata label 1984) records the source a script was compiled from: the
repository, the commit, the compiler and its exact version. Anyone can clone that commit,
rebuild, and compare hashes. What it cannot say is who made the claim, so nothing stops a
third party from publishing a record that points at someone else's repository.

**CIP-170** (metadata label 170) records a KERI-signed attestation: an identifier, a
digest, and the position in that identifier's key event log where the digest was
committed. The signature is non-repudiable and the key history is tamper-evident. What it
does not define is what is being attested.

Attest sits on both. An attestation document names a script hash and the build or audit
behind it. Its digest is a self-addressing identifier, committed to the issuer's key event
log by an interaction event, and published in a CIP-170 record citing that event. Build
attestations also emit the equivalent CIP-171 record, so tools that know nothing about
Attest still see the build.

The chain of evidence a verifier follows:

```
script hash
  └── attestation document      hashes to its own identifier
       └── CIP-170 record       cites identifier + key event sequence
            └── key event log   issuer committed to that digest at that sequence
                 └── issuer     an identifier whose key history is public and append-only
```

Every link is checkable offline given the document and the log. Nothing depends on a
service operated by this project.

## Install

```bash
pnpm add -g attest-cli
```

Publishing needs a KERIA agent holding the issuer's keys, a chain provider, and a funded
wallet. Verifying needs only a provider.

## Quick start

```bash
attest init --network preview
```

Create the identifier attestations are issued under. This writes an inception event to
the agent and authorises it to serve the log:

```bash
export KERIA_PASSCODE=...
attest id create release
attest id oobi release
```

The OOBI is how others reach your key event log. Publish it wherever you publish your
repository.

Build a validator and attest it:

```bash
attest build --validator vault.spend
```

This compiles the project, reads the CIP-57 blueprint, recomputes the script hash from
the bytecode rather than trusting the blueprint's own `hash` field, records the commit,
and writes a document to `attestations/<said>.json`.

Commit it to the log and publish it:

```bash
export BLOCKFROST_PROJECT_ID=preview...
export CARDANO_WALLET_SEED="..."
attest publish attestations/EM8NLOIIpWz6bfr9ULC-NQKf0drCJWjZF62KEe3CBrE8.json
```

Verify, from anywhere:

```bash
attest verify 8f3c...   # a transaction hash
```

```
Verdict: verified
  tx            8f3c...
  issuer        EKtQ1lymrnrh3qv5S18PBzQ7ukHGFJ7EXkH7B22XEMIL
  said          EM8NLOIIpWz6bfr9ULC-NQKf0drCJWjZF62KEe3CBrE8
  type          build
  scripts       d7a75e29fc699c832922e4594b5ac04ed4701b06f680ed9d39a8e5b6

  [ok  ] document: Document hashes to the identifier the record cites
  [ok  ] anchor: Committed by EKtQ1lym... at sequence 1
  [ok  ] script: Every script is present on chain
  [--  ] revocation: No revocation index supplied
```

Rebuild from source and compare the hash yourself:

```bash
attest verify --file attestations/EM8N....json --reproduce --image ghcr.io/aiken-lang/aiken:v1.1.9
```

## Attesting an audit

An audit attestation covers one or more script hashes and records the digest of the
report, so the report can be published anywhere and still be tied to the claim.

```bash
attest audit \
  --report reports/vault-v1.pdf \
  --title "Vault v1 review" \
  --script d7a75e29fc699c832922e4594b5ac04ed4701b06f680ed9d39a8e5b6:v2 \
  --outcome findings-resolved \
  --critical 0 --high 2 --medium 3 --low 5 --informational 9
```

Audits are attested by the auditor's identifier, not the project's. A project cannot
issue an audit attestation about itself without it being visible that it did.

## What verification establishes

Being precise about this matters more than the feature list.

A `verified` verdict means the document is intact, the identifier that published it
committed to it in its own key event log, and no revocation has withdrawn it. It means
the named issuer stands behind the claim, and cannot later deny having made it.

It does not mean the build reproduces. That requires actually rebuilding, which
`attest verify --reproduce` does and the indexer deliberately does not — compiling code
from an arbitrary repository is not something a public service should do unprompted.

It does not mean the issuer is trustworthy. An identifier is just an identifier. Whether
it belongs to an auditor you have reason to believe is a question about credentials, which
CIP-170 addresses with `AUTH_BEGIN` credential chains and which Attest carries but does not
adjudicate.

It does not verify the key event log's own signatures. Attest checks that a log is an
unbroken chain from inception and that it commits to the digest at the cited sequence.
Whether the log is authentic — signature thresholds, witness receipts — is settled by the
KERI agent or watcher network that served it, which is where that belongs. Point the
resolver at infrastructure you trust.

## Running a verifier

The indexer follows metadata label 170, verifies each publication, and serves the results.

```bash
export BLOCKFROST_PROJECT_ID=preview...
export KERIA_URL=http://localhost:3901
export KERIA_PASSCODE=...
attest-verifier
```

```
GET /v1/scripts/:hash          build and audit status for a script
GET /v1/attestations/:said     one attestation and its checks
GET /v1/issuers/:aid           everything an identifier has published
GET /v1/stats                  index totals
```

The script endpoint answers the question a wallet or explorer actually has:

```json
{
  "scriptHash": "d7a75e29fc699c832922e4594b5ac04ed4701b06f680ed9d39a8e5b6",
  "build": "verified",
  "audit": "verified",
  "issuers": ["EKtQ1lymrnrh3qv5S18PBzQ7ukHGFJ7EXkH7B22XEMIL"]
}
```

A withdrawn claim reports as `revoked` rather than disappearing, so a retracted audit never
reads as an audit that never happened. A revocation only counts when it comes from the
identifier that issued the attestation it names.

## Continuous attestation

```yaml
- uses: your-org/attest/action@v1
  with:
    validator: vault.spend
    image: ghcr.io/aiken-lang/aiken:v1.1.9
    network: mainnet
    keria-url: ${{ secrets.KERIA_URL }}
    keria-passcode: ${{ secrets.KERIA_PASSCODE }}
    blockfrost-project-id: ${{ secrets.BLOCKFROST_PROJECT_ID }}
    wallet-seed: ${{ secrets.CARDANO_WALLET_SEED }}
```

## Packages

| Package             | Purpose                                                                             |
| ------------------- | ----------------------------------------------------------------------------------- |
| `@attest/core`      | Attestation documents, CESR encoding, self-addressing identifiers, CIP-170 codec    |
| `@attest/blueprint` | CIP-57 blueprints, script hashing, PlutusData, CIP-171 records, reproducible builds |
| `@attest/cardano`   | Chain providers, metadata assembly, transaction submission                          |
| `@attest/keri`      | Key event log parsing, anchor verification, KERIA client                            |
| `@attest/verifier`  | Verification pipeline, chain indexer, lookup API                                    |
| `attest-cli`        | The `attest` command                                                                |

`@attest/core`, `@attest/blueprint` and `@attest/keri`'s log verification have no runtime
dependencies beyond `@noble/hashes`. The KERI agent client and the transaction builder are
optional peers, loaded only when something needs to issue or publish, so a verifier never
pulls in signing capability it should not have.

## Development

```bash
pnpm install
pnpm test
pnpm run typecheck
```

The script hashing tests run against a published mainnet blueprint, so a regression in the
CBOR wrapping rules fails against a hash that really exists on chain rather than one this
repository made up.

## Format

The document format, the metadata layout and the verification rules are specified in
[docs/format.md](docs/format.md).

## License

Apache-2.0
