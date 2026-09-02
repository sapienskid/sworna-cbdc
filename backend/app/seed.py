"""Bootstrap the banking registry.

Production deployments start with a clean slate: only the central-bank admin
exists (override the password with SWORNA_CB_ADMIN_PASSWORD). Banks are created
at runtime (`POST /api/v1/banks`), each running on its own VM; their staff
logins are created with the bank.
"""
from __future__ import annotations

import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import User
from .security import hash_password


def seed(session: Session) -> None:
    if not session.scalar(select(User).where(User.username == "cbadmin")):
        session.add(
            User(
                username="cbadmin",
                password_hash=hash_password(os.getenv("SWORNA_CB_ADMIN_PASSWORD", "sworna-cb")),
                role="cb_admin",
            )
        )
    session.commit()