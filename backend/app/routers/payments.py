"""Payment endpoints: transfer by account number, redeem — with AML + bank permissions.

Before proxying to the token services, the backend enforces:
  - sender + recipient banks must not be `suspended`
  - sender account must be `active`
  - recipient must exist in the registry and not be `frozen`
  - AML gates (per-tx cap, daily cumulative, daily count — see app.aml)
  - watchlist screening of the recipient name
  - for cross-bank transfers, within the bank's interbank limit
  - redeem requires the bank's `can_redeem` permission

After the ledger confirms the transaction, the AML post-checks run
(large-transaction alerts, velocity, structuring) and may auto-flag the
sender account.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import aml
from ..amounts import to_minor
from ..database import get_session
from ..deps import bank_staff, customer, is_bank_user
from ..models import Account, Bank, TransactionLog, User
from ..schemas import RedeemRequest, TransferRequest, TxLogRead
from ..token_client import TokenServiceError, token_client

router = APIRouter(prefix="/api/v1", tags=["payments"])


def _get_account(session: Session, account_number: str) -> Account:
    account = session.scalar(select(Account).where(Account.account_number == account_number))
    if account is None:
        raise HTTPException(404, f"account '{account_number}' not found")
    return account


def _check_access(user: User, account: Account) -> None:
    if user.role == "customer" and user.account_number != account.account_number:
        raise HTTPException(403, "not your account")
    if is_bank_user(user) and account.bank_code != user.bank_code:
        raise HTTPException(403, "account is not on your bank")


def _ensure_bank_active(bank: Bank, role: str) -> None:
    if bank.status == "suspended":
        raise HTTPException(403, f"bank {bank.name} is suspended; {role} refused")


@router.post("/payments/transfer", response_model=TxLogRead)
async def transfer(
    body: TransferRequest,
    user: User = Depends(customer),
    session: Session = Depends(get_session),
):
    sender = _get_account(session, body.from_account)
    _check_access(user, sender)
    recipient = _get_account(session, body.to_account)

    _ensure_bank_active(sender.bank, "transfer")
    _ensure_bank_active(recipient.bank, "transfer")
    if sender.status != "active":
        raise HTTPException(403, f"account {sender.account_number} is {sender.status}")
    if recipient.status == "frozen":
        raise HTTPException(403, f"recipient {recipient.account_number} is frozen")

    amount_minor = to_minor(body.amount)
    aml.enforce_outflow(session, sender, amount_minor)

    is_interbank = sender.bank_code != recipient.bank_code
    if is_interbank:
        limit = sender.bank.permissions.get("interbank_limit_minor", 0)
        if limit and amount_minor > limit:
            raise HTTPException(
                403, f"amount exceeds {sender.bank.name}'s interbank limit"
            )

    aml.screen_counterparty(session, sender, recipient, amount_minor)

    try:
        txid = await token_client.transfer(
            from_wallet=sender.wallet,
            from_node=sender.owner_node,
            to_wallet=recipient.wallet,
            to_node=recipient.owner_node,
            amount_minor=amount_minor,
            message=body.reference,
        )
    except TokenServiceError as exc:
        raise HTTPException(502, f"token service error: {exc}") from exc

    log = TransactionLog(
        txid=txid,
        tx_type="transfer",
        from_account=sender.account_number,
        to_account=recipient.account_number,
        amount_minor=amount_minor,
        reference=body.reference,
    )
    session.add(log)
    session.flush()
    aml.post_outflow_checks(session, sender, recipient, amount_minor, txid)
    session.commit()
    session.refresh(log)
    return log


@router.post("/payments/redeem", response_model=TxLogRead)
async def redeem(
    body: RedeemRequest,
    user: User = Depends(bank_staff),
    session: Session = Depends(get_session),
):
    account = _get_account(session, body.account)
    _check_access(user, account)

    _ensure_bank_active(account.bank, "redemption")
    if account.status != "active":
        raise HTTPException(403, f"account {account.account_number} is {account.status}")

    bank = account.bank
    if not bank.permissions.get("can_redeem", False):
        raise HTTPException(403, f"bank {bank.name} is not allowed to redeem")

    amount_minor = to_minor(body.amount)
    redeem_limit = bank.permissions.get("redeem_limit_minor", 0)
    if redeem_limit and amount_minor > redeem_limit:
        raise HTTPException(403, f"amount exceeds {bank.name}'s redeem limit")

    try:
        txid = await token_client.redeem(
            wallet=account.wallet,
            node=account.owner_node,
            amount_minor=amount_minor,
            message=body.reference,
        )
    except TokenServiceError as exc:
        raise HTTPException(502, f"token service error: {exc}") from exc

    log = TransactionLog(
        txid=txid,
        tx_type="redeem",
        from_account=account.account_number,
        amount_minor=amount_minor,
        reference=body.reference,
    )
    session.add(log)
    session.commit()
    session.refresh(log)
    return log
