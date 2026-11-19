"""Terminal UI rendering, ANSI styling, ASCII banners, diff formatting, and Markdown display."""
from __future__ import annotations

import difflib
import itertools
import os
import re
import shutil
import sys
import threading
import time
from typing import Optional


class Colors:
    """ANSI terminal styling and color palette."""
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    ITALIC = "\033[3m"
    UNDERLINE = "\033[4m"
    INVERT = "\033[7m"

    # Standard colors
    BLACK = "\033[30m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"
    WHITE = "\033[37m"

    # Bright colors
    BRIGHT_BLACK = "\033[90m"  # Gray
    BRIGHT_RED = "\033[91m"
    BRIGHT_GREEN = "\033[92m"
    BRIGHT_YELLOW = "\033[93m"  # Amber
    BRIGHT_BLUE = "\033[94m"
    BRIGHT_MAGENTA = "\033[95m"
    BRIGHT_CYAN = "\033[96m"
    BRIGHT_WHITE = "\033[97m"

    # Semantic aliases
    PRIMARY = "\033[96m"      # Bright Cyan
    SECONDARY = "\033[94m"    # Bright Blue
    SUCCESS = "\033[92m"      # Bright Green
    WARNING = "\033[93m"      # Amber
    ERROR = "\033[91m"        # Bright Red
    MUTED = "\033[90m"        # Gray
    HEADER = "\033[1;96m"     # Bold Cyan
    ACCENT = "\033[1;95m"     # Bold Magenta

    _enabled = True

    @classmethod
    def set_enabled(cls, enabled: bool) -> None:
        cls._enabled = enabled

    @classmethod
    def is_enabled(cls) -> bool:
        if not cls._enabled or "NO_COLOR" in os.environ or os.environ.get("TERM") == "dumb":
            return False
        return sys.stdout.isatty()


def c(text: str, color_code: str) -> str:
    """Wrap text in an ANSI color code if colors are enabled."""
    if not Colors.is_enabled():
        return text
    return f"{color_code}{text}{Colors.RESET}"


def term_width(fallback: int = 80) -> int:
    """Return the current terminal column width."""
    try:
        return shutil.get_terminal_size((fallback, 24)).columns
    except Exception:
        return fallback


def divider(char: str = "─", color: str = Colors.MUTED, label: Optional[str] = None) -> str:
    """Render a horizontal divider line across the terminal."""
    w = max(40, min(120, term_width()))
    if not label:
        return c(char * w, color)
    padded = f" {label} "
    line_len = (w - len(padded)) // 2
    left = char * max(2, line_len)
    right = char * max(2, w - len(padded) - len(left))
    return f"{c(left, color)}{c(padded, Colors.BOLD + Colors.PRIMARY)}{c(right, color)}"


def get_banner(version: str = "1.0.0", model: str = "gemini-3.8-flash-high", status: str = "ONLINE", mode: str = "coding", effort: str = "high", workspace: Optional[str] = None) -> str:
    """Generate the signature EDITH ASCII banner."""
    ascii_rows = [
        r"  ███████╗ ██████╗  ██╗ ████████╗ ██╗  ██╗",
        r"  ██╔════╝ ██╔══██╗ ██║ ╚══██╔══╝ ██║  ██║",
        r"  █████╗   ██║  ██║ ██║    ██║    ███████║",
        r"  ██╔══╝   ██║  ██║ ██║    ██║    ██╔══██║",
        r"  ███████╗ ██████╔╝ ██║    ██║    ██║  ██║",
        r"  ╚══════╝ ╚═════╝  ╚═╝    ╚═╝    ╚═╝  ╚═╝",
    ]

    w = max(50, min(80, term_width()))
    line_border = c("═" * w, Colors.PRIMARY)

    mode_display = c(mode.upper(), Colors.BOLD + (Colors.WARNING if mode == "auto" else (Colors.SECONDARY if mode == "plan" else Colors.SUCCESS)))

    banner_lines = [
        line_border,
        *[c(row, Colors.BOLD + Colors.PRIMARY) for row in ascii_rows],
        c("        S O V E R E I G N   A I   O P E R A T I N G   S Y S T E M", Colors.BOLD + Colors.SECONDARY),
        line_border,
        f" {c('Core Version:', Colors.MUTED)} {c(f'v{version}', Colors.BOLD + Colors.WHITE)}  "
        f"{c('• Model:', Colors.MUTED)} {c(model, Colors.BOLD + Colors.PRIMARY)}  "
        f"{c('• Mode:', Colors.MUTED)} {mode_display}  "
        f"{c('• Effort:', Colors.MUTED)} {c(effort, Colors.BOLD + Colors.WHITE)}",
        f" {c('Status:', Colors.MUTED)} {c(status, Colors.BOLD + Colors.SUCCESS)}  "
        f"{c('• Telemetry:', Colors.MUTED)} {c('Zero / Air-Gapped Loopback', Colors.MUTED)}",
    ]
    if workspace:
        banner_lines.append(f" {c('Workspace:', Colors.MUTED)} {c(workspace, Colors.BOLD + Colors.WHITE)}")
    banner_lines.append(c("─" * w, Colors.MUTED))
    return "\n".join(banner_lines)


def format_prompt(active_model: str, mode: str = "coding") -> str:
    """Format the dynamic CLI input prompt with active model and mode."""
    mode_color = Colors.WARNING if mode == "auto" else (Colors.SECONDARY if mode == "plan" else Colors.PRIMARY)
    mode_tag = f" · {mode}" if mode != "coding" else ""
    return (
        f"{c('edith', Colors.BOLD + Colors.PRIMARY)} "
        f"{c('[', Colors.MUTED)}"
        f"{c(active_model, Colors.DIM)}"
        f"{c(mode_tag, mode_color)}"
        f"{c(']', Colors.MUTED)} "
        f"{c('❯', Colors.BOLD + Colors.SECONDARY)} "
    )


def render_model_menu(models: list[dict], active_model: str) -> list[str]:
    """Display an interactive numbered model selector and return ordered model IDs."""
    print("\n" + divider(label="SELECT INTELLIGENCE MODEL") + "\n")
    print(c("  Enter a number to switch model, or press Enter to keep current:\n", Colors.MUTED))

    ordered_ids: list[str] = []
    seen = set()

    idx = 1
    for m in models:
        for d in m.get("modelDetails", []):
            mid = d.get("id")
            if not mid or mid in seen:
                continue
            seen.add(mid)
            ordered_ids.append(mid)

            is_active = (mid == active_model)
            marker = c("●", Colors.SUCCESS) if is_active else " "
            name = d.get("name") or mid
            role = d.get("role", "general")
            role_badge = f"[{role}]"

            num_str = c(f"[{idx}]", Colors.BOLD + Colors.PRIMARY if not is_active else Colors.BOLD + Colors.SUCCESS)
            active_label = c("(Active)", Colors.BOLD + Colors.SUCCESS) if is_active else ""

            print(f"  {num_str} {marker} {c(mid.ljust(26), Colors.BOLD + Colors.WHITE)} {c(role_badge.ljust(12), Colors.MUTED)} {c(name, Colors.DIM)} {active_label}")
            idx += 1

    print()
    return ordered_ids


def render_doctor_report(diagnostics: dict) -> None:
    """Render comprehensive Sovereign OS health diagnostics report."""
    print("\n" + divider(label="SOVEREIGN OS DOCTOR DIAGNOSTICS") + "\n")

    for cat_name, items in diagnostics.items():
        print(f"  {c(cat_name.upper(), Colors.BOLD + Colors.PRIMARY)}")
        for label, val in items.items():
            ok = val.get("ok", True) if isinstance(val, dict) else bool(val)
            icon = c("✔", Colors.SUCCESS) if ok else c("✖", Colors.ERROR)
            detail = val.get("detail", str(val)) if isinstance(val, dict) else str(val)
            print(f"    {icon} {c(label.ljust(24), Colors.WHITE)} {c(detail, Colors.DIM if ok else Colors.ERROR)}")
        print()


def render_shell_output(cmd: str, stdout: str, stderr: str, returncode: int) -> None:
    """Render the output of a local shell escape command."""
    status_icon = c("✔", Colors.SUCCESS) if returncode == 0 else c("✖", Colors.ERROR)
    print(f"\n  {status_icon} {c('Shell Exec:', Colors.MUTED)} {c(cmd, Colors.BOLD + Colors.PRIMARY)} {c(f'[exit {returncode}]', Colors.MUTED)}\n")
    if stdout:
        for line in stdout.rstrip().split("\n"):
            print(f"  {c('│', Colors.MUTED)} {line}")
    if stderr:
        for line in stderr.rstrip().split("\n"):
            print(f"  {c('│', Colors.ERROR)} {c(line, Colors.BRIGHT_RED)}")
    print()


class Spinner:
    """Animated terminal spinner for background execution phases."""
    FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

    def __init__(self, message: str = "Processing goal..."):
        self.message = message
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

    def update(self, message: str) -> None:
        with self._lock:
            self.message = message

    def start(self) -> Spinner:
        if not sys.stdout.isatty():
            sys.stdout.write(f"[*] {self.message}\n")
            sys.stdout.flush()
            return self
        self._running = True
        self._thread = threading.Thread(target=self._spin, daemon=True)
        self._thread.start()
        return self

    def _spin(self) -> None:
        cycle = itertools.cycle(self.FRAMES)
        while self._running:
            frame = next(cycle)
            with self._lock:
                msg = self.message
            sys.stdout.write(f"\r  {c(frame, Colors.BOLD + Colors.PRIMARY)} {c(msg, Colors.DIM)}   \b\b\b")
            sys.stdout.flush()
            time.sleep(0.08)

    def stop(self, final_message: Optional[str] = None, success: bool = True) -> None:
        if not self._running:
            return
        self._running = False
        if self._thread:
            self._thread.join(timeout=0.3)
        if sys.stdout.isatty():
            sys.stdout.write("\r\033[K")  # Clear current line
            sys.stdout.flush()
        if final_message:
            icon = c("✔", Colors.SUCCESS) if success else c("✖", Colors.ERROR)
            print(f"  {icon} {final_message}")


def render_markdown(text: str) -> str:
    """Lightweight ANSI markdown renderer for terminal display."""
    if not Colors.is_enabled():
        return text

    lines = text.split("\n")
    formatted: list[str] = []
    in_code_block = False
    code_lang = ""

    for line in lines:
        stripped = line.strip()

        # Fenced code block toggling
        if stripped.startswith("```"):
            if not in_code_block:
                in_code_block = True
                code_lang = stripped[3:].strip()
                tag = f" [{code_lang}]" if code_lang else ""
                formatted.append(c(f"  ┌── Code Block{tag} " + "─" * max(10, term_width() - 25 - len(tag)), Colors.MUTED))
            else:
                in_code_block = False
                formatted.append(c("  └──" + "─" * max(10, term_width() - 15), Colors.MUTED))
            continue

        if in_code_block:
            formatted.append(f"  {c('│', Colors.MUTED)} {c(line, Colors.BRIGHT_WHITE)}")
            continue

        # Headers
        if line.startswith("# "):
            formatted.append("\n" + c(line[2:].upper(), Colors.BOLD + Colors.BRIGHT_CYAN))
            formatted.append(c("═" * min(term_width() - 4, len(line[2:]) + 4), Colors.PRIMARY))
            continue
        elif line.startswith("## "):
            formatted.append("\n" + c(line[3:], Colors.BOLD + Colors.PRIMARY))
            formatted.append(c("─" * min(term_width() - 4, len(line[3:]) + 4), Colors.MUTED))
            continue
        elif line.startswith("### "):
            formatted.append("\n" + c(line[4:], Colors.BOLD + Colors.SECONDARY))
            continue
        elif line.startswith("#### "):
            formatted.append(c(line[5:], Colors.BOLD + Colors.WHITE))
            continue

        # Blockquotes
        if line.startswith("> "):
            formatted.append(f"  {c('▌', Colors.SECONDARY)} {c(line[2:], Colors.DIM)}")
            continue

        # Bullet lists
        if re.match(r"^(\s*)[-*+]\s+", line):
            m = re.match(r"^(\s*)[-*+]\s+(.*)$", line)
            if m:
                indent, content = m.groups()
                content = _inline_format(content)
                formatted.append(f"{indent}  {c('•', Colors.PRIMARY)} {content}")
                continue

        # Numbered lists
        if re.match(r"^(\s*)\d+\.\s+", line):
            m = re.match(r"^(\s*)(\d+\.)\s+(.*)$", line)
            if m:
                indent, num, content = m.groups()
                content = _inline_format(content)
                formatted.append(f"{indent}  {c(num, Colors.SECONDARY)} {content}")
                continue

        # Divider
        if stripped in ("---", "***", "___"):
            formatted.append(c("─" * min(term_width(), 70), Colors.MUTED))
            continue

        formatted.append(_inline_format(line))

    return "\n".join(formatted)


def _inline_format(text: str) -> str:
    """Format inline markdown elements: bold, italic, code spans."""
    # Inline code: `code`
    text = re.sub(r"`([^`]+)`", lambda m: c(f" {m.group(1)} ", Colors.INVERT + Colors.BRIGHT_CYAN), text)
    # Bold: **bold**
    text = re.sub(r"\*\*([^*]+)\*\*", lambda m: c(m.group(1), Colors.BOLD + Colors.WHITE), text)
    # Italic: *italic*
    text = re.sub(r"\*([^*]+)\*", lambda m: c(m.group(1), Colors.ITALIC), text)
    return text


def render_diff(old_content: str, new_content: str, filename: str, max_lines: int = 80) -> str:
    """Render a unified color diff with line numbers and syntax styling."""
    old_lines = old_content.splitlines(keepends=True)
    new_lines = new_content.splitlines(keepends=True)

    diff = list(difflib.unified_diff(
        old_lines,
        new_lines,
        fromfile=f"a/{filename}",
        tofile=f"b/{filename}",
        n=3
    ))

    if not diff:
        return c("  (No textual differences detected)", Colors.MUTED)

    w = max(40, min(100, term_width()))
    header = [
        c("┌── Unified Diff ────────────────────────────────────────────────────────", Colors.MUTED),
        f"{c('│ Target:', Colors.MUTED)} {c(filename, Colors.BOLD + Colors.PRIMARY)}",
        c("├──", Colors.MUTED)
    ]

    out_lines = list(header)
    count = 0
    truncated = False

    for line in diff:
        count += 1
        if count > max_lines:
            truncated = True
            break

        line_clean = line.rstrip("\n")
        if line.startswith("---") or line.startswith("+++"):
            out_lines.append(f"{c('│', Colors.MUTED)} {c(line_clean, Colors.BOLD + Colors.WHITE)}")
        elif line.startswith("@@"):
            out_lines.append(f"{c('│', Colors.MUTED)} {c(line_clean, Colors.BOLD + Colors.CYAN)}")
        elif line.startswith("+"):
            out_lines.append(f"{c('│', Colors.MUTED)} {c(line_clean, Colors.BRIGHT_GREEN)}")
        elif line.startswith("-"):
            out_lines.append(f"{c('│', Colors.MUTED)} {c(line_clean, Colors.BRIGHT_RED)}")
        else:
            out_lines.append(f"{c('│', Colors.MUTED)} {c(line_clean, Colors.MUTED)}")

    if truncated:
        remaining = len(diff) - max_lines
        out_lines.append(f"{c('│', Colors.MUTED)} {c(f'... [{remaining} more diff lines omitted. Press (d) in prompt to toggle]', Colors.WARNING)}")

    out_lines.append(c("└──" + "─" * (w - 3), Colors.MUTED))
    return "\n".join(out_lines)


def render_approval_card(proposal: dict) -> str:
    """Render the Sovereign Approval Gate cryptographic proposal card."""
    w = max(50, min(90, term_width()))
    border = "─" * (w - 2)

    action = str(proposal.get("action", "unknown")).upper()
    target = str(proposal.get("targetFile") or proposal.get("path") or "Workspace Note")
    summary = str(proposal.get("summary") or "Controlled Workspace Modification")
    sha256 = str(proposal.get("sha256", ""))
    short_sha = f"{sha256[:16]}...{sha256[-8:]}" if len(sha256) > 24 else sha256
    explanation = str(proposal.get("explanation") or "Controlled modification awaiting human commit signature")

    card = [
        c(f"╭── 🛡️  SOVEREIGN APPROVAL GATE {border[26:]}╮", Colors.PRIMARY),
        f"{c('│ Action:     ', Colors.MUTED)} {c(action, Colors.BOLD + Colors.WARNING)}",
        f"{c('│ Target:     ', Colors.MUTED)} {c(target, Colors.BOLD + Colors.PRIMARY)}",
        f"{c('│ Summary:    ', Colors.MUTED)} {c(summary, Colors.BOLD + Colors.WHITE)}",
        f"{c('│ SHA-256:    ', Colors.MUTED)} {c(short_sha, Colors.SUCCESS)} {c('(Tamper-Proof Digest)', Colors.MUTED)}",
        f"{c('│ Explanation:', Colors.MUTED)} {c(explanation, Colors.DIM)}",
        c(f"╰{border}╯", Colors.PRIMARY),
    ]
    return "\n".join(card)


def render_event(label: str, detail: str, timestamp: Optional[str] = None, file: Optional[str] = None) -> None:
    """Print a styled real-time agent execution event."""
    ts_str = f"[{timestamp[11:19]}] " if timestamp and len(timestamp) >= 19 else ""
    icon = "●"
    color = Colors.PRIMARY

    if "accept" in label.lower() or "connect" in label.lower():
        icon = "●"
        color = Colors.PRIMARY
    elif "scan" in label.lower() or "context" in label.lower():
        icon = "◆"
        color = Colors.SECONDARY
    elif "reason" in label.lower():
        icon = "▲"
        color = Colors.ACCENT
    elif "tool" in label.lower():
        icon = "■"
        color = Colors.WARNING
    elif "approval" in label.lower() or "gate" in label.lower():
        icon = "⚡"
        color = Colors.WARNING
    elif "commit" in label.lower() or "approved" in label.lower():
        icon = "✔"
        color = Colors.SUCCESS
    elif "error" in label.lower() or "cancel" in label.lower():
        icon = "✖"
        color = Colors.ERROR

    file_tag = f" {c(f'[{file}]', Colors.MUTED)}" if file else ""
    print(f"  {c(icon, color)} {c(ts_str, Colors.MUTED)}{c(label, Colors.BOLD + Colors.WHITE)}: {c(detail, Colors.DIM)}{file_tag}")
