#!/usr/bin/env python3
"""EDITH Sovereign AI OS — Terminal Banner & Operational Status Utility.

Displays a stylized ASCII banner, active Python runtime environment,
workspace root, and sovereign operational health metrics.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
from pathlib import Path


def supports_color() -> bool:
    """Determine whether the terminal environment supports ANSI escape colors."""
    if "NO_COLOR" in os.environ or os.environ.get("TERM") == "dumb":
        return False
    return sys.stdout.isatty()


class Colors:
    """ANSI color code definitions for terminal styling."""
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    CYAN = "\033[96m"
    BLUE = "\033[94m"
    GREEN = "\033[92m"
    AMBER = "\033[93m"
    MAGENTA = "\033[95m"
    GRAY = "\033[90m"


def get_workspace_root() -> Path:
    """Resolve the EDITH workspace root directory."""
    env_root = os.environ.get("EDITH_WORKSPACE_ROOT")
    if env_root:
        return Path(env_root).resolve()
    # Default to current working directory
    return Path.cwd()


def get_status_data(workspace_root: Path) -> dict:
    """Compile sovereign operational status metadata."""
    py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    return {
        "system": "EDITH Sovereign AI OS",
        "version": "1.0.0-sovereign",
        "status": "ONLINE",
        "operational_state": "NOMINAL",
        "python_version": py_ver,
        "python_runtime": f"{platform.python_implementation()} {py_ver}",
        "platform": f"{platform.system()} {platform.release()} ({platform.machine()})",
        "workspace_root": str(workspace_root),
        "execution_gate": "Two-Phase Propose & SHA-256 Commit",
        "telemetry_policy": "Zero Telemetry / Air-Gapped Loopback",
        "gateway_endpoint": "http://127.0.0.1:8766",
    }


def format_banner(plain: bool = False) -> str:
    """Generate the stylized EDITH ASCII banner."""
    c = Colors
    if plain:
        c_cyan = c_blue = c_bold = c_reset = c_dim = c_green = c_amber = ""
    else:
        c_cyan = c.CYAN
        c_blue = c.BLUE
        c_bold = c.BOLD
        c_reset = c.RESET
        c_dim = c.DIM
        c_green = c.GREEN
        c_amber = c.AMBER

    ascii_art = [
        r"  ███████╗ ██████╗  ██╗ ████████╗ ██╗  ██╗",
        r"  ██╔════╝ ██╔══██╗ ██║ ╚══██╔══╝ ██║  ██║",
        r"  █████╗   ██║  ██║ ██║    ██║    ███████║",
        r"  ██╔══╝   ██║  ██║ ██║    ██║    ██╔══██║",
        r"  ███████╗ ██████╔╝ ██║    ██║    ██║  ██║",
        r"  ╚══════╝ ╚═════╝  ╚═╝    ╚═╝    ╚═╝  ╚═╝",
    ]

    divider = "═" * 68
    lines = [
        f"{c_cyan}{divider}{c_reset}",
        *[f"{c_bold}{c_cyan}{row}{c_reset}" for row in ascii_art],
        f"{c_blue}{c_bold}        S O V E R E I G N   A I   O P E R A T I N G   S Y S T E M{c_reset}",
        f"{c_cyan}{divider}{c_reset}",
    ]
    return "\n".join(lines)


def display_status(data: dict, plain: bool = False) -> None:
    """Print the complete formatted banner and system status block."""
    c = Colors
    if plain:
        c_bold = c_reset = c_dim = c_green = c_cyan = c_amber = ""
    else:
        c_bold = c.BOLD
        c_reset = c.RESET
        c_dim = c.DIM
        c_green = c.GREEN
        c_cyan = c.CYAN
        c_amber = c.AMBER

    banner = format_banner(plain=plain)
    print(banner)
    print()
    print(f"  {c_cyan}▸{c_reset} {c_bold}Active Python{c_reset}    : {data['python_runtime']} [{data['platform']}]")
    print(f"  {c_cyan}▸{c_reset} {c_bold}Workspace Root{c_reset}   : {data['workspace_root']}")
    print(f"  {c_cyan}▸{c_reset} {c_bold}Core Status{c_reset}      : {c_green}{c_bold}{data['status']}{c_reset} {c_dim}({data['operational_state']}){c_reset}")
    print(f"  {c_cyan}▸{c_reset} {c_bold}Execution Gate{c_reset}   : {data['execution_gate']}")
    print(f"  {c_cyan}▸{c_reset} {c_bold}Local Gateway{c_reset}    : {data['gateway_endpoint']}")
    print(f"  {c_cyan}▸{c_reset} {c_bold}Sovereign Shield{c_reset} : {c_amber}{data['telemetry_policy']}{c_reset}")
    print()
    divider = "─" * 68
    print(f"  {c_dim}{divider}{c_reset}")
    print(f"  {c_dim}System ready for permissioned sovereign execution.{c_reset}")
    print()


def main() -> None:
    """Entry point for EDITH banner CLI."""
    parser = argparse.ArgumentParser(
        description="EDITH Sovereign AI OS — Banner & Operational Status",
    )
    parser.add_argument(
        "--plain",
        "--no-color",
        dest="plain",
        action="store_true",
        help="Disable ANSI terminal colors",
    )
    parser.add_argument(
        "--json",
        dest="json_output",
        action="store_true",
        help="Output system status in JSON format",
    )
    parser.add_argument(
        "--status-only",
        dest="status_only",
        action="store_true",
        help="Output single-line operational status summary",
    )
    args = parser.parse_args()

    workspace_root = get_workspace_root()
    data = get_status_data(workspace_root)

    if args.json_output:
        print(json.dumps(data, indent=2))
        return

    if args.status_only:
        print(f"EDITH Sovereign AI OS: {data['status']} / {data['operational_state']} | Root: {data['workspace_root']} | Python: {data['python_version']}")
        return

    plain_mode = args.plain or not supports_color()
    display_status(data, plain=plain_mode)


if __name__ == "__main__":
    main()
