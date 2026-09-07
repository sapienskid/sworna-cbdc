# Sworna CBDC — Lab & Bare-Metal 10-Bank Cluster Deployment Guide

This guide covers two deployment methodologies for Sworna CBDC:
1. **Part I: Multi-Host University Lab Deployment** — Connecting physical lab computers across restrictive university Wi-Fi/firewalls using VirtualBox NAT and Tailscale.
2. **Part II: Dedicated Bare-Metal 10-Bank Hypervisor Setup** — Deploying a 10-bank + Central Bank cluster on a single physical workstation (**Intel Core i7-10700, 32 GB RAM, 512 GB SSD, Proxmox VE**) for high-stakes demonstrations to **Nepal Rastra Bank (NRB)**.
3. **Part III: Remote Access & Tunneling Architecture** — Cloudflare Tunnels (public browser access) + Tailscale Subnet Router (admin SSH).
4. **Part IV: Nepal Rastra Bank (NRB) Live Demonstration Runbook** — The 5-Act foolproof live demo script.

---

# Part I: Multi-Host University Lab Deployment

### 1. Lab Constraints & Network Reality
In university and enterprise computer labs:
- **Wi-Fi 802.11 Protocol Limitations:** Wi-Fi routers reject frames with multiple MAC addresses from the same radio. Setting VirtualBox or VMware to "Bridged" over Wi-Fi causes guest VMs to drop packets or fail to receive DHCP leases.
- **Client/AP Isolation:** Enterprise campus networks enforce Access Point Isolation, preventing two laptops on the same Wi-Fi network from communicating directly (`192.168.x.x` cannot ping another `192.168.x.x`).
- **Closed Border Firewalls:** Inbound port forwarding (`7050`, `7051`, `8100`, `9051`) on university routers is prohibited.

### 2. The Solution: VirtualBox NAT + Bidirectional Tailscale Mesh
Instead of bridging, leave the VM network adapter in standard **NAT** mode and create a virtual peer-to-peer overlay network using **Tailscale**.

```
┌───────────────────────────────┐               ┌───────────────────────────────┐
│     LAB COMPUTER 1 (CB VM)    │               │    LAB COMPUTER 2 (BANK VM)   │
│  VirtualBox (NAT Mode)        │               │  VirtualBox (NAT Mode)        │
│  Tailscale: 100.72.112.29     │               │  Tailscale: 100.77.172.35     │
│  - orderer.sworna.example.com │ ◄───────────► │  - peer0.bank1.sworna...      │
│  - peer0.centralbank...       │   Tailscale   │  - owner1 (FSC Engine)        │
│  - issuer / auditor           │   WireGuard   │  - bank web portal (:5173)    │
│  - backend api (:8100)        │   Tunnel      │                               │
└───────────────────────────────┘               └───────────────────────────────┘
```

#### Steps for Lab Deployment:
1. **Install Tailscale on both VMs:**
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```
2. **Bidirectional Sharing (if using different Tailscale accounts):**
   - In Tailscale Admin Console, click **Share...** on the Central Bank VM machine.
   - Enter the email address of the Bank VM's account and approve the share.
   - Both VMs can now ping each other over their `100.x.y.z` IPs.

3. **Deploy Central Bank on Computer 1:**
   ```bash
   git clone https://github.com/sapienskid/sworna-cbdc.git ~/sworna-cbdc
   cd ~/sworna-cbdc
   ./bin/sworna cb init --provision
   ```
   *Verifies Central Bank backend at `http://localhost:8100/healthz` and portal at `http://localhost:5273`.*

4. **Join Bank 001 from Computer 2 (1-Step Automated Join):**
   ```bash
   git clone https://github.com/sapienskid/sworna-cbdc.git ~/sworna-cbdc
   cd ~/sworna-cbdc

   # Replace with Central Bank VM's Tailscale IP:
   ./bin/sworna bank join --code 001 --cb-host 100.72.112.29
   ```
   *The script generates local keys, applies to CB, waits for approval, downloads credentials, joins the channel, and launches the web portal on `:5173`.*

---

# Part II: Dedicated Bare-Metal 10-Bank Hypervisor Setup

For formal institutional presentations to **Nepal Rastra Bank (NRB)**, relying on two separate lab computers on Wi-Fi creates unnecessary failure points. Hosting the entire 11-node network on a single bare-metal workstation delivers maximum speed, stability, and zero network dropouts.

### 1. Hardware Specifications & Resource Budget

- **Workstation:** Intel Core i7-10700 (8 Physical Cores, 16 Threads)
- **Memory:** 32 GB DDR4 RAM
- **Storage:** 512 GB NVMe SSD
- **Hypervisor:** Proxmox Virtual Environment (VE) 8.x (Bare-Metal Type-1 KVM)

#### Memory Allocation Budget (Total: 32 GB)
| Machine | VM ID | Role | vCPU | RAM | Disk (Thin) | Internal Static IP |
|---|---|---|---|---|---|---|
| **Proxmox Host** | - | Hypervisor OS (Debian) | 2 | 4 GB | 50 GB (OS) | `10.10.10.1` |
| **Central Bank** | 100 | Orderer, CB Peer, CAs, Issuer, Auditor, API, Web | 4 | 4 GB | 40 GB | `10.10.10.10` |
| **Bank 001** | 101 | Nabil Bank (Peer, CA, FSC Owner, Web) | 2 | 2 GB | 25 GB | `10.10.10.11` |
| **Bank 002** | 102 | Global IME Bank (Peer, CA, FSC Owner, Web) | 2 | 2 GB | 25 GB | `10.10.10.12` |
| **Bank 003** | 103 | NIC Asia Bank (Peer, CA, FSC Owner, Web) | 2 | 2 GB | 25 GB | `10.10.10.13` |
| **Banks 004–010**| 104–110 | Commercial Banks 4 through 10 | 1 ea | 2 GB ea (14 GB) | 25 GB ea | `10.10.10.14–20`|
| **TOTALS** | **11 Nodes** | | **22 vCPUs** | **28 GB RAM** | **~180 GB real** | **Zero Swap Thrashing** |

#### Why the CPU Overcommit Works:
- Physical Threads: **16**
- Assigned vCPUs: **22** (Ratio: **1.37 : 1**)
- In hypervisor environments, a ratio below **2:1** operates with near-zero scheduling latency. Blockchain nodes idle 95% of the time, consuming burst CPU only during ZKP generation and endorsement.

---

### 2. Proxmox Network Configuration

Configure a dedicated internal Linux Bridge (`vmbr1`) on Proxmox so that all inter-node blockchain traffic travels over virtual bus memory at 10–20+ Gbps:

Edit `/etc/network/interfaces` on Proxmox:
```bash
# Physical management interface (connected to home/lab router)
auto vmbr0
iface vmbr0 inet dhcp
    bridge-ports eno1
    bridge-stp off
    bridge-fd 0

# Isolated internal CBDC bridge (10.10.10.0/24)
auto vmbr1
iface vmbr1 inet static
    address 10.10.10.1/24
    bridge-ports none
    bridge-stp off
    bridge-fd 0
    # Enable outbound NAT so VMs can pull packages/images
    post-up iptables -t nat -A POSTROUTING -s '10.10.10.0/24' -o vmbr0 -j MASQUERADE
    post-down iptables -t nat -D POSTROUTING -s '10.10.10.0/24' -o vmbr0 -j MASQUERADE
```
Apply the network:
```bash
ifreload -a
```

---

### 3. Automated VM Provisioning Script

Save this script on the Proxmox host to provision all 11 VMs using the Ubuntu 22.04 Cloud-Init template:

```bash
#!/usr/bin/env bash
# provision-cbdc-cluster.sh — Provisions 1 CB + 10 Bank VMs on Proxmox
set -euo pipefail

TEMPLATE_ID=9000   # Pre-created Ubuntu 22.04 cloud-init template ID

# 1. Provision Central Bank (VM 100)
echo "==> Provisioning Central Bank (VM 100)..."
qm clone $TEMPLATE_ID 100 --name "sworna-centralbank" --full
qm set 100 --cores 4 --memory 4096 --net0 virtio,bridge=vmbr1
qm set 100 --ipconfig0 ip=10.10.10.10/24,gw=10.10.10.1
qm resize 100 scsi0 +20G
qm start 100

# 2. Provision 10 Commercial Banks (VMs 101 to 110)
for i in $(seq 1 10); do
  VMID=$((100 + i))
  IP="10.10.10.$((10 + i))"
  CODE=$(printf "%03d" $i)
  echo "==> Provisioning Bank $CODE (VM $VMID) at $IP..."
  qm clone $TEMPLATE_ID $VMID --name "sworna-bank-$CODE" --full
  qm set $VMID --cores 2 --memory 2048 --net0 virtio,bridge=vmbr1
  qm set $VMID --ipconfig0 ip="${IP}/24",gw=10.10.10.1
  qm resize $VMID scsi0 +10G
  qm start $VMID
done

echo "==> All 11 VMs provisioned and booting on internal bridge (10.10.10.0/24)."
```

---

# Part III: Remote Access & Tunneling Architecture

To demonstrate the system to executives or external teams, separate access into two channels:

```
                            PUBLIC INTERNET
                                  │
      ┌───────────────────────────┴───────────────────────────┐
      │                                                       │
  [Cloudflare Tunnel]                                     [Tailscale VPN]
  For Evaluators & NRB Board                              For System Administrators
  - No VPN or software needed                             - Direct SSH to any VM
  - Clean HTTPS on phones/laptops                         - Full Proxmox Web GUI access
  - https://cb.yourdomain.com                             - ssh sapiens@10.10.10.10
  - https://bank1.yourdomain.com                          - Subnet router: 10.10.10.0/24
```

### 1. Web Access for Audience: Cloudflare Tunnel (Zero Trust)
No open router ports or static public IPs are required.

1. **Install `cloudflared` on the Central Bank VM or Proxmox host:**
   ```bash
   curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared.deb
   ```
2. **Create Tunnel & Ingress Config (`~/.cloudflared/config.yml`):**
   ```yaml
   tunnel: sworna-cbdc-tunnel
   credentials-file: /root/.cloudflared/sworna-cbdc-tunnel.json

   ingress:
     # Central Bank Web Portal
     - hostname: cb.yourdomain.com
       service: http://10.10.10.10:5273
     # Central Bank API
     - hostname: api.cb.yourdomain.com
       service: http://10.10.10.10:8100
     # Commercial Banks 001 - 010
     - hostname: bank1.yourdomain.com
       service: http://10.10.10.11:5173
     - hostname: bank2.yourdomain.com
       service: http://10.10.10.12:5173
     - hostname: bank3.yourdomain.com
       service: http://10.10.10.13:5173
     # Fallback
     - service: http_status:404
   ```
3. **Run as System Service:**
   ```bash
   sudo cloudflared service install
   sudo systemctl start cloudflared
   ```
*Audience members can now access the Central Bank and Commercial Banks directly from their phones or laptops using standard HTTPS URLs.*

### 2. Admin SSH Access: Tailscale Subnet Router
To administer all 11 VMs remotely from home:

1. **On the Proxmox host (`10.10.10.1`), advertise the internal subnet:**
   ```bash
   sudo tailscale up --advertise-routes=10.10.10.0/24
   ```
2. **In Tailscale Admin Console:**
   - Go to **Machines** ➔ Select Proxmox host ➔ **Edit route settings** ➔ Check `10.10.10.0/24` ➔ Click **Save**.
3. **Connect from your home laptop:**
   With Tailscale enabled on your laptop, you can immediately run:
   ```bash
   ssh sapiens@10.10.10.10   # Direct SSH to Central Bank
   ssh sapiens@10.10.10.11   # Direct SSH to Bank 001
   ssh sapiens@10.10.10.12   # Direct SSH to Bank 002
   ```

---

# Part IV: Nepal Rastra Bank (NRB) Live Demonstration Runbook

### Key Presentation Principles:
1. **Never show all 10 banks at once:** It overwhelms the audience. Frame the story around 3 named banks:
   - **Central Bank:** Nepal Rastra Bank (NRB)
   - **Bank 001:** Nabil Bank
   - **Bank 002:** Global IME Bank
   - **Bank 003:** NIC Asia Bank *(Onboarded live during the presentation)*
2. **Run 100% offline-capable:** Connect your presentation laptop directly to the Proxmox workstation with a physical Ethernet cable (`10.10.10.2`). Do not depend on venue Wi-Fi.

---

### The 5-Act Demonstration Storyboard

#### Act 1: The Two-Tier Architecture Overview (2 mins)
- **Core Message:** *"Nepal Rastra Bank does not open retail accounts for 30 million citizens. The CBDC operates on a two-tier model where NRB manages monetary supply and commercial banks, while commercial banks manage customer KYC, retail distribution, and wallets."*
- **Visual:** Open NRB Central Bank Portal at `http://10.10.10.10:5273/cb`. Show the active Bank Registry displaying Nabil Bank and Global IME Bank.

#### Act 2: Wholesale Minting & Reserve Allocation (3 mins)
- **Core Message:** *"All CBDC tokens originate as cryptographically signed wholesale liabilities backed by central bank fiat reserves."*
- **Action:**
  1. Navigate to **Treasury / Minting** in the NRB Portal.
  2. Select **Nabil Bank (001)**.
  3. Enter amount: `NPR 50,000,000`. Click **Mint Wholesale CBDC**.
- **Result:** Show the instant update in Nabil Bank's Master Reserve Vault (`RESERVE-1`). Explain that the Hyperledger Fabric ledger recorded the transaction across orderer nodes.

#### Act 3: Retail Customer Disbursement (3 mins)
- **Core Message:** *"Commercial banks draw down on their central bank reserve vault to fund retail customer digital rupee balances."*
- **Action:**
  1. Switch browser tab to **Nabil Bank Portal** at `http://10.10.10.11:5173/b/001`.
  2. Log in as `bank1_admin` / `sworna-bank`.
  3. Disburse `NPR 15,000` to citizen wallet `pool_001_w2` (Account: "Ram Sharma").
- **Result:** Ram Sharma's wallet displays an active balance of NPR 15,000.

#### Act 4: Privacy-Preserving Zero-Knowledge Interbank Transfer (4 mins)
- **Core Message:** *"How can a citizen transfer money from Nabil Bank to Global IME Bank instantly without exposing their balance or identity to public blockchain explorers?"*
- **Action:**
  1. Transfer `NPR 4,500` from Ram Sharma (Nabil Bank, `001`) to Sita Shrestha (Global IME Bank, `002`).
  2. Click **Execute Transfer**.
- **Explain the Underlying Technology:**
  - **Idemix (Token-SDK):** Transfer proves mathematically that Ram owns the tokens without revealing Ram's cryptographic public key or historical transactions.
  - **UTXO Change-Splitting:** The original NPR 15,000 input is spent in full; NPR 4,500 goes to Sita, and a change output of NPR 10,500 returns instantly to Ram under the same transaction ID.
  - **The NRB Auditor View:** Show the **Auditor FSC node log** (`docker logs token-services-auditor-1`). The auditor validated that zero counterfeiting occurred and balances conserved, without breaking banking secrecy.

#### Act 5: Live 60-Second Commercial Bank Onboarding (Showstopper) (3 mins)
- **Core Message:** *"When a new commercial bank—NIC Asia Bank—is authorized by NRB, onboarding is 100% automated and zero-touch."*
- **Action:**
  1. Boot VM 103 (Bank 003) and execute:
     ```bash
     ./bin/sworna bank join --code 003 --cb-host 10.10.10.10
     ```
  2. Switch to the NRB Portal (`:5273/cb/banks`). An admission application for **NIC Asia Bank (Bank 003)** appears in real time.
  3. Click **Approve Admission**.
  4. Within seconds, VM 103 terminal streams its Idemix keys, joins the `settlement` channel, launches its FSC engine, and boots its portal at `http://10.10.10.13:5173/b/003`.
  5. Open the NIC Asia portal in a new browser tab.
- **Audience Impact:** Central bankers witness an entire commercial bank enter the national settlement network live without taking down or restarting the central bank ledger.

---

### 5. Pre-Demo Checklist & Contingency Protocol

| Task | Timing | Verification Command |
|---|---|---|
| **Pre-pull Docker Images** | 12 hours before | `docker image inspect hyperledger/fabric-peer:3.1.5` on all VMs |
| **Run E2E Verification** | 6 hours before | `./bin/sworna test e2e` |
| **Take Proxmox Snapshot** | 2 hours before | Create snapshot `demo-ready` on VMs 100 through 110 |
| **Direct Ethernet Fallback** | Setup room | Connect laptop via RJ45 cable to workstation with static IP `10.10.10.2` |
| **Emergency Rollback** | If anything breaks | Proxmox GUI ➔ Select VM ➔ Snapshots ➔ Rollback to `demo-ready` (Takes 3 seconds) |
