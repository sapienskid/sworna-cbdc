# TEAM — how the development team is divided

How we split the work into tracks, who owns which code, how the tracks integrate, and the weekly plan. Division is **by work**, not by arbitrary team size — pick as many people as the tracks below require.

> All team members are undergraduate students. The plan deliberately keeps the hardest technical work (the blockchain layer) small and contained, and lets everyone else build normal web/backend code they already know — in parallel, against pre-agreed API contracts.

---

## 1. Principles

1. **Contract-first parallelism** — the REST API contracts are defined up front. Frontend builds against a mocked backend; Backend builds against a mocked token service. Nobody blocks on the blockchain.
2. **One track = one folder** — no two tracks edit the same files.
3. **One integration lead** owns the seams between tracks (network ↔ backend ↔ frontend).
4. **Undergraduate-friendly** — the blockchain track is small (2–3 people); everything else is standard backend/frontend/web work.

## 2. The tracks

| Track | Size | Best-fit skills | Owns (code) | Delivers |
|---|---|---|---|---|
| **T1 Ledger & Network** | 3 (incl. the Go/Rust person) | Docker, some Go, reads Fabric docs | `network/`, `token-services/` | Running settlement network (CB org + N self-provisioned banks) + working issue/transfer/redeem REST |
| **T2 Backend (Python)** | 3 | Python, FastAPI | `backend/` | All banking APIs (registry, payments, admin, reports) |
| **T3 Frontend (React)** | 3 | JS/React | `web/` | Customer wallet + central-bank console + bank console |
| **T4 DevOps / Deployment** | 2 | Linux, bash, Docker | `scripts/`, per-host compose | One-command bring-up; 1-laptop → 3-host → 25-host |
| **T5 QA & Testing** | 2 | Python (pytest), curl | `tests/`, demo seed | e2e tests, load smoke test, demo scenario verification |
| **T6 Docs & Demo** | 1–2 | clear writing | `docs/`, `DEMO.md` | Runbooks, demo script, keeps docs current |
| **Lead** | 1 (you or strongest dev) | — | — | Integration, ADRs, unblocking, demo-day narration |

**Minimum viable team:** T1×2, T2×2, T3×2, T4×1, T5×1, Lead×1 = **9 people**.
**Full team:** T1×3, T2×3, T3×3, T4×2, T5×2, T6×1, Lead×1 = **15 people**.

## 3. What each track writes

### T1 — Ledger & Network (the hardest track; pair the Go/Rust person here)

- `network/configtx/` — organizations, MSPs, `settlement` channel definition.
- `network/organizations/` — Fabric CA configs + identity-enrollment scripts (certificates for central bank, Bank A, Bank B).
- `network/compose/` — docker-compose for peers / orderers / CAs.
- Token chaincode **deployment** (reused from the sample, not written): `tokengen` parameters (issuer = CB, auditor = CB, bank CAs), SWR token type (2 decimals), wallets (alice/bob/carol/dan).
- Token services configuration: issuer (`:9100`), auditor (`:9000`), one owner per bank (`owner{k}`, REST `:9200+100(k−1)`), confs rendered from `core.yaml.tpl`.
- Blockchain Explorer configuration.
- **Never touches** `backend/` or `web/`.

### T2 — Backend (Python / FastAPI)

- `backend/app/` — models (`customer`, `account`, `bank`, `transactionLog`) and routers.
- Registry & accounts endpoints; KYC status field (`active`/`flagged`/`frozen`); payment proxy to the token services; admin endpoints (issue/redeem/supply/circulation/overview).
- Demo seed data.
- Codes against the documented token-service API (`/api/v1/issuer/*`, `/api/v1/owner/*`, `/api/v1/auditor/*`) with a mock until T1 is ready.

### T3 — Frontend (React)

- `web/wallet/` — customer wallet: login, balance, send, receive, history.
- `web/admin/` — central-bank console (issue/redeem, supply, per-bank circulation); bank console (customers, balances, activity).
- Builds against a **mocked** backend API generated from the OpenAPI contract, in parallel.

### T4 — DevOps / Deployment

- `scripts/` — `network up/down`, `createChannel`, `deployToken`, `deploy-<role>.sh`, `seed`.
- Per-host compose files; port/firewall map (see [DEPLOYMENT.md](DEPLOYMENT.md)); later Ansible for the 25 machines; CI (lint + build).
- Validates the network bring-up path together with T1.

### T5 — QA & Testing

- `tests/` — e2e happy paths across token services + backend; load smoke test; regression tests.
- Verifies the demo scenario step by step and files defects to the owning track.
- Later (comprehensive phase): Caliper benchmark scenarios.

### T6 — Docs & Demo

- Keeps `docs/API.md`, `docs/DEPLOYMENT.md`, `docs/DEMO.md` in sync with what T1–T5 build.
- Writes the demo narrative + runbook for demo day.

### Lead

- Owns the API contract document and the integration seams.
- Maintains ADRs; resolves cross-track conflicts; unblocks; narrates demo day.

## 4. Integration points (the seams)

| Seam | Contract | Who owns it |
|---|---|---|
| Token services ↔ Backend | Token REST API: `/api/v1/issuer/issue`, `/api/v1/owner/accounts/{id}/transfer`, etc. | Lead + T1 + T2 |
| Backend ↔ Frontend | Banking API: `/api/v1/customers`, `/api/v1/payments/transfer`, `/api/v1/admin/*`, etc. | Lead + T2 + T3 |
| Deployment ↔ everyone | Bring-up scripts + per-host compose | T4 |
| Ledger ↔ Explorer | Channel/ledger connection config | T1 |

The full endpoint catalog lives in [API.md](API.md). Contracts must be frozen before week 1 ends so parallel work doesn't drift.

## 5. Dependency order & critical path

```
T1 network+token ──► token REST (:9000/:9100 + per-bank owner REST)
                          │
                          ▼
   T2 backend ──► backend REST (:8000) ──► T3 frontend
                          ▲
        T4 scripts/compose (unblocks every host)
        T5 tests against T1+T2; T6 documents everything
```

- **Week 1 critical path = T1** (network up, tokens working). Every other track works in parallel against contracts/mocks.
- **The highest integration risk is the T1 ↔ T2 seam** (token REST semantics) — the Lead owns that bridge.

## 6. Weekly plan (2-week demo)

| Week | T1 | T2 | T3 | T4 | T5 | T6 |
|---|---|---|---|---|---|---|
| **1** | settlement network (CB org + banks) + tokens | Backend registry + admin (against mock) | Wallet skeleton + mocked backend | Bring-up scripts, per-host compose | Contract tests (against mock) | Draft runbook |
| **2** | Hardening, cross-org flow verified | Wire backend → real token services | Wire UI → real backend | 3-host lab deployment | Full e2e + demo dry-run | Final demo script, docs sync |

## 7. Notes for an undergraduate team

- Put the **strongest / most curious person on T1** — Fabric is the steepest learning curve.
- **Contract-first is the safety net** — if T1 slips, T2/T3 still deliver 80% against mocks.
- Hold a **5-minute cross-track review** weekly so the API contracts don't drift.
- Ask T1 members to read the Fabric test-network and token-sdk docs early (links in [REFERENCES.md](REFERENCES.md)).
