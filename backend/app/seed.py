"""Bootstrap the banking registry.

Production deployments start with a clean slate: only the central-bank admin
exists. Banks are created at runtime (`POST /api/v1/banks`), each running on its
own VM; their staff logins are created with the bank.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import User
from .security import hash_password


def seed(session: Session) -> None:
    if not session.scalar(select(User).where(User.username == "cbadmin")):
        session.add(
            User(
                username="cbadmin",
                password_hash=hash_password("sworna-cb"),
                role="cb_admin",
            )
        )
    session.commit()


def seed_bank_db(session: Session, bank_code: str = "001", bank_name: str = "bankpt", owner_node: str = "owner1") -> None:
    from .models import Bank
    k = int(bank_code)
    msp_id = f"Bank{k}MSP"
    
    # 1. Bank admin user
    if not session.scalar(select(User).where(User.username == "bankadmin")):
        session.add(
            User(
                username="bankadmin",
                password_hash=hash_password("sworna-bank"),
                role="bank_admin",
                bank_code=bank_code,
            )
        )
    
    # 2. Bank entry
    bank = session.scalar(select(Bank).where(Bank.code == bank_code))
    if not bank:
        pool_size = 10
        free_wallets = [f"pool_{bank_code}_w{i}" for i in range(2, pool_size + 1)]
        session.add(
            Bank(
                code=bank_code,
                name=bank_name,
                msp_id=msp_id,
                owner_node=owner_node,
                status="ACTIVE",
                pool_size=pool_size,
                wallet_pool={"used": [], "free": free_wallets},
            )
        )
    session.commit()