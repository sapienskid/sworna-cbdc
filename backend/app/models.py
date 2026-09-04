"""SQLAlchemy models for the Sworna banking system.

The registry stores the off-chain banking view (banks, accounts, users,
payments). Token balances live on the Fabric ledger; the backend keeps the
banking registry + AML data and mirrors payments for reporting.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Bank(Base):
    __tablename__ = "banks"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(3), unique=True, index=True)  # "001"...
    name: Mapped[str] = mapped_column(String(50), unique=True, index=True)  # banka, bankb
    msp_id: Mapped[str] = mapped_column(String(50))  # BankAMSP...
    owner_node: Mapped[str] = mapped_column(String(50))  # owner1...
    portal_url: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(20), default="registered")  # registered | active | suspended
    # permissions: {can_redeem: bool, interbank_limit_minor: int, redeem_limit_minor: int}
    permissions: Mapped[dict] = mapped_column(JSON, default=dict)
    pool_size: Mapped[int] = mapped_column(Integer, default=10)
    # wallet pool manifest: {used: [wallet ids], free: [wallet ids]}
    wallet_pool: Mapped[dict] = mapped_column(JSON, default=dict)
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    accounts: Mapped[list["Account"]] = relationship(back_populates="bank")

    @property
    def bank_name(self) -> str:
        return self.name


class Account(Base):
    """A customer's bank account. Its on-chain identity is the idemix wallet."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_number: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # SWR-001-00001234
    full_name: Mapped[str] = mapped_column(String(120))
    wallet: Mapped[str] = mapped_column(String(60), unique=True, index=True)  # idemix wallet on the owner node
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | flagged | frozen
    kyc_level: Mapped[int] = mapped_column(Integer, default=1)
    transfer_limit_minor: Mapped[int] = mapped_column(Integer, default=100000)  # SWR minor units
    bank_id: Mapped[int] = mapped_column(ForeignKey("banks.id"))

    bank: Mapped["Bank"] = relationship(back_populates="accounts")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    @property
    def owner_node(self) -> str:
        return self.bank.owner_node

    @property
    def bank_code(self) -> str:
        return self.bank.code

    @property
    def bank_name(self) -> str:
        return self.bank.name

    @property
    def transfer_limit(self):
        from .amounts import to_swr

        return to_swr(self.transfer_limit_minor)


class User(Base):
    """Login identity. Roles: cb_admin | bank_staff | customer."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20))  # cb_admin | bank_staff | customer
    bank_code: Mapped[str | None] = mapped_column(String(3), nullable=True)  # for bank_staff
    account_number: Mapped[str | None] = mapped_column(String(20), nullable=True)  # for customer
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TransactionLog(Base):
    """Off-chain mirror of ledger activity, in banking terms."""

    __tablename__ = "transaction_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    txid: Mapped[str] = mapped_column(String(100), index=True)
    tx_type: Mapped[str] = mapped_column(String(20))  # issue | transfer | redeem
    from_account: Mapped[str] = mapped_column(String(20), default="")
    to_account: Mapped[str] = mapped_column(String(20), default="")
    amount_minor: Mapped[int] = mapped_column(Integer)
    reference: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(20), default="Confirmed")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    @property
    def amount(self):
        from .amounts import to_swr

        return to_swr(self.amount_minor)


class WatchlistEntry(Base):
    """AML screening list entry (sanctions / PEP / internal watchlist).

    `value` is matched case-insensitively against customer full names at
    onboarding and against both transfer counterparties at payment time.
    """

    __tablename__ = "aml_watchlist"

    id: Mapped[int] = mapped_column(primary_key=True)
    list_type: Mapped[str] = mapped_column(String(20))  # sanction | pep | internal
    value: Mapped[str] = mapped_column(String(120), index=True)
    note: Mapped[str] = mapped_column(String(255), default="")
    active: Mapped[bool] = mapped_column(default=True)
    created_by: Mapped[str] = mapped_column(String(50), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AMLAlert(Base):
    """An AML rule hit, raised for central-bank compliance review."""

    __tablename__ = "aml_alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    rule: Mapped[str] = mapped_column(String(40))  # large_transaction | velocity | structuring | watchlist
    severity: Mapped[str] = mapped_column(String(10))  # low | medium | high
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | reviewed | dismissed
    account_number: Mapped[str] = mapped_column(String(20), default="", index=True)
    bank_code: Mapped[str] = mapped_column(String(3), default="", index=True)
    counterparty: Mapped[str] = mapped_column(String(20), default="")
    txid: Mapped[str] = mapped_column(String(100), default="")
    amount_minor: Mapped[int] = mapped_column(Integer, default=0)
    details: Mapped[str] = mapped_column(String(500), default="")
    reviewed_by: Mapped[str] = mapped_column(String(50), default="")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    @property
    def amount(self):
        from .amounts import to_swr

        return to_swr(self.amount_minor)


class OnboardingApplication(Base):
    """Institutional Commercial Bank Onboarding Application."""

    __tablename__ = "onboarding_applications"

    id: Mapped[int] = mapped_column(primary_key=True)
    bank_code: Mapped[str] = mapped_column(String(3), unique=True, index=True)
    legal_name: Mapped[str] = mapped_column(String(100), unique=True)
    msp_id: Mapped[str] = mapped_column(String(50))
    owner_node: Mapped[str] = mapped_column(String(50))
    peer_endpoint: Mapped[str] = mapped_column(String(100))
    ca_endpoint: Mapped[str] = mapped_column(String(100))
    portal_url: Mapped[str] = mapped_column(String(200), default="")
    public_msp_json: Mapped[dict] = mapped_column(JSON, default=dict)
    pool_size: Mapped[int] = mapped_column(Integer, default=10)
    status: Mapped[str] = mapped_column(
        String(30), default="submitted"
    )  # submitted | verified_monetary | approved | rejected

    # Four-Eyes Dual Approval tracking
    monetary_officer: Mapped[str] = mapped_column(String(50), default="")
    monetary_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    interbank_limit_minor: Mapped[int] = mapped_column(Integer, default=10_000_000)  # default 100,000 SWR

    security_officer: Mapped[str] = mapped_column(String(50), default="")
    security_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    rejection_reason: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)