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