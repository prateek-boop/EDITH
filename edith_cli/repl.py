"""Interactive Sovereign REPL / TUI for EDITH.

Provides a rich terminal shell with readline command history, tab completion,
multi-line prompt input, interactive model switching, execution modes,
reasoning effort controls, local shell escape, doctor diagnostics, file mentions (@file),
and the signature Two-Phase Sovereign Approval Gate.
"""
from __future__ import annotations

import atexit
import datetime
import os
import re
import readline
import secrets
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from typing import Optional

from edith_cli import __version__
from edith_cli.client import GatewayClient
from edith_cli.settings import get_setting, load_settings, set_local_endpoint, set_setting
from edith_cli.ui import (
    Colors,
    Spinner,
    c,
    divider,
    format_prompt,
    get_banner,
    render_approval_card,
    render_auth_card,
    render_diff,
    render_doctor_report,
    render_event,
    render_local_status,
    render_markdown,
    render_model_menu,
    render_shell_output,
    term_width,
)


class EdithREPL:
    """Interactive command-line shell for EDITH."""

    SLASH_COMMANDS = [
        "/help",
        "/status",
        "/auth",
        "/login",
        "/logout",
        "/whoami",
        "/local",
        "/model",
        "/models",
        "/mode",
        "/effort",
        "/doctor",
        "/files",
        "/notes",
        "/graph",
        "/audit",
        "/diff",
        "/undo",
        "/history",
        "/config",
        "/export",
        "/gateway",
        "/clear",
        "/paste",
        "/exit",
        "/quit",
    ]

    def __init__(
        self,
        client: GatewayClient,
        active_model: Optional[str] = None,
        auto_approve: bool = False,
        mode: Optional[str] = None,
        effort: Optional[str] = None,
    ):
        self.client = client
        settings = load_settings()
        self.active_model = active_model or settings.get("model", "llama-3.2-3b-instruct")
        self.mode = mode or settings.get("mode", "coding")
        self.effort = effort or settings.get("effort", "high")
        self.auto_approve = auto_approve or (self.mode == "auto")
        self.last_proposal: Optional[dict] = None
        self.last_revert_backup: Optional[tuple[str, str]] = None  # (file_path, original_content)
        self.session_jobs: list[dict] = []
        self.session_transcript: list[dict] = []
        self.running = True
        self.workspace_root = client.workspace_root

        # History file configuration
        self.history_file = Path.home() / ".edith_history"
        self._init_readline()

    def _init_readline(self) -> None:
        """Initialize GNU readline with history and custom auto-completion."""
        if not sys.stdin.isatty():
            return

        try:
            if self.history_file.exists():
                readline.read_history_file(str(self.history_file))
        except Exception:
            pass

        readline.set_history_length(1000)
        readline.set_completer_delims(" \t\n`!#$%^&*()=+[{]}\\|;:'\",<>?")
        readline.set_completer(self._complete)
        readline.parse_and_bind("tab: complete")

        atexit.register(self._save_history)

    def _save_history(self) -> None:
        try:
            readline.write_history_file(str(self.history_file))
        except Exception:
            pass

    def _complete(self, text: str, state: int) -> Optional[str]:
        """Auto-complete slash commands and workspace file paths."""
        line = readline.get_line_buffer()

        # Slash commands completion
        if line.startswith("/"):
            matches = [cmd for cmd in self.SLASH_COMMANDS if cmd.startswith(text)]
            return matches[state] if state < len(matches) else None

        # @file mention completion
        is_mention = text.startswith("@")
        search_path = text[1:] if is_mention else text

        try:
            if "/" in search_path:
                dirname, prefix = os.path.split(search_path)
                target_dir = self.workspace_root / dirname
            else:
                dirname = ""
                prefix = search_path
                target_dir = self.workspace_root

            if target_dir.exists() and target_dir.is_dir():
                candidates = []
                for entry in target_dir.iterdir():
                    name = entry.name
                    if name.startswith(".") and not prefix.startswith("."):
                        continue
                    if name.startswith(prefix):
                        rel_match = os.path.join(dirname, name) if dirname else name
                        if entry.is_dir():
                            rel_match += "/"
                        if is_mention:
                            rel_match = "@" + rel_match
                        candidates.append(rel_match)
                candidates.sort()
                return candidates[state] if state < len(candidates) else None
        except Exception:
            pass

        return None

    # -------------------------------------------------------------------------
    # Main Interactive Loop
    # -------------------------------------------------------------------------

    def _is_current_model_local(self) -> bool:
        """Check if active model belongs to a local LLM provider."""
        try:
            avail_locals = self.client.get_available_local_models()
            if self.active_model in avail_locals:
                return True
        except Exception:
            pass
        return any(tag in self.active_model.lower() for tag in ("qwen", "llama", "mistral", "deepseek", "local", "ollama", "phi"))

    def start(self, initial_prompt: Optional[str] = None) -> None:
        """Launch the interactive REPL shell."""
        print(get_banner(
            version=__version__,
            model=self.active_model,
            status="ONLINE",
            mode=self.mode,
            effort=self.effort,
            workspace=str(self.workspace_root),
            auth_user=self.client.auth_user,
            is_local_model=self._is_current_model_local(),
        ))
        print(f" {c('Type your goal, or', Colors.MUTED)} {c('/help', Colors.BOLD + Colors.PRIMARY)} {c('for available slash commands. Prefix with ! to run shell commands.', Colors.MUTED)}\n")

        if initial_prompt:
            self.execute_goal(initial_prompt)

        while self.running:
            prompt_str = format_prompt(self.active_model, mode=self.mode)
            try:
                user_input = input(prompt_str).strip()
            except EOFError:
                print(c("\nExiting EDITH session. Sovereign workspace state preserved.", Colors.MUTED))
                break
            except KeyboardInterrupt:
                print("\n")
                continue

            if not user_input:
                continue

            # Local shell command escape (!command)
            if user_input.startswith("!"):
                self._run_shell(user_input[1:].strip())
                continue

            # Handle multi-line continuation with trailing backslash
            if user_input.endswith("\\"):
                multi_lines = [user_input[:-1].strip()]
                cont_prompt = f"{c(' ...', Colors.MUTED)} "
                while True:
                    try:
                        line = input(cont_prompt)
                        if line.endswith("\\"):
                            multi_lines.append(line[:-1].strip())
                        else:
                            multi_lines.append(line.strip())
                            break
                    except (EOFError, KeyboardInterrupt):
                        break
                user_input = "\n".join(multi_lines).strip()
                if not user_input:
                    continue

            # Check for slash commands
            if user_input.startswith("/"):
                self.handle_slash_command(user_input)
                continue

            # Regular goal execution
            self.execute_goal(user_input)

    # -------------------------------------------------------------------------
    # Local Shell Escape (!command)
    # -------------------------------------------------------------------------

    def _run_shell(self, cmd: str) -> None:
        """Execute a local shell command without exiting the CLI."""
        if not cmd:
            print(c("  Usage: !<command> (e.g. !git status, !ls -la)", Colors.MUTED))
            return
        spinner = Spinner(f"Running shell: {cmd}").start()
        try:
            res = subprocess.run(
                cmd,
                shell=True,
                cwd=str(self.workspace_root),
                capture_output=True,
                text=True,
                timeout=60,
            )
            spinner.stop()
            render_shell_output(cmd, res.stdout, res.stderr, res.returncode)
        except Exception as exc:
            spinner.stop("Shell execution failed", success=False)
            print(f"  {c('Shell Error:', Colors.ERROR)} {exc}\n")

    # -------------------------------------------------------------------------
    # Goal Execution & Sovereign Two-Phase Approval Gate
    # -------------------------------------------------------------------------

    def execute_goal(self, goal: str, kind: Optional[str] = None) -> Optional[dict]:
        """Execute a goal through the Sovereign gateway, streaming real-time events."""
        # Detect @file mentions and resolve them
        detected_sources = []
        mentions = re.findall(r"@([\w\-\.\/]+)", goal)
        for m in mentions:
            cand = self.workspace_root / m
            if cand.exists() and cand.is_file():
                detected_sources.append(m)

        # Apply execution mode rules
        eff_kind = kind or ("reasoning" if self.mode == "plan" else "coding")
        eff_goal = goal
        if self.mode == "plan":
            eff_goal = f"[ARCHITECTURAL PLAN ONLY - DO NOT PROPOSE FILE MODIFICATIONS]\n{goal}"

        print()
        spinner = Spinner(f"Connecting to Sovereign Engine ({self.active_model} · {self.mode})...").start()

        try:
            job_init = self.client.start_job(
                objective=eff_goal,
                source_ids=detected_sources,
                kind=eff_kind,
                model=self.active_model,
                effort=self.effort,
            )
            job_id = job_init["id"]
        except Exception as exc:
            spinner.stop("Failed to dispatch goal to gateway", success=False)
            print(f"  {c('Error:', Colors.BOLD + Colors.ERROR)} {exc}\n")
            return None

        # Event stream callback
        def on_event(ev: dict) -> None:
            label = ev.get("label", "Processing")
            detail = ev.get("detail", "")
            file_name = ev.get("file")
            time_str = ev.get("time")

            spinner.stop()
            render_event(label, detail, timestamp=time_str, file=file_name)
            spinner.update(f"{label}: {detail[:40]}...")
            spinner.start()

        # Stream until finished
        try:
            final_job = self.client.stream_job(job_id=job_id, on_event=on_event)
        except KeyboardInterrupt:
            spinner.stop("Goal cancelled by operator", success=False)
            try:
                self.client.cancel_job(job_id)
            except Exception:
                pass
            print(f"\n  {c('✖ Execution halted by human operator.', Colors.WARNING)}\n")
            return None
        except Exception as exc:
            spinner.stop("Execution interrupted", success=False)
            print(f"  {c('Error:', Colors.BOLD + Colors.ERROR)} {exc}\n")
            return None

        spinner.stop()
        self.session_jobs.append(final_job)
        self.session_transcript.append({
            "time": datetime.datetime.now().isoformat(),
            "goal": goal,
            "model": self.active_model,
            "job": final_job,
        })

        status = final_job.get("status")
        output = final_job.get("output", "")
        proposal = final_job.get("proposal")

        # Conversational / Inquiry Response
        if status == "completed":
            print()
            print(render_markdown(output))
            print()
            return final_job

        # Failure
        if status == "failed":
            err = final_job.get("error") or "Unknown execution error"
            print(f"\n  {c('✖ Sovereign Engine Failed:', Colors.BOLD + Colors.ERROR)} {err}\n")
            return final_job

        # Sovereign Two-Phase Approval Gate
        if status == "waiting_approval" and proposal:
            self.last_proposal = proposal
            self._handle_approval_gate(proposal)
            return final_job

        return final_job

    def _handle_approval_gate(self, proposal: dict) -> None:
        """Handle human-in-the-loop review, diff inspection, and cryptographic commit."""
        print()
        print(render_approval_card(proposal))

        # Check existing content for diffing and backup
        target_file = proposal.get("targetFile")
        old_content = ""
        if target_file:
            target_path = self.workspace_root / target_file
            if target_path.exists() and target_path.is_file():
                try:
                    old_content = target_path.read_text(encoding="utf-8", errors="replace")
                except Exception:
                    pass

        new_content = proposal.get("content", "")

        # Save backup in case of /undo
        if target_file:
            self.last_revert_backup = (target_file, old_content)

        # Auto-approve mode
        if self.auto_approve or self.mode == "auto":
            print(c("\n  [Auto-Approve Enabled: Signing commit directly...]", Colors.WARNING))
            self._commit_proposal(proposal)
            return

        # Show initial diff preview
        print()
        print(render_diff(old_content, new_content, target_file or "Workspace Note", max_lines=40))
        print()

        # Approval prompt loop
        while True:
            try:
                choice = input(
                    f"  {c('Approve and commit to workspace?', Colors.BOLD + Colors.WHITE)} "
                    f"[{c('y', Colors.BOLD + Colors.SUCCESS)}es / "
                    f"{c('n', Colors.BOLD + Colors.ERROR)}o / "
                    f"{c('d', Colors.BOLD + Colors.PRIMARY)}iff / "
                    f"{c('e', Colors.BOLD + Colors.WARNING)}xplanation]: "
                ).strip().lower()
            except (EOFError, KeyboardInterrupt):
                print(c("\n  ✖ Approval cancelled. Workspace unchanged.\n", Colors.WARNING))
                return

            if choice in ("y", "yes"):
                self._commit_proposal(proposal)
                break
            elif choice in ("n", "no"):
                print(c("\n  ✖ Proposal rejected by human operator. Workspace untouched.\n", Colors.ERROR))
                break
            elif choice in ("d", "diff"):
                print("\n" + render_diff(old_content, new_content, target_file or "Workspace Note", max_lines=2000) + "\n")
            elif choice in ("e", "explanation", "explain"):
                print(f"\n  {c('Rationale:', Colors.BOLD + Colors.WHITE)}\n  {proposal.get('explanation', 'No detailed explanation provided.')}\n")
            else:
                print(c("  Please choose (y)es, (n)o, (d)iff, or (e)xplanation.", Colors.MUTED))

    def _commit_proposal(self, proposal: dict) -> None:
        """Sign and commit proposal cryptographically via loopback gateway."""
        sha_prefix = proposal.get("sha256", "")[:16]
        spinner = Spinner("Cryptographically signing SHA-256 commit...").start()
        try:
            receipt = self.client.commit_proposal(proposal["id"], proposal["sha256"])
            spinner.stop("Commit signed & written to workspace", success=True)
            print(
                f"\n  {c('✔ Workspace Updated:', Colors.BOLD + Colors.SUCCESS)} "
                f"{c(receipt.get('path', 'workspace'), Colors.BOLD + Colors.PRIMARY)} "
                f"{c(f'[SHA: {sha_prefix}...]', Colors.MUTED)}\n"
            )
            print(f"  {c('Tip:', Colors.MUTED)} You can undo this change at any time by typing {c('/undo', Colors.PRIMARY)}.\n")
        except Exception as exc:
            spinner.stop("Failed to commit proposal", success=False)
            print(f"  {c('Commit Error:', Colors.BOLD + Colors.ERROR)} {exc}\n")

    # -------------------------------------------------------------------------
    # Slash Commands Dispatcher
    # -------------------------------------------------------------------------

    def handle_slash_command(self, cmd_line: str) -> None:
        """Route and execute interactive slash commands."""
        parts = cmd_line.strip().split(maxsplit=1)
        command = parts[0].lower()
        args = parts[1].strip() if len(parts) > 1 else ""

        if command in ("/exit", "/quit"):
            print(c("Exiting EDITH. Sovereign workspace preserved.", Colors.MUTED))
            self.running = False
        elif command == "/help":
            self._cmd_help()
        elif command == "/status":
            self._cmd_status()
        elif command == "/auth":
            self._cmd_auth(args)
        elif command == "/login":
            self._cmd_login(args)
        elif command == "/logout":
            self._cmd_logout()
        elif command == "/whoami":
            self._cmd_whoami()
        elif command == "/local":
            self._cmd_local(args)
        elif command == "/model":
            self._cmd_model(args)
        elif command == "/models":
            self._cmd_models()
        elif command == "/mode":
            self._cmd_mode(args)
        elif command == "/effort":
            self._cmd_effort(args)
        elif command == "/doctor":
            self._cmd_doctor()
        elif command == "/undo":
            self._cmd_undo()
        elif command == "/files":
            self._cmd_files(args)
        elif command == "/notes":
            self._cmd_notes(args)
        elif command == "/graph":
            self._cmd_graph()
        elif command == "/audit":
            self._cmd_audit(args)
        elif command == "/diff":
            self._cmd_diff()
        elif command == "/history":
            self._cmd_history()
        elif command == "/config":
            self._cmd_config(args)
        elif command == "/export":
            self._cmd_export(args)
        elif command == "/gateway":
            self._cmd_gateway(args)
        elif command == "/clear":
            os.system("clear" if os.name == "posix" else "cls")
            print(get_banner(
                version=__version__,
                model=self.active_model,
                status="ONLINE",
                mode=self.mode,
                effort=self.effort,
                workspace=str(self.workspace_root),
                auth_user=self.client.auth_user,
                is_local_model=self._is_current_model_local(),
            ))
        elif command == "/paste":
            self._cmd_paste()
        else:
            print(f"  {c('Unknown slash command:', Colors.ERROR)} {command}. Type {c('/help', Colors.PRIMARY)} for command list.\n")

    # -------------------------------------------------------------------------
    # Command Implementations
    # -------------------------------------------------------------------------

    def _cmd_help(self) -> None:
        print("\n" + divider(label="EDITH SOVEREIGN CLI COMMANDS") + "\n")
        commands = [
            ("/help", "Display this help manual and shortcut guide"),
            ("/status", "Display Sovereign OS health, active model, and workspace metrics"),
            ("/auth [status|login]", "Inspect or manage Google Identity authentication"),
            ("/login [--demo|--browser]", "Sign in with Google (OAuth 2.0 Web Flow or Instant Demo)"),
            ("/logout", "Sign out and revoke Google authentication session"),
            ("/whoami", "Display authenticated Google identity and session token"),
            ("/local [scan|endpoint]", "Switch to local LLMs (Ollama/LM Studio) if available"),
            ("/model [id|num]", "Interactive model selector or direct switch"),
            ("/models", "List all available AI reasoning, coding, and local models"),
            ("/mode [coding|plan|auto]", "Switch execution mode (coding, architectural plan, auto-approve)"),
            ("/effort [low|med|high|max]", "Set neural reasoning effort depth"),
            ("/doctor", "Run comprehensive diagnostics & verify audit chain integrity"),
            ("/undo", "Revert the last committed file modification in this session"),
            ("/files [query]", "Browse indexed workspace files (supports @mentions)"),
            ("/notes [query]", "Search notes in the Sovereign Knowledge Vault"),
            ("/graph", "Inspect knowledge graph node connectivity and backlinks"),
            ("/audit [limit]", "Inspect recent tamper-evident hash-chained audit events"),
            ("/diff", "Redisplay the most recent proposal's unified diff"),
            ("/history", "View all goals executed in the current session"),
            ("/config [key val]", "View or update persistent CLI preferences"),
            ("/export [file]", "Export conversation transcript and diffs to Markdown"),
            ("/gateway [cmd]", "Manage background gateway (start, stop, restart, status)"),
            ("/paste", "Enter multi-line paste mode until typing /end"),
            ("/clear", "Clear terminal screen and redraw EDITH banner"),
            ("!<command>", "Execute any local shell command directly (e.g. !git status)"),
            ("/exit, /quit", "Exit the EDITH CLI session"),
        ]
        for cmd, desc in commands:
            print(f"  {c(cmd.ljust(25), Colors.BOLD + Colors.PRIMARY)} {c(desc, Colors.WHITE)}")

        print("\n" + divider(label="KEYBOARD CONTROLS & TRICKS") + "\n")
        print(f"  {c('Enter', Colors.BOLD + Colors.WHITE)}         - Execute prompt/goal")
        print(f"  {c('@filename', Colors.BOLD + Colors.WHITE)}     - Mention a workspace file to automatically attach it to context")
        print(f"  {c('!command', Colors.BOLD + Colors.WHITE)}      - Run local shell command without leaving EDITH (e.g. !git diff)")
        print(f"  {c('\\ at end', Colors.BOLD + Colors.WHITE)}     - Multi-line continuation (press Enter to continue next line)")
        print(f"  {c('Tab', Colors.BOLD + Colors.WHITE)}           - Auto-complete slash commands, @files, or file paths")
        print(f"  {c('Up / Down', Colors.BOLD + Colors.WHITE)}     - Scroll through command history")
        print(f"  {c('Ctrl+C', Colors.BOLD + Colors.WHITE)}        - Cancel currently executing goal or clear prompt")
        print(f"  {c('Ctrl+D', Colors.BOLD + Colors.WHITE)}        - Exit EDITH gracefully\n")

    def _cmd_status(self) -> None:
        spinner = Spinner("Querying Sovereign OS health...").start()
        try:
            health = self.client.get_health()
            spinner.stop()
        except Exception as exc:
            spinner.stop("Failed to query gateway", success=False)
            print(f"  {c('Error:', Colors.ERROR)} {exc}\n")
            return

        session_info = self.client.get_auth_session()
        has_auth = session_info.get("ok") and session_info.get("user")
        if has_auth:
            u = session_info["user"]
            v_tag = c("[Verified]", Colors.BOLD + Colors.SUCCESS) if u.get("verified") else c("[Demo]", Colors.WARNING)
            auth_display = f"{u.get('name', 'Google User')} ({u.get('email', '')}) {v_tag}"
        else:
            auth_display = "Guest / Unauthenticated (Run /login to sign in)"

        local_avail = self.client.get_available_local_models()
        if local_avail:
            local_display = f"Connected ({len(local_avail)} model{'s' if len(local_avail) > 1 else ''}: {', '.join(local_avail[:2])})"
        else:
            local_display = "Offline (Loopback probed · Run /local scan)"

        is_cur_local = self._is_current_model_local()
        engine_label = "Local LLM Inference Engine" if is_cur_local else health.get("engine", "EDITH Autonomous Core")

        print("\n" + divider(label="SOVEREIGN OS DIAGNOSTICS") + "\n")
        items = [
            ("Sovereign Engine", engine_label),
            ("Loopback Gateway", f"http://{self.client.host}:{self.client.port}"),
            ("Google Identity", auth_display),
            ("Local LLM Server", local_display),
            ("Active Model", f"{self.active_model} {'[LOCAL]' if is_cur_local else '[CLOUD]'}"),
            ("Execution Mode", f"{self.mode.upper()} ({'Two-Phase Approval' if self.mode == 'coding' else ('Plan Only' if self.mode == 'plan' else 'Auto-Approve')})"),
            ("Reasoning Effort", self.effort),
            ("Vault Notes", f"{health.get('noteCount', 0)} notes indexed"),
            ("Clearance Role", health.get("role", "engineer")),
            ("Write Permission", "Enabled (Two-Phase Commit Gate)" if health.get("canWrite") else "Read-Only"),
            ("Telemetry Policy", "Zero Telemetry / Air-Gapped Loopback"),
            ("Workspace Root", str(self.workspace_root)),
        ]
        for label, val in items:
            print(f"  {c(label.ljust(20) + ':', Colors.MUTED)} {c(str(val), Colors.BOLD + Colors.WHITE)}")
        print()

    def _cmd_models(self) -> None:
        spinner = Spinner("Querying model catalog...").start()
        try:
            models = self.client.get_models()
            spinner.stop()
        except Exception as exc:
            spinner.stop("Failed to query models", success=False)
            print(f"  {c('Error:', Colors.ERROR)} {exc}\n")
            return

        render_model_menu(models, self.active_model)
        print(f"  {c('Switch model with:', Colors.MUTED)} {c('/model <id or number>', Colors.BOLD + Colors.PRIMARY)} {c('or', Colors.MUTED)} {c('/local', Colors.BOLD + Colors.WARNING)} {c('to switch to local models', Colors.MUTED)}\n")

    def _cmd_model(self, target: str) -> None:
        """Switch active model directly or open interactive numbered picker."""
        t_clean = target.strip().lower()
        if t_clean in ("local", "ollama", "lmstudio"):
            self._cmd_local("")
            return

        spinner = Spinner("Fetching available models...").start()
        try:
            models = self.client.get_models()
            spinner.stop()
        except Exception as exc:
            spinner.stop("Failed to fetch models", success=False)
            print(f"  {c('Error:', Colors.ERROR)} {exc}\n")
            return

        ordered_ids = []
        seen = set()
        for m in models:
            for d in m.get("modelDetails", []):
                mid = d.get("id")
                if mid and mid not in seen:
                    seen.add(mid)
                    ordered_ids.append(mid)
            if m.get("provider") == "local-llm":
                for mid in m.get("availableModels", []):
                    if mid and mid not in seen:
                        seen.add(mid)
                        ordered_ids.append(mid)

        # If no argument, show interactive menu
        if not target:
            ordered_ids = render_model_menu(models, self.active_model)
            try:
                choice = input(f"  {c('Select model [1-' + str(len(ordered_ids)) + '] or enter model ID (Enter to keep current):', Colors.BOLD + Colors.WHITE)} ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                return

            if not choice:
                return
            target = choice

        chosen_id = None
        if target.isdigit():
            idx = int(target)
            if 1 <= idx <= len(ordered_ids):
                chosen_id = ordered_ids[idx - 1]
            else:
                print(f"  {c('Error:', Colors.ERROR)} Choice '{target}' out of range (1-{len(ordered_ids)})\n")
                return
        else:
            matched = [mid for mid in ordered_ids if target.lower() in mid.lower()]
            if matched:
                chosen_id = matched[0]
            else:
                chosen_id = target

        self.active_model = chosen_id
        set_setting("model", chosen_id)
        print(f"\n  {c('✔ Active model switched to:', Colors.SUCCESS)} {c(self.active_model, Colors.BOLD + Colors.PRIMARY)}\n")

    def _cmd_mode(self, mode_arg: str) -> None:
        valid_modes = ["coding", "plan", "auto"]
        mode_clean = mode_arg.strip().lower()
        if not mode_clean:
            print(f"\n  {c('Current Mode:', Colors.MUTED)} {c(self.mode.upper(), Colors.BOLD + Colors.PRIMARY)}")
            print(f"  {c('Available Modes:', Colors.MUTED)}")
            print(f"    • {c('coding', Colors.BOLD + Colors.WHITE)} : Standard sovereign agent mode with Two-Phase Approval Gate (Default)")
            print(f"    • {c('plan', Colors.BOLD + Colors.WHITE)}   : Architectural analysis & planning mode (No file edits proposed)")
            print(f"    • {c('auto', Colors.BOLD + Colors.WHITE)}   : Auto-approve file modifications directly (Skip prompt)")
            print(f"  {c('Switch mode with:', Colors.MUTED)} {c('/mode [coding|plan|auto]', Colors.PRIMARY)}\n")
            return

        if mode_clean not in valid_modes:
            print(f"  {c('Invalid mode:', Colors.ERROR)} '{mode_clean}'. Choose from: coding, plan, auto.\n")
            return

        self.mode = mode_clean
        self.auto_approve = (mode_clean == "auto")
        set_setting("mode", mode_clean)
        print(f"\n  {c('✔ Execution mode switched to:', Colors.SUCCESS)} {c(self.mode.upper(), Colors.BOLD + Colors.PRIMARY)}\n")

    def _cmd_effort(self, effort_arg: str) -> None:
        valid_efforts = ["low", "medium", "high", "max"]
        arg_clean = effort_arg.strip().lower()
        if not arg_clean:
            print(f"\n  {c('Current Reasoning Effort:', Colors.MUTED)} {c(self.effort, Colors.BOLD + Colors.PRIMARY)}")
            print(f"  {c('Available Levels:', Colors.MUTED)} low, medium, high, max")
            print(f"  {c('Set effort with:', Colors.MUTED)} {c('/effort [low|medium|high|max]', Colors.PRIMARY)}\n")
            return

        if arg_clean not in valid_efforts:
            print(f"  {c('Invalid effort level:', Colors.ERROR)} Choose from: low, medium, high, max.\n")
            return

        self.effort = arg_clean
        set_setting("effort", arg_clean)
        print(f"\n  {c('✔ Reasoning effort depth set to:', Colors.SUCCESS)} {c(self.effort, Colors.BOLD + Colors.PRIMARY)}\n")

    def _cmd_doctor(self) -> None:
        spinner = Spinner("Running Sovereign OS Doctor diagnostics...").start()
        try:
            report = self.client.run_doctor()
            spinner.stop()
            render_doctor_report(report)
        except Exception as exc:
            spinner.stop("Doctor checks failed", success=False)
            print(f"  {c('Doctor Error:', Colors.ERROR)} {exc}\n")

    def _cmd_undo(self) -> None:
        if not self.last_revert_backup:
            print(c("\n  No committed file modifications to undo in this session.\n", Colors.MUTED))
            return

        target_file, orig_content = self.last_revert_backup
        target_path = self.workspace_root / target_file

        try:
            confirm = input(f"  {c('Revert file', Colors.BOLD + Colors.WARNING)} {c(target_file, Colors.BOLD + Colors.PRIMARY)} {c('to previous state? [y/N]:', Colors.BOLD + Colors.WHITE)} ").strip().lower()
            if confirm not in ("y", "yes"):
                print(c("  Undo cancelled.\n", Colors.MUTED))
                return

            if orig_content == "":
                if target_path.exists():
                    target_path.unlink()
                print(f"\n  {c('✔ Reverted:', Colors.SUCCESS)} Deleted newly created file {c(target_file, Colors.PRIMARY)}\n")
            else:
                target_path.write_text(orig_content, encoding="utf-8")
                print(f"\n  {c('✔ Reverted:', Colors.SUCCESS)} Restored original contents of {c(target_file, Colors.PRIMARY)}\n")
            self.last_revert_backup = None
        except Exception as exc:
            print(f"  {c('Undo Error:', Colors.ERROR)} {exc}\n")

    def _cmd_config(self, args_str: str) -> None:
        parts = args_str.strip().split(maxsplit=1)
        if not parts or not parts[0]:
            settings = load_settings()
            print("\n" + divider(label="EDITH CLI CONFIGURATION") + "\n")
            for k, v in settings.items():
                print(f"  {c(k.ljust(18) + ':', Colors.MUTED)} {c(str(v), Colors.BOLD + Colors.WHITE)}")
            print(f"\n  {c('Set config with:', Colors.MUTED)} {c('/config <key> <value>', Colors.PRIMARY)}\n")
            return

        key = parts[0].lower()
        if len(parts) == 1:
            val = get_setting(key)
            print(f"\n  {c(key + ':', Colors.MUTED)} {c(str(val), Colors.BOLD + Colors.WHITE)}\n")
            return

        val_str = parts[1].strip()
        val: bool | int | str = val_str
        if val_str.lower() in ("true", "yes", "on"):
            val = True
        elif val_str.lower() in ("false", "no", "off"):
            val = False
        elif val_str.isdigit():
            val = int(val_str)

        set_setting(key, val)
        if key == "model":
            self.active_model = str(val)
        elif key == "mode":
            self.mode = str(val)
        elif key == "effort":
            self.effort = str(val)

        print(f"\n  {c('✔ Updated setting:', Colors.SUCCESS)} {c(key, Colors.PRIMARY)} = {c(str(val), Colors.WHITE)}\n")

    def _cmd_export(self, filepath: str) -> None:
        if not self.session_transcript:
            print(c("\n  No goals executed in this session to export.\n", Colors.MUTED))
            return

        dest_name = filepath.strip() or f"edith_session_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        dest_path = self.workspace_root / dest_name

        lines = [
            f"# EDITH Sovereign Session Transcript",
            f"- **Date:** {datetime.datetime.now().isoformat()}",
            f"- **Model:** {self.active_model}",
            f"- **Mode:** {self.mode}",
            f"- **Workspace:** {self.workspace_root}\n",
            "---",
        ]
        for idx, item in enumerate(self.session_transcript, 1):
            j = item.get("job", {})
            lines.append(f"\n## Turn {idx}: {item.get('goal')}")
            lines.append(f"- **Time:** {item.get('time')}")
            lines.append(f"- **Status:** {j.get('status')}")
            if j.get("output"):
                lines.append(f"\n### Output\n\n{j.get('output')}")
            if j.get("proposal"):
                p = j["proposal"]
                lines.append(f"\n### Proposal ({p.get('action')})")
                lines.append(f"- **Target:** `{p.get('targetFile')}`")
                lines.append(f"- **SHA-256:** `{p.get('sha256')}`")

        dest_path.write_text("\n".join(lines), encoding="utf-8")
        print(f"\n  {c('✔ Session exported to:', Colors.SUCCESS)} {c(str(dest_path), Colors.BOLD + Colors.PRIMARY)}\n")

    def _cmd_files(self, query: str = "") -> None:
        spinner = Spinner("Scanning workspace files...").start()
        try:
            tree_data = self.client.get_workspace_files()
            spinner.stop()
        except Exception as exc:
            spinner.stop("Failed to fetch workspace files", success=False)
            print(f"  {c('Error:', Colors.ERROR)} {exc}\n")
            return

        files = tree_data.get("files", [])
        if not files:
            print(c("  No workspace files found.", Colors.MUTED))
            return

        flat_files: list[str] = []
        def walk(items: list[dict]):
            for it in items:
                if it.get("type") == "file":
                    p = it.get("path", "")
                    if not query or query.lower() in p.lower():
                        flat_files.append(p)
                elif it.get("type") == "folder":
                    walk(it.get("children", []))

        walk(files)
        print("\n" + divider(label=f"WORKSPACE FILES ({len(flat_files)} matches)") + "\n")
        for f in flat_files[:40]:
            print(f"  {c('📄', Colors.PRIMARY)} {f}")
        if len(flat_files) > 40:
            print(f"  {c(f'... [{len(flat_files) - 40} more files]', Colors.MUTED)}")
        print()

    def _cmd_notes(self, query: str = "") -> None:
        spinner = Spinner("Searching Sovereign Vault...").start()
        try:
            data = self.client.get_vault_notes(query=query)
            spinner.stop()
        except Exception as exc:
            spinner.stop("Failed to fetch notes", success=False)
            print(f"  {c('Error:', Colors.ERROR)} {exc}\n")
            return

        notes = data.get("items", []) or data.get("notes", [])
        print("\n" + divider(label=f"SOVEREIGN KNOWLEDGE VAULT ({len(notes)} notes)") + "\n")
        if not notes:
            print(c("  No matching notes in vault.", Colors.MUTED))
        for n in notes[:25]:
            title = n.get("id") or n.get("name")
            folder = n.get("folder", "")
            folder_str = f" [{folder}]" if folder and folder != "." else ""
            print(f"  {c('📝', Colors.SECONDARY)} {c(title, Colors.BOLD + Colors.WHITE)}{c(folder_str, Colors.MUTED)}")
        print()

    def _cmd_graph(self) -> None:
        spinner = Spinner("Traversing Vault graph topology...").start()
        try:
            graph = self.client.get_vault_graph()
            spinner.stop()
        except Exception as exc:
            spinner.stop("Failed to fetch graph", success=False)
            print(f"  {c('Error:', Colors.ERROR)} {exc}\n")
            return

        nodes = graph.get("nodes", [])
        links = graph.get("links", [])
        print("\n" + divider(label="VAULT KNOWLEDGE TOPOLOGY") + "\n")
        print(f"  {c('Total Nodes:', Colors.MUTED)} {c(str(len(nodes)), Colors.BOLD + Colors.PRIMARY)}")
        print(f"  {c('Total Links:', Colors.MUTED)} {c(str(len(links)), Colors.BOLD + Colors.SECONDARY)}\n")
        print(f"  {c('Key Knowledge Hubs:', Colors.BOLD + Colors.WHITE)}")
        for node in nodes[:10]:
            nid = node.get("id", "")
            ntype = node.get("type", "note")
            deg = len([l for l in links if l.get("source") == nid or l.get("target") == nid])
            print(f"  • {c(nid, Colors.WHITE)} ({c(ntype, Colors.MUTED)}) - {c(str(deg), Colors.PRIMARY)} backlinks")
        print()

    def _cmd_audit(self, limit_str: str = "") -> None:
        limit = int(limit_str) if limit_str.isdigit() else 10
        spinner = Spinner("Reading cryptographic audit log...").start()
        try:
            records = self.client.get_audit_trail(limit=limit)
            spinner.stop()
        except Exception as exc:
            spinner.stop("Failed to fetch audit log", success=False)
            print(f"  {c('Error:', Colors.ERROR)} {exc}\n")
            return

        print("\n" + divider(label=f"HASH-CHAINED AUDIT TRAIL (Last {min(len(records), limit)})") + "\n")
        if not records:
            print(c("  Audit trail empty.", Colors.MUTED))
            return

        for rec in reversed(records[-limit:]):
            action = rec.get("action", "unknown")
            status = rec.get("status", "unknown")
            time_str = rec.get("timestamp", "")[:19].replace("T", " ")
            chash = rec.get("hash", "")[:12] + "..."
            status_col = Colors.SUCCESS if status in ("approved", "succeeded", "completed") else Colors.WARNING

            print(f"  {c(time_str, Colors.MUTED)} │ {c(action.ljust(22), Colors.BOLD + Colors.WHITE)} │ {c(status.upper().ljust(10), status_col)} │ {c(chash, Colors.MUTED)}")
        print()

    def _cmd_diff(self) -> None:
        if not self.last_proposal:
            print(c("\n  No active proposal in this session.\n", Colors.MUTED))
            return
        target_file = self.last_proposal.get("targetFile")
        old_content = ""
        if target_file:
            p = self.workspace_root / target_file
            if p.exists() and p.is_file():
                try:
                    old_content = p.read_text(encoding="utf-8", errors="replace")
                except Exception:
                    pass
        print("\n" + render_diff(old_content, self.last_proposal.get("content", ""), target_file or "Proposal", max_lines=500) + "\n")

    def _cmd_history(self) -> None:
        print("\n" + divider(label="SESSION GOALS & EXECUTIONS") + "\n")
        if not self.session_jobs:
            print(c("  No executions run in this session yet.", Colors.MUTED))
            return
        for idx, j in enumerate(self.session_jobs, 1):
            status = j.get("status", "unknown")
            obj = j.get("objective", "")
            stat_col = Colors.SUCCESS if status in ("completed", "waiting_approval") else Colors.ERROR
            print(f"  {c(str(idx) + '.', Colors.MUTED)} [{c(status.upper(), stat_col)}] {obj}")
        print()

    def _cmd_gateway(self, action: str = "") -> None:
        act = action.strip().lower() or "status"
        if act == "status":
            online = self.client.is_healthy()
            state = c("ONLINE", Colors.BOLD + Colors.SUCCESS) if online else c("OFFLINE", Colors.BOLD + Colors.ERROR)
            print(f"\n  {c('Gateway Status:', Colors.MUTED)} {state} ({self.client.base_url})\n")
        elif act == "start":
            ok, msg = self.client.ensure_gateway(auto_start=True)
            if ok:
                print(f"\n  {c('✔ Gateway started successfully:', Colors.SUCCESS)} {self.client.base_url}\n")
            else:
                print(f"\n  {c('✖ Failed to start gateway:', Colors.ERROR)} {msg}\n")
        elif act == "stop":
            stopped = self.client.stop_gateway()
            if stopped:
                print(c("\n  ✔ Gateway process stopped.\n", Colors.SUCCESS))
            else:
                print(c("\n  Gateway was not running or could not be terminated.\n", Colors.MUTED))
        elif act == "restart":
            self.client.stop_gateway()
            time.sleep(0.5)
            ok, msg = self.client.ensure_gateway(auto_start=True)
            if ok:
                print(f"\n  {c('✔ Gateway restarted:', Colors.SUCCESS)} {self.client.base_url}\n")
            else:
                print(f"\n  {c('✖ Failed to restart gateway:', Colors.ERROR)} {msg}\n")
        else:
            print(f"  Usage: /gateway [status|start|stop|restart]\n")

    def _cmd_paste(self) -> None:
        print(c("\n  Entering Multi-Line Paste Mode.", Colors.BOLD + Colors.PRIMARY))
        print(c("  Paste your text below. Type '/end' on a new line or press Ctrl+D to execute:\n", Colors.MUTED))
        buffer = []
        while True:
            try:
                line = input(c("  │ ", Colors.MUTED))
                if line.strip() == "/end":
                    break
                buffer.append(line)
            except EOFError:
                break
            except KeyboardInterrupt:
                print(c("\n  Paste cancelled.\n", Colors.WARNING))
                return
        content = "\n".join(buffer).strip()
        if content:
            self.execute_goal(content)

    # -------------------------------------------------------------------------
    # Google Authentication Commands
    # -------------------------------------------------------------------------

    def _cmd_auth(self, args_str: str = "") -> None:
        """Inspect, manage, or initiate Google Authentication."""
        sub = args_str.strip().lower()
        if not sub or sub == "status":
            self._cmd_whoami()
            return
        if sub.startswith("login"):
            sub_args = args_str.strip()[5:].strip()
            self._cmd_login(sub_args)
            return
        if sub == "logout":
            self._cmd_logout()
            return
        if sub in ("whoami", "user", "info"):
            self._cmd_whoami()
            return
        print(f"  Usage: /auth [status|login|logout|whoami]\n")

    def _cmd_whoami(self) -> None:
        """Display the currently active Google user identity."""
        spinner = Spinner("Verifying Google session...").start()
        try:
            res = self.client.get_auth_session()
            spinner.stop()
        except Exception as exc:
            spinner.stop("Failed to verify session", success=False)
            print(f"  {c('Error:', Colors.ERROR)} {exc}\n")
            return

        if res.get("ok") and res.get("user"):
            render_auth_card(res["user"], self.client.session_token)
            print(f"  {c('Session active.', Colors.SUCCESS)} Type {c('/logout', Colors.PRIMARY)} to sign out.\n")
        else:
            print("\n" + divider(label="GOOGLE IDENTITY AUTHENTICATION") + "\n")
            print(f"  {c('Status:', Colors.MUTED)} {c('Unauthenticated (Guest Session)', Colors.WARNING)}")
            print(f"  {c('Options:', Colors.MUTED)}")
            print(f"    • {c('/login', Colors.BOLD + Colors.PRIMARY)}           : Interactive Google sign-in (OAuth or Instant Demo)")
            print(f"    • {c('/login --demo', Colors.BOLD + Colors.PRIMARY)}    : Instant Google Developer profile")
            print(f"    • {c('/login --browser', Colors.BOLD + Colors.PRIMARY)} : Launch Google OAuth in system browser\n")

    def _cmd_login(self, args_str: str = "") -> None:
        """Execute Google Authentication flow (Browser OAuth, Demo, or Token)."""
        arg = args_str.strip().lower()

        # Check if already authenticated
        if not arg:
            session = self.client.get_auth_session()
            if session.get("ok") and session.get("user"):
                u = session["user"]
                print(f"\n  {c('Currently signed in as:', Colors.MUTED)} {c(u.get('name', 'User'), Colors.BOLD + Colors.WHITE)} ({c(u.get('email', ''), Colors.PRIMARY)})")
                try:
                    reauth = input(f"  {c('Do you want to re-authenticate or switch accounts? [y/N]:', Colors.BOLD + Colors.WHITE)} ").strip().lower()
                except (EOFError, KeyboardInterrupt):
                    print()
                    return
                if reauth not in ("y", "yes"):
                    return

        # Direct flags
        if arg in ("--demo", "demo"):
            self._do_demo_login()
            return
        if arg in ("--browser", "browser"):
            self._do_browser_login()
            return

        # Interactive menu
        print("\n" + divider(label="SIGN IN WITH GOOGLE") + "\n")
        print(f"  {c('[1]', Colors.BOLD + Colors.PRIMARY)} Sign in via System Browser (Google OAuth 2.0 Web Flow)")
        print(f"  {c('[2]', Colors.BOLD + Colors.PRIMARY)} Instant Google Sign-In (Demo Profile)")
        print(f"  {c('[3]', Colors.BOLD + Colors.PRIMARY)} Enter Google OAuth2 ID Token manually")
        print(f"  {c('[q]', Colors.MUTED)} Cancel\n")

        try:
            choice = input(f"  {c('Select option [1-3, q]:', Colors.BOLD + Colors.WHITE)} ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return

        if choice == "1":
            self._do_browser_login()
        elif choice == "2":
            self._do_demo_login()
        elif choice == "3":
            self._do_token_login()
        elif choice in ("q", "quit", "cancel"):
            print(c("  Authentication cancelled.\n", Colors.MUTED))
        else:
            print(c("  Invalid choice.\n", Colors.ERROR))

    def _do_demo_login(self) -> None:
        spinner = Spinner("Connecting instant Google Developer session...").start()
        try:
            res = self.client.login_google_demo()
            spinner.stop("Google session initialized", success=True)
            if res.get("ok") and res.get("user"):
                render_auth_card(res["user"], res.get("sessionToken"))
                print(f"  {c('✔ Signed in as:', Colors.SUCCESS)} {c(res['user'].get('email', 'developer@edith.dev'), Colors.BOLD + Colors.PRIMARY)}\n")
            else:
                print(f"  {c('Login failed:', Colors.ERROR)} {res.get('error', 'Unknown error')}\n")
        except Exception as exc:
            spinner.stop("Instant sign-in failed", success=False)
            print(f"  {c('Error:', Colors.ERROR)} {exc}\n")

    def _do_token_login(self) -> None:
        try:
            tok = input(f"  {c('Paste Google ID Token:', Colors.BOLD + Colors.WHITE)} ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not tok:
            print(c("  No token provided.\n", Colors.MUTED))
            return

        spinner = Spinner("Verifying Google credential with Sovereign Gateway...").start()
        try:
            res = self.client.login_google_credential(tok)
            spinner.stop("Credential verified", success=True)
            if res.get("ok") and res.get("user"):
                render_auth_card(res["user"], res.get("sessionToken"))
                print(f"  {c('✔ Successfully authenticated as:', Colors.SUCCESS)} {c(res['user'].get('email', ''), Colors.BOLD + Colors.PRIMARY)}\n")
            else:
                print(f"  {c('Verification failed:', Colors.ERROR)} {res.get('error', 'Invalid token')}\n")
        except Exception as exc:
            spinner.stop("Verification failed", success=False)
            print(f"  {c('Error:', Colors.ERROR)} {exc}\n")

    def _do_browser_login(self) -> None:
        state = "edith_cli_" + secrets.token_hex(8)
        start_url = self.client.get_google_auth_url(state)

        print(f"\n  {c('Opening Google Sign-In in your default browser...', Colors.BOLD + Colors.PRIMARY)}")
        print(f"  {c('If the browser does not open automatically, visit this URL:', Colors.MUTED)}")
        print(f"  {c(start_url, Colors.UNDERLINE + Colors.SECONDARY)}\n")

        try:
            webbrowser.open(start_url)
        except Exception:
            pass

        spinner = Spinner("Waiting for Google authorization in browser (timeout: 120s)...").start()
        start_time = time.time()
        poll_interval = 1.0

        while time.time() - start_time < 120.0:
            try:
                res = self.client.poll_google_auth(state, timeout=poll_interval + 1.0)
                if res.get("ok") and res.get("sessionToken"):
                    user = res.get("user", {})
                    self.client.save_auth_session(res["sessionToken"], user)
                    spinner.stop("Google authentication completed", success=True)
                    render_auth_card(user, res["sessionToken"])
                    print(f"  {c('✔ Signed in as:', Colors.SUCCESS)} {c(user.get('email', 'Google User'), Colors.BOLD + Colors.PRIMARY)}\n")
                    return
            except Exception:
                pass
            time.sleep(poll_interval)

        spinner.stop("Google authorization timed out (120s)", success=False)
        print(c("  Authentication timed out. You can try again or use instant demo sign-in via /login --demo.\n", Colors.WARNING))

    def _cmd_logout(self) -> None:
        spinner = Spinner("Terminating Google session...").start()
        try:
            self.client.logout()
            spinner.stop("Google session terminated", success=True)
            print(f"\n  {c('✔ Logged out successfully.', Colors.SUCCESS)} Session credentials cleared.\n")
        except Exception as exc:
            spinner.stop("Logout error", success=False)
            print(f"  {c('Error:', Colors.ERROR)} {exc}\n")

    # -------------------------------------------------------------------------
    # Local LLM Models Commands
    # -------------------------------------------------------------------------

    def _cmd_local(self, args_str: str = "") -> None:
        """Inspect, probe, or switch to local loopback LLM models."""
        sub = args_str.strip()

        if sub == "scan" or sub == "probe":
            spinner = Spinner("Probing loopback endpoints (Ollama, LM Studio, vLLM)...").start()
            try:
                scans = self.client.scan_local_endpoints()
                spinner.stop()
                render_local_status(scans, self.active_model)
            except Exception as exc:
                spinner.stop("Probe failed", success=False)
                print(f"  {c('Error:', Colors.ERROR)} {exc}\n")
            return

        if sub.startswith("endpoint"):
            parts = sub.split(maxsplit=1)
            if len(parts) > 1:
                ep = parts[1].strip()
                set_local_endpoint(ep)
                print(f"\n  {c('✔ Local endpoint updated to:', Colors.SUCCESS)} {c(ep, Colors.BOLD + Colors.PRIMARY)}")
                print(c("  Probing new endpoint...", Colors.MUTED))
                scans = self.client.scan_local_endpoints()
                render_local_status(scans, self.active_model)
            else:
                settings = load_settings()
                print(f"\n  {c('Configured Local Endpoint:', Colors.MUTED)} {c(settings.get('local_endpoint', 'http://127.0.0.1:11434/v1'), Colors.BOLD + Colors.PRIMARY)}")
                print(f"  {c('Update with:', Colors.MUTED)} {c('/local endpoint <url>', Colors.PRIMARY)}\n")
            return

        if sub in ("off", "cloud", "reset"):
            default_m = "llama-3.2-3b-instruct"
            self.active_model = default_m
            set_setting("model", default_m)
            print(f"\n  {c('✔ Switched to Sovereign Core model:', Colors.SUCCESS)} {c(self.active_model, Colors.BOLD + Colors.PRIMARY)}\n")
            return

        # Check for available local models
        spinner = Spinner("Checking for available local models...").start()
        avail_locals = []
        try:
            avail_locals = self.client.get_available_local_models()
            spinner.stop()
        except Exception as exc:
            spinner.stop("Failed to query models", success=False)
            print(f"  {c('Error:', Colors.ERROR)} {exc}\n")
            return

        if not avail_locals:
            print(f"\n  {c('✖ No local model servers currently available.', Colors.WARNING)}")
            scans = self.client.scan_local_endpoints()
            render_local_status(scans, self.active_model)
            print(f"  {c('How to start a local model server:', Colors.BOLD + Colors.WHITE)}")
            print(f"    1. Ollama:    Run {c('ollama serve', Colors.PRIMARY)} then {c('ollama run qwen2.5:7b', Colors.PRIMARY)}")
            print(f"    2. LM Studio: Start Local Inference Server on port 1234")
            print(f"    3. vLLM:      Launch with {c('python -m vllm.entrypoints.openai.api_server', Colors.PRIMARY)}\n")
            print(f"  {c('To test connection:', Colors.MUTED)} Type {c('/local scan', Colors.PRIMARY)} or {c('/local endpoint <url>', Colors.PRIMARY)}\n")
            return

        # Target model matching
        chosen = None
        if sub:
            matched = [m for m in avail_locals if sub.lower() in m.lower()]
            if matched:
                chosen = matched[0]
            else:
                chosen = sub
        else:
            if len(avail_locals) == 1:
                chosen = avail_locals[0]
            else:
                print("\n" + divider(label="AVAILABLE LOCAL MODELS") + "\n")
                for i, lm in enumerate(avail_locals, 1):
                    is_cur = (lm == self.active_model)
                    marker = c("●", Colors.SUCCESS) if is_cur else " "
                    print(f"  [{i}] {marker} {c(lm, Colors.BOLD + Colors.WHITE)}")
                print()
                try:
                    c_idx = input(f"  {c('Select local model [1-' + str(len(avail_locals)) + ']:', Colors.BOLD + Colors.WHITE)} ").strip()
                    if c_idx.isdigit() and 1 <= int(c_idx) <= len(avail_locals):
                        chosen = avail_locals[int(c_idx) - 1]
                    else:
                        chosen = avail_locals[0]
                except (EOFError, KeyboardInterrupt):
                    print()
                    return

        self.active_model = chosen
        set_setting("model", chosen)
        print(f"\n  {c('✔ Active model switched to local model:', Colors.SUCCESS)} {c(self.active_model, Colors.BOLD + Colors.PRIMARY)}")
        print(f"  {c('Inference Mode:', Colors.MUTED)} {c('Numeric loopback HTTP · Air-gapped / Zero telemetry active.', Colors.SUCCESS)}\n")
