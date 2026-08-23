"""End-to-end smoke tests for the banking API against a running CB stack.

Requires (on the CB host):
  - backend (:8000) + token CA (:27054)
  - Fabric network up (chaincode approved)

The suite bootstraps its own data through the PUBLIC API — it registers two
runtime banks, provisions them (mints wallets + owner identity via the token CA)
and exercises role scoping. Ledger-flow tests additionally need the banks'
owner services running and the chaincode committed; they skip automatically
when the owner nodes are not reachable.

These tests create real registry entries. Run against a deployment you can
reset (`docs/SETUP.md` §9).
"""
from __future__ import annotations

import httpx
import pytest

BACKEND = "http://localhost:8000/api/v1"

CB = ("cbadmin", "sworna-cb")
BANK_A = {"code": "901", "name": "pytest-bank-a", "msp_id": "Bank901MSP",
          "owner_node": "owner901", "staff_username": "pytest_bank_a"}
BANK_B = {"code": "902", "name": "pytest-bank-b", "msp_id": "Bank902MSP",
          "owner_node": "owner902", "staff_username": "pytest_bank_b"}
STAFF_A = (BANK_A["staff_username"], "sworna-bank")
STAFF_B = (BANK_B["staff_username"], "sworna-bank")


@pytest.fixture(scope="module")
def client():
    return httpx.Client(timeout=120)


def _login(client: httpx.Client, username: str, password: str) -> str:
    resp = client.post(f"{BACKEND}/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _assert_ok(resp: httpx.Response) -> dict:
    assert 200 <= resp.status_code < 300, f"{resp.status_code}: {resp.text}"
    return resp.json()


@pytest.fixture(scope="module")
def cb_token(client: httpx.Client) -> str:
    return _login(client, *CB)


@pytest.fixture(scope="module")
def banks_provisioned(client: httpx.Client, cb_token: str) -> dict:
    """Register + provision two runtime banks through the public API."""
    out = {}
    for spec, staff in ((BANK_A, STAFF_A), (BANK_B, STAFF_B)):
        resp = client.post(f"{BACKEND}/banks", headers=_auth(cb_token), json=spec)
        if resp.status_code == 409:
            pass  # already registered from a previous run — reuse
        else:
            assert resp.status_code == 201, resp.text

        result = _assert_ok(
            client.post(f"{BACKEND}/admin/banks/{spec['code']}/provision", headers=_auth(cb_token))
        )
        assert result["free"] > 0

        # staff login works (created with the bank)
        out[spec["code"]] = _login(client, *staff)
    return out


# -- pure API tests (no owner node needed) ---------------------------------

def test_health(client: httpx.Client):
    assert client.get("http://localhost:8000/healthz").json() == {"status": "ok"}


def test_bad_login(client: httpx.Client):
    resp = client.post(f"{BACKEND}/auth/login", json={"username": "cbadmin", "password": "wrong"})
    assert resp.status_code == 401


def test_runtime_bank_created_and_staff_login(client: httpx.Client, banks_provisioned):
    cb = _login(client, *CB)
    banks = _assert_ok(client.get(f"{BACKEND}/banks", headers=_auth(cb)))
    codes = {b["code"] for b in banks}
    assert {BANK_A["code"], BANK_B["code"]} <= codes
    # staff logins were minted with the banks
    assert client.post(f"{BACKEND}/auth/login", json={"username": STAFF_A[0], "password": STAFF_A[1]}).status_code == 200


def test_provision_is_idempotent(client: httpx.Client, cb_token: str):
    result = _assert_ok(
        client.post(f"{BACKEND}/admin/banks/{BANK_A['code']}/provision", headers=_auth(cb_token))
    )
    assert result["free"] > 0


def test_bank_scoping(client: httpx.Client, banks_provisioned):
    cb = _login(client, *CB)
    token_a = banks_provisioned[BANK_A["code"]]
    token_b = banks_provisioned[BANK_B["code"]]

    # staff see only their own bank's accounts
    mine = _assert_ok(client.get(f"{BACKEND}/accounts", headers=_auth(token_a)))
    assert all(a["account_number"].startswith(f"SWR-{BANK_A['code']}") for a in mine)

    # a bank cannot read another bank's account
    other = _assert_ok(client.get(f"{BACKEND}/accounts", headers=_auth(cb)))
    assert other, "CB sees all accounts"
    target = other[0]["account_number"]
    if not target.startswith(f"SWR-{BANK_A['code']}"):
        resp = client.get(f"{BACKEND}/accounts/{target}/balance", headers=_auth(token_b))
        assert resp.status_code == 403


def test_onboard_account(client: httpx.Client, banks_provisioned):
    token_a = banks_provisioned[BANK_A["code"]]
    resp = client.post(
        f"{BACKEND}/accounts",
        headers=_auth(token_a),
        json={
            "full_name": "Pytest User",
            "username": "pytest_user_prod",
            "password": "sworna-pass",
            "kyc_level": 1,
            "transfer_limit": "500.00",
        },
    )
    if resp.status_code == 201:
        account = resp.json()
        assert account["account_number"].startswith(f"SWR-{BANK_A['code']}")
        assert account["full_name"] == "Pytest User"
        return
    assert resp.status_code == 409, resp.text  # username reused from a prior run
    pytest.skip("pytest_user_prod already exists")


def test_admin_overview_ok_even_without_owner_nodes(client: httpx.Client, cb_token: str):
    overview = _assert_ok(client.get(f"{BACKEND}/admin/overview", headers=_auth(cb_token)))
    assert float(overview["total_supply"]) >= 0


# -- ledger-flow tests (need onboarded banks + owner services reachable) ----

def _ledger_available(client: httpx.Client, banks_provisioned) -> bool:
    """Probe one owner REST endpoint; ledger flows need the owners running."""
    import os

    host = os.getenv("SWORNA_TEST_OWNER_HOST")
    port = os.getenv("SWORNA_TEST_OWNER_PORT")
    if not (host and port):
        return False
    try:
        resp = client.get(f"http://{host}:{port}/api/v1/readyz", timeout=10)
        return resp.status_code == 200
    except httpx.HTTPError:
        return False


def test_issue_transfer_redeem_flow(client: httpx.Client, cb_token: str, banks_provisioned):
    if not _ledger_available(client, banks_provisioned):
        pytest.skip("bank owner services not reachable — deploy + onboard banks first")

    code_a, code_b = BANK_A["code"], BANK_B["code"]
    issue = _assert_ok(
        client.post(
            f"{BACKEND}/admin/issue",
            headers=_auth(cb_token),
            json={"to_account": f"SWR-{code_a}-00000001", "amount": "2.00",
                  "reference": "pytest issue"},
        )
    )
    assert issue["tx_type"] == "issue"

    intra = _assert_ok(
        client.post(
            f"{BACKEND}/payments/transfer",
            headers=_auth(cb_token),
            json={"from_account": f"SWR-{code_a}-00000001",
                  "to_account": f"SWR-{code_a}-00000002",
                  "amount": "0.50", "reference": "pytest intra"},
        )
    )
    assert intra["tx_type"] == "transfer"

    cross = _assert_ok(
        client.post(
            f"{BACKEND}/payments/transfer",
            headers=_auth(cb_token),
            json={"from_account": f"SWR-{code_a}-00000001",
                  "to_account": f"SWR-{code_b}-00000001",
                  "amount": "0.25", "reference": "pytest cross"},
        )
    )
    assert cross["tx_type"] == "transfer"

    token_b = banks_provisioned[code_b]
    redeem = _assert_ok(
        client.post(
            f"{BACKEND}/payments/redeem",
            headers=_auth(token_b),
            json={"account": f"SWR-{code_b}-00000001", "amount": "0.10",
                  "reference": "pytest redeem"},
        )
    )
    assert redeem["tx_type"] == "redeem"


def test_bank_permission_blocks_redeem(client: httpx.Client, cb_token: str, banks_provisioned):
    if not _ledger_available(client, banks_provisioned):
        pytest.skip("bank owner services not reachable — deploy + onboard banks first")

    code_b = BANK_B["code"]
    token_b = banks_provisioned[code_b]
    perms = {"permissions": {"can_redeem": False, "interbank_limit_minor": 0,
                             "redeem_limit_minor": 0}}
    _assert_ok(client.patch(f"{BACKEND}/banks/{code_b}/permissions",
                            headers=_auth(cb_token), json=perms))
    resp = client.post(
        f"{BACKEND}/payments/redeem",
        headers=_auth(token_b),
        json={"account": f"SWR-{code_b}-00000001", "amount": "0.01",
              "reference": "should fail"},
    )
    assert resp.status_code == 403
    perms["permissions"]["can_redeem"] = True
    _assert_ok(client.patch(f"{BACKEND}/banks/{code_b}/permissions",
                            headers=_auth(cb_token), json=perms))