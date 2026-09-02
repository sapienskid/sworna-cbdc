"""Auth dependencies for role-based access."""
from __future__ import annotations

from fastapi import Depends, HTTPException, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import get_session
from .models import User
from .security import decode_token


def get_current_user(
    authorization: str = Header(default=""),
    session: Session = Depends(get_session),
) -> User:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = decode_token(token)
    except Exception as exc:
        raise HTTPException(401, "invalid or expired token") from exc
    user = session.scalar(select(User).where(User.username == payload.get("sub")))
    if user is None:
        raise HTTPException(401, "user not found")
    return user


def require_roles(*roles: str):
    def dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "insufficient role")
        return user

    return dep


cb_admin = require_roles("cb_admin")
cb_mint = require_roles("cb_admin", "cb_mint_officer")
cb_audit = require_roles("cb_admin", "cb_auditor")
cb_staff = require_roles("cb_admin", "cb_mint_officer", "cb_auditor")
bank_staff = require_roles("cb_admin", "cb_mint_officer", "cb_auditor", "bank_admin", "bank_staff")
customer = require_roles("cb_admin", "cb_mint_officer", "cb_auditor", "bank_admin", "bank_staff", "customer")

CB_ROLES = ("cb_admin", "cb_mint_officer", "cb_auditor")
BANK_ROLES = ("bank_admin", "bank_staff")


def is_cb_user(user: User) -> bool:
    return user.role in CB_ROLES


def is_bank_user(user: User) -> bool:
    """True for bank-portal users that must be scoped to their own bank.

    CB users pass the `bank_staff` dependency as supervisors, but they are
    never scoped — only bank_admin/bank_staff are.
    """
    return user.role in BANK_ROLES and bool(user.bank_code)