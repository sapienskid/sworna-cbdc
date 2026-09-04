import sys
import time
from typing import Optional
from ..core.docker_runner import DockerRunner
from ..core.config import REPO_ROOT, NETWORK_DIR, TOKEN_SERVICES_DIR, CB_BACKEND_URL, CB_PORTAL_URL
from ..core.api_client import SwornaClient

class CentralBankManager:
    @staticmethod
    def init(provision: bool = True):
        print("==> [Central Bank] Initializing Fabric Network (orderer + CentralBankMSP)...")
        DockerRunner.run_cmd(["./network.sh", "up", "createChannel", "-ca"], cwd=str(NETWORK_DIR))

        print("==> [Central Bank] Deploying Token Chaincode CCaaS on settlement channel...")
        DockerRunner.run_cmd([
            "./network.sh", "deployCCAAS",
            "-ccn", "tokenchaincode",
            "-ccp", str(TOKEN_SERVICES_DIR / "tokenchaincode"),
            "-ccs", "1"
        ], cwd=str(NETWORK_DIR))

        print("==> [Central Bank] Launching Token CA...")
        DockerRunner.compose_up([str(TOKEN_SERVICES_DIR / "compose-ca.yaml")], cwd=str(TOKEN_SERVICES_DIR))

        # Check and enroll CB token identities
        if not (TOKEN_SERVICES_DIR / "keys" / "issuer" / "fsc").exists():
            print("==> [Central Bank] Enrolling Issuer and Auditor token identities...")
            DockerRunner.run_cmd(["./scripts/enroll-users.sh"], cwd=str(TOKEN_SERVICES_DIR))

        print("==> [Central Bank] Starting Issuer and Auditor FSC engines...")
        DockerRunner.compose_up([str(TOKEN_SERVICES_DIR / "docker-compose.yaml")], cwd=str(TOKEN_SERVICES_DIR))

        print("==> [Central Bank] Starting Backend (:8100) and Web Portal (:5273) containers...")
        DockerRunner.compose_up([str(REPO_ROOT / "docker-compose.cb.yaml")], cwd=str(REPO_ROOT))

        print("==> Waiting for Central Bank services to be healthy...")
        client = SwornaClient()
        for _ in range(30):
            try:
                client.login()
                print(" Central Bank is UP and ready!")
                break
            except Exception:
                time.sleep(2)
        else:
            print("[WARN] Central Bank services started, but health check timed out.")

        print(f"\n Central Bank Portal: {CB_PORTAL_URL}")
        print(f" Central Bank API:    {CB_BACKEND_URL}/docs\n")

    @staticmethod
    def mint(bank_code: str, amount: float, reference: Optional[str] = None):
        print(f"==> [Central Bank] Minting {amount} SWR to Bank {bank_code}...")
        client = SwornaClient()
        client.login()
        res = client.mint(bank_code=bank_code, amount=amount, reference=reference or "Wholesale CBDC Issuance")
        print(f" Mint succeeded! TXID: {res.get('txid')}")
        print(f"   Status: {res.get('status')}")
        print(f"   Target: {res.get('to_account')}")

    @staticmethod
    def status():
        print("==> Central Bank Stack Status:")
        containers = ["orderer.sworna.example.com", "peer0.centralbank.sworna.example.com", "token-services-issuer-1", "token-services-auditor-1", "sworna-cb-backend", "sworna-cb-web"]
        for c in containers:
            running = DockerRunner.is_container_running(c)
            status_str = " RUNNING" if running else " STOPPED"
            print(f"  {c:38}: {status_str}")

    @staticmethod
    def down():
        print("==> Tearing down Central Bank Stack...")
        DockerRunner.compose_down([str(REPO_ROOT / "docker-compose.cb.yaml")], cwd=str(REPO_ROOT))
        DockerRunner.compose_down([str(TOKEN_SERVICES_DIR / "docker-compose.yaml")], cwd=str(TOKEN_SERVICES_DIR))
        DockerRunner.compose_down([str(TOKEN_SERVICES_DIR / "compose-ca.yaml")], cwd=str(TOKEN_SERVICES_DIR))
        DockerRunner.run_cmd(["./network.sh", "down"], cwd=str(NETWORK_DIR), check=False)
        print(" Central Bank Stack terminated.")
