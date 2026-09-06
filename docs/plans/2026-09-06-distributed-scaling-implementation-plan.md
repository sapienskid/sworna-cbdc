# Master Implementation Plan: Distributed CBDC with Unlimited Banks & Customers

**Document Version:** 1.0.0  
**Target:** Automated execution by AI coding agent / DevOps Engineer  
**Date:** 2026-09-06  
**Status:** Approved for Direct Execution  

---

## 1. System Inventory & Topology

| Node Name | Role | Hostname / IP | Native Host Services (To Remove) | Docker Services (Target State) |
|---|---|---|---|---|
| **centralcbdc** | Central Bank | `100.72.112.29` | `sworna-backend` (:8000), `sworna-web` (:5173) | Orderer (:7050), CB Peer (:7051), Token CA (:27054), Issuer (:9100), Auditor (:9000), Backend (:8100), Web (:5273) |
| **bankpp** | Bank 001 | `100.72.65.13` | None | Bank1 Peer (:9051), Bank1 CA (:20055), CCaaS (:9999), Owner1 (:9200), Web (:5173) |
| **bankpt** | Bank 002 | `100.111.120.73` | Old `npm run dev`, `uvicorn` (:8000) | Bank2 Peer (:11051), Bank2 CA (:20056), CCaaS (:9999), Owner2 (:9300), Web (:5173) |
| **bank_{k}** | Future Banks | Dynamic Tailnet | None | Peer ($9051+2000(k-1)$), CA ($20054+k$), Owner ($9200+100(k-1)$), Web (:5173) |

---

## 2. Prerequisites & Credentials

* **Central Bank SSH:** `sapiens@100.72.112.29` (SSH key authentication, sudo password `sapiens` if prompted).
* **Bank 2 SSH:** `bankpt@100.111.120.73` (Password `bankpt`).
* **Central Bank API Credentials:** `cbadmin` / `sworna-cb`.
* **Bank Admin Default Password:** `sworna-bank`.

---

## 3. Phase-by-Phase Execution Runbook

### Phase 1: Central Bank Clean-Up & 100% Dockerization
**Goal:** Eliminate host-level systemd conflicts, ensure file ownership is `sapiens:sapiens`, and verify the Docker stack is authoritative.

#### Step 1.1: Stop and disable host systemd services
Run on `sapiens@100.72.112.29`:
```bash
sudo systemctl stop sworna-backend sworna-web || true
sudo systemctl disable sworna-backend sworna-web || true
sudo rm -f /etc/systemd/system/sworna-backend.service /etc/systemd/system/sworna-web.service
sudo systemctl daemon-reload
```

#### Step 1.2: Reset file ownership & permissions
Ensure no files are locked by root:
```bash
cd /home/sapiens/sworna-cbdc
sudo chown -R sapiens:sapiens /home/sapiens/sworna-cbdc
chmod 664 /home/sapiens/sworna-cbdc/backend/sworna.db 2>/dev/null || true
chmod 664 /home/sapiens/sworna-cbdc/network/bank-hosts.env 2>/dev/null || true
```

#### Step 1.3: Start Central Bank Docker Compose Stack
```bash
cd /home/sapiens/sworna-cbdc

# 1. Start core Fabric infrastructure (Orderer, Peer, CAs, CCaaS, Issuer, Auditor)
docker compose -f docker-compose.yaml -f docker-compose.net.yaml up -d

# 2. Rebuild and launch CB Backend (:8100) and Web Portal (:5273)
docker compose -f docker-compose.cb.yaml up -d --build
```

#### Step 1.4: Validation & Health Check
Verify all ports respond from inside and outside:
```bash
# Verify Central Bank Backend
curl -sf http://127.0.0.1:8100/healthz || echo "Backend failed"

# Verify Central Bank Web Portal (Nginx serving SPA)
curl -sI http://127.0.0.1:5273 | grep "HTTP/1.1 200 OK"

# Verify Token CA
curl -sf http://127.0.0.1:27054/cainfo || echo "Token CA failed"

# Verify Auditor FSC Node
curl -sf http://127.0.0.1:9000/api/v1/healthz || echo "Auditor failed"
```

---

### Phase 2: Dynamic Auto-Replenishing Customer Wallet Pool
**Goal:** Prevent `"no free wallets"` errors by automatically minting new Idemix credentials when free pool $< 5$.

#### Step 2.1: Code Modification in `backend/app/provisioning.py`
Add auto-expansion logic to `assign_wallet`:
```python
def replenish_wallet_pool(bank: Bank, batch_size: int = 25) -> int:
    """Mint additional Idemix wallet credentials from Token CA to expand the pool."""
    declared = set(bank.wallet_pool.get("used", []) + bank.wallet_pool.get("free", []))
    current_count = len(declared)
    new_wallets = [f"pool_{bank.code}_w{i}" for i in range(current_count + 1, current_count + batch_size + 1)]

    for wid in new_wallets:
        msp = wallet_msp_path(bank.owner_node, wid)
        if not (msp / "user" / "SignerConfig").exists():
            generate_wallet(bank.owner_node, wid)

    free = list(bank.wallet_pool.get("free", [])) + new_wallets
    bank.wallet_pool = {
        "used": bank.wallet_pool.get("used", []),
        "free": free,
    }
    bank.pool_size = len(bank.wallet_pool["used"]) + len(bank.wallet_pool["free"])
    return len(new_wallets)

def assign_wallet(bank: Bank, auto_replenish_threshold: int = 5, batch_size: int = 25) -> str:
    """Take the next free wallet from the pool. Auto-replenishes if running low."""
    free = list(bank.wallet_pool.get("free", []))
    if len(free) <= auto_replenish_threshold:
        try:
            replenish_wallet_pool(bank, batch_size=batch_size)
            free = list(bank.wallet_pool.get("free", []))
        except Exception as exc:
            if not free:
                raise ProvisioningError(f"Wallet pool exhausted and replenishment failed: {exc}")

    if not free:
        raise ProvisioningError(f"bank {bank.name} has no free wallets; provision more")

    wid = free.pop(0)
    used = list(bank.wallet_pool.get("used", []))
    used.append(wid)
    bank.wallet_pool = {"used": sorted(used), "free": free}
    return wid
```

#### Step 2.2: Test Wallet Pool Scalability
Run scratch script registering 30 sequential accounts to ensure pool expands from 10 to 35 without errors:
```bash
python3 -c "
from backend.app.database import SessionLocal
from backend.app.models import Bank
from backend.app.provisioning import assign_wallet
with SessionLocal() as s:
    bank = s.query(Bank).filter_by(code='001').first()
    for i in range(30):
        wid = assign_wallet(bank)
    s.commit()
    print('Pool size now:', bank.pool_size, 'Free:', len(bank.wallet_pool['free']))
"
```

---

### Phase 3: Tailscale Dynamic Hostname Discovery in Scripts
**Goal:** Stop hardcoding fragile raw IPs. Use Tailscale hostnames or auto-detected active IPs.

#### Step 3.1: Modify `scripts/bank-docker.sh`
Update IP detection to prefer MagicDNS / active Tailscale IP:
```bash
if [ -z "$MY_HOST" ]; then
  # 1. Prefer Tailscale DNS name or active Tailscale IPv4
  if command -v tailscale >/dev/null 2>&1; then
    TS_NAME=$(tailscale status --json 2>/dev/null | jq -r '.Self.DNSName // empty' | sed 's/\.$//')
    TS_IP=$(tailscale ip -4 2>/dev/null | head -1)
    MY_HOST="${TS_NAME:-$TS_IP}"
  fi

  # 2. Route fallback
  if [ -z "$MY_HOST" ]; then
    MY_HOST=$(ip route get "$CB_HOST" 2>/dev/null | grep -oP 'src \K\S+' || true)
  fi
fi
```

#### Step 3.2: Sync changes to repo and pull on Central Bank
```bash
git add backend/ scripts/
git commit -m "feat(network): auto-replenish wallet pool and dynamic tailscale discovery"
git push origin main
ssh sapiens@100.72.112.29 "cd /home/sapiens/sworna-cbdc && git pull && docker compose -f docker-compose.cb.yaml up -d --build"
```

---

### Phase 4: Bank 2 Clean-Up & 1-Step Onboarding Execution
**Goal:** Deploy Bank 2 (`bankpt` on `100.111.120.73`) cleanly in Docker.

#### Step 4.1: Clean up stale containers and host processes on `bankpt`
Run via SSH on `bankpt@100.111.120.73`:
```bash
# Kill old native uvicorn/vite
killall -9 node uvicorn python3 2>/dev/null || true

# Stop stale 5-day-old bank1 containers
docker stop peer0.bank1.sworna.example.com ca_bank1 token-services-owner-1 peer0bank1_tokenchaincode_ccaas 2>/dev/null || true
docker rm -f peer0.bank1.sworna.example.com ca_bank1 token-services-owner-1 peer0bank1_tokenchaincode_ccaas 2>/dev/null || true
```

#### Step 4.2: Pull latest code & execute Dockerized join
```bash
cd /home/bankpt/sworna-cbdc
git pull

# Execute 100% Docker onboarding for Bank 002
./scripts/bank-docker.sh up 002 100.72.112.29 100.111.120.73
```
*Note: Since Central Bank has already approved Bank 2 (`approved`), this script will immediately download credentials (`bank002.tar.gz`), unpack them, join the channel, start the FSC owner engine, and start the web portal on `:5173`.*

#### Step 4.3: Verify Bank 2
```bash
curl -sI http://100.111.120.73:5173/b/002 | grep "200 OK"
curl -s http://100.111.120.73:9300/api/v1/healthz
```

---

### Phase 5: Bank 1 Health & FSC Owner Startup
**Goal:** Verify Bank 1 (`100.72.65.13`) has its FSC Owner engine running so inter-bank zero-knowledge transfers succeed.

#### Step 5.1: Check Bank 1 Owner engine status
On Central Bank:
```bash
nc -zv 100.72.65.13 9200
```
If port 9200 is connection refused:
Connect to Bank 1 and start its owner engine container:
```bash
cd /home/sapiens/sworna-cbdc/token-services
docker compose -p "bank001-owner" -f docker-compose.bank.yaml -f docker-compose.bank.net.yaml up -d --build owner
```

---

### Phase 6: Automated End-to-End Verification
Run the unified verification tool:
```bash
./bin/sworna test e2e
```

**Verification Checklist:**
1. [ ] Central Bank mints 1,000,000 SWR to Bank 1.
2. [ ] Bank 1 transfers 50,000 SWR to Bank 2 via ZKP blind transaction.
3. [ ] Auditor FSC node verifies zero-knowledge balance proof without revealing payer/payee identity.
4. [ ] Bank 1 balance reads `950,000 SWR`.
5. [ ] Bank 2 balance reads `50,000 SWR`.

---

### Phase 7: Ingress Gateway (Public Browser Access without VPN)
To allow any client, stakeholder, or mobile device to open the web portal without installing Tailscale:

#### Option 1: Cloudflare Tunnel (Zero-Open-Ports)
On Central Bank VM:
```bash
# Install cloudflared
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# Run quick tunnel for the web portal
cloudflared tunnel --url http://localhost:5273
```
*Gives a public HTTPS URL (e.g. `https://xxxx.trycloudflare.com`) accessible from any browser.*

#### Option 2: Tailscale Funnel
```bash
tailscale funnel 5273 on
```
*Exposes `https://centralcbdc.<tailnet>.ts.net` publicly to the entire internet.*
