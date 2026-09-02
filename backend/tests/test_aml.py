"""Unit tests for the AML rule engine (app.aml) — no live stack required."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.aml import (
    REPORTABLE_THRESHOLD_MINOR,
    enforce_outflow,
    post_outflow_checks,
    screen_name,
    tier_for,
)
from app.models import Account, AMLAlert, Bank, Base, TransactionLog, WatchlistEntry


@pytest.fixture()
def session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    bank = Bank(code="001", name="testbank", msp_id="Bank001MSP", owner_node="owner1")
    s.add(bank)
    s.flush()
    yield s, bank
    s.close()


def _account(session, bank, **kw):
    defaults = dict(
        account_number="SWR-001-00000001",
        full_name="Alice Smith",
        wallet="pool_001_w2",
        bank_id=bank.id,
        kyc_level=1,
        transfer_limit_minor=100_000,
    )
    defaults.update(kw)
    acc = Account(**defaults)
    session.add(acc)
    session.flush()
    return acc


def _outflow(session, acc, amount_minor, minutes_ago=0):
    session.add(
        TransactionLog(
            txid=f"tx{minutes_ago}-{amount_minor}",
            tx_type="transfer",
            from_account=acc.account_number,
            to_account="SWR-001-00000099",
            amount_minor=amount_minor,
            created_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
        )
    )
    session.flush()


def test_tier_caps(session):
    s, _ = session
    assert tier_for(0).per_tx_minor == 50_000
    assert tier_for(1).daily_minor == 500_000
    assert tier_for(5).per_tx_minor == tier_for(3).per_tx_minor  # clamped


def test_per_tx_cap_enforced(session):
    s, bank = session
    acc = _account(s, bank)
    # tier 1 cap is 100k minor; account limit 100k → 100001 refused
    with pytest.raises(HTTPException) as exc:
        enforce_outflow(s, acc, 100_001)
    assert exc.value.status_code == 403
    enforce_outflow(s, acc, 100_000)  # at cap, ok


def test_account_limit_lower_than_tier(session):
    s, bank = session
    acc = _account(s, bank, transfer_limit_minor=10_000)
    with pytest.raises(HTTPException):
        enforce_outflow(s, acc, 10_001)


def test_daily_cumulative(session):
    s, bank = session
    acc = _account(s, bank)
    _outflow(s, acc, 300_000, minutes_ago=30)
    _outflow(s, acc, 150_000, minutes_ago=10)
    # tier-1 daily cap 500_000: 450_000 sent → 50_000 more ok, 50_001 refused
    enforce_outflow(s, acc, 50_000)
    with pytest.raises(HTTPException) as exc:
        enforce_outflow(s, acc, 50_001)
    assert "daily cumulative" in exc.value.detail


def test_daily_count(session):
    s, bank = session
    acc = _account(s, bank)
    for i in range(20):  # tier-1 daily_count = 20
        _outflow(s, acc, 1_000, minutes_ago=i + 1)
    with pytest.raises(HTTPException) as exc:
        enforce_outflow(s, acc, 1_000)
    assert "count limit" in exc.value.detail


def test_large_transaction_alert(session):
    s, bank = session
    acc = _account(s, bank)
    alerts = post_outflow_checks(s, acc, None, REPORTABLE_THRESHOLD_MINOR, "tx1")
    s.flush()
    assert [a.rule for a in alerts] == ["large_transaction"]
    assert alerts[0].severity == "medium"
    assert acc.status == "active"


def test_velocity_flags_account(session):
    s, bank = session
    acc = _account(s, bank)
    for i in range(11):
        _outflow(s, acc, 1_000, minutes_ago=i)
    alerts = post_outflow_checks(s, acc, None, 1_000, "txv")
    s.flush()
    rules = [a.rule for a in alerts]
    assert "velocity" in rules
    assert acc.status == "flagged"
    assert s.query(AMLAlert).filter(AMLAlert.rule == "auto_flag").count() == 1


def test_structuring_detected(session):
    s, bank = session
    acc = _account(s, bank)
    just_under = int(REPORTABLE_THRESHOLD_MINOR * 0.9)
    for i in range(3):
        _outflow(s, acc, just_under, minutes_ago=i * 60 + 5)
    alerts = post_outflow_checks(s, acc, None, just_under, "txs")
    s.flush()
    assert "structuring" in [a.rule for a in alerts]
    assert acc.status == "flagged"


def test_no_structuring_below_threshold(session):
    s, bank = session
    acc = _account(s, bank)
    small = int(REPORTABLE_THRESHOLD_MINOR * 0.3)
    for i in range(4):
        _outflow(s, acc, small, minutes_ago=i * 60)
    alerts = post_outflow_checks(s, acc, None, small, "txn")
    assert [a.rule for a in alerts] == []


def test_watchlist_screening(session):
    s, bank = session
    s.add(WatchlistEntry(list_type="sanction", value="john doe", note="OFAC demo"))
    s.add(WatchlistEntry(list_type="pep", value="Smith", note="political exposure"))
    s.flush()
    assert [e.list_type for e in screen_name(s, "John   DOE")] == ["sanction"]
    assert [e.list_type for e in screen_name(s, "Jane Smith")] == ["pep"]
    assert screen_name(s, "Rita Shrestha") == []
