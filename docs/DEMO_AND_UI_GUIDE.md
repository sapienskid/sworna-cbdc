# Sworna CBDC — Demo Runbook & UI Reference Guide

> **Official Guide for Demonstrating the Two-Tier Distributed CBDC System**  
> Hyperledger Fabric + Fabric Token-SDK (Zero-Knowledge Idemix Proofs)  
> Central Bank ↔ Commercial Banks (Bank A & Bank B) ↔ Retail Customers

---

## Table of Contents

1. [Access Links & Credentials](#1-access-links--credentials)
2. [Central Bank UI Field Reference](#2-central-bank-ui-field-reference)
3. [Cryptographic Signatures Explained](#3-cryptographic-signatures-explained)
4. [Two-Tier Privacy Architecture](#4-two-tier-privacy-architecture)
5. [How to Onboard Customers (Bank Staff Portal)](#5-how-to-onboard-customers-bank-staff-portal)
6. [Step-by-Step Demo Script for Presentations](#6-step-by-step-demo-script-for-presentations)
7. [Verified Live Transaction Examples](#7-verified-live-transaction-examples)
8. [UI Map (2026 redesign)](#8-ui-map-2026-redesign)

---

## 1. Access Links & Credentials

All web portals are accessible directly via your web browser on **Port 8000** (or Port 5173).

### Direct Browser Portals

| Node | Browser URL | Default Role / View |
|---|---|---|
| **Central Bank** | **`http://100.72.112.29:8000`** *(or `:5173`)* | Central Bank Operator Console & Block Explorer |
| **Commercial Bank A (Bank 001)** | **`http://100.111.120.73:8000`** | Bank A Staff Console & Retail Customer Portal |
| **Commercial Bank B (Bank 002)** | **`http://100.71.149.60:8000`** | Bank B Staff Console & Retail Customer Portal |

---

### Complete Login Credentials

| Institution / Account | Username | Password | Role | Account Number | Initial Demo Balance |
|---|---|---|---|---|---|
| **Central Bank Admin** | `cbadmin` | `sworna-cb` | `cb_admin` | — | Total Supply: `25,000+ SWR` |
| **Bank A Staff** | `bankadmin` | `sworna-bank` | `bank_staff` | `RESERVE-001` | Bank A Vault |
| **Bank A Customer (Alice)** | `alice` | `alice123` | `customer` | `SWR-001-00000001` | **`1,100.00 SWR`** |
| **Bank A Customer (Bob)** | `bob` | `bob123` | `customer` | `SWR-001-00000002` | **`0.00 SWR`** |
| **Bank B Staff** | `bankadmin` | `sworna-bank` | `bank_staff` | `RESERVE-002` | **`20,000.00 SWR`** |
| **Bank B Customer (Charlie)** | `charlie` | `charlie123` | `customer` | `SWR-002-00000001` | **`5,150.00 SWR`** |

> Passwords are per-deployment values (customer passwords are chosen by bank
> staff at onboarding; the CB admin bootstrap password is
> `SWORNA_CB_ADMIN_PASSWORD`). The login screen intentionally shows no
> credentials — this table is the single source for the demo.

---

## 2. Central Bank UI Field Reference

When logged in as `cbadmin`, the **"All banks on the network"** table displays the consortium members:

| Field | Meaning & Purpose |
|---|---|
| **Bank** | Legal registered name of the financial institution and its 3-digit CBDC routing code (e.g. `bankpt / 001`, `bankpp / 002`). |
| **MSP** | **Membership Service Provider ID** in Hyperledger Fabric (`Bank1MSP`, `Bank2MSP`). Identifies the organization's cryptographic root of trust on the consortium ledger. |
| **Owner node** | The **Fabric Smart Client (FSC)** node name (`owner1`, `owner2`) running inside the bank's VM. The owner node manages the bank's UTXOs and executes peer-to-peer transfers with counterparty banks. |
| **Status** | `active` indicates the bank is healthy and permitted to transact. The CB can toggle this to `suspended` to freeze an institution during regulatory actions. |
| **Joined** | Exact date when the commercial bank was admitted to the `settlement` channel. |
| **Actions** | **Provision keys** (mint the bank's missing token-CA identities: its owner-node FSC identity + Idemix pool wallets — idempotent) and **Permissions** (`can_redeem`, interbank/redeem limits). The **Register bank** button adds a new consortium member to the registry before its VM deployment. |
| **Status — suspended** | A suspended bank's payments, deposits, withdrawals and onboarding are refused at the API until reactivated. |

### Why Pre-Provisioned Token Pools Exist (The 10 Wallets)
In Zero-Knowledge CBDC architectures using **Idemix**, generating a user wallet requires a cryptographic credential issued by the Central Bank Token CA. 
- **The Problem:** If a bank had to request a new cryptographic signature from the Central Bank CA every time a retail citizen walked in to open an account, the Central Bank would become a single point of failure and bottleneck.
- **The Solution:** During bank onboarding, the Central Bank CA pre-provisions an **Idemix Key Pool** (e.g., 10, 50, 100 wallets) to the commercial bank.
  - `pool_00k_w1`: Reserved as the Bank's Master Reserve Vault.
  - `pool_00k_w2..wN`: Allocated instantly to retail customers as they onboard without any network lag or CA dependency.
- **UI Simplification:** The internal pool count is an underlying cryptographic detail and has been streamlined from the Central Bank governance table.

## 3. Cryptographic Signatures Explained

Transactions in Sworna CBDC combine 4 layers of cryptographic signatures:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TRANSACTION LIFECYCLE                           │
│                                                                        │
│  1. Idemix Owner Proof    --> Spending Authorization (ZKP Privacy)     │
│  2. Auditor Signature     --> Zero-Knowledge Conservation Proof        │
│  3. Issuer Signature      --> Authorized Digital Currency Minting      │
│  4. Fabric Endorsements   --> Consortium Multi-Org Ledger Finality     │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Central Bank Issuer Signature**:
   - Cryptographically certifies newly minted digital tokens during wholesale issuance.
2. **Auditor Signature (Zero-Knowledge Validation)**:
   - The Central Bank Auditor verifies the sender's mathematical ZK-proof (confirming sufficient funds without double-spending) and attaches an audit signature *without ever seeing the sender, receiver, or amount*.
3. **Owner (Customer / Bank) Signature**:
   - An Idemix zero-knowledge pseudo-signature authorizing the token transfer without disclosing the owner's real-world identity on-chain.
4. **Fabric Peer Endorsements**:
   - Peer nodes from the involved organizations (`CentralBankMSP`, `Bank1MSP`, `Bank2MSP`) execute chaincode endorsement policies before the orderer includes the transaction in a block.

---

## 4. Two-Tier Privacy Architecture

### Why Does Central Bank Not Store Retail Customer Records?
- In compliance with BIS (Bank for International Settlements) standards and consumer privacy laws, **the Central Bank only manages commercial banks**.
- Retail customer identities, KYC records, and personal account mappings remain strictly inside the local databases of Commercial Bank A and Commercial Bank B.
- On the shared blockchain ledger, transfers occur between anonymous Idemix identities, ensuring strict privacy for citizens.

---

## 5. How to Onboard Customers (Bank Staff Portal)

Customer account opening is conducted within each commercial bank's staff console:

1. Open **`http://100.111.120.73:8000`** (for Bank A) or **`http://100.71.149.60:8000`** (for Bank B).
2. Log in with **`bankadmin`** / **`sworna-bank`**.
3. Click the **"Onboard Customer"** button.
4. Fill in:
   - **Full Name:** (e.g. `Ram Sharma` or `Sita Thapa`)
   - **Username & Password:** Customer login credentials
   - **KYC Level:** Level 1, 2, or 3
   - **Transfer Limit:** Maximum single transfer limit
5. Click **Submit**. The bank immediately assigns the next unused Idemix wallet from its pool (`pool_00k_wX`) and generates a structured account number (`SWR-00k-0000000X`).

---

## 6. Step-by-Step Demo Script for Presentations

Follow this flow for an impressive and flawless demonstration:

### **Part 1: The Central Bank Macro View (2 mins)**
1. Open **`http://100.72.112.29:8000`** in your browser.
2. Log in as **`cbadmin`** / **`sworna-cb`**.
3. **Showcase:**
   - **Circulation & Reserve Dashboard:** Total money supply and active commercial bank reserves.
   - **Consortium Members:** Bank 001 (`Bank1MSP`) and Bank 002 (`Bank2MSP`) status.
   - **Live Ledger Tab:** Show real-time blocks (height 45+) committed on the `settlement` channel with cryptographic transaction hashes.

---

### **Part 2: Commercial Bank Operations & Reserves (2 mins)**
1. Open a new browser tab or window at **`http://100.71.149.60:8000`** (Bank B).
2. Log in as **`bankadmin`** / **`sworna-bank`**.
3. **Showcase:**
   - **Master Reserve Vault:** Shows `20,000.00 SWR` wholesale reserve minted by the Central Bank.
   - **Customer Directory:** Displays registered customer Charlie (`SWR-002-00000001`).
   - *(Optional)* Execute a `500.00 SWR` retail deposit from the Reserve Vault to Charlie.

---

### **Part 3: Zero-Knowledge Interbank Settlement (The Highlight — 3 mins)**
1. Open a new window at **`http://100.111.120.73:8000`** (Bank A).
2. Log in as customer **`alice`** (`alice123`).
   - Alice is on **Bank A** (`SWR-001-00000001`).
3. Click **"Transfer"** and input:
   - **Destination Account:** `SWR-002-00000001` *(Charlie on Bank B)*
   - **Amount:** `100.00`
   - **Reference:** `Interbank Payment Demo`
4. Click **Send Transfer**.
5. **Watch the live settlement:**
   - In ~8 seconds, the transaction is verified by the Central Bank Auditor via Zero-Knowledge Proofs, endorsed across peer organizations, and committed to Block #46+.
   - Alice's balance instantly decrements.
6. Open **`http://100.71.149.60:8000`**, log in as **`charlie`** (`charlie123`).
   - Charlie's balance instantly reflects the **`+100.00 SWR`** credit!

---

### **Part 4: AML Compliance Console (2 mins)**
1. Back in the CB console, open **Supervision → AML Compliance**.
2. **Showcase:**
   - **Alert queue:** large-transaction / velocity / structuring hits raised by the rule engine, filterable by severity and status; **Review** or **Dismiss** one live.
   - **Watchlist:** add a `sanction` entry, then (as bank staff) try onboarding that name → refused; a PEP name → account opens **flagged**.
   - **KYC tier table:** the live limits that gate every payment.
   - Full details: `docs/AML-COMPLIANCE.md` (rules fire automatically as payments flow — no manual setup needed).

### **Part 5: Privacy & Cryptography Page (1 min)**
1. Open **Supervision → Privacy & Cryptography**.
2. **Showcase:**
   - **Live public parameters** of the token chaincode (Pedersen generators, range-proof base 300^5, Idemix issuer key, auditor cert — all fingerprinted).
   - The three one-paragraph explainers: blind signatures, hidden amounts, auditor gate.
   - Tie it back to §3 above: this page is the *proof*, the explainer is the *story*.

---

## 7. Verified Live Transaction Examples

All flows below have been executed and cryptographically committed on the multi-node network:

| Operation | From | To | Amount | Ledger Tx ID | Status |
|---|---|---|---|---|---|
| **Wholesale Mint** | Central Bank | Bank B Vault (`pool_002_w1`) | `25,000 SWR` | `ae771171d84635d3d59c03f9ab83bb52469566eb936bab3f0b85a2010569eac3` | **Confirmed** |
| **Retail Deposit** | Bank B Vault | Charlie (`SWR-002-00000001`) | `5,000 SWR` | `8fb3de4321e43a755ec035c96c7cd9ee333b6a13b098c87c04dd30f7a04f9a14` | **Confirmed** |
| **Interbank Transfer 1** | Alice (Bank A) | Charlie (Bank B) | `200 SWR` | `ea385293cb7ff291078012234c6123397a893527058ee1bc55bf85f5c78b6dd2` | **Confirmed (Block 43)** |
| **Interbank Transfer 2** | Alice (Bank A) | Charlie (Bank B) | `50 SWR` | `2ad6803d60df03cc381ea47b277fdec7c79983b67582e3b5e786ab1e4dfcb47d` | **Confirmed (8s)** |
| **Interbank Return** | Charlie (Bank B) | Alice (Bank A) | `100 SWR` | `f9a11dd977a7f02858c9276364d44505a8afff12313cf22c1f5cf56c5ef3c555` | **Confirmed (8s)** |

## 8. UI Map (2026 redesign)

The UI was rebuilt around URL-based navigation (every tab is a real route —
deep-linkable and refresh-safe) with a monochrome shadcn design system.

### Central Bank console (`/cb`)

| Section | Page | What it shows |
|---|---|---|
| Oversight | Dashboard | M0 supply, bank count, **live token-layer parameters** (no more static badges), mint / allocate / burn / reserves tabs, burn requires confirmation |
| Oversight | Banks | Registry + register bank, provisioning, permissions, suspend |
| Oversight | Ledger & Transactions | Ledger monitor (channel height, blocks), 14-day volume chart, searchable/filterable transaction table, CSV export |
| Supervision | AML Compliance | Alert queue, watchlist manager, KYC tier table (see `docs/AML-COMPLIANCE.md`) |
| Supervision | Privacy & Cryptography | Live zk public params + wallet credential fingerprints + protocol explainers |
| Administration | Staff & Access | CB staff RBAC management |

### Bank staff console (`/b/00k`)

- **Overview**: reserve KPI, AML watch KPI (flagged count), cash-in / cash-out
  forms, transfer form.
- **Customer accounts**: registry with live on-ledger balances (batched),
  KYC tier, per-tx limit, status badges (flagged = payments blocked), freeze /
  unfreeze, CSV export.
- Customer passwords are set at onboarding; names are watchlist-screened.

### Customer wallet (`/b/00k` as customer)

Balance card, **Send** (with KYC-limit hints), **Receive** with a real account
QR code, **Cash Out**, statement history with CSV export. Auto-refreshes every
30 s.

### Conventions

- Topbar shows a live UTC clock, network status badge, and a dark-mode toggle.
- All money renders via one formatter (Nepali-style grouping, 2 decimals).
- Demo credentials are no longer displayed on the login screen — keep
  §1's table with you during the demo.
- Architecture/conventions: `docs/FRONTEND.md`.
