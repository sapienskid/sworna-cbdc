# AML & Compliance — the rule engine, thresholds and alerts

Sworna's anti-money-laundering controls live in **two layers**:

1. **Cryptographic gate (on-chain, always on).** The central bank's auditor
   node co-signs every token transaction and can de-blind every amount and
   counterparty. No transaction can commit without it. This is described in
   [BLIND-SIGNATURES-AND-PRIVACY.md](BLIND-SIGNATURES-AND-PRIVACY.md) §4.
2. **Rule engine (off-chain, in the banking backend).** Codified AML rules —
   KYC-tiered limits, daily cumulative caps, velocity, structuring, watchlist
   screening — enforced in `backend/app/aml.py` *before* a payment is proxied
   to the token services, with alerts raised *after* the ledger confirms it.
   This document is about layer 2 (ADR-0011).

> **Why off-chain?** The token chaincode verifies cryptographic validity only;
> it has no notion of customers, KYC or names (they live only in the bank
> registries — that is what makes the privacy layer work). Real-world CBDC
> designs therefore split compliance the same way: the ledger enforces
> *who is allowed to transact at all* (auditor gate), the banking layer
> enforces *how much and how often*, and the auditor provides the complete
> de-blinded audit trail for investigations.

---

## 1. Rule catalogue

All thresholds are in minor units (1 SWR = 100 minor) and configurable via
environment variables (see §5). Defaults:

| Rule | Trigger | Effect |
|---|---|---|
| **Per-transaction cap** | amount > min(account's own `transfer_limit`, KYC-tier cap) | Payment refused (403) |
| **Daily cumulative cap** | today's outgoing transfers + cash-outs + this payment > tier daily cap | Refused (403) |
| **Daily count cap** | today's outgoing tx count + 1 > tier count cap | Refused (403) |
| **Large transaction** | single outflow ≥ reportable threshold (default 1,000 SWR) | Alert (medium), payment proceeds |
| **Velocity** | > 10 outflows within a rolling 60 minutes | Alert (high) + account auto-flagged |
| **Structuring** | ≥ 3 outflows in 24 h, each ≥ 80 % of the threshold, summing ≥ threshold | Alert (high) + account auto-flagged |
| **Watchlist — sanctions** | recipient or new customer name matches a `sanction` entry | Payment/onboarding refused (403) + alert (high) |
| **Watchlist — PEP / internal** | name matches a `pep` or `internal` entry | Alert (medium), payment proceeds |

"Outgoing flows" for the daily rules are `transfer` and `withdraw`
(cash-out) transaction logs whose sender is the account, per UTC day.

### Auto-flagging

A `flagged` account **cannot send payments or cash out** until bank staff
reset its status (`PATCH /accounts/{n}/status` → `active`). The CB sees the
flag in every alert, and the compliance console's *Flagged Accounts* KPI.
Freezing (`frozen`) is stronger — staff-imposed, blocks everything.

## 2. KYC tiers

Each account carries a `kyc_level` (0–3) set by the bank at onboarding. The
tier sets the AML envelope; the account-level `transfer_limit` can only
tighten it, never loosen it.

| Tier | Label | Per-tx cap | Daily cumulative | Daily count |
|---|---|---|---|---|
| 0 | Unverified | 500 SWR | 1,000 SWR | 3 |
| 1 | Basic | 1,000 SWR | 5,000 SWR | 20 |
| 2 | Verified | 10,000 SWR | 50,000 SWR | 100 |
| 3 | Enhanced | 1,000,000 SWR | 500,000 SWR ×1000 | 1,000 |

(The live table is served by `GET /admin/aml/summary` and rendered on the CB
*AML Compliance* page.)

## 3. Watchlist screening

Entries (`list_type` = `sanction` | `pep` | `internal`, `value`, `note`) are
managed by CB auditors and matched **case-insensitively, as substrings** of
customer full names:

- **At onboarding** (`POST /accounts`): a sanctions match refuses the
  onboarding outright and raises a high alert; a PEP/internal match opens the
  account in `flagged` state with a medium alert.
- **On every transfer**: the recipient's registry name is screened. Sanctions
  match → the payment is refused and a high alert is stored; PEP/internal →
  medium alert, payment proceeds.

Matching is deliberately simple (substring, normalized whitespace). It is a
demonstration control, not a production sanctions scanner — see
[SECURITY-MODEL.md](SECURITY-MODEL.md) for limitations.

## 4. Alerts lifecycle

1. Rules raise `AMLAlert` rows (`rule`, `severity`, `account`, `counterparty`,
   `txid`, `details`). Alerts for refused payments are committed even though
   the payment is rolled back.
2. CB auditors work the queue at **CB portal → AML Compliance**:
   filter by status/severity, **Review** (acknowledge) or **Dismiss** with a
   note; reviewer and timestamp are recorded.
3. Alerts feed the KPI row (open, high-severity, flagged accounts) and can be
   exported to CSV for reporting.

## 5. Configuration knobs (env vars)

| Variable | Default | Meaning |
|---|---|---|
| `SWORNA_AML_THRESHOLD` | 100000 minor | reportable threshold |
| `SWORNA_AML_VELOCITY_WINDOW` | 60 min | velocity window |
| `SWORNA_AML_VELOCITY_MAX` | 10 | max outflows in window |
| `SWORNA_AML_STRUCT_MIN_TXS` | 3 | minimum txs for structuring |
| `SWORNA_AML_T{0..3}_PER_TX` | per table §2 | tier per-transaction cap |
| `SWORNA_AML_T{0..3}_DAILY` | per table §2 | tier daily cumulative cap |
| `SWORNA_AML_T{0..3}_COUNT` | per table §2 | tier daily count cap |

## 6. API surface (all under `/api/v1`, CB roles)

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/admin/aml/summary` | cb_* | KPI counts + live tier table + threshold |
| GET | `/admin/aml/alerts?status=&severity=&bank_code=` | cb_* | list alerts (newest first) |
| PATCH | `/admin/aml/alerts/{id}` | cb_admin, cb_auditor | `{status: reviewed|dismissed, note}` |
| GET | `/admin/aml/watchlist` | cb_* | list entries |
| POST | `/admin/aml/watchlist` | cb_admin, cb_auditor | `{list_type, value, note}` |
| DELETE | `/admin/aml/watchlist/{id}` | cb_admin, cb_auditor | deactivate (soft delete) |

## 7. Demo script (AML in 4 minutes)

1. As CB admin, add a `sanction` watchlist entry for a name, e.g.
   "Sanctioned Person" (AML Compliance → Add entry).
2. As bank staff, try onboarding that name → refused with 403; try a PEP name
   → account opens `flagged` (visible in the accounts table).
3. Move money: make several near-threshold transfers from one account within
   minutes — the **structuring** rule fires, the account is auto-flagged, and
   open alerts appear on the compliance console.
4. Review/dismiss the alerts; then (as bank staff) reset the account status
   back to `active` and show that payments flow again.

Unit tests for every rule live in `backend/tests/test_aml.py`
(`cd backend && .venv/bin/python -m pytest tests/test_aml.py -q`) — they run
without a ledger.
