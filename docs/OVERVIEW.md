# Sworna — A Central Bank Digital Currency Prototype (Team Overview)

> A plain-language overview of the whole project. If you only read one document, read this one.
> For the detailed technical docs, see the rest of the `docs/` folder.

---

## 1. What is a CBDC?

A **Central Bank Digital Currency (CBDC)** is digital money issued by a central bank. Think of it as the digital version of cash: it is a **direct liability of the central bank** (like physical notes), but it lives in digital form and can be transferred electronically.

Why does a country want one?

- Faster and cheaper payments, working **24/7** (the current interbank systems often run only during business hours).
- More people reachable digitally (financial inclusion).
- The central bank keeps control of the national currency in a world of private digital money (stablecoins, etc.).
- Programmable and traceable money (subject to privacy safeguards).

## 2. What we are building — "Sworna"

**Sworna** is a prototype of a full CBDC banking system for the **Nepali rupee** concept, built on **Hyperledger Fabric** (an enterprise blockchain platform used by real central-bank pilots).

In plain terms: we are building a small but complete **digital money system** where:

- the **central bank** creates and destroys money,
- **commercial banks** hold money and serve customers,
- **customers** use a **digital wallet** to pay each other — instantly, including between different banks,
- the **central bank can see the whole system** for supervision, while banks and customers keep their financial details private.

This mirrors how cash and banking work today — just fully digital and running on a shared, tamper-proof ledger.

## 3. Why Hyperledger Fabric?

| Requirement | Why Fabric fits |
|---|---|
| Permissioned — only trusted institutions participate | Yes, Fabric is built for closed, regulated networks |
| Banks + central bank each run their own node | Yes — multi-organization design |
| Privacy between banks | Yes — private data and Zero-Knowledge Proofs |
| Real-world proof | Used by a real central-bank pilot (Philippines "Project Agila") |
| Enterprise support | Backed by the Linux Foundation |

We also chose **privacy by default**: transaction amounts and parties are hidden on the ledger (using Zero-Knowledge Proofs) but can be seen by the central bank for oversight — a balance that real CBDCs need.

## 4. How the money works — two tiers

```
                    TIER 1  (wholesale / interbank)
   ┌───────────────────────────────────────────────────┐
   │               CENTRAL BANK                        │
   │   creates (issues) money ──►  destroys (redeems)  │
   └──────────────┬──────────────────────┬─────────────┘
                  │ issues SWR            │ redemptions
                  ▼                        ▲
        ┌─────────┴──────┐      ┌─────────┴──────┐
        │  COMMERCIAL    │      │  COMMERCIAL    │
        │  BANK 1        │◄────►│  BANK 2 …  N   │  ← banks pay each other (settlement)
        └─────────┬──────┘      └─────────┬──────┘
                  │                       │
                    TIER 2  (retail / customers)
                  │                       │
         ┌─────────▼──────┐      ┌─────────▼──────┐
         │  customers     │      │  customers     │  ← customers pay each other
         │  (wallets)     │      │  (wallets)     │
         └────────────────┘      └────────────────┘
```

- **Tier 1:** the central bank issues SWR to banks and redeems it back. Banks settle with each other.
- **Tier 2:** banks hand money to customers, who pay each other through digital wallets.

## 5. The overall architecture

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
   │    │  Bank 1 service     │      │  Bank 2 … N services │ │
   │    │  (customer wallets) │      │  (customer wallets)  │ │
   │    └───────────┬─────────┘      └─────────────┬────────┘ │
   │                └──────────┬───────────────────┘         │
   │                     banks talk privately                │
   └────────────────────────────┼────────────────────────────┘
                                │
   ┌────────────────────────────┼────────────────────────────┐
   │    HYPERLEDGER FABRIC  —  shared, tamper-proof ledger   │
   │    Orderer (agreement) · Peers (one per org)            │
   │    Token chaincode verifies every transaction           │
   └─────────────────────────────────────────────────────────┘

   Plus: React wallet app (customers) · CB/bank admin consoles
```

The idea: banks negotiate payments privately between themselves, then record the **proof** of the payment on the shared ledger where it cannot be changed and can be audited.

## 6. Who is who in the network

| Player | Role in the network | What they can do |
|---|---|---|
| **Central bank** | Issuer + Auditor | Create/destroy money; see the whole system; approve every transaction; onboard banks |
| **Commercial bank k** | Owner node (wallets) + own network node | Holds money for its customers; processes their payments |
| **Customers** | Wallet users | Send and receive money through an app |

## 7. The full banking system — what we are ultimately building

The prototype grows into a **full banking system**. Six big areas:

1. **Money core** — issue, transfer, redeem (the heart of the system)
2. **Central bank** — issuance, supervision, reports, monetary-policy tools (interest, limits)
3. **Commercial banks** — customer accounts, interbank settlement, reconciliation
4. **Retail / customers** — wallet app, payments (incl. QR), statements
5. **Compliance & risk** — KYC, anti-money-laundering, sanctions, freezing funds
6. **Infrastructure** — security, monitoring, backups, performance testing

Each area is built in stages — the first stage focuses on the money core + basic apps; the rest follow in later phases.

## 8. The roadmap — phases

```
NOW                      WEEK 1-2              MONTHS 1-3              CONTINUOUS
──────────────────────────────────────────────────────────────────────────────────
Phase 1          │   Phase 2-3         │   Phase 4               │   Phase 5-6
────────         │   ─────────         │   ─────────             │   ─────────
Documentation    │   Working demo      │   Full banking system   │   Performance,
& planning       │   (prototype)       │   + BFT consensus       │   security,
(we are here)    │                     │   + compliance engine   │   and beyond
```

| Phase | Name | What happens | Who cares |
|---|---|---|---|
| **1** | Documentation & planning | The full plan, architecture, and decisions written down | Everyone |
| **2** | Foundation | Prove the tech stack works on our laptops | Engineers |
| **3** | Prototype | Central bank + commercial banks (each on its own VM), wallets, admin console | Everyone — demo day |
| **4** | Comprehensive system (1–3 months) | Full banking features, stronger consensus, compliance, more machines | Everyone |
| **5** | Performance & security | Benchmarks, tuning, hardening | Engineers |
| **6** | Future vision | Offline payments, cross-border, production readiness | Leadership |

## 9. How a bank joins the network

Onboarding a new commercial bank is a live operation — the network keeps running:

1. The **central bank** registers the bank and mints its wallet keys.
2. The **bank** stands up its own node on its own machine and generates its own identity.
3. The **central bank** admits the bank's org to the shared ledger — no downtime.
4. The **bank** connects, and its customers can immediately hold and pay with SWR.

## 10. Tech at a glance

| Layer | What it is | Language |
|---|---|---|
| Shared ledger | Hyperledger Fabric v3.1 (permissioned blockchain) | Go (prebuilt) |
| Token layer | Issue / transfer / redeem with privacy (Zero-Knowledge Proofs) | Go (prebuilt) |
| Banking backend | Accounts, customers, admin, reports | Python (FastAPI) |
| Apps | Customer wallet, central-bank & bank consoles | React |
| Benchmarking | Measure speed & reliability | Hyperledger Caliper |

## 11. Where to go deeper

The detailed, technical documentation lives in the same `docs/` folder:

- `PHASES.md` — the step-by-step roadmap with exit criteria
- `ARCHITECTURE.md` — the technical design
- `FULL-BANKING-SYSTEM.md` — the complete subsystem list
- `API.md` — the application interfaces
- `ADRs/` — the record of every key decision (and why)

**Questions?** This overview is intentionally non-technical — ask a member of the build team and they can point you to the right level of detail.
