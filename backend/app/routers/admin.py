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
from ..deps import cb_admin
from ..models import Account, Bank, TransactionLog, User
from ..paths import BIN, FABRIC_CFG, NETWORK_HOME
from ..provisioning import ProvisioningError, provision_wallet_pool
from ..schemas import AdminOverview, CirculationRow, IssueRequest, TxLogRead
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


@router.post("/admin/issue", response_model=TxLogRead, status_code=201)
async def issue(
    body: IssueRequest,
    user: User = Depends(cb_admin),
    session: Session = Depends(get_session),
):
    account = session.scalar(select(Account).where(Account.account_number == body.to_account))
    if account is None:
        raise HTTPException(404, f"account '{body.to_account}' not found")

    amount_minor = to_minor(body.amount)
    try:
        txid = await token_client.issue(
            amount_minor=amount_minor,
            node=account.owner_node,
            wallet=account.wallet,
            message=body.reference,
        )
    except TokenServiceError as exc:
        raise HTTPException(502, f"token service error: {exc}") from exc

    log = TransactionLog(
        txid=txid,
        tx_type="issue",
        to_account=account.account_number,
        amount_minor=amount_minor,
        reference=body.reference,
    )
    session.add(log)
    session.commit()
    session.refresh(log)
    return log


@router.post("/admin/banks/{code}/provision", response_model=ProvisionResult)
async def provision_bank_keys(
    code: str,
    user: User = Depends(cb_admin),
    session: Session = Depends(get_session),
):
    """Generate (top up) the bank's wallet pool via the token CA."""
    bank = session.scalar(select(Bank).where(Bank.code == code))
    if bank is None:
        raise HTTPException(404, "bank not found")
    try:
        provision_wallet_pool(bank)
    except ProvisioningError as exc:
        raise HTTPException(502, f"provisioning failed: {exc}") from exc
    session.commit()
    session.refresh(bank)
    used = len(bank.wallet_pool.get("used", []))
    free = len(bank.wallet_pool.get("free", []))
    return ProvisionResult(
        bank_code=bank.code,
        bank_name=bank.name,
        owner_node=bank.owner_node,
        wallets_generated=used + free,
        used=used,
        free=free,
    )


@router.get("/admin/transactions", response_model=list[TxLogRead])
def list_transactions(
    limit: int = 50,
    user: User = Depends(cb_admin),
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
        accounts = session.scalars(select(Account).where(Account.bank_id == bank.id)).all()
        bank_minor = 0
        for account in accounts:
            try:
                bank_minor += await token_client.balances(
                    wallet=account.wallet, node=bank.owner_node
                )
            except (TokenServiceError, httpx.HTTPError):
                continue  # owner VM unreachable — report what we can
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