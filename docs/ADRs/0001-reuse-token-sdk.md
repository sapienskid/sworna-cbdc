# ADR-0001: Reuse the fabric-samples `token-sdk` for the prototype

**Status:** Accepted — superseded **in letter** by [ADR-0010](0010-own-token-layer.md) (the sample was forked into `token-services/` rather than consumed in place); the decision to build on the Token SDK stands
**Date:** 2026-08-18
**Applies to:** Phase 1 (docs) → Phase 3 (prototype demo)

## Context

We need issue/transfer/redeem functionality with UTXO tokens and Zero-Knowledge Proofs, but the team has little time and little Go experience to write and audit custom chaincode. The `fabric-samples/token-sdk` sample ships a prebuilt token chaincode plus ready-to-run Go REST services (issuer, auditor, owners) implementing UTXO tokens with ZK proofs, an auditor that signs every transaction, idemix wallets, a blockchain explorer, and a documented path to point the services at any Fabric network [R13]. It requires Fabric CA 1.5.7+ and Go 1.20+ [R13].

## Decision

Use the `fabric-samples/token-sdk` sample as the base for the token layer. Reuse its chaincode and its issuer/auditor/owner REST services unchanged where possible, customizing only the token type (SWR, 2 decimals) and the topology (3 orgs). Do not write custom chaincode in Phase 3.

## Consequences

**Positive:** no custom chaincode to write/audit; ZK + UTXO + auditor + REST + explorer work out of the box; fastest path to a working demo.
**Negative/risks:** the sample is version-sensitive and under active development — exact commit hashes must be pinned (README); it assumes a single-channel test-network-style topology (see ADR-0002); deeper banking features (interest, programmability) may eventually require custom chaincode or auditor-layer logic (Phase 4).

## References

- token-sdk sample README: https://github.com/hyperledger/fabric-samples/tree/main/token-sdk [R13]
- Panurus (Fabric Token SDK) for the underlying token framework: https://github.com/LFDT-Panurus/panurus [R12]
