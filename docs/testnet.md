# Running on a public testnet

What it takes to publish a verifiable attestation on Preview, end to end.

## 1. Start a KERIA agent

The agent holds the issuer's key material and validates key event logs as it ingests
them. Attest never sees a private key.

```bash
docker compose up -d keria
```

Confirm it is up. The boot interface answers unauthenticated; the admin interface
answers 401 until a client connects, which is correct.

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3903/health
```

## 2. Create the issuing identifier

```bash
export KERIA_PASSCODE=$(node -e "import('signify-ts').then(async m => { await m.ready(); console.log(m.randomPasscode()) })")
attest id create release
attest id oobi release
```

Keep the passcode. It controls the agent, and losing it means losing the ability to
extend the key event log — every attestation already published stays verifiable, but
no new ones can be anchored under that identifier.

Publish the OOBI wherever you publish the repository. It is how anyone else reaches
your log to verify what you signed.

## 3. Fund a Preview wallet

Get a Blockfrost Preview project id from [blockfrost.io](https://blockfrost.io), and
test ADA from the [Cardano faucet](https://docs.cardano.org/cardano-testnets/tools/faucet).

```bash
export BLOCKFROST_PROJECT_ID=preview...
export CARDANO_WALLET_SEED="your twenty four word preview seed phrase"
```

A publication costs roughly 0.21 ADA, so a single faucet grant covers several
thousand attestations.

## 4. Build and publish

```bash
attest init --network preview
attest build --validator <title>
attest publish attestations/<said>.json
```

`publish` does two things in order: it commits the attestation's identifier to the key
event log with an interaction event, then submits a transaction carrying the CIP-170
record, the document and the CIP-171 record. The sequence number in the on-chain
record is the position of that key event.

Use `--dry-run` first. It performs the anchoring and prints the metadata without
submitting, which is the cheapest way to confirm the payload is what you expect.

## 5. Verify from the chain

```bash
attest verify <tx-hash>
```

This is the check anyone can run. It resolves the issuer's log, confirms the log
commits to the document at the cited sequence, and confirms the document hashes to
its own identifier. Nothing in the path is operated by this project.

## Running the integration tests

The offline suite never needs an agent. The anchoring tests run only when one is
configured:

```bash
KERIA_URL=http://localhost:3901 KERIA_BOOT_URL=http://localhost:3903 pnpm test
```
