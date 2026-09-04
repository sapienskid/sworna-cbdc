from fastapi.testclient import TestClient
import pytest
from app.main import app
from app.database import SessionLocal
from app.models import Base, User, OnboardingApplication, Bank
from app.database import engine
from app.security import hash_password

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as session:
        # Create CB Admin and CB Mint officer
        session.add(User(username="cbadmin", password_hash=hash_password("sworna-cb"), role="cb_admin"))
        session.add(User(username="cbmint", password_hash=hash_password("sworna-cb"), role="cb_mint_officer"))
        session.commit()

def test_full_institutional_admission_pipeline():
    # Login as CB Admin & Mint officer
    cb_admin_token = client.post("/api/v1/auth/login", json={"username": "cbadmin", "password": "sworna-cb"}).json()["token"]
    cb_mint_token = client.post("/api/v1/auth/login", json={"username": "cbmint", "password": "sworna-cb"}).json()["token"]
    
    admin_headers = {"Authorization": f"Bearer {cb_admin_token}"}
    mint_headers = {"Authorization": f"Bearer {cb_mint_token}"}

    # 1. Bank 001 submits application
    apply_payload = {
        "bank_code": "001",
        "legal_name": "Standard Chartered Demo Bank",
        "msp_id": "Bank1MSP",
        "owner_node": "owner1",
        "peer_endpoint": "peer0.bank1.sworna.example.com:11051",
        "ca_endpoint": "ca.bank1.sworna.example.com:20055",
        "portal_url": "http://localhost:5274",
        "public_msp_json": {"name": "Bank1MSP", "msp_id": "Bank1MSP"},
        "pool_size": 10,
    }
    resp = client.post("/api/v1/onboarding/apply", json=apply_payload)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["status"] == "submitted"
    assert data["bank_code"] == "001"

    # 2. Security officer tries to approve directly -> Should fail with 400 (Four-Eyes Principle violation!)
    resp = client.post("/api/v1/onboarding/applications/001/approve-admission", json={"approve": True}, headers=admin_headers)
    assert resp.status_code == 400
    assert "Four-Eyes Principle" in resp.json()["detail"]

    # 3. Monetary Officer verifies reserve quota & limits
    resp = client.post(
        "/api/v1/onboarding/applications/001/verify-monetary",
        json={"interbank_limit_minor": 50_000_000},
        headers=mint_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "verified_monetary"
    assert data["monetary_officer"] == "cbmint"
    assert data["interbank_limit_minor"] == 50_000_000

    # 4. Security officer now approves admission
    resp = client.post("/api/v1/onboarding/applications/001/approve-admission", json={"approve": True}, headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "approved"
    assert data["security_officer"] == "cbadmin"

    # 5. Check that the bank is now created in the active banks registry
    resp = client.get("/api/v1/banks", headers=admin_headers)
    assert resp.status_code == 200
    banks = resp.json()
    assert any(b["code"] == "001" and b["status"] == "active" for b in banks)
    print("Full Institutional Admission Pipeline Test PASSED!")
