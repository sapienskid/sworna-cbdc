"""Bank + account registry endpoints, scoped by role."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..accounts import generate_account_number
from ..amounts import to_swr
from ..database import get_session
from ..deps import bank_staff, cb_admin, customer
from ..models import Account, Bank, User
from ..provisioning import ProvisioningError, assign_wallet
from ..schemas import (
    AccountCreate,
    AccountRead,
    BalanceRead,
    BankCreate,
    BankPermissionsUpdate,
    BankRead,
    BankStatusUpdate,
    CashInOutRequest,
    StatementItem,
    StatusUpdate,
)
from ..security import hash_password
from ..token_client import TokenServiceError, token_client

router = APIRouter(prefix="/api/v1", tags=["registry"])


# -- banks ----------------------------------------------------------------
@router.get("/banks", response_model=list[BankRead])
def list_banks(user: User = Depends(bank_staff), session: Session = Depends(get_session)):
    stmt = select(Bank).order_by(Bank.id)
    if user.role == "bank_staff":
        stmt = stmt.where(Bank.code == user.bank_code)
    return session.scalars(stmt).all()


@router.post("/banks", response_model=BankRead, status_code=201)
def create_bank(
    body: BankCreate,
    user: User = Depends(cb_admin),
    session: Session = Depends(get_session),
):
    if session.scalar(select(Bank).where(Bank.code == body.code)):
        raise HTTPException(409, f"bank code {body.code} already in use")
    if session.scalar(select(Bank).where(Bank.name == body.name)):
        raise HTTPException(409, f"bank name '{body.name}' already in use")
    bank = Bank(
        code=body.code,
        name=body.name,
        msp_id=body.msp_id,
        owner_node=body.owner_node,
        portal_url=body.portal_url,
        status="registered",
        permissions=body.permissions.model_dump(),
        pool_size=body.pool_size,
        wallet_pool={"used": [], "free": []},
    )
    session.add(bank)

    if body.staff_username:
        if session.scalar(select(User).where(User.username == body.staff_username)):
            raise HTTPException(409, f"username '{body.staff_username}' already in use")
        session.add(
            User(
                username=body.staff_username,
                password_hash=hash_password("sworna-bank"),
                role="bank_staff",
                bank_code=bank.code,
            )
        )

    session.commit()
    session.refresh(bank)
    return bank


@router.patch("/banks/{code}/status", response_model=BankRead)
def set_bank_status(
    code: str,
    body: BankStatusUpdate,
    user: User = Depends(cb_admin),
    session: Session = Depends(get_session),
):
    bank = session.scalar(select(Bank).where(Bank.code == code))
    if bank is None:
        raise HTTPException(404, "bank not found")
    bank.status = body.status
    if body.status == "active" and bank.joined_at is None:
        from .models import utcnow

        bank.joined_at = utcnow()
    session.commit()
    session.refresh(bank)
    return bank


@router.patch("/banks/{code}/permissions", response_model=BankRead)
def set_bank_permissions(
    code: str,
    body: BankPermissionsUpdate,
    user: User = Depends(cb_admin),
    session: Session = Depends(get_session),
):
    bank = session.scalar(select(Bank).where(Bank.code == code))
    if bank is None:
        raise HTTPException(404, "bank not found")
    bank.permissions = body.permissions.model_dump()
    session.commit()
    session.refresh(bank)
    return bank


# -- accounts ------------------------------------------------------------
def _scoped_accounts(user: User, session: Session):
    stmt = select(Account).order_by(Account.id)
    if user.role == "bank_staff":
        stmt = stmt.join(Bank).where(Bank.code == user.bank_code)
    elif user.role == "customer":
        stmt = stmt.where(Account.account_number == user.account_number)
    return stmt


@router.get("/accounts", response_model=list[AccountRead])
def list_accounts(user: User = Depends(bank_staff), session: Session = Depends(get_session)):
    return session.scalars(_scoped_accounts(user, session)).all()


@router.post("/accounts", response_model=AccountRead, status_code=201)
def create_account(
    body: AccountCreate,
    user: User = Depends(bank_staff),
    session: Session = Depends(get_session),
):
    bank = session.scalar(select(Bank).where(Bank.code == user.bank_code))
    if bank is None:
        raise HTTPException(404, "bank not found")

    if session.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(409, f"username '{body.username}' taken")

    try:
        wallet = assign_wallet(bank)
    except ProvisioningError as exc:
        raise HTTPException(409, str(exc)) from exc

    existing = session.execute(
        select(Account.account_number).where(Account.bank_id == bank.id)
    ).scalars().all()
    next_seq = 1
    if existing:
        next_seq = max(int(a.split("-")[2]) for a in existing) + 1

    account = Account(
        account_number=generate_account_number(bank.code, next_seq),
        full_name=body.full_name,
        wallet=wallet,
        bank_id=bank.id,
        kyc_level=body.kyc_level,
        transfer_limit_minor=int(body.transfer_limit * 100),
    )
    session.add(account)
    session.flush()
    session.add(
        User(
            username=body.username,
            password_hash=hash_password(body.password),
            role="customer",
            bank_code=bank.code,
            account_number=account.account_number,
        )
    )
    session.commit()
    session.refresh(account)
    return account


@router.get("/accounts/{account_number}", response_model=AccountRead)
def get_account(
    account_number: str,
    user: User = Depends(customer),
    session: Session = Depends(get_session),
):
    account = session.scalar(select(Account).where(Account.account_number == account_number))
    if account is None:
        raise HTTPException(404, f"account '{account_number}' not found")
    if user.role == "bank_staff" and account.bank_code != user.bank_code:
        raise HTTPException(403, "account is not on your bank")
    if user.role == "customer" and user.account_number != account_number:
        raise HTTPException(403, "not your account")
    return account


@router.patch("/accounts/{account_number}/status", response_model=AccountRead)
def set_account_status(
    account_number: str,
    body: StatusUpdate,
    user: User = Depends(bank_staff),
    session: Session = Depends(get_session),
):
    account = session.scalar(select(Account).where(Account.account_number == account_number))
    if account is None:
        raise HTTPException(404, "account not found")
    if user.role == "bank_staff" and account.bank_code != user.bank_code:
        raise HTTPException(403, "account is not on your bank")
    account.status = body.status
    session.commit()
    session.refresh(account)
    return account


@router.get("/accounts/{account_number}/balance", response_model=BalanceRead)
async def account_balance(
    account_number: str,
    user: User = Depends(customer),
    session: Session = Depends(get_session),
):
    account = session.scalar(select(Account).where(Account.account_number == account_number))
    if account is None:
        raise HTTPException(404, f"account '{account_number}' not found")
    if user.role == "bank_staff" and account.bank_code != user.bank_code:
        raise HTTPException(403, "account is not on your bank")
    if user.role == "customer" and user.account_number != account_number:
        raise HTTPException(403, "not your account")
    try:
        minor = await token_client.balances(wallet=account.wallet, node=account.owner_node)
    except TokenServiceError as exc:
        raise HTTPException(502, f"token service error: {exc}") from exc
    return BalanceRead(
        account_number=account.account_number,
        full_name=account.full_name,
        bank_code=account.bank_code,
        balance=str(to_swr(minor)),
    )


@router.get("/accounts/{account_number}/statements", response_model=list[StatementItem])
async def account_statements(
    account_number: str,
    user: User = Depends(customer),
    session: Session = Depends(get_session),
):
    account = session.scalar(select(Account).where(Account.account_number == account_number))
    if account is None:
        raise HTTPException(404, f"account '{account_number}' not found")
    if user.role == "bank_staff" and account.bank_code != user.bank_code:
        raise HTTPException(403, "account is not on your bank")
    if user.role == "customer" and user.account_number != account_number:
        raise HTTPException(403, "not your account")
    try:
        history = await token_client.auditor_history(account.wallet)
    except TokenServiceError as exc:
        raise HTTPException(502, f"token service error: {exc}") from exc

    # translate internal wallet ids to public account numbers
    wallet_to_account = {
        acc.wallet: acc.account_number
        for acc in session.scalars(select(Account)).all()
    }

    def _label(wallet: str) -> str:
        if not wallet:
            return "CB"
        return wallet_to_account.get(wallet, wallet)

    items: list[StatementItem] = []
    for tx in history:
        items.append(
            StatementItem(
                txid=tx.get("id", ""),
                amount=int(tx.get("amount", {}).get("value", 0)),
                reference=tx.get("message", ""),
                sender=_label(tx.get("sender", "")),
                recipient=_label(tx.get("recipient", "")),
                status=tx.get("status", ""),
                timestamp=tx.get("timestamp", ""),
            )
        )
    return items


@router.get("/bank/reserve", response_model=BalanceRead)
async def get_bank_reserve(
    user: User = Depends(bank_staff),
    session: Session = Depends(get_session),
):
    """Get the master reserve balance of the bank."""
    bank = session.scalar(select(Bank).where(Bank.code == user.bank_code))
    if bank is None:
        raise HTTPException(404, "bank not found")
    reserve_wallet = f"pool_{bank.code}_w1"
    try:
        minor = await token_client.balances(wallet=reserve_wallet, node=bank.owner_node)
    except TokenServiceError as exc:
        raise HTTPException(502, f"token service error: {exc}") from exc
    return BalanceRead(
        account_number=f"RESERVE-{bank.code}",
        full_name=f"{bank.name.upper()} Reserve Vault",
        bank_code=bank.code,
        balance=str(to_swr(minor)),
    )


@router.post("/bank/deposit")
async def deposit_to_account(
    body: CashInOutRequest,
    user: User = Depends(bank_staff),
    session: Session = Depends(get_session),
):
    """Disburse CBDC from bank master reserve into a customer's account (Cash In)."""
    account = session.scalar(select(Account).where(Account.account_number == body.account_number))
    if account is None:
        raise HTTPException(404, f"account '{body.account_number}' not found")
    if user.role == "bank_staff" and account.bank_code != user.bank_code:
        raise HTTPException(403, "account is not on your bank")
    if account.status != "active":
        raise HTTPException(403, f"account {account.account_number} is {account.status}")

    bank = account.bank
    reserve_wallet = f"pool_{bank.code}_w1"
    from ..amounts import to_minor
    amount_minor = to_minor(body.amount)

    try:
        txid = await token_client.transfer(
            from_wallet=reserve_wallet,
            from_node=bank.owner_node,
            to_wallet=account.wallet,
            to_node=account.owner_node,
            amount_minor=amount_minor,
            message=body.reference or f"Cash-In Deposit to {account.account_number}",
        )
    except TokenServiceError as exc:
        raise HTTPException(502, f"token service error: {exc}") from exc

    from ..models import TransactionLog
    log = TransactionLog(
        txid=txid,
        tx_type="deposit",
        from_account=f"RESERVE-{bank.code}",
        to_account=account.account_number,
        amount_minor=amount_minor,
        reference=body.reference or "Cash-In Deposit",
    )
    session.add(log)
    session.commit()
    session.refresh(log)
    return log


@router.post("/bank/withdraw")
async def withdraw_from_account(
    body: CashInOutRequest,
    user: User = Depends(customer),
    session: Session = Depends(get_session),
):
    """Redeem customer CBDC back to the bank's master reserve (Cash Out)."""
    account = session.scalar(select(Account).where(Account.account_number == body.account_number))
    if account is None:
        raise HTTPException(404, f"account '{body.account_number}' not found")
    if user.role == "bank_staff" and account.bank_code != user.bank_code:
        raise HTTPException(403, "account is not on your bank")
    if user.role == "customer" and user.account_number != body.account_number:
        raise HTTPException(403, "not your account")
    if account.status != "active":
        raise HTTPException(403, f"account {account.account_number} is {account.status}")

    bank = account.bank
    reserve_wallet = f"pool_{bank.code}_w1"
    from ..amounts import to_minor
    amount_minor = to_minor(body.amount)

    try:
        txid = await token_client.transfer(
            from_wallet=account.wallet,
            from_node=account.owner_node,
            to_wallet=reserve_wallet,
            to_node=bank.owner_node,
            amount_minor=amount_minor,
            message=body.reference or f"Cash-Out Withdrawal from {account.account_number}",
        )
    except TokenServiceError as exc:
        raise HTTPException(502, f"token service error: {exc}") from exc

    from ..models import TransactionLog
    log = TransactionLog(
        txid=txid,
        tx_type="withdraw",
        from_account=account.account_number,
        to_account=f"RESERVE-{bank.code}",
        amount_minor=amount_minor,
        reference=body.reference or "Cash-Out Withdrawal",
    )
    session.add(log)
    session.commit()
    session.refresh(log)
    return log