# Test fixtures

## plutus.json

One validator from the CIP-57 blueprint of
[sidan-lab/aiken-content-ownership](https://github.com/sidan-lab/aiken-content-ownership),
copied unmodified. Apache-2.0, copyright sidan-lab contributors. See [NOTICE](../../../../NOTICE).

It is here so the script hashing tests run against bytecode that was really compiled and
deployed, with a `hash` field written by Aiken rather than by this project. A change to the
CBOR wrapping rules or the language tag then fails against a hash that exists on chain.

The smallest validator in the blueprint was chosen to keep the fixture readable. Nothing in
this directory is used at runtime.
