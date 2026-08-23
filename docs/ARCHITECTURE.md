# ARCHITECTURE — Sworna CBDC design

This document describes the architectural design of the Sworna CBDC prototype. It reflects the decisions locked in the ADRs (see [docs/ADRs](ADRs/)) and the research in [REFERENCES.md](REFERENCES.md) (cited inline as `[R#]`).

---

## 1. Design goals

1. **Two-tier retail + wholesale hybrid**: the central bank issues SWR to commercial banks; banks distribute to customers; interbank (wholesale) settlement also runs on the same network — mirroring the model validated by **Project Agila**, the Philippines BSP wholesale CBDC pilot on Hyperledger Fabric [R18][R19].
2. **Privacy by default**: on-ledger amounts and parties are hidden with Zero-Knowledge Proofs, while the central bank's **auditor** retains full visibility for oversight and AML — the pattern implemented by the token-sdk sample [R13].
3. **Speed to prototype**: reuse the battle-tested `token-sdk` sample (prebuilt chaincode + REST services) instead of writing custom chaincode (ADR-0001) [R13].
4. **Team-fit**: the team is Python-heavy; Python is used off-chain only, because Fabric chaincode and the Fabric Gateway SDKs support Go/Node/Java only (ADR-0005) [R4][R14].
5. **Evolution-ready**: start simple (single channel, Raft) and grow to BFT + multi-channel + distributed deployment in later phases (ADRs 0002, 0003).

## 2. CBDC model

- **Distribution: two-tier.** Tier 1: central bank ↔ commercial banks (issue, redemption, wholesale settlement). Tier 2: commercial banks ↔ customers (retail wallets). See ADR-0008.
- **Money representation: token-based (UTXO).** Currency exists as individual spendable tokens; a transfer consumes inputs and creates outputs (change-splitting), like Bitcoin. Balances are derived from owned unspent outputs, not stored as a per-account number. See ADR-0006 [R13].
- **Privacy: Zero-Knowledge Proofs (zkatdlog).** Each transaction carries commitments and range proofs. Anyone (e.g., the peer / token chaincode) can verify the proofs are valid; only the involved parties and the **auditor** can open them to see values and counterparties. The ledger therefore does not reveal amounts, balances, or who transacted with whom [R13].
- **Oversight: auditor role.** The auditor (operated by the central bank — ADR-0004) approves (signs) every transaction before submission, can enforce business rules (limits, holds) and can see all values. This becomes the compliance/AML rule engine in Phase 4 [R13].

## 3. Organizations, roles, and identities

| Role in system | Organization | Fabric/MSP | Node/service | Identities |
|---|---|---|---|---|
| Currency issuer | Central bank | `centralbank` / `CentralBankMSP` | issuer node (REST :9100) | issuer x509 identity |
| Supervisor / AML | Central bank | `centralbank` | auditor node (REST :9000) | auditor x509 identity |
| Commercial bank A | Bank A | `banka` / `BankAMSP` | owner node A (REST :9200) | customers alice, bob (idemix) |
| Commercial bank B | Bank B | `bankb` / `BankBMSP` | owner node B (REST :9300) | customers carol, dan (idemix) |
| Customers | on bank owner nodes | — | wallet SPA via FastAPI | idemix credentials [R13] |

- Network domain: `sworna.example.com` (e.g., `orderer0.sworna.example.com`, `peer0.centralbank.sworna.example.com`, `peer0.banka.sworna.example.com`).
- Identity model: Fabric CA per organization (more realistic than cryptogen; test-network supports this via the `-ca` flag) [R3]. Customer wallets use **idemix** credentials issued by a CA known to the token chaincode [R13].

## 4. Component inventory

### 4.1 Layer 2 — token services (from the token-sdk sample) [R13]

- **Issuer node** — mints tokens on request of the central bank; records issuance history.
- **Auditor node** — validates, signs, and stores every token transaction; sees all amounts and parties.
- **Owner nodes** (one per commercial bank) — hold customer wallets; construct and submit transfers; reconcile balances from own ledger view.
- The layer-2 nodes talk to each other over **libp2p** to negotiate token transactions (private, between the parties), then submit the final signed transaction to the Fabric settlement layer.

### 4.2 Layer 1 — Fabric settlement network

- **Ordering service**: Raft cluster (3 orderers) in the prototype; SmartBFT (4+ consenters, V3_0 capabilities) in Phase 4 [R1][R2].
- **Peers**: one per organization (`centralbank`, `banka`, `bankb`), **CouchDB** state database (ADR-0007) [R3].
- **Token chaincode**: deployed on the `settlement` channel; validates all ZK proofs and signatures and commits the transaction [R13].
- **Channels**: single `settlement` channel in the prototype (ADR-0002); expanded to `settlement` + `retail` + `registry/KYC` with Private Data Collections in Phase 4.

### 4.3 Off-chain application layer

- **FastAPI banking backend (Python)** — customer/bank/account registry, KYC flags, aggregation API, admin API, and the adapter that calls the token-sdk REST services [R13].
- **React SPAs** — customer wallet; central-bank admin console; bank console.
- **Blockchain explorer** — read-only view of the settlement ledger for demos and monitoring [R13].

## 5. Phase-1 topology

```
                            ┌─────────────────────────────────────────────┐
                            │              CENTRAL BANK (CB)              │
                            │   issuer node (REST :9100)   auditor node   │
                            │   (REST :9000)   admin console (React)      │
                            └───────┬───────────────────────────┬─────────┘
                                    │ HTTP                        │ HTTP
                    ┌───────────────┴───────────────┐            │
                    │        FastAPI backend        │◄───────────┘
                    │  accounts · registry · admin  │
                    └───────────────┬───────────────┘
                                    │ HTTP (REST)
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
 ┌────────┴────────┐     ┌──────────┴─────────┐     ┌─────────┴────────┐
 │  owner node A   │     │   owner node B     │     │  owner node...   │
 │  banka (alice,  │     │   bankb (carol,    │     │  (customers)     │
 │  bob)  :9200    │     │   dan)  :9300      │     │  :9400           │
 └────────┬────────┘     └──────────┬─────────┘     └─────────┬────────┘
          │          libp2p (peer-to-peer, private txns)       │
          └────────────────────────┼──────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │          FABRIC NETWORK — single channel "settlement"│
        │   orderers (Raft x3)  peers (CB, banka, bankb)      │
        │   token chaincode (UTXO + ZK proofs verified here)  │
        └─────────────────────────────────────────────────────┘

  Blockchain explorer (:8081) watches the settlement channel.
  React wallet SPA ← FastAPI ← owner-node REST APIs.
```

## 6. Transaction flows

### 6.1 Issue (mint)

1. Central bank admin requests an issuance via FastAPI → issuer node.
2. Issuer node creates a token for the target owner (bank) and submits it to the token chaincode; the chaincode validates the issuer signature and commitments.
3. On commit, the SWR token is owned by the bank's wallet. The auditor (CB) can see the issuance.

### 6.2 Transfer (with ZK) [R13]

1. Alice requests an anonymous key from the recipient (e.g., carol at bank B) that will own the output token.
2. Alice's owner node builds the transaction with commitments covering value/sender/recipient for each input and output — visible only to the parties and the auditor.
3. **Get endorsements:** the transaction is sent to the **auditor**, who validates business rules and signs it; then it is submitted to the **token chaincode**, which verifies all proofs and required signatures (the peers cannot see what was transferred between whom).
4. **Commit:** the endorsed transaction goes to the ordering service; on commit event, the owner nodes update their views. UTXO change-splitting applies: a 1000 SWR input becomes 100 (to carol) + 900 (change to alice).

### 6.3 Redeem (burn)

1. A customer/bank requests redemption via FastAPI → issuer node.
2. The redeemed token is destroyed on-chain; the central bank credits the corresponding amount (off-chain ledger update in the prototype).

## 7. Deployment plan

- **Prototype (Phase 3):** the deployment is **distributed** — CB host + one VM
  per bank (each bank runs its own peer, CA, chaincode and owner service; the CB
  host runs orderer + central-bank peer + token CA + issuer/auditor + backend).
  All-in-one on a single dev laptop is used **only for local testing**, never as
  a deployment. See [DEPLOYMENT.md](DEPLOYMENT.md) / [SETUP.md](SETUP.md).
- **Comprehensive (Phase 4):** distribute across the 25-machine lab (8–16 GB RAM / 4–8 cores each). Roles: orderer hosts, peer hosts, CA hosts, token-service hosts, FastAPI/UI hosts, explorer/monitoring hosts. Per-host compose files or Ansible; documented ports and firewall requirements.
- **Considerations:** peers are RAM-hungry (≈2 GB+ each, plus CouchDB); Cap memory; run peers on dedicated hosts in the lab.

## 8. Rationale references

- Two-tier wholesale CBDC on Fabric: Project Agila [R18][R19]; CBDC landscape [R20][R21].
- Chaincode languages [R4]; Gateway SDK languages [R14].
- Token-sdk architecture (issue/transfer/redeem, ZK, auditor) [R13].
- BFT ordering and V3_0 capabilities [R1][R2]; test-network conventions [R3].
- Fabric-X as the future high-throughput track [R7][R8][R9][R10].
