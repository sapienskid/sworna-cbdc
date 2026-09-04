# Security Model — Production Cryptography, Trust, and Governance

This document describes the security model, cryptographic guarantees, trust boundaries, and hardening standards of the Sworna CBDC platform.

Companion documents:
- [BLIND-SIGNATURES-AND-PRIVACY.md](BLIND-SIGNATURES-AND-PRIVACY.md) (Zero-Knowledge and Blind Signatures),
- [ARCHITECTURE.md](ARCHITECTURE.md) (System Architecture), and
- [BACKEND-INTERNALS.md](BACKEND-INTERNALS.md) (Off-Chain Banking Engine).

---

## 1. Trust Anchors & Hardware Boundaries

| Anchor | Holder | Why Trusted | Production Protection Standard |
|---|---|---|---|
| **Token Public Parameters (`zkatdlog_pp.json`)** | Baked into Chaincode Image | Defines Pedersen generators, Idemix issuer PK, and Auditor PK. Tampering invalidates all tokens. | Cryptographically signed and verified in chaincode container digest. |
| **Token CA (= Idemix Issuer Key)** | Central Bank | Mints Idemix wallet credentials and owner node identities. | **FIPS 140-2/3 Level 3 Hardware Security Module (HSM)**. Private keys never leave the secure hardware boundary. |
| **Fabric Org CAs & MSPs** | One per institution (CB + Commercial Banks) | Governs peer and admin identities. Banks self-provision their own CAs. | Bank HSM boundary. Central Bank never holds commercial bank private keys. |
| **Auditor Opening Key** | Regulatory Auditor (Central Bank / FIU) | Decrypts per-transaction audit openings; co-signs transactions. | Hardware Security Module with threshold M-of-N key splitting (Shamir's Secret Sharing). |
| **Consensus Validators** | SmartBFT Orderers | Orders blocks and prevents double spending. | Isolated BFT cluster across 4 independent institutional zones. |

---

## 2. Cryptographic Primitives

| Purpose | Primitive | Implementation Library |
|---|---|---|
| **Wallet Credentials & Blind Pseudonyms** | Camenisch–Lysyanskaya (CL) blind signatures over BN254 curve | IBM Idemix via Fabric CA (`--enrollment.type idemix`) |
| **Confidential Amounts** | Pedersen Commitments ($C = g^v \cdot h^r$) | Token SDK `zkatdlog` driver |
| **Zero-Knowledge Validity** | ZK Range Proofs (base 300, exponent 5) | Token SDK `zkatdlog` |
| **Transaction Finality Gate** | Blind Auditor Co-Signature | Token SDK `ttx.AuditApproveView` |
| **Consensus Agreement** | Byzantine Fault Tolerant (BFT) consensus | Hyperledger Fabric SmartBFT (4 consenters) |
| **Transport Security** | TLS 1.3 with Mutual Authentication (mTLS) | OpenSSL / Go crypto/tls |
| **Password Hashing** | PBKDF2-HMAC-SHA256 (120,000 rounds) | Python hashlib (`backend/app/security.py`) |
| **Session Authentication** | Short-lived JWT (15 min) + HttpOnly Refresh Cookies | PyJWT + Redis Blacklist |

---

## 3. Institutional Governance & The Four-Eyes Principle

In a production central bank, unilateral operations are strictly prohibited:

### 3.1 Dual-Control Currency Minting (Wholesale)
- **Monetary Operator:** Proposes a wholesale mint batch (`POST /api/v1/admin/mint/propose`).
- **Monetary Governor:** Reviews aggregate supply impact, reserve backing, and executes cryptographic co-signing (`POST /api/v1/admin/mint/authorize`).
- Without both independent signatures, the Issuer FSC daemon rejects the request.

### 3.2 Dual-Control Bank Admission
- **Regulatory Officer:** Verifies banking license and KYC/AML compliance profile (`POST /api/v1/admin/onboarding/{id}/approve-monetary`).
- **CISO:** Cryptographically verifies the bank's public MSP certificate chain and network TLS endpoints (`POST /api/v1/admin/onboarding/{id}/approve-security`).
- On dual approval, the Central Bank node generates the on-chain channel configuration delta.

---

## 4. Application & Network Hardening Controls

### 4.1 Engine-Level Mutual TLS (mTLS) & Zero-Trust Mesh
* The Go token services (`issuer :9100`, `auditor :9000`, `owner :9200`) do not accept unauthenticated plain HTTP.
* Strict mutual TLS is enforced: only authorized backend service containers possessing registered client certificates can invoke token APIs.
* Container network policies (e.g., Cilium or Kubernetes NetworkPolicies) block all external traffic to token engine ports.

### 4.2 Web & Session Security
* **No `localStorage` for Credentials:** All session credentials are stored in `HttpOnly`, `SameSite=Strict`, `Secure` cookies, mitigating cross-site scripting (XSS) risks.
* **Rate Limiting & Lockout:** API gateways enforce exponential backoff and brute-force IP rate limiting on `/auth/login`.

### 4.3 Database Integrity & Event-Driven Finality
* **Clustered PostgreSQL:** Replaces prototype SQLite with high-availability PostgreSQL clusters featuring row-level locking for wallet pools and transaction records.
* **Two-Phase Finality:** Transactions are initially logged as `SUBMITTED`. A dedicated Fabric Block Event Listener updates the status to `FINAL` only when the transaction is confirmed in a committed block.

---

## 5. Circuit Breakers & Emergency Suspension (The Kill Switch)

1. **Application Router Revocation:** Central Bank toggles bank status to `SUSPENDED`; FastAPI payment gateway immediately blocks all transactions.
2. **Auditor Denial:** The Regulatory Auditor rejects ZK proof co-signing for any transaction involving the suspended bank's MSP, halting on-chain settlement.
3. **Consensus Expulsion:** The Central Bank issues a channel configuration update removing the bank's MSP from the channel.
