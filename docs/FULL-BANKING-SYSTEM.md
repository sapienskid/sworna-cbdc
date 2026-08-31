# FULL-BANKING-SYSTEM — Sworna subsystem map

The complete banking system we are building toward. This is the target reference; each subsystem is tagged with the phase in which it is implemented.

Phases:
- **Phase 3 (P3)** = Prototype Demo (**Complete / Functional**)
- **Phase 4 (P4)** = Comprehensive Banking System (**Planned — 6–8 weeks effort**)
- **Phase 5 (P5)** = Performance, Benchmarks & Hardening (**Planned**)
- **Phase 6 (P6)** = Future Vision / Production Scale (**Vision**)

---

## A. Ledger & money core

| ID | Subsystem | Phase | Notes |
|---|---|---|---|
| A1 | **Currency lifecycle: mint/issue, transfer, redeem/burn** | **P3 (Complete)** | Provided by token-sdk issue/transfer/redeem REST flows; UTXO + ZK [R13] |
| A2 | **Currency configuration (SWR, 2 decimals)** | **P3 (Complete)** | Token type definition; denominations |
| A3 | Token types (retail SWR, wholesale SWR, future stable-assets) | P4 | Multi-token support |
| A4 | Swap / atomic exchange / programmable payments | P4 | token-sdk swaps & conditional HTLC [R12][R13] |
| A5 | Ledger snapshots / channel join-from-snapshot | P5 | Fabric snapshot feature [R1][R5] |

## B. Central bank functions

| ID | Subsystem | Phase | Notes |
|---|---|---|---|
| B1 | **Issuer console: issue to banks, redeem from banks** | **P3 (Complete)** | Admin console + issuer node |
| B2 | **Supervision view: total supply, per-bank circulation** | **P3 (Complete)** | From auditor node + FastAPI aggregation |
| B3 | Reserve & liquidity management (bank reserve accounts, intraday) | P4 | Per-bank reserve tracking |
| B4 | Monetary policy tools: interest/remuneration, holding limits | P4 | ADR-0011 interest model; limits at auditor layer |
| B5 | Wholesale settlement / RTGS-style interbank transfers | P4 | Modeled on Project Agila's interbank use case [R18][R19] |
| B6 | Regulation, reporting & stress reports | P4 | Money supply, velocity, per-bank stats |

## C. Commercial bank functions

| ID | Subsystem | Phase | Notes |
|---|---|---|---|
| C1 | **Customer & account registry** | **P3 (Complete)** | FastAPI backend (SQLite/PostgreSQL) |
| C2 | **Bank console: list customers, balances, activity** | **P3 (Complete)** | React; data from FastAPI |
| C3 | **Retail wallet issuance & management** | **P3 (Complete)** | Idemix wallet pool identities on owner nodes [R13] |
| C4 | Interbank operations: funding, settlement, liquidity | P4 | Wholesale flows |
| C5 | Bank-side fraud monitoring & transaction limits | P4 | Rules at auditor + backend alerts |
| C6 | Reconciliation & statements | P4 | From owner-node transaction history |

## D. Retail customer functions

| ID | Subsystem | Phase | Notes |
|---|---|---|---|
| D1 | **Wallet SPA: send, receive, balance, history** | **P3 (Complete)** | React; FastAPI aggregation |
| D2 | Request money, QR payments, merchant payments | P4 | React SPA extensions |
| D3 | Top-up / deposit & cash-out / redeem flows | P4 | Links retail to core banking |
| D4 | Statements, notifications | P4 | Statement generation & push alerts |
| D5 | Offline payments (research) | P6 | Vision |

## E. Compliance, risk & regulation

| ID | Subsystem | Phase | Notes |
|---|---|---|---|
| E1 | **Basic AML flags (demo-level)** | **P3 (Complete)** | Account status: active / flagged / frozen; backend transfer-limit check |
| E2 | KYC/KYB onboarding workflows | P4 | Bank-staff approval; off-chain documents |
| E3 | Transaction monitoring, sanctions/watchlist, travel rule | P4 | Enforced at Go Auditor layer — auditor signs every transaction [R13] |
| E4 | Freeze / unfreeze / legal holds | P4 | Auditor-enforced exclusion; owner nodes refuse to spend frozen tokens |
| E5 | Suspicious activity detection & reporting | P4 | Backend rules + auditor data |
| E6 | Full audit trail & forensics | P4 | Auditor sees all values; ledger is append-only |

## F. Supporting infrastructure

| ID | Subsystem | Phase | Notes |
|---|---|---|---|
| F1 | **REST API layer + FastAPI backend** | **P3 (Complete)** | See [API.md](API.md) |
| F2 | **Custom block ledger explorer** | **P3 (Complete)** | Integrated into CB Portal (peer CLI + `configtxlator`) |
| F3 | **Identity & certificate management** | **P3 (Complete)** | Fabric CA per org + Idemix Token CA [R3] |
| F4 | Monitoring / observability (Prometheus/Grafana) | P4 | Fabric metrics via Operations Service [R2] |
| F5 | API gateway, OIDC auth, rate limiting | P4 | Role-based access |
| F6 | CI/CD, backups/DR, ledger snapshots | P4–P5 | Snapshot/join [R5] |
| F7 | Performance benchmarking (Caliper) | P5 | See [BENCHMARKS.md](BENCHMARKS.md) [R15] |
| F8 | HSM key management, production hardening | P6 | Vision |

---

## Phase mapping (which phase builds which subsystem)

- **Phase 3 (P3 - Complete):** A1–A2, B1–B2, C1–C3, D1, E1, F1–F3.
- **Phase 4 (P4 - Planned Comprehensive):** A3–A4, B3–B6, C4–C6, D2–D4, E2–E6, F4–F6.
- **Phase 5 (P5 - Hardening & Benchmarks):** A5, F7.
- **Phase 6 (P6 - Production Vision):** D5, F8.
