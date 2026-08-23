# Sworna CBDC — Project Plan

**A central bank digital currency prototype built on Hyperledger Fabric**

---

## Executive summary

Sworna is a prototype of a complete central bank digital currency (CBDC) system. It models the national currency digitally: a **central bank creates and destroys money**, **commercial banks hold and distribute it**, and **customers send and receive it instantly through digital wallets** — all on a shared, tamper-proof ledger that only trusted institutions can join.

The prototype is built on **Hyperledger Fabric**, the enterprise blockchain platform used by real central-bank pilots around the world. It combines two of the most important properties a CBDC needs:

- **Trust** — every transaction is agreed and recorded by multiple independent institutions; nothing can be silently changed.
- **Privacy with oversight** — transaction amounts and parties are hidden from the general ledger (using Zero-Knowledge Proofs), while the central bank retains full visibility for supervision and anti-money-laundering purposes.

Sworna will grow from a working demonstration (central bank + two banks + customer wallets) into a full banking system covering accounts, compliance, interbank settlement, and reporting.

---

## 1. Background: why a CBDC

Digital money today mostly lives inside private companies (banks, payment apps). A CBDC is **digital money issued directly by the central bank** — the digital equivalent of cash. Countries pursue CBDCs because they can deliver:

- **24/7 payments** — instant transfers between banks even when traditional settlement systems are closed.
- **Financial inclusion** — a digital national currency reachable by anyone with a phone.
- **Monetary sovereignty** — the central bank keeps control of the national currency as digital private money grows.
- **Efficiency and programmability** — faster settlement, lower cost, and money that can carry policy rules (for example, expiry or interest) if a country chooses.

This prototype demonstrates how such a system can be designed and built.

---

## 2. The model: how the money works

Sworna uses the **two-tier model** — the standard structure adopted by central banks worldwide. The central bank deals with commercial banks; commercial banks deal with the public.

```
                    TIER 1  (interbank / wholesale)
   ┌───────────────────────────────────────────────────┐
   │               CENTRAL BANK                        │
   │   creates money ──►  distributes to banks          │
   │   destroys money ◄──  redeems from banks           │
   └──────────────┬──────────────────────┬─────────────┘
                  │ issues                │ redemptions
                  ▼                        ▲
        ┌─────────┴──────┐      ┌─────────┴──────┐
        │  COMMERCIAL    │      │  COMMERCIAL    │
        │  BANK A        │◄────►│  BANK B        │  interbank settlement
        └─────────┬──────┘      └─────────┬──────┘
                  │                       │
                    TIER 2  (retail / public)
                  │                       │
        ┌─────────▼──────┐      ┌─────────▼──────┐
        │  alice, bob    │      │  carol, dan    │  person-to-person payments
        │  (wallets)     │      │  (wallets)     │
        └────────────────┘      └────────────────┘
```

- **Tier 1 (wholesale):** the central bank creates ("issues") SWR and distributes it to banks; banks can settle with each other; the central bank can remove ("redeem") money.
- **Tier 2 (retail):** banks serve customers, who pay each other through wallets — including across different banks.

## 3. Key design choices

| Choice | What it means |
|---|---|
| **Permissioned network** | Only approved institutions (the central bank and commercial banks) run the network. |
| **Two-tier distribution** | Central bank issues to banks; banks serve customers — the globally accepted model. |
| **Token-based money** | Money exists as individual, verifiable digital tokens (like banknotes), not just numbers in a database. |
| **Privacy by default** | Payment amounts and parties are hidden from the ledger using Zero-Knowledge Proofs. |
| **Central-bank oversight** | An "auditor" role — operated by the central bank — sees every transaction and signs off on it, enabling supervision and AML. |
| **Proven technology** | Hyperledger Fabric is the platform used by real central-bank pilots (e.g., the Philippines' wholesale CBDC project). |

## 4. Overall architecture

```
            ┌─────────────────────────────────────────────┐
            │           CENTRAL BANK                      │
            │   Issuer service  ·  Auditor service        │
            │   Admin console (web)                       │
            └───────┬──────────────────────────────┬──────┘
                    │                              │
        ┌───────────▼─────────────┐                │
        │   Banking backend       │                │
        │   (accounts, customers, │                │
        │   admin, reports)       │                │
        └───────────┬─────────────┘                │
                    │                              │
   ┌────────────────┼──────────────────────────────┼──────────┐
   │                │                              │          │
   │    ┌───────────▼─────────┐      ┌─────────────▼────────┐ │
   │    │  Bank A service     │      │  Bank B service      │ │
   │    │  (alice, bob)       │      │  (carol, dan)        │ │
   │    └───────────┬─────────┘      └─────────────┬────────┘ │
   │                └──────────┬───────────────────┘         │
   │                    banks negotiate privately            │
   └────────────────────────────┼────────────────────────────┘
                                │
   ┌────────────────────────────┼────────────────────────────┐
   │    HYPERLEDGER FABRIC  —  shared, tamper-proof ledger   │
   │    Orderers (agreement) · Peers (one per institution)   │
   │    Token chaincode verifies every transaction           │
   └─────────────────────────────────────────────────────────┘

   Plus: Blockchain Explorer (live ledger view) · Wallet app (customers)
```

How a payment flows:

1. The sender's bank and the recipient's bank **agree privately** on the transfer (amounts and parties stay confidential).
2. The transaction is **approved by the central-bank auditor** and then checked by the network.
3. The transaction is recorded on the **shared ledger**, permanently and unchangeably.
4. Both banks update their customers' balances; the customer sees it instantly in the wallet.

## 5. Who is who

| Participant | Role | Responsibilities |
|---|---|---|
| **Central bank** | Issuer + Auditor | Creates and destroys money; approves every transaction; supervises the whole network; sees all activity |
| **Commercial banks** | Wallet custodians | Hold digital money for customers; process payments; reconcile accounts |
| **Customers** | Wallet users | Send and receive money through an app; view balance and history |
| **Build team** | Implementers | Design, build, run, and demonstrate the system |

## 6. How deployment works (one repo, many roles)

There is **one code repository** containing all the code for every role. A machine becomes "the central bank", "a bank", or something else **not by running different code, but by running the same code with a different configuration and identity** — the same way one operating-system installer creates different machines depending on how you configure them.

### 6.1 What runs where

```
Central-bank host (machine 1)      Bank A host (machine 2)        Bank B host (machine 3)
├─ ordering cluster                ├─ peer (ledger copy)          ├─ peer (ledger copy)
├─ peer (ledger copy)              ├─ certificate authority       ├─ certificate authority
├─ certificate authority           ├─ Bank A service              ├─ Bank B service
├─ Issuer service (creates money)  │   (wallets: alice, bob)      │   (wallets: carol, dan)
├─ Auditor service (oversight)     └─ bank console                └─ bank console
├─ banking backend
└─ admin console + wallet app

Customer machines (all remaining lab PCs): nothing installed — they just open the web app in a browser.
```

- **Central-bank host:** the central bank's certificates and services (issue, audit, admin).
- **Bank hosts:** the same codebase, but each runs the **Bank A / Bank B** configuration — its own certificates and its own customer wallets.
- **Customers:** are **not nodes at all**. A customer is a wallet identity inside their bank's service, plus a browser. There is nothing to install.

### 6.2 What decides "who is who"

| Layer | Decides | How |
|---|---|---|
| **Identity** | Which role a machine plays | Certificates issued by each organization's CA, carrying the organization's ID (CentralBank, BankA, BankB) |
| **Chaincode rules** | What each identity is allowed to do | Only the issuer identity can create money; only the auditor can approve transactions; only a token's owner can spend it — enforced cryptographically on every transaction |
| **Application access** | What each user sees in the apps | The banking backend gives central-bank admins, bank staff, and customers only their own screens and actions |

So even if someone copied the repo, they could not act as the central bank — the network would reject their transactions because they lack the valid central-bank identity.

### 6.3 Where it runs

- **Development:** everything on one laptop, as containers — fastest way to build and test.
- **Lab demo:** three machines as above (central bank, Bank A, Bank B); customers use browsers.
- **Full lab (25 machines):** roles are split further — separate ordering machines, per-bank peer machines, a backend machine, a monitoring machine — all driven from the same repo with automated deployment scripts.

## 7. What the full system covers

The prototype grows into a **complete banking system** across six areas:

| Area | Capabilities |
|---|---|
| **Money core** | Issuing, transferring, and redeeming digital currency |
| **Central bank** | Issuance, supervision, reporting, and monetary-policy tools (e.g., interest, limits) |
| **Commercial banking** | Customer accounts, interbank settlement, reconciliation |
| **Retail / customers** | Wallet app, payments (including QR and merchant payments), statements |
| **Compliance & risk** | KYC, anti-money-laundering, sanctions screening, ability to freeze funds, audit trail |
| **Infrastructure** | Security, monitoring, backups, and performance benchmarking |

## 8. Tools and technologies

Every tool we will use, and what we use it for.

### 8.1 Core platform (the ledger)

| Tool | What it is | Used for |
|---|---|---|
| **Hyperledger Fabric v3.1** | Enterprise permissioned blockchain platform | The shared, tamper-proof ledger run by all institutions |
| **Fabric token services** (fabric-samples `token-sdk`) | Prebuilt token layer with Zero-Knowledge Proofs | Issuing, transferring, and redeeming SWR tokens; the issuer / auditor / owner REST services |
| **Fabric CA** | Certificate authority | Issuing the digital identities (certificates) of every organization, node, and user |
| **Fabric Gateway** | Standard client interface | How our applications talk to the network (Go / Node / Java) |
| **CouchDB** | JSON document database | The peers' state database; rich queries for reporting and dashboards |
| **Raft → SmartBFT ordering service** | Consensus component | Agrees on the order of transactions; upgraded to Byzantine-fault-tolerant consensus in the comprehensive build |

### 8.2 Application & development tools

| Tool | What it is | Used for |
|---|---|---|
| **Python 3 + FastAPI** | Web framework | The banking backend: accounts, customers, admin, reports, API aggregation |
| **Uvicorn** | ASGI server | Serving the FastAPI application |
| **SQLite (dev) / PostgreSQL (later)** | Databases | The registry of customers, accounts, and banks behind the backend |
| **React (with Vite)** | JavaScript UI framework | Customer wallet and the central-bank / bank admin consoles |
| **Node.js + npm** | Runtime + package manager | Building and running the React apps and benchmark tooling |
| **Go** | Programming language | Running the prebuilt token services (no custom chaincode needed for the demo) |
| **Blockchain Explorer** | Ledger visualization | Live view of committed transactions for demos and monitoring |
| **Hyperledger Caliper** | Benchmark framework | Measuring throughput, latency, and success rate |
| **Docker + Docker Compose** | Containerization | Packaging and running every component consistently across machines |
| **Git** | Version control | Source control for all code and configuration |
| **curl / REST clients** | API testing | Calling and verifying the REST endpoints |

### 8.3 Operations & infrastructure tools

| Tool | What it is | Used for |
|---|---|---|
| **make, jq, shell scripts** | Automation utilities | One-command network bring-up, crypto generation, seeding demo data |
| **Prometheus + Grafana** | Monitoring + dashboards | Watching the health and performance of the network |
| **Structured logging** | Observability | Debugging and auditing component behavior |
| **Ansible** | Configuration management | Rolling the network out across the 25 lab machines (comprehensive build) |
| **Hardware / environment** | 25-machine lab (8–16 GB RAM, 4–8 cores each) | Running the central-bank, bank, and customer nodes in a realistic distributed setup |

---

## 9. Application interfaces — API reference

The system exposes REST APIs in two places: the **token services** (perform the real money operations) and the **banking backend** (accounts, customers, admin, and aggregation).

### 9.1 Service ports (development)

| Port | Service |
|---|---|
| 8080 | Interactive API documentation (Swagger) |
| 9000 | Auditor service (central bank supervision) |
| 9100 | Issuer service (central bank issuance) |
| 9200+100(k−1) | Owner service for bank `k` (demo: 9200 owner1/banka, 9300 owner2/bankb) |
| 8000 | Banking backend (FastAPI) |

### 9.2 Token services (money operations)

**Issuer service (central bank) — `:9100`**

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/issuer/issue` | Create (mint) SWR tokens and assign to a bank/customer |
| GET | `/api/v1/issuer/history` | Issuance history |
| POST | `/api/v1/issuer/redeem` | Destroy (burn) SWR tokens |

**Owner services (banks) — `:9200`/`:9300`/… per bank `k`**

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/owner/accounts` | List wallet accounts on the node |
| GET | `/api/v1/owner/accounts/{id}` | Account details |
| GET | `/api/v1/owner/accounts/{id}/balance` | SWR balance |
| GET | `/api/v1/owner/accounts/{id}/transactions` | Transaction history |
| POST | `/api/v1/owner/accounts/{id}/transfer` | Transfer SWR to another account (intra- or inter-bank) |
| POST | `/api/v1/owner/accounts/{id}/redeem` | Redeem SWR to the issuer |

**Auditor service (central bank) — `:9000`**

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/auditor/balances` | All balances (central-bank oversight view) |
| GET | `/api/v1/auditor/transactions` | All transaction history |
| POST | `/api/v1/auditor/approve` | Validate and sign a transaction (every transaction is approved here) |

### 9.3 Banking backend (FastAPI) — `:8000`, base path `/api/v1`

**Registry & accounts**

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/customers` | List customers |
| POST | `/customers` | Register a customer (onboarding) |
| GET | `/customers/{id}` | Customer details |
| PATCH | `/customers/{id}` | Update customer / set KYC status |
| GET | `/customers/{id}/accounts` | A customer's accounts |
| POST | `/customers/{id}/accounts` | Open an account (creates a wallet on the bank's node) |
| GET | `/accounts/{id}` | Account details (bank, balance, status) |
| PATCH | `/accounts/{id}` | Set account status: active / flagged / frozen |
| GET | `/banks` | List commercial banks |

**Payments (wraps the token services)**

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/payments/transfer` | Send money: `{fromAccount, toAccount, amount, message}` |
| GET | `/payments/{id}/status` | Transaction status (submitted / endorsed / committed) |
| GET | `/accounts/{id}/balance` | Aggregated SWR balance for the wallet UI |
| GET | `/accounts/{id}/transactions` | Aggregated history for the wallet UI |

**Central-bank admin**

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/admin/issue` | Issue SWR to a bank (`{bank, amount}`) |
| POST | `/admin/redeem` | Redeem SWR from a bank (`{bank, amount}`) |
| GET | `/admin/supply` | Total SWR in circulation |
| GET | `/admin/circulation` | SWR per bank |
| GET | `/admin/overview` | Dashboard aggregate: supply, banks, customers, recent transactions |

### 9.4 Example calls

Issue 1,000 SWR to Alice (via the issuer service):

```json
POST /api/v1/issuer/issue
{
  "amount": {"code": "SWR", "value": 1000},
  "counterparty": {"node": "owner1", "account": "alice"},
  "message": "central bank issuance"
}
```

Transfer 100 SWR from Alice to Dan (via a bank's owner service):

```json
POST /api/v1/owner/accounts/alice/transfer
{
  "amount": {"code": "SWR", "value": 100},
  "counterparty": {"node": "owner2", "account": "dan"},
  "message": "hello dan!"
}
```

Note the token model: Alice's 1,000 SWR input is split into 100 (to Dan) and 900 (change back to Alice).

### 9.5 Data model (banking backend)

| Entity | Fields |
|---|---|
| `customer` | id, name, phone, bank, kycStatus (pending/verified), accountStatus (active/flagged/frozen), created |
| `account` | id, customerId, bankId, ownerNode (owner{k}), walletName (e.g. alice), tokenType (SWR), created |
| `bank` | id (001/002), name (banka/bankb), msp (Bank1MSP/Bank2MSP), ownerNode (owner1/owner2), created |
| `transactionLog` | id, fromAccount, toAccount, amount, status, tokenTxId, timestamp |

## 10. Deliverables

1. **Working network** — a live Hyperledger Fabric network run by the central bank and commercial banks.
2. **Working currency** — SWR tokens that can be issued, transferred (including between banks), and redeemed.
3. **Customer wallet** — send, receive, balance, and history in a web app.
4. **Admin consoles** — central-bank and bank dashboards for issuing, monitoring, and reporting.
5. **Compliance foundations** — customer onboarding, KYC status, limits, and freeze capability.
6. **Documentation** — architecture, decisions, API reference, and operating guides.
7. **Performance report** — measured throughput and latency, with tuning recommendations.

## 11. Timeline (overall estimate)

- **Working demonstration** — approximately **2 weeks** after setup begins: central bank + two banks + customer wallets + admin console + explorer, running on development machines.
- **Comprehensive system** — approximately **1–3 months** after the demonstration: full banking features, compliance engine, interbank settlement, stronger consensus, and a distributed deployment across the lab network.
- **Hardening** — ongoing: performance benchmarking, security review, and production-readiness improvements.

## 12. Success criteria

The project is successful when we can show, end to end:

- the **central bank issues** digital money to banks and **redeems** it;
- **customers pay each other**, including **across banks**, with settlement recorded on the shared ledger;
- **transactions are private** to the parties yet **fully visible to the central bank** for supervision;
- the system is **measured and documented** (throughput, latency, reliability);
- the design is a credible foundation for a **national-scale** CBDC.

---

*This document is the high-level project plan. More detailed technical documentation is maintained alongside it for the build team.*
