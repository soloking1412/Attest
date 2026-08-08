# Attestation format

## Serialization

Documents are JSON with no whitespace, serialized in field order rather than sorted order.
This follows KERI, whose self-addressing identifiers are computed over field-ordered JSON,
and it survives `JSON.parse`, so a document read back from disk or from a transaction
canonicalizes to the bytes its identifier commits to.

Two restrictions make that guarantee hold:

- Object keys that look like integers are rejected, because JavaScript hoists them ahead of
  string keys and would silently reorder the document.
- Numbers must be safe integers. Attestations have no use for floats, and excluding them
  removes any dependence on how a runtime formats them.

## Version string

```
ATST10JSON000236_
├──┘└┘└──┘└────┘└ terminator
│   │   │      └── serialized size, six hex digits
│   │   └───────── serialization kind
│   └───────────── protocol version
└───────────────── protocol
```

The size is the byte length of the serialized document. A verifier that reads a different
length has been given a document that was altered after issue.

## Self-addressing identifier

The `d` field holds the digest of the document itself, encoded as a CESR primitive. It is
computed by replacing `d` with a placeholder of equal length, serializing, digesting, and
substituting the result back. Because the placeholder is the same length as the value that
replaces it, the size recorded in `v` stays accurate.

The digest algorithm is carried by the CESR code, so a document is self-describing:
`E` is Blake3-256, `F` is Blake2b-256, `I` is SHA2-256.

## Envelope

| Field | Meaning                                                                |
| ----- | ---------------------------------------------------------------------- |
| `v`   | Version string                                                         |
| `d`   | Self-addressing identifier                                             |
| `t`   | `build`, `audit`, `release` or `revocation`                            |
| `i`   | Issuer's autonomic identifier                                          |
| `ri`  | Credential registry the issuer's authority derives from, optional      |
| `dt`  | Issue time, ISO-8601 with microsecond precision and an explicit offset |
| `a`   | Body, per type                                                         |

## Bodies

### build

```json
{
  "script": { "hash": "d7a7…", "plutusVersion": "v2", "title": "vault.spend" },
  "source": {
    "url": "https://github.com/example/vault",
    "commit": "5e51…",
    "path": "validators/vault.ak"
  },
  "compiler": { "name": "aiken", "version": "v1.1.9+e2fb28b" },
  "blueprint": "EPLtP7TunoGEyoHGQE3i2yaViGg3bL8S7iv51I87UQKt",
  "parameters": ["182a"],
  "environment": { "image": "ghcr.io/aiken-lang/aiken@sha256:…", "command": "aiken build" }
}
```

`blueprint` is the digest of the CIP-57 blueprint file exactly as written, so the artifact
the hash was read from can be fetched and compared. `parameters` are CBOR-encoded
PlutusData applied to the validator, in application order; without them a parameterized
validator's on-chain hash will not match the blueprint's.

### audit

```json
{
  "scripts": [{ "hash": "d7a7…", "plutusVersion": "v2" }],
  "source": { "url": "https://github.com/example/vault", "commit": "5e51…" },
  "report": { "title": "Vault v1 review", "digest": "ELC5…", "uri": "ipfs://bafy…" },
  "outcome": "findings-resolved",
  "findings": { "critical": 0, "high": 2, "medium": 3, "low": 5, "informational": 9 }
}
```

The report itself stays off chain. Only its digest is attested, so the report can move
between hosts without invalidating the claim.

### release

Groups scripts into a deployment and names the build and audit attestations it stands on,
by their identifiers.

### revocation

Withdraws an earlier attestation by identifier, with a reason of `compromised`,
`superseded`, `erroneous` or `withdrawn`. A revocation is honoured only when its issuer
matches the issuer of the attestation it names.

## Transaction metadata

| Label | Contents                                                               |
| ----- | ---------------------------------------------------------------------- |
| 170   | CIP-170 `ATTEST` record                                                |
| 1701  | Attestation document, chunked. Provisional pending CIP-10 registration |
| 1984  | CIP-171 verification record, for build attestations                    |

The CIP-170 record:

```json
{
  "170": {
    "t": "ATTEST",
    "i": "EKtQ1lymrnrh3qv5S18PBzQ7ukHGFJ7EXkH7B22XEMIL",
    "d": "EM8NLOIIpWz6bfr9ULC-NQKf0drCJWjZF62KEe3CBrE8",
    "s": "1",
    "v": { "v": "1.0" },
    "m": { "t": "build", "h": ["d7a75e29fc699c832922e4594b5ac04ed4701b06f680ed9d39a8e5b6"] }
  }
}
```

`s` is the sequence number of the key event committing to `d`, lowercase hex without
padding. `m` is an indexing hint that lets a scanner filter without resolving every
document; a verifier re-derives it from the document and treats a mismatch as an error
rather than as a claim.

Publishing the document under label 1701 makes a transaction self-contained: verification
needs the chain and the issuer's key event log, and nothing else. It can be omitted, in
which case the document must be resolved by identifier from elsewhere.

### Size limits

The ledger rejects metadata strings over 64 bytes. Text is chunked on UTF-8 boundaries so a
multi-byte character is never split. Byte values use the `0x`-prefixed convention, where 64
bytes is a 130-character string — measuring those as text is a mistake that makes valid
metadata look oversized.

## Script hashes

A script hash is `blake2b-224(languageTag ‖ script)`, where the language tag is `0x01`,
`0x02` or `0x03` for Plutus V1, V2 and V3, and `script` is the flat-encoded program inside
exactly one CBOR byte string, as it appears in a transaction witness set.

Toolchains disagree about how many CBOR wrappers `compiledCode` already carries. Attest
detects whether the buffer is exactly one byte string spanning its own length and wraps only
if it is not. When a blueprint declares a `hash`, the recomputed value must agree; a
blueprint whose stated hash does not follow from its own bytecode is rejected rather than
trusted, because that is the one place the two can be cross-checked.

## Verification

1. Read the CIP-170 record from label 170.
2. If a document is present, confirm it hashes to its own identifier, that the identifier
   matches the record's `d`, that the issuer matches, and that the index hints agree.
3. If a CIP-171 record is present alongside a build attestation, confirm the source and
   compiler agree.
4. Resolve the issuer's key event log and confirm it is an unbroken chain from inception.
5. Confirm the event at sequence `s` commits to `d`. A digest found at any other sequence
   does not count: the record names one specific event, and accepting another would let a
   later transaction point at an earlier commitment.
6. Optionally confirm the scripts exist on chain, and that no revocation from the same
   issuer names the attestation.

Steps 1 through 3 are pure functions of the transaction. Step 4 depends on the KERI
infrastructure serving the log, which is what establishes the log's authenticity; Attest
checks its structure and its commitments, not its signatures.
