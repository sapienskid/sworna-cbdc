"""Pydantic schemas for the Sworna banking API.

Amounts are expressed in major units of SWR (Decimal) at the API boundary and
converted to integer minor units before reaching the token services.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AccountStatus = str
BankStatus = str


class BankPermissions(BaseModel):
    can_redeem: bool = True
    interbank_limit_minor: int = Field(default=0, ge=0, description="0 = unlimited")
    redeem_limit_minor: int = Field(default=0, ge=0, description="0 = unlimited")


class BankCreate(BaseModel):
    code: str = Field(pattern=r"^\d{3}$", description="3-digit bank code, e.g. 001")
    name: str
    msp_id: str
    owner_node: str
    portal_url: str = ""
    staff_username: str = Field(
        default="",
        description="login for the bank's staff console; created if provided",
    )
    pool_size: int = Field(default=10, ge=1, le=100)
    permissions: BankPermissions = BankPermissions()


class BankRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    name: str
    msp_id: str
    owner_node: str
    portal_url: str
    status: BankStatus
    permissions: BankPermissions
    pool_size: int
    joined_at: datetime | None


class BankStatusUpdate(BaseModel):
    status: BankStatus


class BankPermissionsUpdate(BaseModel):
    permissions: BankPermissions


class AccountCreate(BaseModel):
    full_name: str
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6)
    kyc_level: int = Field(default=1, ge=0, le=3)
    transfer_limit: Decimal = Field(default=Decimal("1000.00"), gt=0, description="SWR")


class AccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    account_number: str
    full_name: str
    status: AccountStatus
    kyc_level: int
    bank_code: str
    bank_name: str
    transfer_limit: Decimal


class StatusUpdate(BaseModel):
    status: AccountStatus


class TransferRequest(BaseModel):
    from_account: str
    to_account: str
    amount: Decimal = Field(gt=0, description="SWR, major units")
    reference: str = ""


class RedeemRequest(BaseModel):
    account: str
    amount: Decimal = Field(gt=0, description="SWR, major units")
    reference: str = ""


class IssueRequest(BaseModel):
    to_account: str | None = None
    bank_code: str | None = None
    amount: Decimal = Field(gt=0, description="SWR, major units")
    reference: str = ""


class MintToBankRequest(BaseModel):
    bank_code: str
    amount: Decimal = Field(gt=0, description="SWR, major units")
    reference: str = ""


class AllocateBankRequest(BaseModel):
    from_bank_code: str
    to_bank_code: str
    amount: Decimal = Field(gt=0, description="SWR, major units")
    reference: str = ""


class BurnFromBankRequest(BaseModel):
    bank_code: str
    amount: Decimal = Field(gt=0, description="SWR, major units")
    reference: str = ""


class CashInOutRequest(BaseModel):
    account_number: str
    amount: Decimal = Field(gt=0, description="SWR, major units")
    reference: str = ""


class CBUserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6)
    role: Literal["cb_admin", "cb_mint_officer", "cb_auditor"]
    full_name: str = ""


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    role: str
    bank_code: str | None
    account_number: str | None
    created_at: datetime


class TxLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    txid: str
    tx_type: str
    from_account: str
    to_account: str
    amount: Decimal
    reference: str
    status: str
    created_at: datetime


class CirculationRow(BaseModel):
    bank_code: str
    bank_name: str
    status: BankStatus
    total_minor: int
    total: Decimal
    account_count: int
    wallet_errors: int = 0


class AdminOverview(BaseModel):
    total_supply: Decimal
    circulation: list[CirculationRow]
    wallets_unreachable: int = 0


# AML / compliance
class AMLAlertRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    rule: str
    severity: str
    status: str
    account_number: str
    bank_code: str
    counterparty: str
    txid: str
    amount: Decimal
    details: str
    reviewed_by: str
    reviewed_at: datetime | None
    created_at: datetime


class AMLAlertUpdate(BaseModel):
    status: Literal["open", "reviewed", "dismissed"]
    note: str = ""


class AMLSummary(BaseModel):
    open_alerts: int
    open_by_severity: dict[str, int]
    flagged_accounts: int
    watchlist_entries: int
    reportable_threshold: Decimal
    kyc_tiers: dict[str, dict]


class WatchlistEntryCreate(BaseModel):
    list_type: Literal["sanction", "pep", "internal"]
    value: str = Field(min_length=2, max_length=120)
    note: str = ""


class WatchlistEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    list_type: str
    value: str
    note: str
    active: bool
    created_by: str
    created_at: datetime


class CryptoParams(BaseModel):
    identifier: str
    curve_id: int
    idemix_curve_id: int
    quantity_precision: int
    max_token: int
    range_proof: dict
    issuers: int
    idemix_issuer_pk_fingerprint: str
    auditor: dict
    pedersen_generators_fingerprint: str
    params_file: str
    params_valid: bool


class WalletCryptoInfo(BaseModel):
    account_number: str
    full_name: str
    wallet: str
    key_type: str
    credential_fingerprint: str | None = None


# auth
class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    role: str
    username: str
    bank_code: str | None = None
    account_number: str | None = None


class BalanceRead(BaseModel):
    account_number: str
    full_name: str
    bank_code: str
    balance: str  # SWR, major units


class StatementItem(BaseModel):
    txid: str
    amount: int
    reference: str
    sender: str
    recipient: str
    status: str
    timestamp: str


# onboarding
class OnboardingApplicationCreate(BaseModel):
    bank_code: str = Field(pattern=r"^\d{3}$", description="3-digit bank code, e.g. 001")
    legal_name: str
    msp_id: str
    owner_node: str
    peer_endpoint: str
    ca_endpoint: str
    portal_url: str = ""
    public_msp_json: dict = Field(default_factory=dict)
    pool_size: int = Field(default=10, ge=1, le=100)


class OnboardingApplicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    bank_code: str
    legal_name: str
    msp_id: str
    owner_node: str
    peer_endpoint: str
    ca_endpoint: str
    portal_url: str
    public_msp_json: dict
    pool_size: int
    status: str
    monetary_officer: str
    monetary_approved_at: datetime | None
    interbank_limit_minor: int
    security_officer: str
    security_approved_at: datetime | None
    rejection_reason: str
    created_at: datetime


class MonetaryApprovalRequest(BaseModel):
    interbank_limit_minor: int = Field(default=10_000_000, ge=0, description="0 = unlimited")


class SecurityApprovalRequest(BaseModel):
    approve: bool = True
    rejection_reason: str = ""