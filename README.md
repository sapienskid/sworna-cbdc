# Sworna CBDC

A two-tier Central Bank Digital Currency (CBDC) platform built on Hyperledger Fabric + Token-SDK.

## What It Does

- **Central Bank** issues wholesale SWR tokens to commercial banks
- **Commercial Banks** distribute retail SWR to customers via deposit
- **Customers** transfer SWR peer-to-peer, intra-bank or inter-bank
- All transfers are **zero-knowledge** (Idemix/ZKP) — amounts and identities are private
- Settled on a private blockchain (`settlement` channel)

## Master Specification (Publication-Ready)

| Document | Format | Description |
|:---|:---|:---|
| **[Master Specification Markdown](docs/SWORNA-CBDC-MASTER-SPECIFICATION.md)** | Markdown | 4,900+ lines covering macroeconomic model, UTXO mechanics, Idemix/Pedersen cryptography, Go FSC flows, FastAPI backend, and workshop runbooks |
| **[Master Specification PDF](docs/sworna-cbdc-specification.pdf)** | PDF (XeLaTeX) | Stakeholder and executive presentation document with complete math, diagrams, and verification benchmarks |
| **[Master Specification EPUB](docs/sworna-cbdc-specification.epub)** | EPUB | Full technical manual optimized for mobile and e-readers |

## Quick Start & Web Portals

### Web Portals & APIs
- **Central Bank Portal:** `http://<CB_IP>:5273` (Local: `http://localhost:5273`) — Login: `cbadmin` / `sworna-cb`
- **Central Bank Swagger API:** `http://<CB_IP>:8100/docs`
- **Commercial Bank Portals:** `http://<BANK_VM_IP>:5173/b/00k` (Local: `http://localhost:5173`) — Login: `bank{k}_admin` / `sworna-bank`
- **Retail Customer View:** `http://<BANK_VM_IP>:5173/b/00k/customer` — Login: `customer00k_1` / `customer123`

### Deploy & Verify with Single Command

```bash
# ================================================================
# 1. Central Bank Host (Orderer, CB Peer, CCaaS, Issuer, Auditor, Backend :8100, Portal :5273)
# ================================================================
./bin/sworna cb init --provision

# ================================================================
# 2. Commercial Bank Host (Any new VM — 100% Dockerized 1-Step Onboarding):
# ================================================================
./bin/sworna bank join --code 001 --cb-host <CB_IP>
# (Or directly: ./scripts/bank-docker.sh up 001 <CB_IP>)

# ================================================================
# 3. Automated End-to-End Verification (Mint + ZKP Transfer + Balance Audit)
# ================================================================
./bin/sworna test e2e
```

### Documentation Index
- **[docs/DEMO_AND_UI_GUIDE.md](docs/DEMO_AND_UI_GUIDE.md)**: Browser portal URLs, credentials, UI field definitions, and presentation script.
- **[docs/SETUP.md](docs/SETUP.md)**: Authoritative operational setup runbook, multi-org onboarding, and troubleshooting.
- **[docs/BLIND-SIGNATURES-AND-PRIVACY.md](docs/BLIND-SIGNATURES-AND-PRIVACY.md)**: Blind signatures (Idemix/CL), Pedersen commitments, range proofs, the auditor gate.
- **[docs/AML-COMPLIANCE.md](docs/AML-COMPLIANCE.md)**: AML rule engine: KYC tiers, limits, velocity, structuring, watchlist, alerts.
- **[docs/BACKEND-INTERNALS.md](docs/BACKEND-INTERNALS.md)**: Module-by-module walk-through of the FastAPI banking layer.
- **[docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md)**: Trust model, cryptography, auth, and known limitations.
- **[docs/README.md](docs/README.md)**: Full documentation index.

## Architecture

```
Central Bank (CB VM)
  ├── Fabric Orderer           :7050
  ├── Fabric Peer (CB)         :7051
  ├── Issuer FSC               :9100 / :9101 (P2P)
  ├── Auditor FSC              :9000 / :9001 (P2P)
  ├── Token CA                 :27054
  ├── Central Bank Backend     :8100 (Docker container)
  └── Central Bank Portal      :5273 (Docker container)

Commercial Bank VMs (Banks 001..005)
  ├── Fabric Peer (Bank k)     :9051 + 2000*(k-1)
  ├── Owner FSC (owner k)      :9200 + 100*(k-1) / :9201 + 100*(k-1) (P2P)
  ├── Bank Fabric CA           :20054 + k
  └── Bank Web Portal          :5173 (Docker container)
```

## Network & Lab/Workshop Setup

In computer labs and multi-VM workshops, VMs communicate seamlessly over **Tailscale** (mesh VPN):

- **Zero configuration on student VMs:** Students do not need individual Tailscale accounts. Generate a single **Reusable Auth Key** from your [Tailscale Admin Console](https://login.tailscale.com/admin/settings/keys) (`tskey-auth-xxxx`).
- **1-Command Connection:**
  ```bash
  curl -fsSL https://tailscale.com/install.sh | sh
  sudo tailscale up --authkey <REUSABLE_AUTH_KEY>
  ```
- **VirtualBox Networking:** Keep VirtualBox in default **NAT** mode. Enterprise lab Wi-Fi and Ethernet switches frequently block "Bridged Networking" (due to 802.11 MAC restrictions and 802.1X port security). NAT + Tailscale bypasses all firewalls and AP isolation.
- **Dynamic Routing:** `bank join` automatically queries the kernel routing table for `CB_HOST` to select the correct interface IP (`100.x.y.z` or LAN) without manual IP overrides.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Hyperledger Fabric v3.1 (BFT ordering) |
| Token Protocol | Hyperledger Labs Token-SDK (DLOG ZKP) |
| Smart Contract | Go (CCAAS) |
| Backend API | Python / FastAPI |
| Frontend | React + Vite + Tailwind + shadcn/ui |
| Networking | Tailscale mesh VPN |
| Infrastructure | Docker Compose v2 |

## Key Design Decisions

- **CB never touches retail accounts** — minting goes strictly to bank master reserve vaults (`RESERVE-{k}` / `pool_00k_w1`); retail customer accounts are strictly isolated (`pool_00k_w2..wN`)
- **UTXO change-splitting** — transactions spend tokens in full, returning fresh change notes to sender under zero-knowledge proofs
- **Banks self-provision** their Fabric org (peer/admin keys never leave their VM)
- **Token-SDK Idemix** provides unlinkable ZK proofs for all token operations
- **Multi-org channel updates** require co-signatures from all existing members (Fabric policy)
- **1-Command Dockerized Onboarding** — `./bin/sworna bank join --code 00k --cb-host <CB_IP>` eliminates host runtime dependencies
- **Scripts are idempotent** — re-running deploy or join steps is always safe

## Development & Multi-VM Update Workflow

When making enhancements or updating code across multiple machines:
1. **Develop and test locally**:
   ```bash
   cd web && npm run build
   ```
2. **Commit and push to GitHub**:
   ```bash
   git add .
   git commit -m "feat/fix: description of changes"
   git push origin main
   ```
3. **Update any running VM with a single pull & restart**:
   ```bash
   ssh user@<VM_IP>
   cd ~/sworna-cbdc
   git pull origin main
   docker build -t sworna-web:latest ./web
   # Restart container:
   docker restart sworna-cb-web          # on Central Bank VM
   # Or on Bank VM:
   docker restart sworna-bank-web-00k    # e.g. sworna-bank-web-001
   ```

## Verification

After full deployment, run the checks in [docs/SETUP.md §7](docs/SETUP.md#7-verification-checklist).

Success criteria:
- All containers healthy
- Chaincode committed with all org approvals
- Mint → Deposit → P2P transfer succeeds end-to-end (`./bin/sworna test e2e`)

## Troubleshooting

See [docs/SETUP.md §9](docs/SETUP.md#9-troubleshooting) for a full table of failure modes and fixes.

