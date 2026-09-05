# Sworna CBDC

A two-tier Central Bank Digital Currency (CBDC) platform built on Hyperledger Fabric + Token-SDK.

## What It Does

- **Central Bank** issues wholesale SWR tokens to commercial banks
- **Commercial Banks** distribute retail SWR to customers via deposit
- **Customers** transfer SWR peer-to-peer, intra-bank or inter-bank
- All transfers are **zero-knowledge** (Idemix/ZKP) — amounts and identities are private
- Settled on a private blockchain (`settlement` channel)

## Quick Start

- **[docs/DEMO_AND_UI_GUIDE.md](docs/DEMO_AND_UI_GUIDE.md)**: Browser portal URLs, login credentials, UI field definitions, and step-by-step presentation script.
- **[docs/SETUP.md](docs/SETUP.md)**: Authoritative operational setup runbook, multi-org onboarding, and troubleshooting.
- **[docs/README.md](docs/README.md)**: full documentation index, including the deep dives below.

### Deep Dives

- **[docs/BLIND-SIGNATURES-AND-PRIVACY.md](docs/BLIND-SIGNATURES-AND-PRIVACY.md)** — how the blind-signature / zero-knowledge privacy layer works, step by step.
- **[docs/AML-COMPLIANCE.md](docs/AML-COMPLIANCE.md)** — the AML rule engine: KYC tiers, limits, watchlist screening, alerts.
- **[docs/BACKEND-INTERNALS.md](docs/BACKEND-INTERNALS.md)** — module-by-module walk-through of the FastAPI banking layer.
- **[docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md)** — trust model, cryptography, auth, and known limitations.
- **[docs/FRONTEND.md](docs/FRONTEND.md)** — the three-portal React app: architecture and conventions.

### Web Portals & APIs

- **Central Bank Portal:** `http://localhost:5273` (or `http://<CB_IP>:5273`) — `cbadmin` / `sworna-cb`
- **Central Bank API:** `http://localhost:8100/docs` (Swagger UI)
- **Commercial Bank Portals:** `http://localhost:5173` on each bank VM (or `http://<CB_IP>:5273/b/001` through `/b/005` in sandbox mode)

### Deploy & Verify with `sworna-cli`

```bash
# 1. Central Bank VM (Orderer, CB Peer, CCaaS, Issuer, Auditor, Backend :8100, Portal :5273)
./bin/sworna cb init --provision

# 2. Verify all Central Bank services
./bin/sworna cb status

# 3. Add a commercial bank (100% Dockerized 1-Step Onboarding):
# On Bank VM:
./bin/sworna bank join --code 001 --cb-host <CB_IP>
# Central Bank approves onboarding with 1 click via Web Portal (http://<CB_IP>:5273)

# 4. Run automated End-to-End verification (Wholesale Mint + ZKP Transfer + Balance Check)
./bin/sworna test e2e
```

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

- **CB never touches retail accounts** — minting goes to bank reserve wallets (`pool_00k_w1`) only
- **Banks self-provision** their Fabric org (peer/admin keys never leave their VM)
- **Token-SDK Idemix** provides unlinkable ZK proofs for all token operations
- **Multi-org channel updates** require co-signatures from all existing members (Fabric policy)
- Scripts are **idempotent** — re-running `deploy-bank.sh` or `onboard-bank.sh` is safe

## Verification

After full deployment, run the checks in [docs/SETUP.md §7](docs/SETUP.md#7-verification-checklist).

Success criteria:
- All containers healthy
- Chaincode committed with all 3 org approvals (`Bank1MSP: true, Bank2MSP: true, CentralBankMSP: true`)
- Mint → Deposit → P2P transfer succeeds end-to-end

## Troubleshooting

See [docs/SETUP.md §9](docs/SETUP.md#9-troubleshooting) for a full table of failure modes and fixes.

Most common issues:
- **`reading from file .../owner1/fsc/.../cert.pem failed`** — copy sibling bank's public cert to the bank VM
- **`policy not satisfied: 1 sub-policy satisfied, requires 2`** — onboard-bank.sh must collect co-sigs from existing banks
- **`chaincode registration failed`** — CCAAS container package ID must exactly match `peer lifecycle chaincode queryinstalled` output
