# ADR-0005: Python is used off-chain only; REST is the boundary

**Status:** Accepted — refined by [ADR-0010](0010-own-token-layer.md) (Python keeps owning all business logic; the Go sample was forked, not replaced by Python)
**Date:** 2026-08-18
**Applies to:** all phases

## Context

The team is most comfortable in Python, but Hyperledger Fabric supports chaincode in **Go, Node.js, and Java only** — Python has no supported chaincode shim [R4]. Likewise, the Fabric Gateway client APIs are available only for Go, Node, and Java; there is no official Python gateway SDK [R14].

## Decision

- On-chain code (chaincode) is **Go** — in Phase 3 this is the prebuilt token-sdk chaincode, requiring ~zero custom Go (ADR-0001).
- The layer-2 token services (issuer/auditor/owner) are the sample's Go binaries, run as-is [R13].
- All banking/back-office/UI logic is **Python (FastAPI)** and **React**, calling the token services over their documented REST APIs.
- REST is the language boundary: Python never talks gRPC directly to Fabric.

## Consequences

**Positive:** team works in its strongest language for everything we build ourselves; no custom chaincode needed for the demo.
**Negative/risks:** the Python layer is dependent on the token-sdk REST surface; any functionality not exposed by that REST API requires either a small Go extension or a custom chaincode (Phase 4 decisions).

## References

- Supported chaincode languages: https://hyperledger-fabric.readthedocs.io/en/latest/chaincode4ade.html [R4]
- Fabric Gateway client languages: https://github.com/hyperledger/fabric-gateway [R14]
- token-sdk REST API: https://github.com/hyperledger/fabric-samples/tree/main/token-sdk [R13]
