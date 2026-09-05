"""Filesystem locations for the Sworna repo.

Defaults are derived from this file's location so the backend works at any
clone path (dev laptop, lab VM, etc.) without setting environment variables.
Every value can be overridden with the matching SWORNA_* variable.
"""
from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(os.getenv("SWORNA_REPO_ROOT", str(Path(__file__).resolve().parent.parent.parent)))

BIN = os.getenv("SWORNA_BIN", str(REPO_ROOT / "bin"))
TOKEN_SERVICES = os.getenv("SWORNA_TOKEN_SERVICES", str(REPO_ROOT / "token-services"))
NETWORK_HOME = os.getenv("SWORNA_NETWORK_HOME", str(REPO_ROOT / "network"))
FABRIC_CFG = os.getenv("SWORNA_FABRIC_CFG", str(REPO_ROOT / "config"))