"""Seed the banking registry (bootstrap).

Creates: the central-bank admin, the first banks, their staff logins, and the
demo accounts (which reuse the engine's existing wallets so ledger balances
remain visible). Wallet pools are provisioned on demand by the CB (see
app/provisioning.py).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .accounts import generate_account_number
from .models import Account, Bank, User
from .security import hash_password

BANKS = [
    {
        "code": "001",
        "name": "banka",
        "msp_id": "Bank1MSP",
        "owner_node": "owner1",
        "staff": "banka_admin",
        "accounts": [
            ("alice", "Alice Adhikari", "alice", 1),
            ("bob", "Bob Basnet", "bob", 1),
        ],
    },
    {
        "code": "002",
        "name": "bankb",
        "msp_id": "Bank2MSP",
        "owner_node": "owner2",
        "staff": "bankb_admin",
        "accounts": [
            ("carlos", "Carlos Chhetri", "carlos", 1),
            ("dan", "Dan Dhakal", "dan", 1),
        ],
    },
]


def _ensure_user(session: Session, username: str, password: str, role: str, bank_code: str | None = None, account_number: str | None = None) -> None:
    if session.scalar(select(User).where(User.username == username)):
        return
    session.add(
        User(
            username=username,
            password_hash=hash_password(password),
            role=role,
            bank_code=bank_code,
            account_number=account_number,
        )
    )


def seed(session: Session) -> None:
    _ensure_user(session, "cbadmin", "sworna-cb", "cb_admin")

    for bank_spec in BANKS:
        bank = session.scalar(select(Bank).where(Bank.code == bank_spec["code"]))
        if bank is None:
            bank = Bank(
                code=bank_spec["code"],
                name=bank_spec["name"],
                msp_id=bank_spec["msp_id"],
                owner_node=bank_spec["owner_node"],
                status="active",
                permissions={"can_redeem": True, "interbank_limit_minor": 0, "redeem_limit_minor": 0},
                pool_size=10,
                wallet_pool={"used": [], "free": []},
            )
            session.add(bank)
            session.flush()

        _ensure_user(session, bank_spec["staff"], "sworna-bank", "bank_staff", bank.code)

        for seq, (username, full_name, wallet, kyc) in enumerate(bank_spec["accounts"], start=1):
            existing = session.scalar(
                select(Account).where(Account.wallet == wallet)
            )
            if existing:
                continue
            account_number = generate_account_number(bank.code, seq)
            account = Account(
                account_number=account_number,
                full_name=full_name,
                wallet=wallet,
                bank_id=bank.id,
                kyc_level=kyc,
            )
            session.add(account)
            session.flush()
            _ensure_user(session, username, "sworna-pass", "customer", bank.code, account_number)

    session.commit()