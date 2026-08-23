# Sworna CBDC

**Sworna** is a prototype Central Bank Digital Currency (CBDC) system built on **Hyperledger Fabric**, modeling a two-tier retail + wholesale payment system for the **Nepali rupee** concept. The currency is represented on-ledger as **UTXO tokens protected by Zero-Knowledge Proofs** — amounts and parties remain hidden to the ledger while remaining provably valid, with a central-bank-operated **auditor** enforcing oversight.

> **Project status: v3 — distributed N-bank.** ZK-private SWR on a 3+ org Fabric
> settlement network with a banking layer (accounts, per-bank portals, JWT,
> payments by account number incl. cross-bank, CB provisioning). The CB host and
> every commercial bank run on their **own VMs**; each bank self-provisions its
> Fabric org and any number of banks are supported. **Setup: [docs/SETUP.md](docs/SETUP.md).**
> See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/token-network/](docs/token-network/).

---

## Phase 2 — De-risking report

Status: **PASSED (with one known blocker — see §5).** Verified 2026-08-22 on the dev laptop.

### 1. Pinned versions (setup basis)

| Component | Version / commit |
|---|---|
| Fabric binaries + images | **3.1.5** (installed by `scripts/install-fabric-tools.sh` into `bin/`/`config/`; images `hyperledger/fabric-{peer,orderer,ccenv,baseos}:3.1.5`) |
| Fabric CA | **1.5.22** |
| `fabric-token-sdk` / `fabric-smart-client` | **v0.3.0** (in `token-services/{auditor,issuer,owner}/go.mod` + `tokenchaincode/Dockerfile`) |
| `tokengen` | v0.3.0 (`go install ...@v0.3.0`) |
| Go toolchain | **1.24** (the token engine builds in `golang:1.24` containers) |

> No `fabric-samples` checkout is required (or kept). The Fabric binaries,
> config and images are installed straight into the repo's own `bin/`/`config/`
> and Docker by `scripts/install-fabric-tools.sh`.

### 2. Required build fixes (the sample does not build unmodified today)

The sample's pinned dependency graph is broken under current Go/Docker toolchains. Four changes were required in the de-risking copy of `fabric-samples/token-sdk`:

1. **Pin `quic-go` v0.38.1 + `qpack` v0.4.0** in `auditor/`, `issuer/`, `owner/` — the sample's go.mod recorded v0.49.1, which is incompatible with the SDKs' webtransport-go v0.5.3 / libp2p v0.31 pins.
2. **Pin `gnark-crypto` v0.9.1** in all three modules — the sample recorded v0.18.1 (issuer/owner) and v0.12.1 (auditor); the IBM/mathlib + idemix stack requires v0.9.1 (`//go:linkname` to `bls12-381.g1Isogeny` breaks otherwise).
3. **Fix `go.work`** from `go 1.23.0` → `go 1.24.0` (was inconsistent with the module `go 1.24.0` directives).
4. **Pin `Dockerfile` + `tokenchaincode/Dockerfile`** base image `golang:latest` → `golang:1.24` (both build with `go build`, which fails on the current `golang:latest`).

All four fixes are **baked into the owned fork** under `token-services/` (see
[docs/token-network/05-engine-deep-dive.md](docs/token-network/05-engine-deep-dive.md)) —
there is no `fabric-samples` checkout to patch.

### 3. Verified end-to-end (token-sdk sample, 2-org test network)

- **Issue** 1000 TOK → alice (`/api/v1/issuer/issue`) ✅
- **Transfer** 100 TOK alice → dan (cross-owner, `/api/v1/owner/.../transfer`) ✅
- **Redeem** 40 TOK from dan (`/api/v1/owner/.../redeem`) ✅
- **UTXO change-splitting** ✅ — the transfer tx produced **two** outputs: 100 → dan, 900 → alice (change), same tx id.
- **ZK privacy** ✅ — decoded ledger blocks 2–7 contain **no** plaintext amounts (1000/100/900), token code, party names, or messages. Only matches are the chaincode's internal `ztoken` namespace prefix and base64 coincidences inside encrypted payloads.
- **Auditor oversight** ✅ — `/api/v1/auditor/accounts/alice/transactions` reveals full amounts, sender, and recipient (the auditor sees through the ZK).

### 4. Running the de-risking sample (Phase-2 record)

> Historical: this exercised the unmodified `fabric-samples/token-sdk` sample on
> its 2-org test network during de-risking. The `fabric-samples` checkout has
> since been removed; the production flow is `scripts/install-fabric-tools.sh`
> + `scripts/deploy-centralbank.sh` (see [docs/SETUP.md](docs/SETUP.md)).

```bash
cd fabric-samples && ./install-fabric.sh -f 3.1.5 -c 1.5.22 docker binary
export PATH="$PWD/bin:$HOME/go/bin:$PATH"
go install github.com/hyperledger-labs/fabric-token-sdk/cmd/tokengen@v0.3.0
cd token-sdk && ./scripts/up.sh     # start; use ./scripts/down.sh to stop
```

Services: swagger `:8080`, auditor `:9000`, issuer `:9100`, owner1 `:9200`, owner2 `:9300`.

### 5. Known blocker — Blockchain Explorer vs Fabric v3

The `hyperledger-labs/blockchain-explorer` (used by the sample on `:8081`) **does not work with Fabric v3.x**. Its synchronizer calls the `lscc.syscc` system chaincode, which was removed in Fabric v3 — sync fails and **0 blocks** are stored. This is a known upstream issue (blockchain-explorer #508, #512).

**Options for Phase 3** (choose in Week 1):
1. Drop the explorer from the demo; surface ledger activity through the FastAPI/React admin console (peer queries + `configtxlator` block decode).
2. Track a v3-compatible explorer fork (community, unverified).
3. Pin peers/orderers to Fabric v2.5.9 for explorer-only runs — contradicts the v3.1.x decision; not recommended.

Recommendation: **Option 1** for the Phase-3 demo.

---

## Phase 3 — running the stack

Everything is owned in this repo. **Deployment (CB + N bank VMs):**

```bash
# CB VM
./scripts/install-fabric-tools.sh                     # one-time: binaries + images
./scripts/deploy-centralbank.sh --provision
#   -> org1 network + chaincode approved + engine + portal
#   -> dist-bank-bundles/bank<CODE>.tar.gz per bank

# Bank k VM (after extracting its bundle):
export SWORNA_CB_HOST=<CB-IP> SWORNA_OWNER_OWNER1_HOST=<bank1-IP> ...
./scripts/deploy-bank.sh 00k        # identity phase -> bank{k}-org.json

# CB VM: add the bank to the channel, then re-run the bank script, then commit
./scripts/onboard-bank.sh Bank{k}MSP bank{k}-org.json
./scripts/deploy-bank.sh 00k        # (bank VM) join + start owner/portal
./scripts/commit-chaincode.sh       # (CB VM, once all banks are on)
```

Fresh clones are handled automatically: `token-services/keys/` is gitignored, so
`deploy-centralbank.sh` enrolls the CB's identities once; banks **self-provision
their Fabric org** on their own VM. Deploy scripts require Docker Compose v2;
backend paths derive from the repo location (`backend/app/paths.py`). See
[docs/SETUP.md](docs/SETUP.md) for the full runbook and per-role verification,
and [docs/token-network/09-distributed-deployment.md](docs/token-network/09-distributed-deployment.md)
for the distributed N-VM topology (implemented, pending live validation).

See [docs/DEMO.md](docs/DEMO.md) for the runbook and [docs/token-network/](docs/token-network/) for how the token network works.

---

## Project goal

- **Phase 1 (now):** A complete, research-backed documentation set that defines what we will build (this `docs/` folder).
- **Later phases:** A working prototype — a Fabric network (central bank + commercial banks + customers), a token layer for issuing/transferring/redemption, a Python banking backend, and wallet + central-bank admin UIs — evolving into a comprehensive banking system with benchmarks.

## Locked decisions

| Area | Decision |
|---|---|
| Currency | Token code **SWR**, symbol **रू**, name "Sworna", **2 decimal places** |
| CBDC model | Hybrid **retail + wholesale**, **two-tier** distribution (ADR-0008) |
| Money model | **Token-based / UTXO** with **Zero-Knowledge Proofs** (ADR-0006) |
| Framework | **Hyperledger Fabric v3.1.x** (chaincode layer) |
| Ordering | **Raft** for the initial prototype → **SmartBFT (BFT)** in the comprehensive phase (ADR-0003) |
| Channels | Single `settlement` channel for the prototype → multiple channels later (ADR-0002) |
| Organizations | `centralbank` (CentralBankMSP) + any number of banks (`Bank{k}MSP`, self-provisioned on their own VMs); customers are wallet identities on bank owner nodes |
| Roles | Central bank = **issuer + auditor**; commercial banks = **owner** nodes (ADR-0004) |
| Token layer | Reuse the **fabric-samples `token-sdk`** sample (prebuilt chaincode + REST services) (ADR-0001) |
| On-chain language | **Go** (prebuilt token-sdk chaincode, ~zero custom Go) |
| Off-chain language | **Python (FastAPI)** — on-chain only, REST is the boundary (ADR-0005) |
| State DB | **CouchDB** (ADR-0007) |
| Frontend | **React SPA** (customer wallet + central-bank/bank admin consoles) |
| Domain | `sworna.example.com` |
| Deployment | Distributed: CB host + one VM per bank (any number of banks); all-in-one on a dev laptop is testing only |
| Benchmarking | **Hyperledger Caliper** (comprehensive phase) |

## Documentation map

| Document | Contents |
|---|---|
| [docs/OVERVIEW.md](docs/OVERVIEW.md) | **Team-facing plain-language overview** (no citations) — start here to explain the project to anyone |
| [docs/PHASES.md](docs/PHASES.md) | The full phased roadmap: documentation → foundation → prototype demo → comprehensive system → performance/hardening → vision |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architectural design: two-tier model, UTXO + ZK, roles, network topology, transaction flows, deployment |
| [docs/SETUP.md](docs/SETUP.md) | **Step-by-step host setup runbook** (agent-executable): preflight → clone → Fabric tools → CB bring-up → provisioning → bank bring-up → verification |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | How the single repo is deployed so machines act as central bank / banks / customers; ports, identity, 1→3→25-host progression |
| [docs/DEMO.md](docs/DEMO.md) | Demo scenario and runbook (verified on the dev laptop) |
| [docs/FULL-BANKING-SYSTEM.md](docs/FULL-BANKING-SYSTEM.md) | The complete banking-system subsystem map (ledger core, central bank, commercial bank, retail, compliance, infrastructure) |
| [docs/API.md](docs/API.md) | REST API catalog: FastAPI banking layer + token-sdk service endpoints |
| [docs/TEAM.md](docs/TEAM.md) | How the development team is divided: tracks, code ownership, API contracts, weekly plan |
| [docs/BENCHMARKS.md](docs/BENCHMARKS.md) | Performance benchmarking methodology (Caliper) and Fabric-X evaluation notes (stub) |
| [docs/REFERENCES.md](docs/REFERENCES.md) | Canonical bibliography of every source used for this plan |
| [docs/ADRs/](docs/ADRs/) | Architecture Decision Records (0001–0009) |
| [docs/token-network/](docs/token-network/) | How the token network works; `08-provisioning.md` = wallet pools & join bundles; `09-distributed-deployment.md` = 3-VM topology |

## How to read this repository

1. Share [docs/OVERVIEW.md](docs/OVERVIEW.md) with the team first — it explains the whole project in plain language.
2. Start with [docs/PHASES.md](docs/PHASES.md) to understand where we are and where we are going.
3. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design rationale.
4. Reference [docs/REFERENCES.md](docs/REFERENCES.md) for all primary sources.
5. Each decision is captured in its own ADR under [docs/ADRs/](docs/ADRs/).
