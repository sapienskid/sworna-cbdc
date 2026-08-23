"""Bank provisioning: create a bank's wallet key material via the token CA.

The owner-node confs already declare a fixed set of pool wallets
(`pool_w1..pool_wN`, committed in the repo). The central bank controls the
token CA (the idemix issuer trusted by the chaincode params), so provisioning
only has to *generate* the idemix key material for those declared wallets and
record the pool manifest on the bank. Onboarding then assigns wallets to new
customer accounts.
"""
from __future__ import annotations

import os
import secrets
import subprocess
from pathlib import Path

from .models import Bank
from .paths import BIN, TOKEN_SERVICES

TOKEN_CA_URL = os.getenv("SWORNA_TOKEN_CA", "http://localhost:27054")
TOKEN_CA_ADMIN = os.getenv("SWORNA_TOKEN_CA_ADMIN", "admin:adminpw")
KEYS_DIR = Path(TOKEN_SERVICES) / "keys"
CA_CLIENT_HOME = Path(
    os.getenv("SWORNA_CA_CLIENT_HOME", str(Path(TOKEN_SERVICES) / ".ca-client"))
)


class ProvisioningError(RuntimeError):
    pass


def _run(*args: str) -> str:
    proc = subprocess.run(
        list(args),
        capture_output=True,
        text=True,
        timeout=90,
        env={
            "PATH": f"{BIN}:{os.environ.get('PATH', '')}",
            "FABRIC_CA_CLIENT_HOME": str(CA_CLIENT_HOME),
        },
    )
    if proc.returncode != 0:
        raise ProvisioningError(f"{args[0]} failed: {proc.stderr.strip()[-500:]}")
    return proc.stdout


def ensure_ca_admin() -> None:
    """Enroll the token-CA admin once; register calls require an enrolled client."""
    signcert = CA_CLIENT_HOME / "msp" / "signcerts" / "cert.pem"
    if signcert.exists():
        return
    CA_CLIENT_HOME.mkdir(parents=True, exist_ok=True)
    _run("fabric-ca-client", "enroll", "-u", f"http://{TOKEN_CA_ADMIN}@{TOKEN_CA_URL.removeprefix('http://')}")


def pool_wallet_ids(bank: Bank) -> list[str]:
    """Deterministic pool wallet ids for a bank: pool_{code}_w1..w{pool_size}.

    The bank's owner conf (rendered from the template on its VM) declares the
    same ids, so the CB does not need the conf file to provision any bank.
    """
    return [f"pool_{bank.code}_w{i}" for i in range(1, bank.pool_size + 1)]


def wallet_msp_path(owner_node: str, wallet_id: str) -> Path:
    return KEYS_DIR / owner_node / "wallet" / wallet_id / "msp"


def generate_wallet(owner_node: str, wallet_id: str) -> Path:
    """Register + enroll one idemix wallet at the token CA."""
    ensure_ca_admin()
    secret = secrets.token_urlsafe(12)
    path = wallet_msp_path(owner_node, wallet_id)
    _run(
        "fabric-ca-client", "register", "-u", TOKEN_CA_URL,
        "--id.name", wallet_id, "--id.secret", secret,
        "--id.type", "client", "--enrollment.type", "idemix",
        "--idemix.curve", "gurvy.Bn254",
    )
    _run(
        "fabric-ca-client", "enroll", "-u",
        f"http://{wallet_id}:{secret}@{TOKEN_CA_URL.removeprefix('http://')}",
        "-M", str(path), "--enrollment.type", "idemix", "--idemix.curve", "gurvy.Bn254",
    )
    return path


def provision_wallet_pool(bank: Bank) -> None:
    """Generate missing idemix key material for the bank's pool wallets."""
    declared = pool_wallet_ids(bank)
    if not declared:
        raise ProvisioningError(
            f"bank {bank.name} has an empty wallet pool"
        )

    used = set(bank.wallet_pool.get("used", []))
    free = [w for w in declared if w not in used]

    generated = 0
    for wid in free:
        msp = wallet_msp_path(bank.owner_node, wid)
        if not (msp / "user" / "SignerConfig").exists():
            generate_wallet(bank.owner_node, wid)
            generated += 1

    bank.wallet_pool = {"used": sorted(used), "free": free}
    bank.pool_size = len(declared)


def assign_wallet(bank: Bank) -> str:
    """Take the next free wallet from the pool (raises if exhausted)."""
    free = list(bank.wallet_pool.get("free", []))
    if not free:
        raise ProvisioningError(
            f"bank {bank.name} has no free wallets; provision more"
        )
    wid = free.pop(0)
    used = list(bank.wallet_pool.get("used", []))
    used.append(wid)
    bank.wallet_pool = {"used": sorted(used), "free": free}
    return wid