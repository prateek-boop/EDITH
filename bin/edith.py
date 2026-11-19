#!/usr/bin/env python3
"""EDITH — Sovereign Personal AI Operating System CLI.

Python entrypoint for EDITH CLI.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

os.environ.setdefault("EDITH_APP_ROOT", str(PROJECT_ROOT))
os.environ.setdefault("EDITH_WORKSPACE_ROOT", os.getcwd())

# Prefer project virtual environment python if available
venv_python = PROJECT_ROOT / ".venv" / "bin" / "python"
if venv_python.exists() and sys.executable != str(venv_python) and "EDITH_VENV_EXEC" not in os.environ:
    os.environ["EDITH_VENV_EXEC"] = "1"
    os.execv(str(venv_python), [str(venv_python)] + sys.argv)

from edith_cli.main import main

if __name__ == "__main__":
    sys.exit(main())
