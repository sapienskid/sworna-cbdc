"""
Documentation Management for Sworna CBDC.
"""

import subprocess
import sys
from pathlib import Path

CLI_DIR = Path(__file__).resolve().parent
REPO_ROOT = CLI_DIR.parents[1]
BUILD_SCRIPT = REPO_ROOT / "scripts" / "build-master-docs.py"


class DocsManager:
    @staticmethod
    def build():
        """Run the comprehensive master documentation compiler."""
        if not BUILD_SCRIPT.exists():
            print(f"[ERROR] Build script not found: {BUILD_SCRIPT}", file=sys.stderr)
            sys.exit(1)
        res = subprocess.run([sys.executable, str(BUILD_SCRIPT)], cwd=str(REPO_ROOT))
        sys.exit(res.returncode)

    @staticmethod
    def check():
        """Validate that documentation sources exist and dependencies are present."""
        import shutil
        missing_tools = []
        for tool in ["pandoc", "xelatex"]:
            if not shutil.which(tool):
                missing_tools.append(tool)
        if missing_tools:
            print(f"[WARN] Missing required publication tools: {', '.join(missing_tools)}")
        else:
            print("[OK] Pandoc and XeLaTeX are installed.")
        
        import importlib.util
        spec = importlib.util.spec_from_file_location("bmd", str(BUILD_SCRIPT))
        bmd = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bmd)
        PARTS_STRUCTURE = bmd.PARTS_STRUCTURE
        SYNTHESIS_SRC = bmd.SYNTHESIS_SRC
        # Quick existence check
        missing_files = []
        if not SYNTHESIS_SRC.exists():
            missing_files.append(str(SYNTHESIS_SRC))
        for _, chapters in PARTS_STRUCTURE:
            for _, path in chapters:
                if not path.exists():
                    missing_files.append(str(path))
        if missing_files:
            print(f"[ERROR] {len(missing_files)} documentation source files are missing:")
            for f in missing_files:
                print(f"  - {f}")
            sys.exit(1)
        print(f"[OK] All 45 documentation source files verified.")
