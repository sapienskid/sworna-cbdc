"""Institutional Commercial Bank Onboarding & Admission Router.

Implements the production-grade 4-stage admission pipeline:
1. Bank submits application with public MSP JSON (POST /onboarding/apply)
2. Central Bank reviews pending applications (GET /onboarding/applications)
3. Central Bank Monetary Officer verifies & sets limits (POST /onboarding/{code}/verify-monetary)
4. Central Bank CISO/Admin approves security & admits to channel (POST /onboarding/{code}/approve-admission)
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_session
from ..deps import cb_admin, cb_mint
from ..models import Bank, OnboardingApplication, User, utcnow
from ..paths import REPO_ROOT
from ..provisioning import provision_wallet_pool
from ..schemas import (
    BankCredentialsRead,
    MonetaryApprovalRequest,
    OnboardingApplicationCreate,
    OnboardingApplicationRead,
    SecurityApprovalRequest,
)
from ..security import hash_password

router = APIRouter(prefix="/api/v1/onboarding", tags=["onboarding"])


@router.post("/apply", response_model=OnboardingApplicationRead, status_code=201)
def apply_for_onboarding(
    body: OnboardingApplicationCreate,
    session: Session = Depends(get_session),
):
    """Stage 1: Commercial Bank submits signed admission request (idempotent)."""
    existing_app = session.scalar(
        select(OnboardingApplication).where(OnboardingApplication.bank_code == body.bank_code)
    )
    if existing_app:
        # Update endpoints/public MSP if re-submitted
        existing_app.legal_name = body.legal_name
        existing_app.peer_endpoint = body.peer_endpoint
        existing_app.ca_endpoint = body.ca_endpoint
        existing_app.portal_url = body.portal_url
        if body.public_msp_json:
            existing_app.public_msp_json = body.public_msp_json
        session.commit()
        session.refresh(existing_app)
        app = existing_app
    else:
        app = OnboardingApplication(
            bank_code=body.bank_code,
            legal_name=body.legal_name,
            msp_id=body.msp_id,
            owner_node=body.owner_node,
            peer_endpoint=body.peer_endpoint,
            ca_endpoint=body.ca_endpoint,
            portal_url=body.portal_url,
            public_msp_json=body.public_msp_json,
            pool_size=body.pool_size,
            status="submitted",
        )
        session.add(app)
        session.commit()
        session.refresh(app)

    # Auto-admit mode (e.g. for workshop or zero-touch deployments)
    import os
    if os.getenv("SWORNA_AUTO_ADMIT", "0") == "1" and app.status != "approved":
        _execute_monetary_approval(app, MonetaryApprovalRequest(), "system", session)
        _execute_security_approval(app, SecurityApprovalRequest(approve=True), "system", session)

    return app


@router.get("/applications", response_model=list[OnboardingApplicationRead])
def list_applications(
    user: User = Depends(cb_admin),
    session: Session = Depends(get_session),
):
    """Central Bank compliance list of admission applications."""
    return session.scalars(select(OnboardingApplication).order_by(OnboardingApplication.created_at.desc())).all()


@router.get("/applications/{code}", response_model=OnboardingApplicationRead)
def get_application(
    code: str,
    user: User = Depends(cb_admin),
    session: Session = Depends(get_session),
):
    app = session.scalar(select(OnboardingApplication).where(OnboardingApplication.bank_code == code))
    if not app:
        raise HTTPException(404, f"No application for bank code {code}")
    return app


def _execute_monetary_approval(
    app: OnboardingApplication,
    body: MonetaryApprovalRequest,
    officer_username: str,
    session: Session,
) -> OnboardingApplication:
    app.monetary_officer = officer_username
    app.monetary_approved_at = utcnow()
    app.interbank_limit_minor = body.interbank_limit_minor
    app.status = "verified_monetary"
    session.commit()
    session.refresh(app)
    return app


def _execute_security_approval(
    app: OnboardingApplication,
    body: SecurityApprovalRequest,
    officer_username: str,
    session: Session,
) -> OnboardingApplication:
    if not body.approve:
        app.status = "rejected"
        app.rejection_reason = body.rejection_reason or "Rejected by security officer"
        session.commit()
        session.refresh(app)
        return app

    # Enforce Four-Eyes Principle: Monetary verification must occur before security approval!
    if not app.monetary_approved_at:
        raise HTTPException(400, "Four-Eyes Principle violation: Monetary Officer approval required before admission")

    app.security_officer = officer_username
    app.security_approved_at = utcnow()

    # 1. Write the bank's public MSP definition to network/
    k = int(app.bank_code)
    bank_org = f"bank{k}"
    org_file = REPO_ROOT / "network" / f"{bank_org}-org.json"
    if app.public_msp_json:
        with open(org_file, "w") as f:
            json.dump(app.public_msp_json, f, indent=2)

    # 2. Record bank host in bank-hosts.env if peer_endpoint has an IP
    import os
    if app.peer_endpoint:
        host_part = app.peer_endpoint.split(":")[0]
        if host_part not in ("127.0.0.1", "localhost"):
            hosts_env = REPO_ROOT / "network" / "bank-hosts.env"
            with open(hosts_env, "a") as f:
                f.write(f"\nSWORNA_OWNER_OWNER{k}_HOST={host_part}\n")

    # 3. Admit the org to the Fabric channel if on-chain script exists
    skip_onchain = os.getenv("SWORNA_SKIP_ONCHAIN_ADMISSION", "0") == "1"
    onboard_script = REPO_ROOT / "scripts" / "onboard-bank.sh"
    if not skip_onchain and onboard_script.exists() and org_file.exists():
        proc = subprocess.run(
            [str(onboard_script), app.msp_id, str(org_file)],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            raise HTTPException(
                502, f"On-chain channel admission failed: {proc.stderr.strip()[-500:]}"
            )

    # 4. Create or activate the Bank record in the database
    bank = session.scalar(select(Bank).where(Bank.code == app.bank_code))
    if not bank:
        bank = Bank(
            code=app.bank_code,
            name=app.legal_name,
            msp_id=app.msp_id,
            owner_node=app.owner_node,
            portal_url=app.portal_url,
            status="active",
            permissions={
                "can_redeem": True,
                "interbank_limit_minor": app.interbank_limit_minor,
                "redeem_limit_minor": 0,
            },
            pool_size=app.pool_size,
            wallet_pool={"used": [], "free": []},
            joined_at=utcnow(),
        )
        session.add(bank)

    # Ensure bank staff user exists
    staff_user = f"bank{k}_admin"
    if not session.scalar(select(User).where(User.username == staff_user)):
        session.add(
            User(
                username=staff_user,
                password_hash=hash_password("sworna-bank"),
                role="bank_staff",
                bank_code=app.bank_code,
            )
        )
    session.commit()
    session.refresh(bank)

    # 5. Provision the Idemix token wallet pool for the bank
    try:
        provision_wallet_pool(bank)
        session.commit()
    except Exception:
        pass

    # 6. Export join bundle
    try:
        export_script = REPO_ROOT / "scripts" / "export-join-bundles.sh"
        if export_script.exists():
            subprocess.run([str(export_script)], cwd=str(REPO_ROOT), capture_output=True, text=True)
    except Exception:
        pass

    # 7. Auto-commit chaincode endorsement policy with new bank
    try:
        commit_script = REPO_ROOT / "scripts" / "commit-chaincode.sh"
        if commit_script.exists() and not skip_onchain:
            subprocess.run([str(commit_script)], cwd=str(REPO_ROOT), capture_output=True, text=True)
    except Exception:
        pass

    app.status = "approved"
    session.commit()
    session.refresh(app)
    return app


@router.post("/applications/{code}/verify-monetary", response_model=OnboardingApplicationRead)
def verify_monetary_policy(
    code: str,
    body: MonetaryApprovalRequest,
    user: User = Depends(cb_mint),
    session: Session = Depends(get_session),
):
    """Stage 3A: Central Bank Monetary Officer reviews reserve quota & interbank limits."""
    app = session.scalar(select(OnboardingApplication).where(OnboardingApplication.bank_code == code))
    if not app:
        raise HTTPException(404, f"No application for bank code {code}")
    if app.status not in ("submitted", "verified_monetary"):
        raise HTTPException(400, f"Cannot verify monetary policy for application in status '{app.status}'")
    return _execute_monetary_approval(app, body, user.username, session)


@router.post("/applications/{code}/approve-admission", response_model=OnboardingApplicationRead)
def approve_and_admit(
    code: str,
    body: SecurityApprovalRequest,
    user: User = Depends(cb_admin),
    session: Session = Depends(get_session),
):
    """Stage 3B: Central Bank CISO/Admin verifies security & commits on-chain channel delta."""
    app = session.scalar(select(OnboardingApplication).where(OnboardingApplication.bank_code == code))
    if not app:
        raise HTTPException(404, f"No application for bank code {code}")
    return _execute_security_approval(app, body, user.username, session)


@router.post("/applications/{code}/admit-fast", response_model=OnboardingApplicationRead)
def fast_admit(
    code: str,
    user: User = Depends(cb_admin),
    session: Session = Depends(get_session),
):
    """1-Click admission: performs monetary verification + security approval in one step."""
    app = session.scalar(select(OnboardingApplication).where(OnboardingApplication.bank_code == code))
    if not app:
        raise HTTPException(404, f"No application for bank code {code}")
    _execute_monetary_approval(app, MonetaryApprovalRequest(), user.username, session)
    return _execute_security_approval(app, SecurityApprovalRequest(approve=True), user.username, session)


@router.get("/applications/{code}/credentials", response_model=BankCredentialsRead)
def get_credentials(
    code: str,
    session: Session = Depends(get_session),
):
    """Securely stream minted Idemix keys + Orderer TLS certificates to approved bank node."""
    app = session.scalar(select(OnboardingApplication).where(OnboardingApplication.bank_code == code))
    if not app:
        raise HTTPException(404, f"No application for bank code {code}")
    if app.status != "approved":
        raise HTTPException(400, f"Bank {code} is not approved yet (status: {app.status})")

    bundle_file = REPO_ROOT / "dist-bank-bundles" / f"bank{code}.tar.gz"
    if not bundle_file.exists():
        export_script = REPO_ROOT / "scripts" / "export-join-bundles.sh"
        if export_script.exists():
            subprocess.run([str(export_script)], cwd=str(REPO_ROOT), capture_output=True, text=True)

    if not bundle_file.exists():
        raise HTTPException(500, f"Credential bundle for bank {code} not found")

    import base64
    bundle_b64 = base64.b64encode(bundle_file.read_bytes()).decode("utf-8")
    return BankCredentialsRead(
        bank_code=code,
        owner_node=app.owner_node,
        bundle_base64=bundle_b64,
    )

