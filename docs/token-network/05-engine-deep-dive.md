# Token network — the Go engine (we own it)

The engine under `token-services/` is a **fork of the Hyperledger fabric-samples
token-sdk sample**, now owned by this repository. It is a set of Go services
that wrap the **Fabric Token SDK** (the audited ZK-UTXO library) and expose a
REST API.

## Why Go?

- Fabric chaincode and the SDK are Go-only; the token SDK cannot run as Python.
- We keep Go confined to this engine; **all business logic is Python** (backend/).

## Services

| Service | Port | Role |
|---|---|---|
| `issuer` | 9100 | mint / burn (central bank) |
| `auditor` | 9000 | approve + open every transaction (central bank) |
| `owner` | 9200+100(k−1) | one per bank `k` (owner{k} = bank{k}) |
| `swagger-ui` | 8080 | API docs |

Each node is a Fabric Smart Client node: it talks to the other nodes over
libp2p (e.g. to fetch a recipient's anonymous key), assembles transactions with
ZK proofs, gets the auditor's signature, and submits to the settlement channel.

## What we changed vs. the sample (all baked in)

1. **Dependency pins** — `quic-go v0.38.1`, `gnark-crypto v0.9.1`, `qpack
   v0.4.0` (the sample's recorded versions were mutually incompatible and would
   not build on current Go).
2. **`go.work` → go 1.24.0** and **Dockerfiles → `golang:1.24`** (was
   `golang:latest`, which broke the build).
3. **Wired to the settlement network** — channel `settlement`; issuer/auditor on
   the central-bank peer (`CentralBankMSP`), and one owner per bank (`Bank{k}MSP`,
   conf rendered from `core.yaml.tpl` on the bank's VM).
4. **Fixed a latent P2P resolver bug** — each owner's resolver now points at the
   other owners' real listen ports.
5. **Confidentiality note** — the `data/` and `keys/` folders are generated and
   gitignored; the engine is reproducible via `scripts/`.

## REST surface (consumed by the backend)

```
POST /issuer/issue
POST /owner/accounts/{id}/transfer
POST /owner/accounts/{id}/redeem
GET  /owner/accounts
GET  /owner/accounts/{id}
GET  /owner/accounts/{id}/transactions
GET  /auditor/accounts/{id}
GET  /auditor/accounts/{id}/transactions
```

See [06-api-contracts](06-api-contracts.md) for the exact contracts.