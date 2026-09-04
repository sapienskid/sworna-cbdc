# Sworna CBDC — Production-Grade Master Plan

**A Sovereign Central Bank Digital Currency Platform Built on Hyperledger Fabric & Token-SDK**

---

## Executive Summary

Sworna CBDC is an enterprise-grade, privacy-preserving Central Bank Digital Currency (CBDC) platform. It implements a **two-tier sovereign monetary architecture**: the **Central Bank** issues wholesale digital currency to regulated commercial banks, **commercial banks** distribute retail currency to citizen and merchant wallets, and all settlement occurs on a tamper-proof distributed ledger with **Zero-Knowledge Proofs (ZKP)** and **blind signatures**.

This plan details the upgrade of Sworna from an initial demonstration prototype into a **production-grade national currency system**, organized around three sovereign subsystems:
1. **Commercial Bank System:** Autonomous organizational peers, local CAs, Go FSC token engines, and core-banking adapters.
2. **Regulatory Auditor System:** Independent Zero-Knowledge verification, mandatory co-signing for transaction finality, selective de-anonymization decryption, and real-time AML/sanctions gating.
3. **Validator Nodes (Consensus Layer):** A 4-node Byzantine Fault Tolerant (SmartBFT) ordering cluster operated by an institutional consortium, guaranteeing settlement finality and resilience against malicious or failing nodes.

---

## 1. System Architecture: The Three Operating Subsystems

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   TIER 1: NATIONAL GOVERNANCE & CORE                            │
│                                                                                                  │
│   ┌───────────────────────────┐  ┌───────────────────────────┐  ┌─────────────────────────────┐  │
│   │   CENTRAL BANK SOVEREIGN  │  │   REGULATORY AUDITOR(S)   │  │    VALIDATOR ORDERING NET   │  │
│   │   • Monetary Policy Board │  │   • ZK Transaction Audit  │  │    • 4-Node SmartBFT Cluster│  │
│   │   • M-of-N Mint Approval  │  │   • Selective Opening Dec │  │    • Crash & Byzantine Proof│  │
│   │   • Token CA (Idemix PK)  │  │   • AML/CFT Real-Time Gate│  │    • Channel Block Publisher│  │
│   └─────────────┬─────────────┘  └─────────────┬─────────────┘  └──────────────┬──────────────┘  │
└─────────────────┼──────────────────────────────┼───────────────────────────────┼─────────────────┘
                  │                              │                               │
                  │   Secured Financial Interconnect (mTLS / IPsec VPN / Leased) │
                  │                              │                               │
┌─────────────────┼──────────────────────────────┼───────────────────────────────┼─────────────────┐
│                 ▼                              ▼                               ▼                 │
│   ┌──────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                          TIER 2: INSTITUTIONAL COMMERCIAL BANKS                          │   │
│   │                                                                                          │   │
│   │   • Commercial Bank 001            • Commercial Bank 002          • Commercial Bank N    │   │
│   │     - Autonomous Fabric Peer         - Autonomous Fabric Peer       - Autonomous Peer    │   │
│   │     - Local Fabric CA (Bank Keys)    - Local Fabric CA              - Local Fabric CA    │   │
│   │     - Go FSC Owner Node              - Go FSC Owner Node            - Go FSC Owner Node  │   │
│   │     - Core Banking / ISO 20022       - Core Banking / ISO 20022     - Core Banking Bus   │   │
│   └────────────────────────────────────────────┬─────────────────────────────────────────────┘   │
└────────────────────────────────────────────────┼─────────────────────────────────────────────────┘
                                                 │
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   TIER 3: RETAIL CUSTOMERS & MERCHANTS                           │
│                                                                                                  │
│   • Retail Wallets (Mobile / Web)  • Merchant QR Terminals  • Idemix Blind Pseudonyms (ZKP)      │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Commercial Bank System (Operational Layer)
* **Institutional Autonomy:** Each commercial bank runs its own Fabric Certificate Authority (`ca_bank{k}`), peer node (`peer0.bank{k}`), and token management engine (`owner{k}`). Bank private keys never leave the bank's secure perimeter.
* **Token Custody & UTXO Lifecycle:** The bank's Go FSC owner node manages customer wallets, signs zero-knowledge transactions, and requests recipient blind identities over libp2p.
* **Core Banking Integration (ISO 20022):** Interfaces with legacy core-banking systems (Finacle, Temenos) via standard financial messaging (`pacs.008` for customer credit transfers, `camt.053` for bank statements).

### 1.2 Regulatory Auditor System (Supervision Layer)
* **Zero-Knowledge Audit Gate:** Located in `token-services/auditor/service/audit.go`. Every transaction requires a cryptographic co-signature from the Auditor before the Fabric ledger will accept it.
* **Selective De-anonymization (Decryption Opening):** Located in `token-services/auditor/service/history.go`. Senders encrypt opening parameters under the Auditor's public key. On regulatory warrant or AML flag, the Auditor can de-anonymize the enrollment IDs and exact minor amounts without breaking general privacy.
* **Multi-Agency Quorum:** Extends the auditor from a single node to a shared regulatory quorum (Central Bank + Financial Intelligence Unit / Tax Authority) using threshold cryptography.

### 1.3 Validator Nodes (Consensus Layer)
* **BFT Consensus Ordering Cluster:** Eliminates single-node Raft. Deploys a **4-node Byzantine Fault Tolerant (SmartBFT) ordering cluster** capable of tolerating $f = 1$ corrupted or offline node out of $3f + 1 = 4$ nodes.
* **Consortium Governance:** The ordering cluster is hosted across sovereign institutions (e.g., Central Bank Data Center 1, Central Bank Data Center 2, National Clearing House, Ministry of Finance).
* **Decoupled Validation:** Commercial banks do not run consensus orderers; they operate validating and committing peers that verify transaction read/write sets and append blocks locally.

---

## 2. Institutional Admission & Verification Pipeline

In production, **commercial banks cannot automatically join the network**. The previous prototype mechanism using central SSH pushes (`add-bank.sh`) is replaced by an **asynchronous, multi-stage Application -> Verification -> Approval pipeline**:

```
STAGE 1: APPLICATION            STAGE 2: VERIFICATION           STAGE 3: CB ACCEPTANCE           STAGE 4: NETWORK ADMISSION
┌─────────────────────────┐     ┌────────────────────────┐     ┌────────────────────────┐     ┌─────────────────────────┐
│ Commercial Bank (Applicant)    │ Central Bank Regulators│     │ CB Board / Governors   │     │ Smart Contract / Channel│
│                         │     │                        │     │                        │     │                         │
│ • Runs local Fabric CA  │     │ • Banking License Check│     │ • Dual-Control Approval│     │ • CB signs Channel Delta│
│ • Generates keys in HSM │────►│ • AML/CFT Audit        │────►│   (Four-Eyes Principle)│────►│ • Org added to Channel  │
│ • Submits CSR + Org MSP │     │ • Tech Security Audit  │     │ • Governor A Approves  │     │ • Bank connects peer    │
│   (Signed Admission Req)│     │ • Risk & Reserve Rating│     │ • Governor B Approves  │     │ • Status: LICENSED      │
└─────────────────────────┘     └────────────────────────┘     └────────────────────────┘     └─────────────────────────┘
```

### Stage 1: Autonomous Application
The applicant bank initializes its local Fabric CA and peer on its own cloud/data center, generates its signing keys locally (in HSM), and submits an admission bundle via HTTPS:
* Legal entity identifier & SWIFT BIC.
* Public MSP JSON definition (`configtxgen -printOrg`).
* Network endpoints (`peer0.bankxyz.com:7051`, `owner.bankxyz.com:9200`).
* Signed application payload.
* *Initial Status:* `SUBMITTED`.

### Stage 2: Regulatory & Technical Verification
The Central Bank compliance team and automated verifiers perform due diligence:
* National banking license and capital adequacy verification.
* Automated network probe (mTLS certificate validation, Fabric protocol handshake).
* AML/CFT audit and reserve account binding.
* *Status:* `VERIFIED_PENDING_APPROVAL`.

### Stage 3: Central Bank Board Approval (Four-Eyes Principle)
No single operator can approve a bank:
* **Governor A (Monetary Policy / Risk Officer):** Reviews reserve allocations and interbank settlement limits; applies cryptographic signature.
* **Governor B (Chief Information Security Officer):** Verifies cryptographic integrity and endpoint compliance; applies co-signature.
* *Status:* `APPROVED`.

### Stage 4: On-Chain Channel Admission (Zero SSH)
* The Central Bank calculates the channel configuration delta for the `settlement` channel, signs the configuration update, and submits it to the ordering cluster.
* The applicant bank receives an automated webhook notification with the signed channel block hash.
* The commercial bank executes `peer channel join` against the public orderer endpoint.
* The bank is now live on the monetary network.

### Emergency Circuit Breakers (Kill Switch)
* **Application Layer:** Instant status flip to `SUSPENDED` halts all payment routes in `backend/app/routers/payments.py`.
* **Cryptographic Layer:** The Regulatory Auditor denies co-signing to any transaction involving the suspended bank's MSP.
* **Consensus Layer:** Emergency channel configuration update removes the bank's MSP from the channel.

---

## 3. Scalability: From 5 Banks to Hundreds of Banks

### 3.1 Decoupled Chaincode Endorsement Policy
* **The Problem:** Upgrading the chaincode with explicit OR endorsements (`OR('Bank1MSP.peer', ..., 'BankNMSP.peer')`) requires network-wide chaincode upgrades whenever a new bank joins.
* **The Production Solution:** The token chaincode endorsement policy is tied to institutional roles rather than an enumerated bank list:
  $$\text{AND}('CentralBankMSP.peer', 'AuditorMSP.peer') \quad \text{or} \quad \text{MAJORITY('Application.peer')}$$
  New commercial banks onboard and begin transacting immediately **with zero chaincode updates and zero network downtime**.

### 3.2 Dynamic Libp2p Peer Discovery
* Dynamic DHT / Kademlia peer discovery over libp2p replaces hardcoded resolver templates in `core.yaml.tpl`.
* Commercial bank nodes discover counterparty addresses dynamically via verified on-chain endpoint records.

---

## 4. Production Security & Hardening Matrix

| Security Domain | Current Prototype Status | Production-Grade Standard |
|---|---|---|
| **Key Storage** | Plaintext files on disk (`token-services/keys/.../priv_sk`). | **Hardware Security Modules (HSM):** FIPS 140-2/3 Level 3 via PKCS#11 for all Central Bank, Auditor, and Bank keys. Non-exportable. |
| **Engine REST Security** | Unauthenticated HTTP on ports `9000`, `9100`, `9200`. | **Strict Mutual TLS (mTLS) + Network Policy:** REST endpoints accept connections only from authenticated backend proxies with valid client certificates. |
| **Session Security** | JWTs stored in browser `localStorage`. | **HttpOnly, SameSite=Strict, Encrypted Cookies** with short-lived tokens and Redis-backed session revocation. |
| **Database & Finality** | Local SQLite (`sworna.db`) with optimistic "Confirmed" status. | **Clustered PostgreSQL + Block Event Listeners:** Transactions remain `PENDING` until a Fabric `BlockEvent` confirms commit on-chain. |
| **AML & Sanctions Screening** | Substring checks in Python RAM. | **Real-Time Fuzzy Matching (Jaro-Winkler/Levenshtein)** integrated with official OFAC, UN, and national sanctions XML feeds. |
| **Minting Governance** | Single admin button click. | **M-of-N Multi-Signature Issuance:** Multiple executive cryptographic approvals required before wholesale tokens can be minted. |

---

## 5. Two-Track Implementation Delivery

### Track A: Single-Node 5-Bank Sandbox (Immediate Target)
To make installation straightforward and eliminate lab multi-machine friction:
* **Unified Docker Compose Stack (`compose-sandbox-5banks.yaml`):**
  * Central Bank: Orderer, CB Peer, Token CA, Issuer, Auditor, Backend, Portal (`:8000`, `:5173`).
  * Commercial Banks: 5 distinct banks (`Bank001` through `Bank005`), each with an isolated peer, CA, owner engine, and bank portal (`:8001`–`:8005`).
  * Container bridge networking with pre-resolved internal DNS.
  * **One-command bootstrap (`./sandbox-up.sh`):** Zero manual IP configuration, zero SSH keys, zero Tailscale requirements.

### Track B: Distributed Production Package
* **Ansible / Terraform Blueprints:** Automated multi-cloud deployment (AWS/Azure/On-Prem) for Central Bank and Commercial Bank clusters.
* **Self-Service Onboarding Portal:** Web UI and API for institutional license application and dual-control governor approvals.
* **Monitoring & Observability:** Prometheus and Grafana dashboards tracking transaction throughput, ZKP generation latency, and consensus health.

---

## 6. Success Metrics & Verification

A deployment is considered production-ready when:
1. **Consensus Fault Tolerance:** The 4-node BFT cluster continues committing transactions when 1 orderer node is forcibly terminated.
2. **Autonomous Admission:** A new bank completes the application -> verification -> approval pipeline and transacts without any manual SSH or server restarts.
3. **Audit Compliance:** Every transfer is validated and co-signed by the Auditor; selective de-anonymization decrypts transaction metadata accurately on simulated AML alerts.
4. **Resilience & Finality:** Network maintains zero transaction loss under simulated network partitions, with all confirmed balances backed by on-chain UTXO state.
