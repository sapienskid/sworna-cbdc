# Token network — API contracts

Two REST layers:

```
React UI ──► FastAPI (:8000) ──► Go engine (issuer/auditor :9000/:9100 + per-bank owner) ──► Fabric
```

## Layer 1: FastAPI banking API (`backend/app/routers`)

The user-facing FastAPI surface evolves faster than this series. The
authoritative catalog is **[docs/API.md](../API.md)**; the module walk-through
is **[docs/BACKEND-INTERNALS.md](../BACKEND-INTERNALS.md)**. In brief:
`/auth`, `/banks`, `/accounts` (onboarding, balances, statements), `/payments`
(transfer, redeem), `/bank` (reserve deposit/withdraw), `/admin` (mint,
allocate, burn, provisioning, ledger, users), `/admin/aml` (alerts,
watchlist, summary) and `/admin/crypto` (public parameter surface).

## Layer 2: engine contracts (Go services)

All amounts are integer minor units; token code is `SWR`.

### issuer (:9100)
```json
POST /issuer/issue
{ "amount": {"code":"SWR","value":10000},
  "counterparty": {"node":"owner1","account":"alice"},
  "message": "CB issues SWR to bank 001" }
→ { "message": "...", "payload": "<txid>" }
```

### owner (one per bank, e.g. :9200 owner1, :9300 owner2, :9400 owner3)
```json
POST /owner/accounts/alice/transfer
{ "amount": {"code":"SWR","value":2000},
  "counterparty": {"node":"owner1","account":"bob"},
  "message": "intra-bank" }
→ { "message": "...", "payload": "<txid>" }

POST /owner/accounts/carlos/redeem
{ "amount": {"code":"SWR","value":150}, "message": "cash out" }

GET /owner/accounts/alice            → { "payload": {"balance":[{"code":"SWR","value":...}], "id":"alice"} }
GET /owner/accounts/alice/transactions
```

### auditor (:9000)
```json
GET /auditor/accounts/alice/transactions
→ full amounts + sender/recipient (the privileged view)
```

## Contract stability

These contracts are the boundary between the layers. The FastAPI layer owns the
*user-facing* semantics (SWR major units, AML); the engine owns the *crypto*
semantics (minor units, proofs). Changes to one must not leak into the other.