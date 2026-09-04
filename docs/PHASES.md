# PHASES — Sworna CBDC Production Roadmap

This document provides the master implementation roadmap for the Sworna CBDC platform, outlining the completed foundational phases and the work breakdown for **production readiness, institutional admission control, multi-bank scalability, and hardware-grade security**.

| Phase | Name | Scope & Focus | Status |
|---|---|---|---|
| **Phase 1** | Research & Architecture Foundation | CBDC models, cryptographic design, ADRs 0001–0011 | **Complete** |
| **Phase 2** | Prototype De-risking | Token-SDK UTXO ZK validation, Idemix blind signatures | **Complete** |
| **Phase 3** | Initial Demonstration | CB + 2 Banks, FastAPI banking backend, React portals | **Complete (Functional)** |
| **Phase 4** | Production Systems & 5-Bank Sandbox | 3 Sovereign Systems, Admission Pipeline, 5-Bank Sandbox, SmartBFT | **In Progress / Current Focus** |
| **Phase 5** | Enterprise Security & Hardening | HSM PKCS#11, Engine mTLS, Clustered PostgreSQL, Caliper benchmarks | **Planned** |
| **Phase 6** | Sovereign Interoperability & Rollout | ISO 20022 core adapter, RTGS integration, National Clearing | **Vision** |

---

## Phase 4 — Production Systems, Admission Governance & 5-Bank Sandbox

**Goal:** Transform the prototype into an institutional-grade monetary platform featuring:
1. Formal separation of the **Three Sovereign Systems** (Commercial Banks, Regulatory Auditors, Validator Nodes).
2. An **Asynchronous Institutional Admission Pipeline** (Application -> Verification -> Four-Eyes Approval -> Channel Delta).
3. A **Single-Node 5-Bank Sandbox** for friction-free evaluation and testing.
4. **Decoupled Chaincode Endorsement** allowing hundreds of banks to transact without chaincode upgrades.

### 4.1 Track A: Single-Node 5-Bank Sandbox (Immediate Target)
* **Unified Docker Compose Stack (`compose-sandbox-5banks.yaml`):**
  * Central Bank: Orderer, CB Peer, Token CA, Issuer FSC, Auditor FSC, Backend API (`:8000`), CB Portal (`:5173`).
  * 5 Commercial Banks (`Bank001` to `Bank005`): Each running an isolated peer, local CA, owner FSC engine, backend API (`:8001`–`:8005`), and bank portal (`:5174`–`:5178`).
* **Automated Bootstrap Script (`./scripts/sandbox-5banks.sh`):**
  * One-command lifecycle: `up`, `down`, `test`, `mint-demo`.
  * Pre-configured container bridge networking with zero `/etc/hosts` editing and zero SSH requirements.

### 4.2 Track B: Institutional Admission Pipeline & Governance
* **API-Driven Admission Gateway:**
  * Endpoint `POST /api/v1/onboarding/apply` allowing applicant banks to submit public MSP definitions and endpoints.
  * State lifecycle: `SUBMITTED` -> `VERIFIED` -> `DUAL_APPROVED` -> `ADMITTED`.
* **Four-Eyes Approval (Dual Control):**
  * Dual-authorization endpoints requiring independent sign-offs from the Central Bank Monetary Risk Officer and CISO before admission.
* **Automated Channel Delta Generation:**
  * Central Bank automatically computes and signs the `settlement` channel configuration delta to add the bank's MSP upon dual approval.
* **Elimination of SSH Pushes:**
  * Commercial banks pull signed channel blocks and join autonomously; zero cross-host SSH access between institutions.

### 4.3 Track C: Consensus Ordering Cluster (4-Node SmartBFT)
* **SmartBFT Migration:**
  * Replace single-node Raft with a 4-node Byzantine Fault Tolerant ordering cluster (`ConsenterMapping` across 4 distinct institutional consenters).
  * Survives $f = 1$ Byzantine failure out of $3f + 1 = 4$ nodes.
* **Consortium Governance:**
  * Orderer nodes distributed across sovereign entities (Central Bank, National Clearing House, Ministry of Finance).

### 4.4 Track D: Decoupled Endorsement Policy (Scale to 100+ Banks)
* **Role-Based Endorsement:**
  * Transition token chaincode endorsement from explicit bank enumerations (`OR('Bank1MSP', ..., 'BankNMSP')`) to role-based policies:
    $$\text{AND}('CentralBankMSP.peer', 'AuditorMSP.peer') \quad \text{or} \quad \text{MAJORITY('Application.peer')}$$
  * Enables hundreds of commercial banks to join without requiring chaincode sequence upgrades or network downtime.
* **Dynamic Libp2p Discovery:**
  * FSC owner nodes discover counterparty addresses dynamically over libp2p using on-chain endpoint registry records.

### 4.5 Track E: Regulatory Auditor System Enhancements
* **ZK Proof Verification & Blind Co-Signing:**
  * Production hardening of `token-services/auditor/service/audit.go`.
* **Selective De-anonymization & Audit Trail:**
  * Standardized export utilities for decrypting transaction openings and generating Suspicious Activity Reports (SARs).
* **Multi-Agency Quorum:**
  * Threshold key splitting (Shamir's Secret Sharing) across Central Bank and Financial Intelligence Units.

---

## Phase 5 — Enterprise Security, Key Custody & Hardening

| Subsystem | Scope & Key Deliverables | Complexity |
|---|---|---|
| **Hardware Key Security (HSM)** | Bind Fabric peer signing keys, Idemix issuer root key, and Auditor keys to **PKCS#11 FIPS 140-2 Level 3 HSMs**. Keys never touch disk or RAM. | **High** |
| **Engine Mutual TLS (mTLS)** | Implement strict mutual TLS and container network policies across Go FSC ports (`:9000`, `:9100`, `:9200`), eliminating open HTTP. | **Medium-High** |
| **Database & Finality** | Migrate off-chain registries to high-availability **clustered PostgreSQL** with row-level locking. Implement Fabric **Block-Event listeners** for true two-phase finality. | **Medium** |
| **Web & App Security** | Store session tokens in **HttpOnly, SameSite=Strict encrypted cookies**; integrate Redis token blacklisting and brute-force rate-limiting. | **Medium** |
| **Caliper Benchmarks** | Measure TPS, latency (p50/p95/p99), and UTXO lock contention under high-velocity interbank settlement. | **Medium** |

---

## Phase 6 — Sovereign Interoperability & National Rollout

- **ISO 20022 Financial Messaging:** Bridge core banking systems to CBDC via `pacs.008` (credit transfers) and `camt.053` (statements).
- **RTGS Interoperability:** Real-Time Gross Settlement synchronization for automated reserve vault funding.
- **Cross-Border Clearing:** Bilateral and multilateral multi-currency settlement (mBridge architecture).
- **Offline & Hardware Wallets:** Secure Enclave and smartcard token storage for disaster-resilient offline payments.
