from pathlib import Path
import os

REPO_ROOT = Path(__file__).resolve().parents[3]
BIN_DIR = REPO_ROOT / "bin"
NETWORK_DIR = REPO_ROOT / "network"
TOKEN_SERVICES_DIR = REPO_ROOT / "token-services"
BACKEND_DIR = REPO_ROOT / "backend"

CB_BACKEND_URL = os.getenv("SWORNA_CB_BACKEND_URL", "http://localhost:8100/api/v1")
CB_PORTAL_URL = os.getenv("SWORNA_CB_PORTAL_URL", "http://localhost:5273")
ISSUER_URL = os.getenv("SWORNA_ISSUER_URL", "http://localhost:9100/api/v1")
AUDITOR_URL = os.getenv("SWORNA_AUDITOR_URL", "http://localhost:9000/api/v1")

DEFAULT_CB_ADMIN_USER = "cbadmin"
DEFAULT_CB_ADMIN_PASS = "sworna-cb"

BANK_OWNER_PORTS = {
    "001": 9200,
    "002": 9300,
    "003": 9400,
    "004": 9500,
    "005": 9600,
}
