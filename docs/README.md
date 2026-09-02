# Sworna documentation

Start here for anything you want to understand or operate.

## Getting started

| Doc | What it covers |
|---|---|
| [../README.md](../README.md) | Project overview, quick start, deploy order |
| [SETUP.md](SETUP.md) | Authoritative runbook: per-VM deploy, onboarding, verification, troubleshooting |
| [DEMO_AND_UI_GUIDE.md](DEMO_AND_UI_GUIDE.md) | Portal URLs, credentials, UI field reference, demo script |
| [OVERVIEW.md](OVERVIEW.md) | Plain-language introduction: what a CBDC is, the two-tier model |

## How it works (deep dives)

| Doc | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, topology, transaction flows, ADR cross-links |
| [BLIND-SIGNATURES-AND-PRIVACY.md](BLIND-SIGNATURES-AND-PRIVACY.md) | Blind signatures (Idemix/CL), Pedersen commitments, range proofs, the auditor gate — step by step, with code pointers |
| [AML-COMPLIANCE.md](AML-COMPLIANCE.md) | The AML rule engine: KYC tiers, limits, velocity, structuring, watchlist, alerts |
| [BACKEND-INTERNALS.md](BACKEND-INTERNALS.md) | FastAPI layer module-by-module: roles, wallet pool, transfer flow, testing |
| [SECURITY-MODEL.md](SECURITY-MODEL.md) | Trust anchors, cryptography table, authz, honest limitations, hardening checklist |
| [FRONTEND.md](FRONTEND.md) | The three-portal React app: stack, routes, conventions |
| [token-network/](token-network/) | 9-part series on the token engine: ZK model, chaincode params, engine internals, provisioning, distributed deployment |

## Operations

| Doc | What it covers |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Roles-by-script, trust model, join bundles, dev→lab progression |
| [API.md](API.md) | REST endpoint catalog (backend + engine contracts) |
| [FULL-BANKING-SYSTEM.md](FULL-BANKING-SYSTEM.md) | Subsystem checklist (what exists vs planned) |
| [PHASES.md](PHASES.md) | Roadmap: phases, WBS, risk register |
| [BENCHMARKS.md](BENCHMARKS.md) | Performance methodology (stub until Phase 5) |

## Decisions

[ADRs/](ADRs/) — architecture decision records 0001–0011. Notable chain:
0001 (reuse Token SDK) → 0010 (fork it into `token-services/`); 0004 (CB is
issuer **and** auditor); 0006 (UTXO + ZK privacy); 0011 (AML off-chain rule
engine). ADR-0007 (CouchDB) is proposed but not yet implemented — peers run
LevelDB.

## Research

[REFERENCES.md](REFERENCES.md) — the canonical bibliography cited as `[R#]`
across all docs.
