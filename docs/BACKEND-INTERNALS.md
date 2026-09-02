# Backend Internals — the FastAPI banking layer, module by module

The backend (`backend/app/`) is the **off-chain banking layer**: registry,
policy, AML, and the REST adapter in front of the Go token engine. Python is
deliberately not allowed near the ledger (ADR-0005, ADR-0010): the backend
only talks HTTP to the issuer / owner / auditor services, which do all crypto.

```
React portals ──► FastAPI (:8000) ──► issuer/auditor (CB host :9100/:9000)
                        │            └─► owner{k}.sworna.example.com (:9200+100(k−1))
                        └─► SQLite (backend/sworna.db) — registry + AML + tx mirror
```

Interactive API docs: `http://localhost:8000/docs` (Swagger). Endpoint
catalog: [API.md](API.md).

---

## 1. Module map

| Module | Responsibility |
|---|---|
| `main.py` | FastAPI app, lifespan (create schema, seed `cbadmin`), CORS, routers, SPA static serving from `web/dist` |
| `config.py` | `Settings` dataclass: issuer/auditor URLs, SQLite path, decimals — all overridable via `SWORNA_*` env vars |
| `paths.py` | Derives repo/bin/network/token-services paths; do not export `SWORNA_BIN` etc. unless overriding deliberately |
| `models.py` | SQLAlchemy models: `Bank`, `Account`, `User`, `TransactionLog`, `WatchlistEntry`, `AMLAlert` |
| `schemas.py` | Pydantic request/response models. Amounts are `Decimal` major units at the boundary |
| `amounts.py` | `to_minor` / `to_swr` — every token-service call uses integer minor units (2 decimals) |
| `accounts.py` | Account-number format `SWR-<bank>-<8 digits>` |
| `security.py` | PBKDF2-HMAC-SHA256 (120k iters) password hashing; JWT HS256, 12 h TTL (`SWORNA_JWT_SECRET`, `SWORNA_JWT_TTL_HOURS`) |
| `deps.py` | `get_current_user` (Bearer), `require_roles`, role predicates `is_cb_user` / `is_bank_user` |
| `database.py` | Engine + session (no auto-commit; routers commit) |
| `seed.py` | Seeds only `cbadmin` (password `SWORNA_CB_ADMIN_PASSWORD`, default `sworna-cb`) |
| `provisioning.py` | Token-CA client: owner FSC identities + idemix pool wallets |
| `token_client.py` | Async HTTP client for issuer/owner/auditor REST (`TokenServiceError` on any failure) |
| `owner_urls.py` | `owner{k}` → `http://owner{k}.sworna.example.com:{9200+100(k−1)}/api/v1`, overridable per node |
| `aml.py` | The AML rule engine (see [AML-COMPLIANCE.md](AML-COMPLIANCE.md)) |
| `routers/auth.py` | `POST /auth/login`, `GET /auth/me` |
| `routers/registry.py` | Banks, accounts, balances, statements, reserve deposit/withdraw |
| `routers/payments.py` | Transfer + redeem, with the full pre/post AML pipeline |
| `routers/admin.py` | Mint/allocate/burn, provisioning, ledger monitor, users, AML console API, crypto-params API |

## 2. Roles and scoping

Roles (in the JWT and `users.role`):

- **CB roles**: `cb_admin` (everything), `cb_mint_officer` (mint/allocate/burn),
  `cb_auditor` (AML review, read-mostly).
- **Bank roles**: `bank_staff`, `bank_admin` — scoped to their own `bank_code`.
  CB roles pass the same dependencies as supervisors but are never scoped.
- **`customer`** — confined to their own account.

Scoping is centralized in `deps.is_bank_user(user)`; every registry/payment
query filters by `Bank.code == user.bank_code` for bank users. Cross-bank
access returns 403 (covered by `backend/tests/test_banking.py::test_bank_scoping`).

## 3. The two-tier money model, as code

- **Mint** (`POST /admin/mint`, CB): issue SWR *into a bank's reserve wallet*
  `pool_{code}_w1` via the issuer node. Logged as `tx_type="issue"`.
- **Cash-in** (`POST /bank/deposit`, bank staff): transfer reserve → customer
  wallet (owner node). `tx_type="deposit"`.
- **Transfer** (`POST /payments/transfer`, customer/bank): wallet → wallet on
  the owner nodes; cross-bank works because owner nodes resolve remote
  counterparties over libp2p. `tx_type="transfer"`.
- **Cash-out** (`POST /bank/withdraw`): customer wallet → reserve. Note this
  is *not* a redemption — tokens stay inside the bank. `tx_type="withdraw"`.
- **Redeem/burn**: `POST /payments/redeem` (bank-authorized retail redemption)
  and `POST /admin/burn` (wholesale) actually destroy tokens via `tx.Redeem`.
  `tx_type="redeem"` / `"burn"`.
- **Allocate** (`POST /admin/allocate`): wholesale reserve→reserve transfer
  between banks (liquidity settlement). `tx_type="wholesale_allocation"`.

On-ledger balances are the only balances (`GET /owner/accounts/{wallet}`);
the SQLite `transaction_log` is a *mirror for reporting*, not the source of
truth.

## 4. Wallet pool mechanics

Each bank owns a deterministic pool of idemix wallets
`pool_{code}_w1..w{pool_size}`; `w1` is the master reserve vault. The pool
manifest lives on the `banks` row as JSON `{"used": [...], "free": [...]}`:

1. `POST /admin/banks/{code}/provision` (CB) mints whatever is missing: the
   owner node's FSC x509 identity (`fsc owner{k}`) and any pool wallets whose
   `SignerConfig` doesn't exist yet. **Idempotent** — safe to re-run.
2. `POST /accounts` (bank staff) pops the head of `free` for the new customer
   under a row lock (`SELECT … FOR UPDATE` on the bank row, so concurrent
   onboardings can't draw the same wallet or race the account-number
   sequence).
3. The owner conf on the bank's VM declares the same wallet ids (rendered by
   `scripts/render-owner-conf.py`), so the CB never ships key material.

Exhausted pool → 409 with a clear message; provision again with a larger
pool. Full flow: `docs/token-network/08-provisioning.md`.

## 5. Request flow: transfer end-to-end

`POST /payments/transfer` (`routers/payments.py`) — the most complete path:

1. Auth (JWT → `User`), load sender/recipient **from the registry** — both
   must be registered accounts (no guessed wallets).
2. Status gates: neither bank `suspended`; sender `active`; recipient not
   `frozen`. Role scoping check.
3. **AML pre-checks** (`aml.enforce_outflow`): per-tx cap, daily cumulative,
   daily count.
4. Interbank permission check (bank `interbank_limit_minor`).
5. **Watchlist screening** (`aml.screen_counterparty`): sanctions match → 403
   + persisted alert.
6. Proxy to the owner node (`token_client.transfer`) → txid.
7. Persist `TransactionLog`, then **AML post-checks**
   (`aml.post_outflow_checks`): large-transaction / velocity / structuring
   alerts, auto-flagging. Commit.

Failures at 1–5 are cheap and local; failure at 6 leaves no registry trace;
the ledger is the final arbiter at commit.

## 6. Ledger monitor

`GET /admin/ledger` shells out to the Fabric `peer` CLI
(`peer channel getinfo` / `peer channel fetch` → `configtxlator proto_decode`)
to show channel height and the last blocks. Each request uses unique temp
files; requires the peer CLI + CB org admin certs on the CB host. It is a
read-only monitor, not a data path — the app never depends on it.

## 7. Testing

- `backend/tests/test_banking.py` — integration smoke suite against a running
  stack (registers two runtime banks, provisions them, exercises scoping and
  the full issue→transfer→redeem flow; ledger tests auto-skip without owner
  nodes).
- `backend/tests/test_aml.py` — pure unit tests for the AML engine
  (`pytest tests/test_aml.py -q`), no services needed.

## 8. Known sharp edges

- The Go engine's REST endpoints are **unauthenticated by the upstream
  sample**; network position is the defense. See
  [SECURITY-MODEL.md](SECURITY-MODEL.md) before exposing anything.
- `to_minor` rounds HALF_UP; amounts below the minor unit round *up*.
- `TransactionLog.status` is written `Confirmed` optimistically; a later
  finality failure would require operator reconciliation (visible as a
  balance mismatch in `/admin/overview`, which reports unreachable wallets).
