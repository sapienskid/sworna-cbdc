# Sworna CBDC

A two-tier Central Bank Digital Currency (CBDC) platform built on Hyperledger Fabric + Token-SDK.

## What It Does

- **Central Bank** issues wholesale SWR tokens to commercial banks
- **Commercial Banks** distribute retail SWR to customers via deposit
- **Customers** transfer SWR peer-to-peer, intra-bank or inter-bank
- All transfers are **zero-knowledge** (Idemix/ZKP) — amounts and identities are private
- Settled on a private blockchain (`settlement` channel)

## Quick Start

See **[docs/SETUP.md](docs/SETUP.md)** for the full setup guide.

### Deploy Order

```
# 1. Central Bank VM
./scripts/deploy-centralbank.sh --provision

# 2. Bank VM (generates bank-org.json)
SWORNA_CB_HOST=<CB-IP> ./scripts/deploy-bank.sh 001

# 3. CB VM (add bank to channel — auto-collects co-sigs from existing banks)
SWORNA_OWNERS="owner1" SWORNA_OWNER_OWNER1_HOST=<BANK-IP> \
  ./scripts/onboard-bank.sh Bank1MSP network/bank1-org.json

# 4. Bank VM (join channel + install chaincode + start owner FSC)
SWORNA_CB_HOST=<CB-IP> SWORNA_OWNERS="owner1" \
  SWORNA_OWNER_OWNER1_HOST=<BANK-IP> ./scripts/deploy-bank.sh 001

# 5. CB VM (commit chaincode with all banks in policy)
./scripts/commit-chaincode.sh
```

## Architecture

```
Central Bank (CB VM)
  ├── Fabric Orderer           :7050
  ├── Fabric Peer (CB)         :7051
  ├── Issuer FSC               :9100 / :9101 (P2P)
  ├── Auditor FSC              :9000 / :9001 (P2P)
  ├── Token CA                 :27054
  ├── Backend API              :8000
  └── CB Portal                :5173

Bank A VM
  ├── Fabric Peer (Bank1)      :9051
  ├── Owner FSC (owner1)       :9200 / :9201 (P2P)
  ├── Bank Fabric CA           :8054
  ├── Backend API              :8000
  └── Bank Portal              :5173

Bank B VM
  ├── Fabric Peer (Bank2)      :11051
  ├── Owner FSC (owner2)       :9300 / :9301 (P2P)
  ├── Bank Fabric CA           :9054
  ├── Backend API              :8000
  └── Bank Portal              :5173
```

## Network

All VMs communicate over **Tailscale** (encrypted mesh VPN):

| VM | Tailscale IP | Role |
|----|-------------|------|
| centralcbdc | `100.72.112.29` | Central Bank |
| bankpt | `100.111.120.73` | Bank A (001) |
| bankpp | `100.71.149.60` | Bank B (002) |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Hyperledger Fabric 2.x |
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
