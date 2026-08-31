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

- **Distribution: two-tier hybrid.**
  - **Tier 1 (Wholesale):** The central bank transacts *only* with regulated commercial banks (`Bank{k}MSP`). The central bank issues new SWR into commercial bank reserve/custodial wallets and redeems currency from them. The central bank does *not* manage retail citizen accounts directly.
  - **Tier 2 (Retail):** Commercial banks maintain retail customer accounts, enforce customer-level KYC/AML, and hold customer idemix wallet keys on their owner nodes. Customers transact with each other (intra-bank or cross-bank) through their commercial banks. See ADR-0008.
- **Money representation: token-based (UTXO).** Currency exists as individual spendable tokens rather than a single database balance row. A transfer consumes input tokens and creates new output tokens with change-splitting ($1000 \text{ SWR} \to 100 \text{ to recipient} + 900 \text{ change to sender}$), like Bitcoin. Balances are derived dynamically from unspent outputs owned by an idemix identity. See ADR-0006 [R13].
- **Privacy: Zero-Knowledge Proofs (zkatdlog).** 
  - **Pedersen Commitments:** Amounts $v$ are hidden on-ledger using homomorphic commitments $C = g_0^{H(\text{SWR})} \cdot g_1^v \cdot g_2^r$ where $r$ is a random blinding factor. Observers and peers verify $\sum C_{\text{in}} = \sum C_{\text{out}}$ homomorphically without learning $v$.
  - **ZKAT-DLOG Range Proofs:** Senders generate zero-knowledge range proofs proving $v \ge 0$ (preventing negative token creation) and proving ownership of the spending key without revealing it.
  - **Idemix Anonymity:** Account identities on-chain are cryptographic commitments to Idemix credentials (`BN254` pairing curve), preventing address tracking.
- **Oversight: auditor role (regulatory de-blinding).** The sender encrypts the commitment opening parameters $(v, r, \text{sender}, \text{recipient})$ under the **Auditor's public key**. The Central Bank Auditor node (`:9000`) de-blinds and inspects every transaction for AML/sanctions compliance and co-signs it before it can be committed to the ledger (ADR-0004) [R13].

## 3. Organizations, roles, and identities

| Role in system | Organization | Fabric/MSP | Node/service | Identities |
|---|---|---|---|---|
| Currency issuer | Central bank | `centralbank` / `CentralBankMSP` | issuer node (REST :9100) | issuer x509 identity |
| Supervisor / AML | Central bank | `centralbank` | auditor node (REST :9000) | auditor x509 identity |
| Commercial bank `k` | Bank `k` | `bank{k}` / `Bank{k}MSP` | owner node `owner{k}` (REST :9200+100(k−1)) | customers (idemix wallets) |
| Customers | on bank owner nodes | — | wallet SPA via FastAPI | idemix credentials [R13] |

- Network domain: `sworna.example.com` (e.g., `orderer.sworna.example.com`,
  `peer0.centralbank.sworna.example.com`, `peer0.bank{k}.sworna.example.com`).
- Any number of commercial banks is supported; the demo seeds banks `001`
  (`banka`, `Bank1MSP`, `owner1`) and `002` (`bankb`, `Bank2MSP`, `owner2`).
- Identity model: Fabric CA per organization (more realistic than cryptogen; test-network supports this via the `-ca` flag) [R3]. Customer wallets use **idemix** credentials issued by a CA known to the token chaincode [R13].

## 4. Component inventory

### 4.1 Layer 2 — token services (from the token-sdk sample) [R13]

- **Issuer node** — mints tokens on request of the central bank; records issuance history.
- **Auditor node** — validates, signs, and stores every token transaction; sees all amounts and parties.
- **Owner nodes** (one per commercial bank) — hold customer wallets; construct and submit transfers; reconcile balances from own ledger view.
- The layer-2 nodes talk to each other over **libp2p** to negotiate token transactions (private, between the parties), then submit the final signed transaction to the Fabric settlement layer.

### 4.2 Layer 1 — Fabric settlement network

- **Ordering service**: Raft cluster (3 orderers) in the prototype; SmartBFT (4+ consenters, V3_0 capabilities) in Phase 4 [R1][R2].
- **Peers**: one per organization (`centralbank` on the CB host; each bank's
  `peer0.bank{k}` on its own VM), LevelDB state database (CouchDB in Phase 4).
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
  │  owner node 1   │     │   owner node 2     │     │  owner node k    │
  │  bank1          │     │   bank2            │     │  (any number)    │
  │  REST :9200     │     │   REST :9300       │     │  REST :9200+100(k−1)│
  └────────┬────────┘     └──────────┬─────────┘     └─────────┬────────┘
          │          libp2p (peer-to-peer, private txns)       │
          └────────────────────────┼──────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │          FABRIC NETWORK — single channel "settlement"│
        │   orderer (Raft)  peers (CB, bank1, bank2, … bankk)  │
        │   token chaincode (UTXO + ZK proofs verified here)   │
        └─────────────────────────────────────────────────────┘

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
