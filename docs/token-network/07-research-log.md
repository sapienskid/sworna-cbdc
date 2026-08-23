# Token network — research log

Lessons and sources gathered while building (2026-08).

## Fabric v3 realities

- **Chaincode is Go / Node / Java only** — there is no Python chaincode runtime,
  and Fabric v3 removed the legacy (v1) lifecycle. Source: Fabric docs
  (chaincode languages; upgrade_to_newest_version).
- **No official Python Fabric client.** `fabric-sdk-py` is abandoned (Fabric
  1.4.x). The Fabric Gateway client APIs are Go/Node/Java. The peer CLI is the
  only reliable Python-accessible path today (`backend`'s ledger monitor shells
  out to `peer` + `configtxlator`).
- **Blockchain Explorer is incompatible with Fabric v3** — it calls the removed
  `lscc.syscc` system chaincode; sync stores 0 blocks. We replaced it with a
  custom ledger monitor in the CB console.

## Token SDK build fragility (found in Phase 2)

- The fabric-samples `token-sdk` sample does not build unmodified on current
  toolchains: its go.mod recorded `quic-go v0.49.1` + `gnark-crypto v0.18.1`,
  incompatible with the SDK's `webtransport-go v0.5.3` / `libp2p v0.31` /
  `mathlib` pins. Fixes: pin `quic-go v0.38.1`, `gnark-crypto v0.9.1`, `qpack
  v0.4.0`, `go.work` → 1.24, Dockerfiles → `golang:1.24`.
- The sample had a latent bug: owner1's P2P resolver pointed owner2 at port
  9201 while owner2 listens on 9301 (fixed).

## ZK privacy

- ZKAT-DLOG (Pedersen commitments + Bulletproofs range proofs + idemix) is the
  SDK's scheme. There is **no** Python implementation; reimplementing it is a
  multi-month crypto project. Decision: keep it as a pinned library, own the
  system around it.

## Design decisions recorded

| # | Decision | Why |
|---|---|---|
| ADR-0010 | Keep token-sdk as the crypto engine; fork+own the sample services; Python owns all business logic | ZK is audited and not reimplementable by a small team |
| — | Per-org peers in the engine config (issuer/auditor→CB, one owner per bank) | genuine multi-org settlement, each bank submits via its own org identity |
| — | Custom ledger monitor replaces explorer | upstream explorer is v3-incompatible |
| — | Each bank **self-provisions its Fabric org** on its own VM and the CB adds it to the channel via `scripts/onboard-bank.sh` (channel config update) | the bank's private keys never leave its VM; the CB admits orgs explicitly (later replaced the earlier `addOrg3` flow, which ran the bank's peer on the CB host) |