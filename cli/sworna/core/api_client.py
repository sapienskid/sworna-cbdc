import urllib.request
import urllib.error
import json
from typing import Dict, Any, Optional
from .config import CB_BACKEND_URL, DEFAULT_CB_ADMIN_USER, DEFAULT_CB_ADMIN_PASS, BANK_OWNER_PORTS

class SwornaClient:
    def __init__(self, base_url: str = CB_BACKEND_URL, token: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def _request(self, method: str, endpoint: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{endpoint}"
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        body = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            try:
                err_json = json.loads(err_body)
                raise RuntimeError(err_json.get("detail") or err_json.get("message") or err_body)
            except Exception:
                raise RuntimeError(f"HTTP {e.code}: {err_body}")

    def login(self, username: str = DEFAULT_CB_ADMIN_USER, password: str = DEFAULT_CB_ADMIN_PASS) -> str:
        res = self._request("POST", "/auth/login", {"username": username, "password": password})
        self.token = res.get("token")
        return self.token

    def mint(self, bank_code: str, amount: float, reference: str = "Wholesale CBDC Issuance") -> Dict[str, Any]:
        return self._request("POST", "/admin/mint", {
            "bank_code": bank_code,
            "amount": amount,
            "reference": reference
        })

    def list_banks(self) -> list:
        return self._request("GET", "/banks")

    def get_account_balance(self, account_number: str) -> Dict[str, Any]:
        return self._request("GET", f"/accounts/{account_number}/balance")

    @staticmethod
    def get_owner_balance(bank_code: str, wallet_id: Optional[str] = None) -> list:
        port = BANK_OWNER_PORTS.get(bank_code)
        if not port:
            raise ValueError(f"Unknown bank code: {bank_code}")
        url = f"http://localhost:{port}/api/v1/owner/accounts"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            payload = data.get("payload", [])
            if wallet_id:
                for item in payload:
                    if item.get("id") == wallet_id:
                        return item.get("balance", [])
                return []
            return payload

    @staticmethod
    def transfer_owner(from_bank: str, from_wallet: str, to_bank: str, to_wallet: str, amount_minor: int, msg: str) -> Dict[str, Any]:
        from_port = BANK_OWNER_PORTS.get(from_bank)
        to_node = f"owner{int(to_bank)}"
        url = f"http://localhost:{from_port}/api/v1/owner/accounts/{from_wallet}/transfer"
        data = {
            "amount": {"code": "SWR", "value": amount_minor},
            "counterparty": {"node": to_node, "account": to_wallet},
            "message": msg
        }
        req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
