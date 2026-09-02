# PHASES — Sworna CBDC roadmap

This document is the master roadmap. Each phase has a goal, a task list, exit criteria, and deliverables. Everything is backed by the sources in [REFERENCES.md](REFERENCES.md) (cited inline as `[R#]`).

| Phase | Name | Duration | Status |
|---|---|---|---|
| 1 | Documentation & research foundation | Completed | **Complete** |
| 2 | Prototype foundation & de-risking | Completed | **Complete (Verified)** |
| 3 | Initial prototype demo (Distributed N-Bank) | Completed | **Complete (Functional)** |
| 4 | Comprehensive banking system | 6–8 weeks (1.5–2 mo) | Planned (Detailed WBS below) |
| 5 | Performance, security & hardening | 2–4 weeks | Planned |
| 6 | Future vision / production path | ongoing | Vision |

---

## Phase 1 — Documentation & research foundation

**Goal:** produce a complete, research-backed documentation set that defines what we will build. **No prototype code.**

**Tasks**

1. `README.md` — project overview, locked decisions, doc navigation.
2. `docs/REFERENCES.md` — canonical bibliography of all primary sources.
3. `docs/PHASES.md` — this roadmap.
4. `docs/ARCHITECTURE.md` — architectural design and rationale.
5. `docs/FULL-BANKING-SYSTEM.md` — complete banking-system subsystem map.
6. `docs/API.md` — REST API catalog (as-designed).
7. `docs/ADRs/0001–0009` — Architecture Decision Records.
8. `docs/DEMO_AND_UI_GUIDE.md` (demo runbook) and `docs/BENCHMARKS.md` (stub, Phase 5).

**Exit criteria:** every document reviewed and approved; every ADR records an accepted decision; all claims traceable to [REFERENCES.md](REFERENCES.md).

**Deliverables:** the complete `docs/` set.

---

## Phase 2 — Prototype foundation & de-risking

**Goal:** prove the entire technical stack works on our laptops before any custom work. Retires the riskiest unknowns (sample quirks, ZK behavior, REST flows, explorer).

**Tasks**

1. Install prerequisites on dev laptops: Docker 20+, Go 1.20+, `make`, `jq`, `curl`.
2. Install prerequisites on dev laptops: Docker 20+, Go 1.20+, `make`, `jq`, `curl`; install the Fabric tools via `./scripts/install-fabric-tools.sh` → Fabric **v3.1.x** binaries/images and Fabric **CA 1.5.x** binaries.
3. Run the **token-sdk sample** end-to-end (`./scripts/up.sh`) on the default 2-org test network [R13][R3]:
   - Issue 1000 tokens → alice; transfer 100 → dan; redeem.
   - Verify **ZK behavior**: ledger does not reveal amounts or parties; the **auditor** can see them [R13].
   - Verify **UTXO change-splitting** (1000 input → 100 + 900 outputs).
   - Launch the **blockchain explorer** on :8081 and watch blocks commit [R13].
4. Exercise the documented "use another Fabric network" path to confirm portability [R13].
5. Record exact commit hashes and image tags, plus setup steps, in the README.

**Exit criteria:** issue/transfer/redeem + ZK + auditor + explorer verified on ≥2 laptops. The ZK-on-Raft behavior (ZK is chaincode-side and orthogonal to the ordering service) is demonstrated.

**Deliverables:** working token-sdk sample, pinned-version README, updated ARCHITECTURE/API docs.

**Sources:** [R3] Fabric test network; [R13] token-sdk sample.

---

## Phase 3 — Initial prototype demo (2 weeks)

**Goal:** a guided demo — central bank issues SWR, commercial banks, customer-to-customer payments (including cross-bank), redemption — on the `settlement` channel. **Delivered (2026):** CB org1-only network + any number of banks, each self-provisioning its own Fabric org on its own VM (see [DEPLOYMENT.md](DEPLOYMENT.md)).

### Week 1 — Settlement network + token layer

| # | Task | Detail |
|---|---|---|
| W1.1 | Network definition | CB host runs the **central-bank org only** (`CentralBankMSP`); each bank self-provisions `Bank{k}MSP` on its own VM and is added to the channel via `scripts/onboard-bank.sh`. Domain `sworna.example.com`; **Fabric CA per org** (`-ca` pattern) [R3]. |
| W1.2 | Raft ordering cluster | Single orderer on the CB host for the prototype; spread across hosts in Phase 4. |
| W1.3 | Single `settlement` channel | The CB creates the channel with org1 and adds each bank's org via a config update; the token chaincode is committed with an OR endorsement policy (`scripts/commit-chaincode.sh`) [R13]. |
| W1.4 | Token services | issuer (CB), auditor (CB), and one owner node per bank (`owner{k}`, conf rendered from `core.yaml.tpl`); configure **SWR** with **2 decimals**. |
| W1.5 | Cross-org flow test | CB issues SWR → a bank customer; intra-bank transfer; cross-bank transfer; redeem. All via REST [R13]. |
| W1.6 | Explorer | Dropped — Fabric v3 incompatible; ledger activity surfaces via the CB portal's Ledger page. |
| W1.7 | Version pinning | Fabric 3.1.5 / CA 1.5.22 pinned via `scripts/install-fabric-tools.sh`. |

**Exit criteria:** SWR issued/transferred/redeemed with ZK intact across the CB + every onboarded bank.

### Week 2 — Banking layer (Python/FastAPI) + UI (React)

| # | Task | Detail |
|---|---|---|
| W2.1 | FastAPI backend | Customer/bank/account registry (SQLite); wraps owner/issuer/auditor REST APIs (owner URLs derived from the owner node — `app/owner_urls.py`); the registry starts empty — banks are created at runtime. |
| W2.2 | Basic AML flags | Demo-level account `status` (active / flagged / frozen) + a transfer limit check in the backend (not on-chain yet). |
| W2.3 | Admin console (React) | CB: issue/redeem, total supply + per-bank circulation, ledger monitor; bank view: customers, balances, activity. |
| W2.4 | Wallet SPA (React) | Customer login; balance, send, receive, transaction history (served by FastAPI). |
| W2.5 | Runtime onboarding verification | Create a bank → provision → bundle → bank identity → onboard (live) → join → commit; issue → transfers (intra + cross) → redeem through the APIs/portals. |
| W2.6 | Tests | Happy-path e2e covering both REST layers (token engine + FastAPI). |
| W2.7 | Documentation | ARCHITECTURE.md, API.md, PHASES.md, SETUP/DEPLOYMENT runbooks, ADRs 0001–0011. |
| W2.8 | Distributed demo | CB host + one VM per bank; cross-host DNS via generated `extra_hosts` + `/etc/hosts`. |

**Exit criteria (demo day):** a guided demo; admin console + wallet visible; docs complete.

**Sources:** [R3] test network; [R13] token-sdk sample.

---

## Phase 4 — Comprehensive banking system (1–3 months)

**Goal:** turn the demo into a comprehensive banking system: BFT consensus, multi-channel data governance, KYC/AML/compliance, monetary-policy tooling, interbank settlement, and a distributed deployment across the 25-machine lab.

### 4.1 Architecture upgrades

| Task | Detail |
|---|---|
| SmartBFT migration | Raise channel to **V3_0** capabilities; run **4+ orderers** (`ConsenterMapping`) [R1][R2]; evaluate Ed25519 identities [R1]. |
| Multi-channel topology | `settlement` (all orgs) + `retail` (CB + bank pairs) + `registry/KYC` (private data) channels [R3]. |
| Private Data Collections | Customer private data (KYC docs, per-bank balances) kept out of the shared ledger; hashes on-chain. |
| Distributed deployment | Map the 25 lab machines to roles (orderers, peers, REST/customer hosts, explorer, monitoring); per-host compose files or Ansible + runbook. |
| Observability | Prometheus/Grafana over Fabric metrics + FastAPI metrics; structured logging. |

### 4.2 Compliance & risk engine

| Task | Detail |
|---|---|
| KYC/KYB workflows | Onboarding with bank-staff approval; document storage off-chain; status lifecycle. |
| Transaction monitoring | Rule engine (threshold, velocity, cross-border) enforced at the **auditor** layer — the auditor signs every transaction and can reject [R13]; plus backend alerts. |
| Sanctions/watchlists + travel rule | Python service with configurable lists. |
| Freeze / unfreeze / legal holds | Auditor-enforced exclusion; owner nodes refuse to spend frozen tokens. |
| Reporting | Central-bank reports: money supply, velocity, per-bank stats; compliance dashboard. |

### 4.3 Monetary policy & settlement

| Task | Detail |
|---|---|
| Interbank settlement | Wholesale flows between banks; reserve balances at the CB; settlement finality on the settlement channel [R18][R19]. |
| Reserve & liquidity | Per-bank reserve tracking; intraday liquidity visibility. |
| Interest / remuneration | ADR-0011: off-chain accrual + periodic on-chain payment txn vs. custom chaincode (evaluate against token-sdk capabilities) [R13]. |
| Programmability | Escrow / vesting / conditional payments using token-sdk swap; HTLC evaluation [R12][R13]. |

### 4.4 Wallet & UX expansion

QR and merchant payments, request money, top-up/cash-out, statements, notifications, multi-account.

### 4.5 Ops, security, delivery

| Task | Detail |
|---|---|
| API gateway + auth | OAuth2/OIDC; role-based access (CB vs bank vs customer); rate limiting. |
| CI/CD | Lint, unit/integration tests, chaincode package/build, deploy scripts. |
| Backups & DR | Ledger snapshots / join-from-snapshot; CouchDB backups; runbook. |
| Key & cert management | Per-org Fabric CA operations; certificate rotation; idemix wallet lifecycle. |
| Chaincode upgrades | Documented process + scripts for token-chaincode version upgrades. |

### 4.6 Phase 4 Work Breakdown Structure & Effort Estimation

Estimated team basis: **1 Senior Blockchain / Go Engineer + 1 Fullstack Python/React Engineer**.

| Subsystem | Scope & Key Deliverables | Complexity | Estimated Effort |
|---|---|---|---|
| **4.1 Architecture & Consensus** | • Upgrade ordering service from Raft to **SmartBFT** (4+ orderers with `ConsenterMapping`).<br>• Split single channel into **Multi-Channel** topology (`settlement`, `retail`, `registry`).<br>• Introduce **Private Data Collections (PDC)** for customer KYC data hashing. | **High** | **2–3 Weeks** |
| **4.2 Compliance & Risk Engine** | • Enforce transaction rules & travel rule at the **Go Smart Client Auditor layer**.<br>• Automated sanctions screening against configurable watchlist APIs.<br>• On-chain token freeze / legal hold enforcement in FSC owner flows. | **Medium-High** | **2 Weeks** |
| **4.3 Monetary Policy & Settlement** | • Interbank reserve tracking & wholesale RTGS-style liquidity pools.<br>• Automated interest accrual engine (ADR-0011).<br>• Programmable escrow and conditional swaps (HTLC primitives). | **Medium** | **1–2 Weeks** |
| **4.4 Wallet & Retail UX** | • QR-code payments (generation and scanning in React SPA).<br>• Merchant payment acceptance flows & transaction push notifications.<br>• Mock core banking top-up and cash-out integration. | **Low-Medium** | **1 Week** |
| **4.5 Security & Ops Delivery** | • API Gateway with OAuth2/OIDC RBAC auth & rate-limiting.<br>• Automated CI/CD pipelines & ledger snapshot/join runbooks. | **Medium** | **1 Week** |
| **Total Phase 4 Effort** | **Full Comprehensive Banking System** | **Comprehensive** | **6–8 Weeks (1.5–2 mo)** |

**Phase-4 ADRs to write:** ADR-0010 (compliance at auditor layer vs chaincode), ADR-0011 (interest model), ADR-0012 (channel/data-governance design), ADR-0013 (deployment topology on the lab LAN).

**Sources:** [R1][R2] BFT; [R3] channels/test network; [R13] token-sdk; [R18][R19] Project Agila; [R20][R21] CBDC context.

---

## Phase 5 — Performance, security & hardening

| Task | Detail |
|---|---|
| Caliper benchmarks | Suites: intra-bank transfer, cross-bank transfer, mixed (issue/transfer/redeem), high-contention UTXO. Metrics: TPS, latency p50/p95/p99, success rate, CPU/mem/IO [R15]. |
| Distributed benchmark | Load from multiple lab hosts; measure host-placement effects. |
| Tuning pass | Block size/batch timeout; v3.1 write batching (`useWriteBatch`) and read batching [R1]; CouchDB indexes; gossip/fanout; gateway settings. |
| Benchmark report | `docs/BENCHMARKS.md`: results, bottlenecks, recommendations. |
| Fabric-X research track | Evaluate `hyperledger/fabric-x` + samples (UTXO CBDC, 200k+ TPS claim, Arma BFT) as comparison/alternate [R8][R9][R10][R16][R17]. |
| Security hardening | Full TLS, minimal exposed ports, secret management, secure CA operations, dependency/CVE scans. |

**Exit criteria:** quantified throughput/latency on the real lab network; tuning guide; go/no-go view on Fabric-X.

**Sources:** [R1] v3.1 batching; [R8][R9][R10] Fabric-X/Arma; [R15] Caliper; [R16][R17] Fabric-X deployment.

---

## Phase 6 — Future vision / production path

- HSM-backed key management and certified crypto custody.
- Offline payments (research) and device wallets.
- Cross-border interoperability (mBridge-style) and ISO 20022 messaging.
- Real-time gross settlement (RTGS) integration and a 24/7 operating model.
- Regulatory-sandbox engagement; alignment with Nepal Rastra Bank digital-currency direction.
- Production-grade operations: Kubernetes, SRE, multi-region DR.
- Token standards / interoperability via Fabric-X EVM.

**Sources:** [R7][R8] Fabric-X; [R20][R21] CBDC landscape; [R22] Nepal context.

---

## Risk register

| Risk | Mitigation |
|---|---|
| token-sdk under active development; version-sensitive | Pin exact commit hashes (W1.7); Phase 2 de-risking [R13]. |
| 2-week scope creep | Phase-3 scope frozen; everything else explicitly deferred. |
| Only one developer experienced with Go/Rust | Phase 3 requires ~zero custom Go; document Go touch-points; pair on fixes. |
| SmartBFT complexity | Deliberately deferred to Phase 4 (ADR-0003) [R2]. |
| LAN distribution (ports/firewalls) | Document required ports; runbook; Week-2 stretch covers a 3-host run first. |
| ZK overhead on throughput | Measured in Phase 5; token-sdk benchmarks known; Fabric-X track as fallback [R8][R9]. |
| CouchDB memory on 8–16 GB hosts | Cap container memory; LevelDB documented as fallback (ADR-0007) [R3]. |
| Caliper currently targets Fabric v2.x Gateway SDK | Verify Caliper/Fabric-version compatibility during Phase 5 setup [R15]. |

---

## Deliverables summary

| Phase | Deliverables |
|---|---|
| 1 | README, PHASES, ARCHITECTURE, FULL-BANKING-SYSTEM, API, DEMO_AND_UI_GUIDE, BENCHMARKS, REFERENCES, ADRs 0001–0011 |
| 2 | Running token-sdk sample; pinned-version setup; verified ZK/REST/explorer |
| 3 | Settlement network (CB + N self-provisioned banks) + SWR token layer + FastAPI backend + React wallet/admin console + tests + SETUP/DEMO runbooks |
| 4 | Comprehensive system: SmartBFT, multi-channel, compliance engine, settlement, distributed lab deployment, monitoring, CI |
| 5 | Benchmark report, tuning guide, Fabric-X evaluation, security hardening |
| 6 | Roadmap doc (evolves as research completes) |
