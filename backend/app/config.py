"""Sworna CBDC backend configuration.

Settings are read from environment variables with sensible defaults for the
central-bank host. Owner-node base URLs are derived from the owner node name
(see app.owner_urls); issuer/auditor live on the CB host.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


from .paths import REPO_ROOT


@dataclass(frozen=True)
class Settings:
    issuer_url: str = os.getenv("SWORNA_ISSUER_URL", "http://localhost:9100/api/v1")
    auditor_url: str = os.getenv("SWORNA_AUDITOR_URL", "http://localhost:9000/api/v1")
    database_url: str = os.getenv("SWORNA_DB_URL", f"sqlite:///{REPO_ROOT / 'backend' / 'sworna.db'}")
    decimals: int = 2


settings = Settings()