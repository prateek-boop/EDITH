"""Main command-line entrypoint for EDITH CLI.

Parses CLI flags, manages subcommands, initializes the Sovereign loopback client,
and launches either the interactive REPL or non-interactive prompt execution.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from typing import Optional

from edith_cli import __app_name__, __version__
from edith_cli.client import GatewayClient
from edith_cli.repl import EdithREPL
from edith_cli.settings import load_settings
from edith_cli.ui import (
    Colors,
    Spinner,
    c,
    get_banner,
    render_approval_card,
    render_diff,
    render_event,
    render_markdown,
)


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    settings = load_settings()
    default_model = settings.get("model", "gemini-3.8-flash-high")
    default_mode = settings.get("mode", "coding")
    default_effort = settings.get("effort", "high")

    parser = argparse.ArgumentParser(
        prog=__app_name__,
        description="EDITH — Sovereign Personal AI Operating System Command Line Interface",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  edith                              # Launch interactive Sovereign REPL session
  edith "Explain repository layout"  # Execute prompt non-interactively
  edith -p "Fix type error in api"   # Short alias for prompt execution
  edith -i "Run live audit"          # Run initial prompt then stay in interactive mode
  edith -m claude-sonnet-4-6         # Launch with specific intelligence model
  edith --mode plan "Design auth"    # Plan-only mode (no file mutations proposed)
  edith --effort max "Optimize DB"   # Deep reasoning effort
  edith -y "Create scripts/demo.py"  # Auto-approve proposal without interactive prompt
  edith doctor                       # Run system diagnostics & verify audit chain
  edith status                       # Check Sovereign OS diagnostics & health
  edith models                       # List all supported AI reasoning & coding models
  edith audit                        # Inspect tamper-evident hash-chained audit log
  edith notes                        # Search notes in the Sovereign Knowledge Vault
  edith gateway start                # Start loopback gateway daemon in background
""",
    )

    parser.add_argument(
        "prompt",
        nargs="*",
        default=[],
        help="Optional prompt or goal to execute. If omitted, launches interactive REPL.",
    )
    parser.add_argument(
        "-p", "--print", "--prompt",
        dest="flag_prompt",
        default=None,
        help="Run a single prompt non-interactively and output response",
    )
    parser.add_argument(
        "-i", "--interactive", "--prompt-interactive",
        action="store_true",
        help="Run prompt interactively and keep the session open in the REPL",
    )
    parser.add_argument(
        "-m", "--model",
        default=default_model,
        help=f"AI model to route execution to (default: {default_model})",
    )
    parser.add_argument(
        "--mode",
        choices=["coding", "plan", "auto"],
        default=default_mode,
        help=f"Agent execution mode: coding (default), plan (read-only), auto (auto-approve)",
    )
    parser.add_argument(
        "--effort",
        choices=["low", "medium", "high", "max"],
        default=default_effort,
        help=f"Reasoning effort depth (default: {default_effort})",
    )
    parser.add_argument(
        "-y", "--yes", "--dangerously-skip-permissions",
        action="store_true",
        dest="auto_approve",
        help="Auto-approve file mutations and proposals without prompting",
    )
    parser.add_argument(
        "-w", "--workspace",
        dest="workspace",
        default=os.environ.get("EDITH_WORKSPACE_ROOT") or os.getcwd(),
        help="Workspace root directory for file operations (default: current working directory)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=settings.get("gateway_port", 8766),
        help=f"Port of the EDITH loopback gateway (default: {settings.get('gateway_port', 8766)})",
    )
    parser.add_argument(
        "--host",
        default=settings.get("gateway_host", "127.0.0.1"),
        help="Host of the EDITH loopback gateway (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--no-banner",
        action="store_true",
        help="Suppress the startup ASCII art banner",
    )
    parser.add_argument(
        "--plain", "--no-color",
        action="store_true",
        help="Disable ANSI colors and styling",
    )
    parser.add_argument(
        "-v", "--version",
        action="version",
        version=f"EDITH Sovereign AI OS CLI v{__version__}",
    )

    return parser.parse_args(argv)


def run_single_prompt(
    client: GatewayClient,
    prompt: str,
    model: str,
    auto_approve: bool = False,
    mode: str = "coding",
    effort: str = "high",
) -> int:
    """Execute a prompt non-interactively (print mode)."""
    # Detect @file mentions
    detected_sources = []
    mentions = re.findall(r"@([\w\-\.\/]+)", prompt)
    for m in mentions:
        cand = client.workspace_root / m
        if cand.exists() and cand.is_file():
            detected_sources.append(m)

    eff_kind = "reasoning" if mode == "plan" else "coding"
    eff_goal = prompt
    if mode == "plan":
        eff_goal = f"[ARCHITECTURAL PLAN ONLY - DO NOT PROPOSE FILE MODIFICATIONS]\n{prompt}"

    spinner = Spinner(f"Sovereign Core ({model} · {mode}) processing goal...").start()

    try:
        job_init = client.start_job(
            objective=eff_goal,
            source_ids=detected_sources,
            kind=eff_kind,
            model=model,
            effort=effort,
        )
        job_id = job_init["id"]
    except Exception as exc:
        spinner.stop("Failed to dispatch goal", success=False)
        print(f"{c('Error:', Colors.BOLD + Colors.ERROR)} {exc}", file=sys.stderr)
        return 1

    def on_event(ev: dict) -> None:
        label = ev.get("label", "Processing")
        detail = ev.get("detail", "")
        f_name = ev.get("file")
        spinner.stop()
        render_event(label, detail, timestamp=ev.get("time"), file=f_name)
        spinner.update(f"{label}: {detail[:40]}...")
        spinner.start()

    try:
        final_job = client.stream_job(job_id=job_id, on_event=on_event)
    except KeyboardInterrupt:
        spinner.stop("Interrupted by operator", success=False)
        try:
            client.cancel_job(job_id)
        except Exception:
            pass
        return 130
    except Exception as exc:
        spinner.stop("Execution failed", success=False)
        print(f"{c('Error:', Colors.BOLD + Colors.ERROR)} {exc}", file=sys.stderr)
        return 1

    spinner.stop()
    status = final_job.get("status")
    output = final_job.get("output", "")
    proposal = final_job.get("proposal")

    if status == "completed":
        print()
        print(render_markdown(output))
        return 0

    if status == "failed":
        err = final_job.get("error") or "Execution failed"
        print(f"\n{c('✖ Sovereign Engine Failed:', Colors.BOLD + Colors.ERROR)} {err}", file=sys.stderr)
        return 1

    if status == "waiting_approval" and proposal:
        print()
        print(render_approval_card(proposal))

        target_file = proposal.get("targetFile")
        old_content = ""
        if target_file:
            tp = client.workspace_root / target_file
            if tp.exists() and tp.is_file():
                try:
                    old_content = tp.read_text(encoding="utf-8", errors="replace")
                except Exception:
                    pass

        new_content = proposal.get("content", "")
        print()
        print(render_diff(old_content, new_content, target_file or "Workspace Note", max_lines=40))
        print()

        sha_prefix = proposal.get("sha256", "")[:16]
        if auto_approve or mode == "auto":
            print(c("  [Auto-Approve Enabled: Signing commit directly...]", Colors.WARNING))
            receipt = client.commit_proposal(proposal["id"], proposal["sha256"])
            print(
                f"  {c('✔ Committed to workspace:', Colors.BOLD + Colors.SUCCESS)} "
                f"{c(receipt.get('path', 'workspace'), Colors.BOLD + Colors.PRIMARY)} "
                f"{c(f'[SHA: {sha_prefix}...]', Colors.MUTED)}"
            )
            return 0

        # Ask user for approval
        try:
            while True:
                ans = input(
                    f"  {c('Approve and commit to workspace?', Colors.BOLD + Colors.WHITE)} "
                    f"[{c('y', Colors.BOLD + Colors.SUCCESS)}es / "
                    f"{c('n', Colors.BOLD + Colors.ERROR)}o / "
                    f"{c('d', Colors.BOLD + Colors.PRIMARY)}iff]: "
                ).strip().lower()

                if ans in ("y", "yes"):
                    receipt = client.commit_proposal(proposal["id"], proposal["sha256"])
                    print(
                        f"\n  {c('✔ Committed to workspace:', Colors.BOLD + Colors.SUCCESS)} "
                        f"{c(receipt.get('path', 'workspace'), Colors.BOLD + Colors.PRIMARY)} "
                        f"{c(f'[SHA: {sha_prefix}...]', Colors.MUTED)}\n"
                    )
                    return 0
                elif ans in ("n", "no"):
                    print(c("\n  ✖ Proposal rejected by operator. Workspace untouched.\n", Colors.ERROR))
                    return 0
                elif ans in ("d", "diff"):
                    print("\n" + render_diff(old_content, new_content, target_file or "Workspace Note", max_lines=2000) + "\n")
                else:
                    print("  Please enter 'y', 'n', or 'd'.")
        except (KeyboardInterrupt, EOFError):
            print(c("\n  ✖ Approval cancelled. Workspace unchanged.\n", Colors.WARNING))
            return 130

    return 0


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)

    if args.plain:
        Colors.set_enabled(False)

    app_root = Path(os.environ.get("EDITH_APP_ROOT") or Path(__file__).resolve().parent.parent).resolve()
    raw_ws = args.workspace or os.environ.get("EDITH_WORKSPACE_ROOT") or os.getcwd()
    workspace_root = Path(raw_ws).resolve()
    client = GatewayClient(host=args.host, port=args.port, app_root=app_root, workspace_root=workspace_root)

    # Check for direct subcommands passed as first positional argument
    prompt_tokens = args.prompt if isinstance(args.prompt, list) else ([args.prompt] if args.prompt else [])
    first_arg = prompt_tokens[0].strip().lower() if prompt_tokens else ""
    sub_args = " ".join(prompt_tokens[1:]).strip()

    if first_arg in ("status", "models", "audit", "notes", "vault", "graph", "files", "doctor", "gateway"):
        ok, msg = client.ensure_gateway(auto_start=True)
        if not ok:
            print(f"{c('Error:', Colors.ERROR)} Could not connect to Sovereign Gateway: {msg}", file=sys.stderr)
            return 1

        repl = EdithREPL(client, active_model=args.model, auto_approve=args.auto_approve, mode=args.mode, effort=args.effort)
        if first_arg == "status":
            repl._cmd_status()
        elif first_arg == "models":
            repl._cmd_models()
        elif first_arg == "doctor":
            repl._cmd_doctor()
        elif first_arg == "audit":
            repl._cmd_audit(sub_args)
        elif first_arg in ("notes", "vault"):
            repl._cmd_notes(sub_args)
        elif first_arg == "graph":
            repl._cmd_graph()
        elif first_arg == "files":
            repl._cmd_files(sub_args)
        elif first_arg == "gateway":
            repl._cmd_gateway(sub_args)
        return 0

    # Determine prompt if any
    effective_prompt = args.flag_prompt or (" ".join(prompt_tokens).strip() if prompt_tokens else None)

    # Ensure Gateway is running
    is_up = client.is_healthy()
    if not is_up:
        spinner = Spinner("Starting Sovereign Loopback Gateway...").start()
        ok, msg = client.ensure_gateway(auto_start=True)
        if not ok:
            spinner.stop("Failed to initialize Sovereign Gateway", success=False)
            print(f"{c('Error:', Colors.ERROR)} {msg}", file=sys.stderr)
            return 1
        spinner.stop("Sovereign Gateway Online", success=True)

    # Interactive mode requested or no prompt given
    if not effective_prompt or args.interactive:
        repl = EdithREPL(
            client,
            active_model=args.model,
            auto_approve=args.auto_approve,
            mode=args.mode,
            effort=args.effort,
        )
        repl.start(initial_prompt=effective_prompt if args.interactive else None)
        return 0

    # Non-interactive single prompt execution
    return run_single_prompt(
        client=client,
        prompt=effective_prompt,
        model=args.model,
        auto_approve=args.auto_approve,
        mode=args.mode,
        effort=args.effort,
    )


if __name__ == "__main__":
    sys.exit(main())
