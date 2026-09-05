import os
import sys
from typing import Optional
from ..core.docker_runner import DockerRunner
from ..core.config import REPO_ROOT, NETWORK_DIR, TOKEN_SERVICES_DIR, BANK_OWNER_PORTS
from ..core.api_client import SwornaClient

class BankManager:
    @staticmethod
    def init(code: str, cb_host: str):
        print(f"==> [Bank {code}] Initializing Bank Identity & Peer (CB Host: {cb_host})...")
        env = {
            "BANK_CODE": code,
            "SWORNA_CB_HOST": cb_host
        }
        DockerRunner.run_cmd(["./scripts/bank-network.sh", "identity"], cwd=str(REPO_ROOT), env=env)
        print(f"\n Bank {code} Identity generated successfully!")
        print(f"   Public Onboarding Package: network/bank{int(code)}-org.json")
        print(f"   Submit this package to Central Bank via Web Portal or API.\n")

    @staticmethod
    def start(code: str, cb_host: str):
        print(f"==> [Bank {code}] Joining Settlement Channel and Starting Services...")
        env = {
            "BANK_CODE": code,
            "SWORNA_CB_HOST": cb_host
        }
        DockerRunner.run_cmd(["./scripts/bank-network.sh", "join"], cwd=str(REPO_ROOT), env=env)
        DockerRunner.run_cmd(["./scripts/bank-network.sh", "up"], cwd=str(REPO_ROOT), env=env)
        print(f"\n Bank {code} is live and connected to Sworna network!")
        port = BANK_OWNER_PORTS.get(code)
        if port:
            print(f"   FSC Owner Engine: http://localhost:{port}\n")

    @staticmethod
    def join(code: str, cb_host: str, my_host: Optional[str] = None):
        cmd = ["./scripts/bank-docker.sh", "up", code, cb_host]
        if my_host:
            cmd.append(my_host)
        DockerRunner.run_cmd(cmd, cwd=str(REPO_ROOT))


    @staticmethod
    def status(code: str):
        idx = int(code)
        peer_name = f"peer0.bank{idx}.sworna.example.com"
        owner_name = f"token-services-owner{idx}"
        print(f"==> Bank {code} Status:")
        for c in [peer_name, owner_name]:
            running = DockerRunner.is_container_running(c)
            status_str = " RUNNING" if running else " STOPPED"
            print(f"  {c:38}: {status_str}")

    @staticmethod
    def down(code: str):
        print(f"==> Stopping Bank {code}...")
        DockerRunner.run_cmd(["./scripts/bank-docker.sh", "down", code], cwd=str(REPO_ROOT), check=False)
        print(f" Bank {code} stopped.")

