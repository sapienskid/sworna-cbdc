# Automated Docker Bank Onboarding Architecture & Design

**Date:** 2026-09-05  
**Status:** Approved for Implementation  
**Authors:** Sworna Core Architecture Team  

---

## 1. Context & Motivation

In previous iterations of the Sworna CBDC stack:
- Onboarding required SSH access (`scripts/add-bank.sh`) from the Central Bank VM to Commercial Bank VMs.
- Adding subsequent banks required multi-bank co-signing loops because the channel admin policy was set to `MAJORITY Admins`.
- Credential distribution required manual `.tar.gz` bundles transferred over SSH or physical media.
- Several core components (backend FastAPI and web portal) ran as host processes rather than in containers.

### Goals of this Design
1. **100% Dockerized:** All components (Fabric orderer/peers, CAs, Token engines, FastAPI backends, and React web portals) run exclusively in Docker containers.
2. **Network Agnostic & Zero-SSH:** Works seamlessly over Tailscale, lab LANs, or public WANs. No SSH keys or remote shell access between institutions/VMs.
3. **Sovereign Central Bank Channel Governance:** The Central Bank can admit any number of banks dynamically without needing existing banks to co-sign or be reachable over SSH.
4. **Transparent Credential Streaming:** Idemix wallet keys and TLS certificates are transferred automatically over secure HTTP APIs—eliminating manual bundle files.
5. **Two-Stage or Zero-Touch Admission:** Supports both an interactive 1-click **"Approve & Admit"** UI in the Central Bank Portal (for educational workshops) and an automated `--auto-admit` flag.

---

## 2. Architecture & Networking

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CENTRAL BANK VM (Docker: host networking)                                   │
│ • Orderer (:7050), CB Peer0 (:7051), Token CA (:27054)                      │
│ • Issuer FSC (:9100/9101), Auditor FSC (:9000/9001)                         │
│ • CB Backend API (:8100) + Central Bank Web Portal (:5273)                  │
│                                                                             │
│  [POST /api/v1/onboarding/apply] ◄────────────── (1) Submit Public Org MSP  │
│  [Auto-Admit OR 1-Click UI]       ────────────── (2) Channel Delta & Mint   │
│  [GET /api/v1/onboarding/{code}/credentials] ◄── (3) Stream Keys & Certs    │
└─────────────────────────────────────────────────────────────────────────────┘
                               ▲
                   Any Network (Tailscale / LAN)
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ COMMERCIAL BANK VM (Docker: host networking)                                │
│ Command: ./bin/sworna-bank up --code <00k> --cb-host <CB_IP>                │
│                                                                             │
│ 1. Auto-detects routable IP (Tailscale 100.x.y.z or local LAN)               │
│ 2. Spawns Bank CA container -> Enrolls local Bank{k}MSP keys                │
│ 3. Submits public org definition (JSON) to CB API                           │
│ 4. Polls CB API -> Receives credentials (Idemix wallets + TLS certs)        │
│ 5. Spawns Peer container -> Fetches genesis block & joins settlement channel│
│ 6. Spawns CCAAS Chaincode container & FSC Owner Engine (:9200+100*(k-1))    │
│ 7. Spawns Bank Web Portal container (:5173) -> Ready for banking            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Network Strategy: `network_mode: host`
All containers on the Linux VMs use `network_mode: host`:
- Containers share the VM's network namespace and bind directly to assigned ports.
- Bypasses Docker bridge NAT collisions and port-forwarding issues.
- Containers can resolve `/etc/hosts` and communicate over Tailscale interfaces natively.

---

## 3. Sovereign Channel Administration (Unlimited Banks)

### Channel Admin Policy Update
In `network/configtx/configtx.yaml`:
```yaml
Application: &ApplicationDefaults
  Policies:
    Readers:
      Type: ImplicitMeta
      Rule: "ANY Readers"
    Writers:
      Type: ImplicitMeta
      Rule: "ANY Writers"
    Admins:
      Type: Signature
      Rule: "OR('CentralBankMSP.admin')"
```

### Why this enables infinite scaling:
- **No Co-Signing Deadlock:** When Bank 002 is added, Central Bank does not need signatures from Bank 001. Central Bank's signature alone fulfills `OR('CentralBankMSP.admin')`.
- **Zero-Downtime Admission:** Any bank can register and join dynamically on a live network.
- **Immediate Endorsement Participation:** Central Bank re-approves the token chaincode with an updated policy `OR('CentralBankMSP.peer', ..., 'Bank{N}MSP.peer')`.

---

## 4. Backend API Specifications

### 1. Registration (`POST /api/v1/onboarding/apply`)
Commercial bank submits its public MSP JSON and network endpoint:
```json
{
  "bank_code": "001",
  "legal_name": "Bank Alpha",
  "msp_id": "Bank1MSP",
  "owner_node": "owner1",
  "peer_endpoint": "100.x.x.11:9051",
  "portal_url": "http://100.x.x.11:5173",
  "public_msp_json": { ... },
  "pool_size": 10
}
```
If `SWORNA_AUTO_ADMIT=1` is set on the Central Bank backend, the application transitions directly to monetary approval and security admission.

### 2. Admission (`POST /api/v1/onboarding/applications/{code}/approve-admission`)
Central Bank CISO / Admin executes:
1. Writes public MSP JSON to `network/bank{k}-org.json`.
2. Executes channel configuration update via `onboard-bank.sh` (using sovereign `CentralBankMSP.admin` signature).
3. Provisions the Idemix token wallet pool via the Token CA.
4. Triggers `commit-chaincode.sh` so the endorsement policy includes the new bank.
5. Updates status to `approved`.

### 3. Credential Streaming (`GET /api/v1/onboarding/applications/{code}/credentials`)
Returns base64-encoded archive or JSON containing:
- Orderer TLS CA certificate (`tlsca.sworna.example.com-cert.pem`).
- Auditor and Issuer public certificates.
- Minted Idemix wallet keys for `owner{k}` (`fsc`, `pool_{code}_w1` through `w{pool_size}`).

---

## 5. Bank Client Engine (`sworna-bank up`)

A unified script/runner that performs the bank-side lifecycle:
1. **Pre-flight & IP Detection:** Queries default routable IP (or accepts `--my-host`).
2. **Local Key Generation:** Runs Bank CA container in Docker, runs `registerEnroll-bank.sh` to generate local keys that **never leave the bank VM**.
3. **Application:** Submits public MSP JSON to `http://<CB_HOST>:8100/api/v1/onboarding/apply`.
4. **Polling:** Checks application status until `approved`.
5. **Credential Import:** Downloads credentials from `/credentials` endpoint and unpacks into `token-services/keys/owner{k}`.
6. **Channel Join & Services:**
   - Starts Bank Peer container.
   - Fetches genesis block from Orderer and joins channel `settlement`.
   - Starts CCaaS chaincode container.
   - Generates engine configuration and starts `owner{k}` FSC container.
   - Starts Bank Web Portal container (`sworna-bank-web`) on port `5173`.

---

## 6. Verification & Test Plan

1. **Unit & API Tests:**
   - Test `/onboarding/apply` with valid and invalid payloads.
   - Test `/credentials` endpoint access control (must return 400/403 if application is not approved).
2. **End-to-End Multi-VM Verification:**
   - Deploy Central Bank container stack (`sworna cb init`).
   - Run `sworna-bank up --code 001` on Bank VM 1.
   - Verify 1-click admission in Central Bank Portal.
   - Run `sworna-bank up --code 002` on Bank VM 2.
   - Execute interbank ZKP transfer from Bank 001 to Bank 002.
   - Verify balances on both bank portals and the Central Bank Auditor portal.
