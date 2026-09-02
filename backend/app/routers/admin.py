"""Central-bank admin endpoints: issue, provisioning, supply, circulation, ledger,
AML compliance and the zk-crypto parameter surface."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import aml
from ..amounts import to_minor, to_swr
from ..database import get_session
from ..deps import cb_admin, cb_audit, cb_mint, cb_staff
from ..models import Account, AMLAlert, Bank, TransactionLog, User, WatchlistEntry
from ..paths import BIN, FABRIC_CFG, NETWORK_HOME, TOKEN_SERVICES
from ..provisioning import ProvisioningError, provision_wallet_pool
from ..schemas import (
    AdminOverview,
    AMLAlertRead,
    AMLAlertUpdate,
    AMLSummary,
    AllocateBankRequest,
    BurnFromBankRequest,
    CBUserCreate,
    CirculationRow,
    CryptoParams,
    IssueRequest,
    TxLogRead,
    UserRead,
    WalletCryptoInfo,
    WatchlistEntryCreate,
    WatchlistEntryRead,
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


@router.post("/admin/banks/{code}/provision", response_model=ProvisionResult)
def provision_bank(
    code: str,
    user: User = Depends(cb_admin),
    session: Session = Depends(get_session),
):
    """Mint a bank's token-CA identities: the owner node FSC identity plus its
    idemix pool wallets (`pool_<code>_w1..wN`). Idempotent — only missing
    identities are created."""
    bank = session.scalar(select(Bank).where(Bank.code == code))
    if bank is None:
        raise HTTPException(404, f"bank '{code}' not found")

    before_used = len(bank.wallet_pool.get("used", []))
    before_free = len(bank.wallet_pool.get("free", []))
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
        wallets_generated=max(0, (used + free) - (before_used + before_free)),
        used=used,
        free=free,
    )


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
        tx_type="issue",
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
    unreachable = 0
    for bank in banks:
        bank_minor = 0
        bank_errors = 0

        # 1. Master Reserve Vault (pool_{code}_w1)
        reserve_wallet = f"pool_{bank.code}_w1"
        try:
            bank_minor += await token_client.balances(
                wallet=reserve_wallet, node=bank.owner_node
            )
        except (TokenServiceError, httpx.HTTPError):
            bank_errors += 1

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
                bank_errors += 1
                continue
        total_minor += bank_minor
        unreachable += bank_errors
        rows.append(
            CirculationRow(
                bank_code=bank.code,
                bank_name=bank.name,
                status=bank.status,
                total_minor=bank_minor,
                total=to_swr(bank_minor),
                account_count=len(accounts),
                wallet_errors=bank_errors,
            )
        )
    return AdminOverview(
        total_supply=to_swr(total_minor),
        circulation=rows,
        wallets_unreachable=unreachable,
    )


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
        # Unique temp files per block/request — concurrent callers must not
        # clobber each other's fetches.
        fd, blk_path = tempfile.mkstemp(prefix=f"sworna-blk-{num}-", suffix=".block")
        os.close(fd)
        json_path = blk_path + ".json"
        try:
            fetch = subprocess.run(
                [
                    "peer", "channel", "fetch", str(num), "-o", "localhost:7050",
                    "--ordererTLSHostnameOverride", "orderer.sworna.example.com",
                    "--tls", "--cafile", env["ORDERER_CA"], "-c", channel, blk_path,
                ],
                capture_output=True, text=True, env=env, timeout=30,
            )
            if fetch.returncode != 0:
                continue
            decoded = subprocess.run(
                ["configtxlator", "proto_decode", "--type", "common.Block",
                 "--input", blk_path, "--output", json_path],
                capture_output=True, text=True, env=env, timeout=30,
            )
            if decoded.returncode != 0:
                continue
            try:
                data = json.loads(Path(json_path).read_text())
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
        finally:
            for p in (blk_path, json_path):
                try:
                    os.unlink(p)
                except OSError:
                    pass

    return LedgerStatus(channel=channel, height=height, blocks=blocks)

# -- AML / compliance -------------------------------------------------------
@router.get("/admin/aml/alerts", response_model=list[AMLAlertRead])
def list_aml_alerts(
    status: str = "",
    severity: str = "",
    bank_code: str = "",
    limit: int = 100,
    user: User = Depends(cb_staff),
    session: Session = Depends(get_session),
):
    stmt = select(AMLAlert).order_by(AMLAlert.id.desc()).limit(max(1, min(limit, 500)))
    if status:
        stmt = stmt.where(AMLAlert.status == status)
    if severity:
        stmt = stmt.where(AMLAlert.severity == severity)
    if bank_code:
        stmt = stmt.where(AMLAlert.bank_code == bank_code)
    return session.scalars(stmt).all()


@router.patch("/admin/aml/alerts/{alert_id}", response_model=AMLAlertRead)
def review_aml_alert(
    alert_id: int,
    body: AMLAlertUpdate,
    user: User = Depends(cb_audit),
    session: Session = Depends(get_session),
):
    alert = session.get(AMLAlert, alert_id)
    if alert is None:
        raise HTTPException(404, "alert not found")
    alert.status = body.status
    alert.reviewed_by = user.username
    from ..models import utcnow

    alert.reviewed_at = utcnow()
    if body.note:
        alert.details = f"{alert.details} | review note: {body.note}"[:500]
    session.commit()
    session.refresh(alert)
    return alert


@router.get("/admin/aml/summary", response_model=AMLSummary)
def aml_summary(user: User = Depends(cb_staff), session: Session = Depends(get_session)):
    open_by_severity = {
        sev: session.scalar(
            select(func.count())
            .select_from(AMLAlert)
            .where(AMLAlert.status == "open", AMLAlert.severity == sev)
        ) or 0
        for sev in ("low", "medium", "high")
    }
    tier_table = {
        f"tier_{level}": {
            "label": tier.label,
            "per_tx_minor": tier.per_tx_minor,
            "daily_minor": tier.daily_minor,
            "daily_count": tier.daily_count,
        }
        for level, tier in aml.KYC_TIERS.items()
    }
    return AMLSummary(
        open_alerts=sum(open_by_severity.values()),
        open_by_severity=open_by_severity,
        flagged_accounts=session.scalar(
            select(func.count()).select_from(Account).where(Account.status == "flagged")
        ) or 0,
        watchlist_entries=session.scalar(
            select(func.count()).select_from(WatchlistEntry).where(WatchlistEntry.active)
        ) or 0,
        reportable_threshold=to_swr(aml.REPORTABLE_THRESHOLD_MINOR),
        kyc_tiers=tier_table,
    )


@router.get("/admin/aml/watchlist", response_model=list[WatchlistEntryRead])
def list_watchlist(user: User = Depends(cb_staff), session: Session = Depends(get_session)):
    return session.scalars(select(WatchlistEntry).order_by(WatchlistEntry.id.desc())).all()


@router.post("/admin/aml/watchlist", response_model=WatchlistEntryRead, status_code=201)
def add_watchlist_entry(
    body: WatchlistEntryCreate,
    user: User = Depends(cb_audit),
    session: Session = Depends(get_session),
):
    entry = WatchlistEntry(
        list_type=body.list_type,
        value=body.value,
        note=body.note,
        created_by=user.username,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


@router.delete("/admin/aml/watchlist/{entry_id}", status_code=204)
def deactivate_watchlist_entry(
    entry_id: int,
    user: User = Depends(cb_audit),
    session: Session = Depends(get_session),
):
    entry = session.get(WatchlistEntry, entry_id)
    if entry is None:
        raise HTTPException(404, "watchlist entry not found")
    entry.active = False
    session.commit()


# -- zk-crypto parameter surface (privacy & cryptography page) ---------------
PUBLIC_PARAMS_FILE = Path(TOKEN_SERVICES) / "tokenchaincode" / "zkatdlog_pp.json"


def _fingerprint(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode()
    return hashlib.sha256(data).hexdigest()[:16]


def _load_public_params() -> dict:
    """Load zkatdlog_pp.json; raise 503 with a clear message when missing/bad."""
    if not PUBLIC_PARAMS_FILE.exists():
        raise HTTPException(503, f"public params not found at {PUBLIC_PARAMS_FILE}")
    try:
        return json.loads(PUBLIC_PARAMS_FILE.read_text())
    except json.JSONDecodeError as exc:
        raise HTTPException(503, f"public params file is not valid JSON: {exc}") from exc


@router.get("/admin/crypto/params", response_model=CryptoParams)
def crypto_params(user: User = Depends(cb_staff)):
    """Public parameters of the zero-knowledge token layer.

    These are the exact values baked into the token chaincode at setup time:
    Pedersen generators, the ZKAT range-proof parameters, the issuer public
    keys, the Idemix issuer (blind-signature) public key and the auditor's
    de-blinding public key. Regenerating them invalidates every token.
    """
    outer = _load_public_params()
    inner = json.loads(base64.b64decode(outer["Raw"]))
    auditor_blob = base64.b64decode(inner["Auditor"])
    pem = re.search(
        rb"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----",
        auditor_blob, re.DOTALL,
    )
    msp_id = ""
    # auditor blob is a protobuf message: field 1 (0x0a) is the MSP ID string
    if len(auditor_blob) > 2 and auditor_blob[0] == 0x0A:
        n = auditor_blob[1]
        msp_id = auditor_blob[2 : 2 + n].decode(errors="replace")
    range_proof = inner.get("RangeProofParams", {})
    return CryptoParams(
        identifier=inner.get("Label", outer.get("Identifier", "")),
        curve_id=inner.get("Curve", 0),
        idemix_curve_id=inner.get("IdemixCurveID", 0),
        quantity_precision=inner.get("QuantityPrecision", 0),
        max_token=inner.get("MaxToken", 0),
        range_proof={
            "exponent": range_proof.get("Exponent"),
            "base": len(range_proof.get("SignedValues", [])),
        },
        issuers=len(inner.get("Issuers", [])),
        idemix_issuer_pk_fingerprint=_fingerprint(inner["IdemixIssuerPK"]),
        auditor={
            "msp_id": msp_id,
            "cert_fingerprint": _fingerprint(pem.group(0)) if pem else "",
        },
        pedersen_generators_fingerprint=_fingerprint(
            json.dumps({"gen": inner["PedGen"], "params": inner["PedParams"]}, sort_keys=True)
        ),
        params_file=str(PUBLIC_PARAMS_FILE),
        params_valid=True,
    )


@router.get("/admin/crypto/wallets", response_model=list[WalletCryptoInfo])
def crypto_wallets(
    user: User = Depends(cb_staff), session: Session = Depends(get_session)
):
    """Per-account idemix wallet fingerprints.

    Each wallet holds an Idemix credential — a Camenisch-Lysyanskaya blind
    signature issued by the token CA over the user's secret. On-chain the
    wallet only ever reveals one-time pseudonyms derived from that credential,
    never the credential itself.
    """
    accounts = session.scalars(select(Account).order_by(Account.id)).all()
    out = []
    for acc in accounts:
        signer = Path(TOKEN_SERVICES) / "keys" / acc.owner_node / "wallet" / acc.wallet / "msp" / "user" / "SignerConfig"
        fingerprint = _fingerprint(signer.read_bytes()) if signer.exists() else None
        out.append(
            WalletCryptoInfo(
                account_number=acc.account_number,
                full_name=acc.full_name,
                wallet=acc.wallet,
                key_type="idemix (CL blind-signature credential)",
                credential_fingerprint=fingerprint,
            )
        )
    return out
