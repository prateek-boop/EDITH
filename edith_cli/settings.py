"""Persistent user configuration and settings for EDITH CLI."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

CONFIG_DIR = Path.home() / ".config" / "edith"
CONFIG_FILE = CONFIG_DIR / "settings.json"

DEFAULT_SETTINGS: dict[str, Any] = {
    "model": "llama-3.2-3b-instruct",
    "mode": "coding",            # coding | plan | auto
    "effort": "high",             # low | medium | high | max
    "auto_approve": False,
    "theme": "default",
    "gateway_host": "127.0.0.1",
    "gateway_port": 8766,
    "history_limit": 1000,
    "auth_token": None,
    "auth_user": None,
    "local_endpoint": "http://127.0.0.1:11434/v1",
    "prefer_local": False,
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


# -----------------------------------------------------------------------------
# Google Authentication Helpers
# -----------------------------------------------------------------------------

def get_auth_token() -> Optional[str]:
    """Get the currently persisted Google session token if any."""
    token = get_setting("auth_token")
    return str(token) if token else None


def get_auth_user() -> Optional[dict]:
    """Get the cached authenticated Google user profile."""
    user = get_setting("auth_user")
    return user if isinstance(user, dict) else None


def set_auth_session(token: str, user: dict) -> bool:
    """Persist active Google session token and user profile."""
    settings = load_settings()
    settings["auth_token"] = token
    settings["auth_user"] = user
    return save_settings(settings)


def clear_auth_session() -> bool:
    """Clear saved authentication session."""
    settings = load_settings()
    settings["auth_token"] = None
    settings["auth_user"] = None
    return save_settings(settings)


def is_authenticated() -> bool:
    """Check if a Google session token is saved."""
    return bool(get_auth_token())


# -----------------------------------------------------------------------------
# Local Models Configuration Helpers
# -----------------------------------------------------------------------------

def get_local_endpoint() -> str:
    """Get configured local LLM loopback endpoint."""
    return str(get_setting("local_endpoint", "http://127.0.0.1:11434/v1"))


def set_local_endpoint(endpoint: str) -> bool:
    """Set and persist local LLM loopback endpoint."""
    return set_setting("local_endpoint", endpoint.strip().rstrip("/"))
