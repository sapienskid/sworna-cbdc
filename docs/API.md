# API — Sworna REST endpoint catalog

Two REST surfaces:

1. **Banking backend (FastAPI, `:8000`)** — the user-facing API: auth, banks,
   accounts, payments by account number, admin, provisioning. This is what the
   portals talk to.
2. **Token engine (Go)** — the settlement layer (issue/transfer/redeem with ZK):
   issuer/auditor `:9100`/`:9000` on the CB host, and each bank's owner REST at
   `:9200+100(k−1)` on its own VM. The backend resolves owner URLs from the
   owner node name (`app/owner_urls.py`); see
   `docs/token-network/06-api-contracts.md` for the engine's contracts.

Interactive docs: backend `http://localhost:8000/docs` · engine `:8080`.

---

## Banking backend (`/api/v1`)

Auth: `Authorization: Bearer <jwt>` from `POST /auth/login`.

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/login` | `{username, password}` → token + role (`cb_admin`/`bank_staff`/`customer`) |
| GET | `/auth/me` | current user info |

### Banks (cb_admin manages; bank_staff sees own)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/banks` | list banks (scoped) |
| POST | `/banks` | create a bank `{code, name, msp_id, owner_node, pool_size, permissions}` |
| PATCH | `/banks/{code}/status` | `registered` / `active` / `suspended` |
| PATCH | `/banks/{code}/permissions` | `{can_redeem, interbank_limit_minor, redeem_limit_minor}` |

### Accounts
| Method | Endpoint | Description |
|---|---|---|
| GET | `/accounts` | list accounts (scoped by role/bank) |
| POST | `/accounts` | onboard a customer: `{full_name, username, password, kyc_level, transfer_limit}` → assigns a wallet from the bank's pool + an account number |
| GET | `/accounts/{account_number}` | account detail |
| PATCH | `/accounts/{account_number}/status` | `active` / `flagged` / `frozen` |
| GET | `/accounts/{account_number}/balance` | SWR balance (major units) |
| GET | `/accounts/{account_number}/statements` | history with account numbers, not wallet names |

Account numbers: `SWR-<bank code>-<8 digits>` (e.g. `SWR-001-00000001`).

### Payments
| Method | Endpoint | Description |
|---|---|---|
| POST | `/payments/transfer` | `{from_account, to_account, amount, reference}` — cross-bank settles on the ledger |
| POST | `/payments/redeem` | `{account, amount, reference}` — requires bank `can_redeem` |

Enforced before proxying: sender `active`, recipient not `frozen`, account
transfer limit, bank interbank/redeem limits.

### Admin (cb_admin)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/admin/issue` | `{to_account, amount, reference}` |
| POST | `/admin/banks/{code}/provision` | **generate the bank's wallet-pool keys** via the token CA |
| GET | `/admin/overview` | total supply + per-bank circulation + account counts |
| GET | `/admin/transactions` | recent transaction log |
| GET | `/admin/ledger` | channel height + recent blocks (peer CLI + configtxlator) |

---

## Data model

- `bank`: code (`001`), name, msp_id, owner_node, portal_url, status,
  permissions (JSON), pool_size, wallet_pool (JSON manifest), joined_at.
- `account`: account_number (unique), full_name, wallet (internal idemix id),
  status, kyc_level, transfer_limit_minor, bank.
- `user`: username, password_hash, role, bank_code, account_number.
- `transaction_log`: txid, tx_type, from_account, to_account, amount_minor,
  reference, status.

## References

- Provisioning model: `docs/token-network/08-provisioning.md`
- Token-engine contracts: `docs/token-network/06-api-contracts.md`