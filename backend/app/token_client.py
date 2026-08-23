"""HTTP client for the token-services (the Go engine wrapping the token SDK).

Exposes the issuer / auditor / owner REST APIs to the banking layer. All
amounts here are integer minor units (see app.amounts).
"""
from __future__ import annotations

from typing import Any

import httpx

from .config import settings
from .owner_urls import owner_base_url


class TokenServiceError(RuntimeError):
    """Raised when a token-service call fails (network or business error)."""


class TokenClient:
    def __init__(self, timeout: float = 60.0) -> None:
        self._timeout = timeout
        self._client = httpx.AsyncClient(timeout=timeout)

    async def aclose(self) -> None:
        await self._client.aclose()

    # -- helpers ---------------------------------------------------------
    @staticmethod
    def _raise(payload: Any) -> None:
        if isinstance(payload, dict):
            msg = payload.get("message") or payload.get("payload") or str(payload)
        else:
            msg = str(payload)
        raise TokenServiceError(msg)

    @staticmethod
    def _txid(payload: Any) -> str:
        if isinstance(payload, dict) and isinstance(payload.get("payload"), str):
            return payload["payload"]
        return ""

    # -- issuer ----------------------------------------------------------
    async def issue(self, amount_minor: int, node: str, wallet: str, message: str) -> str:
        resp = await self._client.post(
            f"{settings.issuer_url}/issuer/issue",
            json={
                "amount": {"code": "SWR", "value": amount_minor},
                "counterparty": {"node": node, "account": wallet},
                "message": message,
            },
        )
        payload = resp.json()
        if resp.status_code != 200:
            self._raise(payload)
        return self._txid(payload)

    # -- owner -----------------------------------------------------------
    async def transfer(
        self,
        from_wallet: str,
        from_node: str,
        to_wallet: str,
        to_node: str,
        amount_minor: int,
        message: str,
    ) -> str:
        resp = await self._client.post(
            f"{owner_base_url(from_node)}/owner/accounts/{from_wallet}/transfer",
            json={
                "amount": {"code": "SWR", "value": amount_minor},
                "counterparty": {"node": to_node, "account": to_wallet},
                "message": message,
            },
        )
        payload = resp.json()
        if resp.status_code != 200:
            self._raise(payload)
        return self._txid(payload)

    async def redeem(self, wallet: str, node: str, amount_minor: int, message: str) -> str:
        resp = await self._client.post(
            f"{owner_base_url(node)}/owner/accounts/{wallet}/redeem",
            json={"amount": {"code": "SWR", "value": amount_minor}, "message": message},
        )
        payload = resp.json()
        if resp.status_code != 200:
            self._raise(payload)
        return self._txid(payload)

    async def balances(self, wallet: str, node: str) -> int:
        resp = await self._client.get(
            f"{owner_base_url(node)}/owner/accounts/{wallet}"
        )
        payload = resp.json()
        if resp.status_code != 200:
            self._raise(payload)
        balances = payload.get("payload", {}).get("balance", [])
        for b in balances:
            if b.get("code") == "SWR":
                return int(b["value"])
        return 0

    # -- auditor ---------------------------------------------------------
    async def auditor_history(self, wallet: str) -> list[dict]:
        resp = await self._client.get(
            f"{settings.auditor_url}/auditor/accounts/{wallet}/transactions"
        )
        payload = resp.json()
        if resp.status_code != 200:
            self._raise(payload)
        return payload.get("payload", [])


token_client = TokenClient()