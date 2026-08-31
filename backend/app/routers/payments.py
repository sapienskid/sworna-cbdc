"""Payment endpoints: transfer by account number, redeem — with AML + bank permissions.

Before proxying to the token services, the backend enforces:
  - sender account must be `active`
  - recipient must not be `frozen`
  - amount within the account's transfer limit
  - for cross-bank transfers, within the bank's interbank limit
  - redeem requires the bank's `can_redeem` permission
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..amounts import to_minor
from ..database import get_session
from ..deps import bank_staff, customer
from ..models import Account, TransactionLog, User
from ..schemas import RedeemRequest, TransferRequest, TxLogRead
from ..token_client import TokenServiceError, token_client

router = APIRouter(prefix="/api/v1", tags=["payments"])


class InterbankAccount:
    """Virtual account representation for counterparty bank recipient in interbank transfers."""
    def __init__(self, account_number: str) -> None:
        parts = account_number.split("-")
        if len(parts) != 3 or parts[0] != "SWR":
            raise HTTPException(400, f"invalid account number format '{account_number}'")
        self.account_number = account_number
        self.bank_code = parts[1]
        k = int(self.bank_code)
        seq = int(parts[2])
        self.owner_node = f"owner{k}"
        self.wallet = f"pool_{self.bank_code}_w{seq + 1}"
        self.status = "active"
        self.full_name = f"Interbank Account {account_number}"


def _get_account(session: Session, account_number: str, allow_interbank: bool = False):
    account = session.scalar(select(Account).where(Account.account_number == account_number))
    if account is None:
        if allow_interbank and account_number.startswith("SWR-"):
            return InterbankAccount(account_number)
        raise HTTPException(404, f"account '{account_number}' not found")
    return account


def _check_access(user: User, account: Account | InterbankAccount) -> None:
    if user.role == "customer" and user.account_number != account.account_number:
        raise HTTPException(403, "not your account")
    if user.role == "bank_staff" and account.bank_code != user.bank_code:
        raise HTTPException(403, "account is not on your bank")


@router.post("/payments/transfer", response_model=TxLogRead)
async def transfer(
    body: TransferRequest,
    user: User = Depends(customer),
    session: Session = Depends(get_session),
):
    sender = _get_account(session, body.from_account)
    _check_access(user, sender)
    recipient = _get_account(session, body.to_account, allow_interbank=True)

    if sender.status != "active":
        raise HTTPException(403, f"account {sender.account_number} is {sender.status}")
    if recipient.status == "frozen":
        raise HTTPException(403, f"recipient {recipient.account_number} is frozen")

    amount_minor = to_minor(body.amount)
    if amount_minor > sender.transfer_limit_minor:
        raise HTTPException(403, f"amount exceeds the account transfer limit")

    is_interbank = sender.bank_code != recipient.bank_code
    if is_interbank:
        limit = sender.bank.permissions.get("interbank_limit_minor", 0)
        if limit and amount_minor > limit:
            raise HTTPException(
                403, f"amount exceeds {sender.bank.name}'s interbank limit"
            )

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