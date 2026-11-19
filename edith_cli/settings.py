"""Persistent user configuration and settings for EDITH CLI."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

CONFIG_DIR = Path.home() / ".config" / "edith"
CONFIG_FILE = CONFIG_DIR / "settings.json"

DEFAULT_SETTINGS: dict[str, Any] = {
    "model": "gemini-3.8-flash-high",
    "mode": "coding",            # coding | plan | auto
    "effort": "high",             # low | medium | high | max
    "auto_approve": False,
    "theme": "default",
    "gateway_host": "127.0.0.1",
    "gateway_port": 8766,
    "history_limit": 1000,
}


def load_settings() -> dict[str, Any]:
    """Load settings from ~/.config/edith/settings.json with fallbacks."""
    settings = dict(DEFAULT_SETTINGS)
    if CONFIG_FILE.exists():
        try:
            stored = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            if isinstance(stored, dict):
                settings.update(stored)
        except Exception:
            pass
    return settings


def save_settings(settings: dict[str, Any]) -> bool:
    """Save settings dictionary to ~/.config/edith/settings.json."""
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(settings, indent=2), encoding="utf-8")
        return True
    except Exception:
        return False


def get_setting(key: str, default: Any = None) -> Any:
    """Retrieve a single configuration setting."""
    settings = load_settings()
    return settings.get(key, default)


def set_setting(key: str, value: Any) -> bool:
    """Update and persist a single configuration setting."""
    settings = load_settings()
    settings[key] = value
    return save_settings(settings)
