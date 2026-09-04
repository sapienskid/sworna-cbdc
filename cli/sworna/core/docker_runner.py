import subprocess
import sys
import os
from typing import List, Optional, Dict

class DockerRunner:
    """Wrapper for Docker and Docker Compose operations."""

    @staticmethod
    def run_cmd(cmd: List[str], cwd: Optional[str] = None, env: Optional[Dict[str, str]] = None, check: bool = True) -> subprocess.CompletedProcess:
        full_env = os.environ.copy()
        if env:
            full_env.update(env)
        try:
            res = subprocess.run(
                cmd,
                cwd=cwd,
                env=full_env,
                check=check,
                text=True,
                capture_output=False
            )
            return res
        except subprocess.CalledProcessError as e:
            print(f"[ERROR] Command failed with exit code {e.returncode}: {' '.join(cmd)}", file=sys.stderr)
            if check:
                raise e
            return e

    @staticmethod
    def compose_up(compose_files: List[str], project_name: Optional[str] = None, cwd: Optional[str] = None, env: Optional[Dict[str, str]] = None, build: bool = True, detach: bool = True):
        cmd = ["docker", "compose"]
        if project_name:
            cmd.extend(["-p", project_name])
        for f in compose_files:
            cmd.extend(["-f", f])
        cmd.append("up")
        if detach:
            cmd.append("-d")
        if build:
            cmd.append("--build")
        return DockerRunner.run_cmd(cmd, cwd=cwd, env=env)

    @staticmethod
    def compose_down(compose_files: List[str], project_name: Optional[str] = None, cwd: Optional[str] = None, volumes: bool = False):
        cmd = ["docker", "compose"]
        if project_name:
            cmd.extend(["-p", project_name])
        for f in compose_files:
            cmd.extend(["-f", f])
        cmd.append("down")
        if volumes:
            cmd.append("-v")
        cmd.append("--remove-orphans")
        return DockerRunner.run_cmd(cmd, cwd=cwd, check=False)

    @staticmethod
    def is_container_running(name: str) -> bool:
        res = subprocess.run(
            ["docker", "ps", "--filter", f"name={name}", "--filter", "status=running", "--format", "{{.Names}}"],
            capture_output=True, text=True
        )
        return bool(res.stdout.strip())
