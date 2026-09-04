"""AML rule engine.

All limits live off-chain (the banking registry), because the on-chain auditor
gate only verifies cryptographic validity of token transactions (see
docs/token-network/03-utxo-zk-model.md). Every customer-facing outflow
(transfer, cash-out) passes through :func:`enforce_outflow` BEFORE the token
call, and :func:`post_outflow_checks` runs AFTER the ledger confirms the
transaction to raise alerts and auto-flag accounts.

Rule catalogue (thresholds in minor units; 1 SWR = 100 minor):

- per-tx cap       : min(account transfer_limit, KYC-tier per-tx cap)
- daily cumulative : sum of the account's outgoing transfers + cash-outs in
                     the UTC day must stay under the KYC-tier daily cap
- daily count      : outgoing transactions per UTC day capped per KYC tier
- large transaction: any single outflow >= REPORTABLE_THRESHOLD raises a
                     medium-severity alert (currency-transaction-report style)
- velocity         : more than VELOCITY_MAX_TXS outflows inside the rolling
                     VELOCITY_WINDOW_MINUTES raises a high-severity alert and
                     auto-flags the sender account
- structuring      : >= STRUCTURING_MIN_TXS outflows in 24 h, each >= 80 % of
                     the reportable threshold, summing >= the threshold raises
                     a high-severity alert and auto-flags the sender
- watchlist        : sanctions match blocks the payment (403) and raises a
                     high-severity alert; PEP / internal matches raise
                     medium-severity alerts but allow the payment
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Account, AMLAlert, TransactionLog, WatchlistEntry

OUTFLOW_TYPES = ("transfer", "withdraw")


@dataclass(frozen=True)
class Tier:
    label: str
    per_tx_minor: int
    daily_minor: int
    daily_count: int


def _env_int(name: str, default: int) -> int:
    return int(os.getenv(name, str(default)))


KYC_TIERS: dict[int, Tier] = {
    0: Tier("Unverified", per_tx_minor=_env_int("SWORNA_AML_T0_PER_TX", 50_000),
            daily_minor=_env_int("SWORNA_AML_T0_DAILY", 100_000),
            daily_count=_env_int("SWORNA_AML_T0_COUNT", 3)),
    1: Tier("Basic", per_tx_minor=_env_int("SWORNA_AML_T1_PER_TX", 100_000),
            daily_minor=_env_int("SWORNA_AML_T1_DAILY", 500_000),
            daily_count=_env_int("SWORNA_AML_T1_COUNT", 20)),
    2: Tier("Verified", per_tx_minor=_env_int("SWORNA_AML_T2_PER_TX", 1_000_000),
            daily_minor=_env_int("SWORNA_AML_T2_DAILY", 5_000_000),
            daily_count=_env_int("SWORNA_AML_T2_COUNT", 100)),
    3: Tier("Enhanced", per_tx_minor=_env_int("SWORNA_AML_T3_PER_TX", 100_000_000),
            daily_minor=_env_int("SWORNA_AML_T3_DAILY", 500_000_000),
            daily_count=_env_int("SWORNA_AML_T3_COUNT", 1000)),
}

REPORTABLE_THRESHOLD_MINOR = _env_int("SWORNA_AML_THRESHOLD", 100_000)  # 1,000 SWR
VELOCITY_WINDOW_MINUTES = _env_int("SWORNA_AML_VELOCITY_WINDOW", 60)
VELOCITY_MAX_TXS = _env_int("SWORNA_AML_VELOCITY_MAX", 10)
STRUCTURING_MIN_TXS = _env_int("SWORNA_AML_STRUCT_MIN_TXS", 3)
STRUCTURING_RATIO = 0.8


def tier_for(kyc_level: int) -> Tier:
    return KYC_TIERS.get(max(0, min(3, kyc_level)), KYC_TIERS[1])


def _norm(name: str) -> str:
    return re.sub(r"\s+", " ", name).strip().casefold()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def screen_name(session: Session, full_name: str, threshold: float = 85.0) -> list[WatchlistEntry]:
    """Return active watchlist entries matching the name using RapidFuzz fuzzy partial ratio."""
    value = _norm(full_name)
    if not value:
        return []
    try:
        from rapidfuzz import fuzz
    except ImportError:
        fuzz = None

    entries = session.scalars(select(WatchlistEntry).where(WatchlistEntry.active)).all()
    hits = []
    for e in entries:
        needle = _norm(e.value)
        if not needle:
            continue
        if needle in value:
            hits.append(e)
        elif fuzz is not None and fuzz.partial_ratio(needle, value) >= threshold:
            hits.append(e)
    return hits


def _outflows(session: Session, account_number: str, since: datetime) -> list[TransactionLog]:
    return session.scalars(
        select(TransactionLog).where(
            TransactionLog.from_account == account_number,
            TransactionLog.tx_type.in_(OUTFLOW_TYPES),
            TransactionLog.created_at >= since,
        )
    ).all()


def daily_usage(session: Session, account_number: str, now: datetime | None = None) -> tuple[int, int]:
    """(minor units sent today, tx count today) in UTC-day terms."""
    now = now or _utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    rows = _outflows(session, account_number, day_start)
    return sum(r.amount_minor for r in rows), len(rows)


def enforce_outflow(session: Session, sender: Account, amount_minor: int) -> None:
    """Pre-transaction AML gates. Raises HTTPException on any breach."""
    tier = tier_for(sender.kyc_level)
    per_tx_cap = min(sender.transfer_limit_minor, tier.per_tx_minor)
    if amount_minor > per_tx_cap:
        raise HTTPException(
            403,
            f"amount exceeds the per-transaction limit for KYC tier {sender.kyc_level} "
            f"({tier.label}); cap {per_tx_cap / 100:.2f} SWR",
        )

    sent_today, count_today = daily_usage(session, sender.account_number)
    if sent_today + amount_minor > tier.daily_minor:
        raise HTTPException(
            403,
            f"daily cumulative limit of {tier.daily_minor / 100:.2f} SWR for KYC tier "
            f"{sender.kyc_level} would be exceeded (already sent {sent_today / 100:.2f} SWR today)",
        )
    if count_today + 1 > tier.daily_count:
        raise HTTPException(
            403,
            f"daily transaction count limit ({tier.daily_count}) for KYC tier "
            f"{sender.kyc_level} reached",
        )


def create_alert(
    session: Session,
    *,
    rule: str,
    severity: str,
    account: Account | None,
    counterparty: str = "",
    txid: str = "",
    amount_minor: int = 0,
    details: str = "",
) -> AMLAlert:
    alert = AMLAlert(
        rule=rule,
        severity=severity,
        status="open",
        account_number=account.account_number if account else "",
        bank_code=account.bank_code if account else "",
        counterparty=counterparty,
        txid=txid,
        amount_minor=amount_minor,
        details=details[:500],
    )
    session.add(alert)
    return alert


def _flag(session: Session, account: Account, reason: str) -> None:
    if account.status == "active":
        account.status = "flagged"
        create_alert(
            session, rule="auto_flag", severity="high", account=account,
            details=f"account auto-flagged: {reason}",
        )


def post_outflow_checks(
    session: Session,
    sender: Account,
    recipient: Account | None,
    amount_minor: int,
    txid: str,
) -> list[AMLAlert]:
    """Post-transaction rules: alerts, auto-flagging. Never raises."""
    alerts: list[AMLAlert] = []
    now = _utcnow()

    if amount_minor >= REPORTABLE_THRESHOLD_MINOR:
        alerts.append(create_alert(
            session, rule="large_transaction", severity="medium",
            account=sender,
            counterparty=recipient.account_number if recipient else "",
            txid=txid, amount_minor=amount_minor,
            details=f"single outflow of {amount_minor / 100:.2f} SWR "
                    f">= reportable threshold {REPORTABLE_THRESHOLD_MINOR / 100:.2f} SWR",
        ))

    window_start = now - timedelta(minutes=VELOCITY_WINDOW_MINUTES)
    recent = _outflows(session, sender.account_number, window_start)
    if len(recent) > VELOCITY_MAX_TXS:
        alerts.append(create_alert(
            session, rule="velocity", severity="high", account=sender, txid=txid,
            details=f"{len(recent)} outflows within {VELOCITY_WINDOW_MINUTES} minutes "
                    f"(limit {VELOCITY_MAX_TXS}); account auto-flagged",
        ))
        _flag(session, sender, "velocity")

    day_rows = _outflows(session, sender.account_number, now - timedelta(hours=24))
    structuring_window = [
        r for r in day_rows
        if r.amount_minor >= STRUCTURING_RATIO * REPORTABLE_THRESHOLD_MINOR
    ]
    if (
        len(structuring_window) >= STRUCTURING_MIN_TXS
        and sum(r.amount_minor for r in structuring_window) >= REPORTABLE_THRESHOLD_MINOR
    ):
        alerts.append(create_alert(
            session, rule="structuring", severity="high", account=sender, txid=txid,
            details=f"{len(structuring_window)} outflows in 24 h each >= "
                    f"{STRUCTURING_RATIO:.0%} of the reportable threshold, "
                    f"summing to {sum(r.amount_minor for r in structuring_window) / 100:.2f} SWR; "
                    f"account auto-flagged",
        ))
        _flag(session, sender, "structuring")

    return alerts


def screen_counterparty(
    session: Session,
    sender: Account,
    recipient: Account,
    amount_minor: int,
) -> None:
    """Watchlist screening of the recipient name, pre-transaction."""
    hits = screen_name(session, recipient.full_name)
    if not hits:
        return
    worst = "high" if any(h.list_type == "sanction" for h in hits) else "medium"
    kinds = ",".join(sorted({h.list_type for h in hits}))
    create_alert(
        session, rule="watchlist", severity=worst, account=sender,
        counterparty=recipient.account_number, amount_minor=amount_minor,
        details=f"recipient '{recipient.full_name}' matches {kinds} watchlist entry "
                f"({'; '.join(h.note for h in hits if h.note)})",
    )
    if worst == "high":
        session.commit()  # persist the alert even though the payment is refused
        raise HTTPException(
            403, "payment blocked: recipient name matches the sanctions watchlist"
        )


def screen_onboarding(session: Session, full_name: str) -> str:
    """Returns 'blocked' | 'flagged' | 'ok' for a new customer's name."""
    hits = screen_name(session, full_name)
    if any(h.list_type == "sanction" for h in hits):
        return "blocked"
    return "flagged" if hits else "ok"
