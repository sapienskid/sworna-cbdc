# Distributed CBDC System: Unlimited Banks & Customer Scaling Architecture

**Date:** 2026-09-06  
**Status:** Approved for Implementation  
**Authors:** Sworna Architecture & DevOps Team  

---

## 1. Context & Motivation

In previous iterations, distributed deployment between the Central Bank and Commercial Banks encountered three recurring bottlenecks:
1. **Split-Brain Host vs. Docker Setup:** Native systemd services (`sworna-backend` on port `8000`, `sworna-web` on `5173`) collided with Docker containers (`:8100` and `:5273`), causing SQLite file ownership lockouts (`attempt to write a readonly database`).
2. **Fragile IP Discovery:** Nodes used ephemeral raw IPs (`100.x.y.z`), causing broken connections when VMs re-authenticated or changed network interfaces.
3. **Fixed Wallet Pool Limit:** Banks were provisioned with an initial pool of only 10 anonymous Idemix wallets. After 10 customer accounts were created, subsequent registrations failed with `"No free wallets"`.
4. **External Web & API Accessibility:** Accessing the web UI required client devices to be inside the Tailscale network with manual port tracking.

### Core Objectives
1. **100% Docker Deployment:** Eliminate all host-level systemd services. Run Central Bank and all Banks entirely inside Docker containers with correct file permissions.
2. **Hybrid Network Topology (Approach A + B):**
   - **P2P Blockchain & Zero-Knowledge Transport (Approach A):** Tailscale WireGuard mesh with dynamic hostname/MagicDNS discovery for Fabric gRPC and FSC inter-node TLS.
   - **Ingress Gateway (Approach B):** Ingress proxy (Cloudflare Tunnel / Tailscale Funnel / Nginx) on Central Bank to expose Web UI and APIs securely over HTTPS to external browsers.
3. **Unlimited Commercial Banks:** 1-step, non-interactive or 1-click onboarding for arbitrary bank numbers ($k \in [1, N]$) with dynamic port assignment.
4. **Unlimited Customer Accounts:** Background auto-replenishing Idemix wallet pool that mints new credentials dynamically when the free pool drops below a threshold.

---

## 2. Multi-Layer Architecture

```
                      [ INTERNET / ANY BROWSER ]
                                  │ HTTPS (443)
                                  ▼
           [ LAYER 1: Ingress Gateway on Central Bank VM ]
           Cloudflare Tunnel / Tailscale Funnel / Nginx Proxy
            • https://cbdc.example.com        → Central Bank Portal (:5273)
            • https://cbdc.example.com/b/001  → Bank 1 Portal
            • https://cbdc.example.com/b/002  → Bank 2 Portal
            • https://cbdc.example.com/api    → Central Bank API (:8100)
                                  │
  ════════════════════════════════╪════════════════════════════════════
    LAYER 2: Tailscale Mesh (Private Transport & Service Discovery)
  ════════════════════════════════╪════════════════════════════════════
                                  │
          ┌───────────────────────┴───────────────────────┐
          ▼                                               ▼
 [ Central Bank VM ]                            [ Bank VM 1..N ]
  Host: centralcbdc.ts.net                       Host: bank001.ts.net ...
  (100% Docker: network_mode: host)              (100% Docker: network_mode: host)
   • Orderer (:7050)                              • Bank Peer (:9051 + 2000(k-1))
   • CB Peer (:7051)                              • Bank CA (:20054 + k)
   • Token CA (:27054)                            • CCaaS Token Chaincode (:9999)
   • Issuer FSC (:9100 / :9101 P2P)               • FSC Owner Node (:9200 + 100(k-1))
   • Auditor FSC (:9000 / :9001 P2P)              • Local Bank Portal (:5173)
   • CB Backend API (:8100)
   • CB Web Portal (:5273)
```

### Protocol & Port Allocation Matrix

| Service | Host | Port | Network Layer | Protocol |
|---|---|---|---|---|
| Fabric Orderer | CB | `7050` | Tailscale Mesh | gRPC / mutual TLS |
| Central Bank Peer | CB | `7051` | Tailscale Mesh | gRPC / mutual TLS |
| Token CA | CB | `27054` | Tailscale Mesh | HTTP / REST |
| Auditor FSC | CB | `9000` (REST) / `9001` (P2P) | Tailscale Mesh | HTTP / P2P TLS |
| Issuer FSC | CB | `9100` (REST) / `9101` (P2P) | Tailscale Mesh | HTTP / P2P TLS |
| CB Backend API | CB | `8100` | Ingress / Mesh | HTTP / FastAPI |
| CB Web Portal | CB | `5273` | Ingress Gateway | HTTP / Nginx SPA |
| Bank Peer $k$ | Bank $k$ | $9051 + 2000(k-1)$ | Tailscale Mesh | gRPC / mutual TLS |
| Bank CA $k$ | Bank $k$ | $20054 + k$ | Tailscale Mesh | HTTP / REST |
| Bank Owner FSC $k$| Bank $k$ | $9200 + 100(k-1)$ | Tailscale Mesh | HTTP / P2P TLS |
| Bank Web Portal $k$| Bank $k$ | `5173` | Local / Ingress | HTTP / Nginx SPA |

---

## 3. Dynamic Bank Onboarding Lifecycle

### 1-Step Join Workflow
1. **Self-Identification:** On the new Bank VM:
   ```bash
   ./bin/sworna bank join --code <CODE> --cb-host <CB_HOSTNAME_OR_IP>
   ```
   The script queries Tailscale (`tailscale status --self --json` or `tailscale ip -4`) to determine its stable MagicDNS hostname / IP.
2. **Local Org MSP Generation:** Bank launches `ca_bank{k}` container, enrolls peer, admin, and user MSP identities locally, and produces `bank{k}-org.json`.
3. **Application Submission:** Bank posts its public MSP configuration to `POST /api/v1/onboarding/apply` on Central Bank API.
4. **Approval & Channel Admission:** Central Bank admin approves with 1-click in the web portal (`POST /api/v1/onboarding/applications/{code}/admit-fast`):
   - Admits `Bank{k}MSP` to the live `settlement` channel on-chain via `onboard-bank.sh`.
   - Records the bank's host in `network/bank-hosts.env` and regenerates `docker-compose.net.yaml`.
   - Provisions initial Idemix wallet pool via Token CA.
   - Re-commits the token chaincode endorsement policy via `commit-chaincode.sh`.
   - Exports the encrypted join bundle (`dist-bank-bundles/bank<CODE>.tar.gz`).
5. **Streaming & Startup:** Bank VM streams `bank<CODE>.tar.gz`, unpacks wallets and orderer TLS certs, joins the channel, starts CCaaS, starts the FSC Owner engine, and starts the containerized web portal on `:5173`.

---

## 4. Unlimited Customer Scalability: Dynamic Auto-Replenishing Pool

### The Bottleneck
Previously, `pool_size` was fixed at 10. When 10 accounts were registered, `len(wallet_pool["free"]) == 0`, causing hard failures.

### The Solution: Background Auto-Replenishment
```
[ Customer Registers ] ──► [ POST /api/v1/accounts ]
                                    │
                       Is free_pool < THRESHOLD (5)?
                                    ├─── Yes ──► [ Async Background Worker ]
                                    │                     │
                                    ▼            Calls Token CA (:27054)
                      [ Assign Wallet & Return ]  Mints Batch of 25 Wallets
                                                 Appends to Bank Free Pool
```

* **Threshold:** When `free` wallets drop below 5, a non-blocking background task triggers `replenish_wallet_pool(bank_code, batch_size=25)`.
* **Zero Customer Latency:** Account registration immediately succeeds using an available free wallet while the background task mints more.
* **Idempotency:** Unique wallet names are strictly indexed (`pool_{code}_w{seq}`) ensuring no key collisions.

---

## 5. Implementation & Execution Plan

### Phase 1: Central Bank Host Clean-Up & 100% Docker Verification
* Stop and disable `sworna-backend` and `sworna-web` systemd services.
* Reset permissions on `/home/sapiens/sworna-cbdc` to `sapiens:sapiens` (mode 664 for databases and artifacts).
* Verify CB Docker services on `:8100` (Backend) and `:5273` (Web Portal).

### Phase 2: Ingress Gateway & DNS Resolution
* Configure `gen-net-overrides.py` to support Tailscale MagicDNS hostnames.
* Expose Central Bank portal and backend via Ingress Gateway (Cloudflare Tunnel or Nginx reverse proxy).

### Phase 3: Auto-Replenishing Customer Wallet Pool
* Update `backend/app/provisioning.py` with `replenish_wallet_pool()`.
* Add background task in `backend/app/routers/accounts.py` triggered when free pool $< 5$.

### Phase 4: Commercial Bank Onboarding & Validation
* Clean up Bank 2 VM (`bankpt`). Run `./bin/sworna bank join --code 002`.
* Verify Bank 1 (`bankpp`) FSC Owner container and connectivity.
* Run end-to-end verification (`./bin/sworna test e2e`): wholesale minting, inter-bank ZKP transfer, and balance verification.
