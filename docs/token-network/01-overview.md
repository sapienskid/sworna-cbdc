# Token network — overview

This series documents the Sworna token network as built in Phase 3: how money is
created, held, moved and destroyed on a **Hyperledger Fabric** settlement network
(central-bank org + any number of self-provisioned commercial banks) with
**zero-knowledge privacy** and a central-bank **auditor**.

The network has two layers:

```
  Layer 2  token network   issuer · auditor · owner{k}   (the Go engine, one owner per bank)
              │                    │        REST
  Layer 1  settlement      peer0.centralbank · peer0.bank{k}
              │                    │        channel `settlement`
  ledger     Fabric v3.1.5 · tokenchaincode (ZKAT-DLOG) · Raft orderer
```

## The players

| Role | Runs | Identity | What it does |
|---|---|---|---|
| **Issuer** | central bank | x.509 (token CA) | mints and burns SWR |
| **Auditor** | central bank | x.509 (token CA) | signs/oversees **every** transaction |
| **Owner `k`** | bank `k` | idemix wallets (customers) | holds and transfers SWR |
| **Chaincode** | every org's peer | ZKAT-DLOG params | validates proofs, owns the UTXO ledger |

Banks are added at **runtime** — each self-provisions its Fabric org on its own
VM (`scripts/deploy-bank.sh`) and the CB admits it to the channel
(`scripts/onboard-bank.sh`); see [SETUP.md](../SETUP.md) §4.

## Money model

- SWR is a **UTXO token**: money is a set of unspent transaction outputs, each
  with an owner and a hidden amount.
- Amounts and parties are **Pedersen commitments** on the ledger (ZK); only the
  auditor and the transacting parties can open them.
- Two decimal places (off-chain; the ledger stores integer minor units).

## The transaction flow (in one breath)

```
issuer ──issue──► owner1/alice ──transfer──► owner1/bob ──transfer──► owner2/carlos ──redeem──► issuer
          CB mints                intra-bank              cross-bank              CB burns
```

Every step requires the auditor's signature. The ledger only ever records
commitments and zero-knowledge proofs — decoded blocks contain **no** plaintext
amounts or party names (verified in M2).

## Series index

| Doc | Contents |
|---|---|
| [02-transaction-flow](02-transaction-flow.md) | Issue / transfer / redeem step-by-step, with the auditor |
| [03-utxo-zk-model](03-utxo-zk-model.md) | UTXO accounting, change, double-spend, Pedersen commitments, auditor oversight |
| [04-chaincode-params](04-chaincode-params.md) | tokengen public parameters, SWR, identities |
| [05-engine-deep-dive](05-engine-deep-dive.md) | The Go engine (forked from token-sdk), its REST surface, how we own it |
| [06-api-contracts](06-api-contracts.md) | FastAPI ↔ engine contracts |
| [07-research-log](07-research-log.md) | Sources and lessons learned while building |
| [08-provisioning](08-provisioning.md) | Token-CA provisioning, wallet pools, bank lifecycle |
| [09-distributed-deployment](09-distributed-deployment.md) | N-host deployment, join bundles, DNS |

## Repo layout

```
network/           our Fabric network (configtx, CAs, compose, scripts)
token-services/    the Go engine (issuer/auditor/owner + tokenchaincode)
backend/           Python FastAPI banking core
web/               React wallet + CB/bank consoles
docs/token-network this series
```