"""Central-bank admin endpoints: issue, provisioning, supply, circulation, ledger."""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..amounts import to_minor, to_swr
from ..database import get_session
from ..deps import cb_admin, cb_audit, cb_mint, cb_staff
from ..models import Account, Bank, TransactionLog, User
from ..paths import BIN, FABRIC_CFG, NETWORK_HOME
from ..provisioning import ProvisioningError, provision_wallet_pool
from ..schemas import (
    AdminOverview,
    AllocateBankRequest,
    BurnFromBankRequest,
    CBUserCreate,
    CirculationRow,
    IssueRequest,
    TxLogRead,
    UserRead,
)
from ..token_client import TokenServiceError, token_client

router = APIRouter(prefix="/api/v1", tags=["admin"])


class BlockSummary(BaseModel):
    number: int
    tx_count: int
    txids: list[str]


class LedgerStatus(BaseModel):
    channel: str
    height: int
    blocks: list[BlockSummary]


class ProvisionResult(BaseModel):
    bank_code: str
    bank_name: str
    owner_node: str
    wallets_generated: int
    used: int
    free: int


def _peer_env() -> dict:
    """Environment for the Fabric peer CLI against the sworna network."""
    orgs = Path(NETWORK_HOME) / "organizations"
    env = {
        "PATH": f"{BIN}:" + os.environ.get("PATH", ""),
        "FABRIC_CFG_PATH": FABRIC_CFG,
        "CORE_PEER_TLS_ENABLED": "true",
        "CORE_PEER_LOCALMSPID": "CentralBankMSP",
        "CORE_PEER_ADDRESS": "localhost:7051",
        "CORE_PEER_TLS_ROOTCERT_FILE": str(
            orgs / "peerOrganizations/centralbank.sworna.example.com/peers/peer0.centralbank.sworna.example.com/tls/ca.crt"
        ),
        "CORE_PEER_MSPCONFIGPATH": str(
            orgs / "peerOrganizations/centralbank.sworna.example.com/users/Admin@centralbank.sworna.example.com/msp"
        ),
        "ORDERER_CA": str(
            orgs / "ordererOrganizations/sworna.example.com/orderers/orderer.sworna.example.com/tls/ca.crt"
        ),
    }
    return env


@router.post("/admin/mint", response_model=TxLogRead, status_code=201)
@router.post("/admin/issue", response_model=TxLogRead, status_code=201)
async def mint_to_bank(
    body: IssueRequest,
    user: User = Depends(cb_mint),
    session: Session = Depends(get_session),
):
    """Mint CBDC base money and allocate to a commercial bank's reserve wallet."""
    # Find bank either by bank_code or by target account if legacy call
    bank = None
    target_wallet = None
    target_node = None
    to_label = None

    if body.bank_code:
        bank = session.scalar(select(Bank).where(Bank.code == body.bank_code))
        if bank is None:
            raise HTTPException(404, f"bank with code '{body.bank_code}' not found")
        target_wallet = f"pool_{bank.code}_w1"
        target_node = bank.owner_node
        to_label = f"RESERVE-{bank.code}"
    elif body.to_account:
        if body.to_account.startswith("RESERVE-"):
            bcode = body.to_account.removeprefix("RESERVE-")
            bank = session.scalar(select(Bank).where(Bank.code == bcode))
            if bank is None:
                raise HTTPException(404, f"bank '{bcode}' not found")
            target_wallet = f"pool_{bank.code}_w1"
            target_node = bank.owner_node
            to_label = f"RESERVE-{bank.code}"
        else:
            account = session.scalar(select(Account).where(Account.account_number == body.to_account))
            if account is not None:
                target_wallet = account.wallet
                target_node = account.owner_node
                to_label = account.account_number
            else:
                # Fallback: check if to_account is a bank code
                bank = session.scalar(select(Bank).where(Bank.code == body.to_account))
                if bank:
                    target_wallet = f"pool_{bank.code}_w1"
                    target_node = bank.owner_node
                    to_label = f"RESERVE-{bank.code}"
                else:
                    raise HTTPException(404, f"target bank or account '{body.to_account}' not found")
    else:
        raise HTTPException(400, "either 'bank_code' or 'to_account' must be provided")

    amount_minor = to_minor(body.amount)
    try:
        txid = await token_client.issue(
            amount_minor=amount_minor,
            node=target_node,
            wallet=target_wallet,
            message=body.reference or f"Wholesale CBDC Mint to {to_label}",
        )
    except TokenServiceError as exc:
        raise HTTPException(502, f"token service error: {exc}") from exc

    log = TransactionLog(
        txid=txid,
        tx_type="mint",
        from_account="CENTRAL_BANK",
        to_account=to_label,
        amount_minor=amount_minor,
        reference=body.reference or "Wholesale CBDC Issuance",
    )
    session.add(log)
    session.commit()
    session.refresh(log)
    return log


@router.post("/admin/allocate", response_model=TxLogRead, status_code=201)
async def allocate_between_banks(
    body: AllocateBankRequest,
    user: User = Depends(cb_mint),
    session: Session = Depends(get_session),
):
    """Wholesale interbank liquidity allocation managed by Central Bank."""
    from_bank = session.scalar(select(Bank).where(Bank.code == body.from_bank_code))
    if from_bank is None:
        raise HTTPException(404, f"source bank '{body.from_bank_code}' not found")
    to_bank = session.scalar(select(Bank).where(Bank.code == body.to_bank_code))
    if to_bank is None:
        raise HTTPException(404, f"destination bank '{body.to_bank_code}' not found")

    amount_minor = to_minor(body.amount)
    from_wallet = f"pool_{from_bank.code}_w1"
    to_wallet = f"pool_{to_bank.code}_w1"

    try:
        txid = await token_client.transfer(
            from_wallet=from_wallet,
            from_node=from_bank.owner_node,
            to_wallet=to_wallet,
            to_node=to_bank.owner_node,
            amount_minor=amount_minor,
            message=body.reference or f"Wholesale Allocation {from_bank.code}->{to_bank.code}",
        )
    except TokenServiceError as exc:
        raise HTTPException(502, f"token service error: {exc}") from exc

    log = TransactionLog(
        txid=txid,
        tx_type="wholesale_allocation",
        from_account=f"RESERVE-{from_bank.code}",
        to_account=f"RESERVE-{to_bank.code}",
        amount_minor=amount_minor,
        reference=body.reference or "Wholesale Interbank Allocation",
    )
    session.add(log)
    session.commit()
    session.refresh(log)
    return log


@router.post("/admin/burn", response_model=TxLogRead, status_code=201)
async def burn_from_bank(
    body: BurnFromBankRequest,
    user: User = Depends(cb_mint),
    session: Session = Depends(get_session),
):
    """Revoke / Redeem CBDC from a commercial bank's reserve back into CB vault."""
    bank = session.scalar(select(Bank).where(Bank.code == body.bank_code))
    if bank is None:
        raise HTTPException(404, f"bank '{body.bank_code}' not found")

    amount_minor = to_minor(body.amount)
    target_wallet = f"pool_{bank.code}_w1"

    try:
        txid = await token_client.redeem(
            wallet=target_wallet,
            node=bank.owner_node,
            amount_minor=amount_minor,
            message=body.reference or f"Wholesale CBDC Burn from {bank.code}",
        )
    except TokenServiceError as exc:
        raise HTTPException(502, f"token service error: {exc}") from exc

    log = TransactionLog(
        txid=txid,
        tx_type="burn",
        from_account=f"RESERVE-{bank.code}",
        to_account="CENTRAL_BANK",
        amount_minor=amount_minor,
        reference=body.reference or "Wholesale CBDC Redemption/Burn",
    )
    session.add(log)
    session.commit()
    session.refresh(log)
    return log


@router.get("/admin/users", response_model=list[UserRead])
def list_cb_users(user: User = Depends(cb_admin), session: Session = Depends(get_session)):
    """List Central Bank staff users."""
    return session.scalars(select(User).where(User.role.in_(["cb_admin", "cb_mint_officer", "cb_auditor"]))).all()


@router.post("/admin/users", response_model=UserRead, status_code=201)
def create_cb_user(
    body: CBUserCreate,
    user: User = Depends(cb_admin),
    session: Session = Depends(get_session),
):
    """Create a new Central Bank staff user with role-based access."""
    if session.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(409, f"username '{body.username}' is already in use")
    from ..security import hash_password

    new_user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role=body.role,
    )
    session.add(new_user)
    session.commit()
    session.refresh(new_user)
    return new_user


@router.get("/admin/transactions", response_model=list[TxLogRead])
def list_transactions(
    limit: int = 50,
    user: User = Depends(cb_staff),
    session: Session = Depends(get_session),
):
    return session.scalars(
        select(TransactionLog).order_by(TransactionLog.id.desc()).limit(limit)
    ).all()


@router.get("/admin/overview", response_model=AdminOverview)
async def overview(user: User = Depends(cb_admin), session: Session = Depends(get_session)):
    banks = session.scalars(select(Bank).order_by(Bank.code)).all()
    rows: list[CirculationRow] = []
    total_minor = 0
    for bank in banks:
        bank_minor = 0
        
        # 1. Master Reserve Vault (pool_{code}_w1)
        reserve_wallet = f"pool_{bank.code}_w1"
        try:
            bank_minor += await token_client.balances(
                wallet=reserve_wallet, node=bank.owner_node
            )
        except (TokenServiceError, httpx.HTTPError):
            pass

        # 2. Retail Customer Wallets
        accounts = session.scalars(select(Account).where(Account.bank_id == bank.id)).all()
        for account in accounts:
            if account.wallet == reserve_wallet:
                continue
            try:
                bank_minor += await token_client.balances(
                    wallet=account.wallet, node=bank.owner_node
                )
            except (TokenServiceError, httpx.HTTPError):
                continue
        total_minor += bank_minor
        rows.append(
            CirculationRow(
                bank_code=bank.code,
                bank_name=bank.name,
                status=bank.status,
                total_minor=bank_minor,
                total=to_swr(bank_minor),
                account_count=len(accounts),
            )
        )
    return AdminOverview(total_supply=to_swr(total_minor), circulation=rows)


@router.get("/admin/ledger", response_model=LedgerStatus)
def ledger_status(limit: int = 5, user: User = Depends(cb_admin)):
    env = _peer_env()
    channel = "settlement"
    try:
        info = subprocess.run(
            ["peer", "channel", "getinfo", "-c", channel],
            capture_output=True, text=True, env=env, timeout=30,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(503, f"peer CLI unavailable: {exc}") from exc
    if info.returncode != 0:
        raise HTTPException(503, info.stderr[-500:])

    height = 0
    for line in info.stdout.splitlines():
        if "Blockchain info:" in line:
            height = int(json.loads(line.split(":", 1)[1].strip())["height"])

    blocks: list[BlockSummary] = []
    start = max(0, height - limit)
    for num in range(start, max(height, 1)):
        fetch = subprocess.run(
            [
                "peer", "channel", "fetch", str(num), "-o", "localhost:7050",
                "--ordererTLSHostnameOverride", "orderer.sworna.example.com",
                "--tls", "--cafile", env["ORDERER_CA"], "-c", channel, "/tmp/sworna-blk.block",
            ],
            capture_output=True, text=True, env=env, timeout=30,
        )
        if fetch.returncode != 0:
            continue
        decoded = subprocess.run(
            ["configtxlator", "proto_decode", "--type", "common.Block",
             "--input", "/tmp/sworna-blk.block", "--output", "/tmp/sworna-blk.json"],
            capture_output=True, text=True, env=env, timeout=30,
        )
        if decoded.returncode != 0:
            continue
        try:
            data = json.loads(Path("/tmp/sworna-blk.json").read_text())
            txs = data.get("data", {}).get("data", [])
            txids = []
            for tx in txs:
                ch = tx.get("payload", {}).get("header", {}).get("channel_header", {})
                tid = ch.get("tx_id", "")
                if tid:
                    txids.append(tid)
            blocks.append(BlockSummary(number=num, tx_count=len(txs), txids=txids))
        except (json.JSONDecodeError, KeyError):
            continue

    return LedgerStatus(channel=channel, height=height, blocks=blocks)