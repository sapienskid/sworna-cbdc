# ADR-0011: AML enforcement lives off-chain in the banking layer

**Status:** Accepted
**Date:** 2026-09-02
**Applies to:** Phase 3+ (retail banking features)

## Context

The on-ledger privacy model hides amounts and parties from everyone except
the CB auditor, and the token chaincode validates *cryptographic* validity
only — it has no concept of customers, KYC tiers, names or limits (that data
lives solely in the off-chain registries, which is what makes the privacy
guarantees possible). Regulatory controls therefore had to be placed
somewhere:

1. **In the chaincode** — requires leaking identity/limit data on-chain and
   writing custom chaincode (rejected in ADR-0001/0010), and would defeat the
   zkatdlog privacy model.
2. **In the banking backend** — the layer that already owns accounts, KYC
   levels, statuses and bank permissions, and which every payment must pass
   through anyway.
3. **Auditor-side only** — detect but not prevent; the auditor gate already
   sees everything post hoc, but velocity/limit *prevention* belongs where
   the payment request enters.

## Decision

AML is a **rule engine in the FastAPI banking layer** (`backend/app/aml.py`):

- Pre-transaction gates: KYC-tier per-transaction cap (min of account limit
  and tier cap), daily cumulative cap, daily count cap, watchlist screening
  (sanctions → refuse; PEP/internal → alert).
- Post-transaction rules on the off-chain tx mirror: large-transaction
  alerts, velocity breach, structuring detection; both high-severity rules
  auto-flag the account (flagged accounts cannot send until staff reset).
- Alerts + watchlist + tier tables are exposed to the CB compliance console
  (`/admin/aml/*`, see docs/AML-COMPLIANCE.md).

The ledger-side backstop remains the **auditor co-signature** on every
transaction: nothing commits without the CB seeing it.

## Consequences

**Positive:** rules evolve without touching Go/chaincode; unit-testable
(`backend/tests/test_aml.py`, no ledger needed); thresholds configurable via
env; consistent with the compartmentalization that enables privacy.

**Negative/risks:** rules bind only requests through the backend — a caller
with direct network access to an owner node bypasses them (mitigated by the
auditor gate and by the topology restrictions in
[SECURITY-MODEL.md](../SECURITY-MODEL.md) §5.1); daily windows are UTC-day
based, not rolling 24 h for the cumulative cap.

## References

- docs/AML-COMPLIANCE.md — rule catalogue, thresholds, API, demo script
- docs/token-network/03-utxo-zk-model.md — why identity data is off-chain
- ADR-0004 (CB is issuer and auditor), ADR-0008 (two-tier model)
