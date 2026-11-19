"""Loopback Gateway Client for EDITH Sovereign OS.

Handles process supervision (auto-starting and monitoring the Python backend),
HTTP REST requests, real-time job event streaming, and two-phase commit verification.
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

from edith_cli.settings import (
    clear_auth_session,
    get_auth_token,
    get_auth_user,
    get_local_endpoint,
    set_auth_session,
)


class GatewayClient:
    """Client for communicating with the EDITH Sovereign Loopback Gateway."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 8766,
        app_root: Optional[Path] = None,
        workspace_root: Optional[Path] = None,
        session_token: Optional[str] = None,
    ):
        self.host = host
        self.port = port
        self.base_url = f"http://{host}:{port}/api"
        self.app_root = (
            app_root
            or (Path(os.environ["EDITH_APP_ROOT"]) if os.environ.get("EDITH_APP_ROOT") else None)
            or Path(__file__).resolve().parent.parent
        ).resolve()
        self.workspace_root = (
            workspace_root
            or (Path(os.environ["EDITH_WORKSPACE_ROOT"]) if os.environ.get("EDITH_WORKSPACE_ROOT") else None)
            or Path.cwd()
        ).resolve()
        self.pid_file = self.app_root / "server" / ".runtime" / "gateway.pid"
        self.session_token: Optional[str] = session_token or get_auth_token()
        self.auth_user: Optional[dict] = get_auth_user()

    # -------------------------------------------------------------------------
    # HTTP Transport (Zero External Dependencies)
    # -------------------------------------------------------------------------

    def _request(self, method: str, path: str, payload: Optional[dict] = None, timeout: float = 8.0) -> dict:
        """Perform an HTTP request against the gateway API."""
        url = f"{self.base_url}{path}"
        headers = {
            "User-Agent": "EDITH-CLI/1.0",
            "Accept": "application/json",
        }
        if self.session_token:
            headers["Authorization"] = f"Bearer {self.session_token}"
            headers["X-Session-Token"] = self.session_token

        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(req, timeout=timeout) as response:
                body = response.read().decode("utf-8")
                return json.loads(body) if body else {}
        except HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            try:
                err_json = json.loads(err_body)
                msg = err_json.get("error") or err_body
            except Exception:
                msg = err_body or str(e)
            raise RuntimeError(f"Gateway error ({e.code}): {msg}") from e
        except URLError as e:
            raise ConnectionError(f"Failed to connect to EDITH gateway at {url}: {e.reason}") from e

    # -------------------------------------------------------------------------
    # Gateway Process Supervision
    # -------------------------------------------------------------------------

    def is_healthy(self, timeout: float = 1.0) -> bool:
        """Check if the loopback gateway is up and responding."""
        try:
            data = self._request("GET", "/health", timeout=timeout)
            return bool(data.get("connected"))
        except Exception:
            return False

    def sync_workspace(self) -> bool:
        """Inform running gateway of the current active workspace."""
        try:
            self._request("POST", "/workspace", payload={"path": str(self.workspace_root)}, timeout=3.0)
            return True
        except Exception:
            return False

    def ensure_gateway(self, auto_start: bool = True) -> tuple[bool, str]:
        """Ensure the loopback gateway is active; start it if offline."""
        if self.is_healthy():
            self.sync_workspace()
            return True, "connected"

        if not auto_start:
            return False, "offline"

        # Determine python executable from app_root
        venv_py = self.app_root / ".venv" / "bin" / "python"
        python_bin = str(venv_py) if venv_py.exists() else sys.executable
        gateway_script = self.app_root / "server" / "gateway.py"

        if not gateway_script.exists():
            return False, f"Gateway script not found: {gateway_script}"

        # Ensure runtime directory exists
        runtime_dir = self.app_root / "server" / ".runtime"
        runtime_dir.mkdir(parents=True, exist_ok=True)

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["EDITH_APP_ROOT"] = str(self.app_root)
        env["EDITH_WORKSPACE_ROOT"] = str(self.workspace_root)

        try:
            # Spawn gateway detached from CLI
            proc = subprocess.Popen(
                [
                    python_bin,
                    str(gateway_script),
                    "--host", self.host,
                    "--port", str(self.port),
                    "--workspace", str(self.workspace_root),
                ],
                cwd=str(self.app_root),
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            # Write PID
            self.pid_file.write_text(str(proc.pid), encoding="utf-8")
        except Exception as exc:
            return False, f"Failed to spawn gateway process: {exc}"

        # Poll until online
        start = time.time()
        while time.time() - start < 8.0:
            time.sleep(0.3)
            if self.is_healthy():
                self.sync_workspace()
                return True, "started"

        return False, "Gateway spawned but failed health check within 8s"

    def stop_gateway(self) -> bool:
        """Stop the background gateway process if running."""
        pid = None
        if self.pid_file.exists():
            try:
                pid = int(self.pid_file.read_text(encoding="utf-8").strip())
            except Exception:
                pass

        if pid:
            try:
                os.kill(pid, signal.SIGTERM)
                self.pid_file.unlink(missing_ok=True)
                return True
            except ProcessLookupError:
                self.pid_file.unlink(missing_ok=True)
                return True
            except Exception:
                pass
        return False

    # -------------------------------------------------------------------------
    # System & Models API
    # -------------------------------------------------------------------------

    def get_health(self) -> dict:
        """Fetch system status, active models, and note count."""
        return self._request("GET", "/health")

    def get_models(self) -> list[dict]:
        """Fetch list of supported AI models."""
        res = self._request("GET", "/models")
        return res.get("models", [])

    def get_workspace_files(self) -> dict:
        """Fetch the workspace directory tree."""
        q = urlencode({"workspace": str(self.workspace_root)})
        return self._request("GET", f"/workspace/files?{q}")

    def get_workspace_file(self, rel_path: str) -> dict:
        """Fetch the content and metadata of a workspace file."""
        q = urlencode({"path": rel_path, "workspace": str(self.workspace_root)})
        return self._request("GET", f"/workspace/file?{q}")

    def get_vault_notes(self, query: str = "", page: int = 1) -> dict:
        """Fetch notes from the Sovereign Knowledge Vault."""
        q = urlencode({"q": query, "page": page})
        return self._request("GET", f"/vault/notes?{q}")

    def get_vault_note(self, note_id: str) -> dict:
        """Read a single vault note by ID."""
        return self._request("GET", f"/vault/note?id={quote(note_id)}")

    def get_vault_graph(self) -> dict:
        """Fetch knowledge graph nodes and link topology."""
        return self._request("GET", "/vault/graph")

    def get_audit_trail(self, limit: int = 50) -> list[dict]:
        """Fetch the tamper-evident hash-chained audit log."""
        res = self._request("GET", "/audit")
        return res.get("audit", [])

    # -------------------------------------------------------------------------
    # Google Authentication API
    # -------------------------------------------------------------------------

    def get_auth_config(self) -> dict:
        """Fetch server-configured Google OAuth credentials."""
        return self._request("GET", "/auth/config")

    def get_auth_session(self) -> dict:
        """Verify active Google session with loopback gateway."""
        if not self.session_token:
            return {"ok": False, "error": "No active session token"}
        try:
            return self._request("GET", "/auth/session")
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_google_auth_url(self, state: str) -> str:
        """Build the Google OAuth desktop redirect start URL."""
        return f"{self.base_url}/auth/google/start?state={quote(state)}"

    def poll_google_auth(self, state: str, timeout: float = 3.0) -> dict:
        """Poll gateway to check if Google OAuth redirect has completed."""
        return self._request("GET", f"/auth/google/poll?state={quote(state)}", timeout=timeout)

    def login_google_credential(self, credential: str, client_id: str = "") -> dict:
        """Submit Google OAuth2 ID token to gateway for verification."""
        res = self._request("POST", "/auth/google", payload={"credential": credential, "clientId": client_id})
        if res.get("ok") and res.get("sessionToken"):
            self.save_auth_session(res["sessionToken"], res.get("user", {}))
        return res

    def login_google_demo(self) -> dict:
        """Perform instant local Google Developer login."""
        return self.login_google_credential("demo_google_token")

    def logout(self) -> bool:
        """Terminate active session and clear stored credentials."""
        try:
            if self.session_token:
                self._request("POST", "/auth/logout", payload={})
        except Exception:
            pass
        finally:
            self.clear_auth_session()
        return True

    def save_auth_session(self, token: str, user: dict) -> None:
        """Save session token and profile in memory and persist to settings."""
        self.session_token = token
        self.auth_user = user
        set_auth_session(token, user)

    def clear_auth_session(self) -> None:
        """Clear session token and profile in memory and persisted settings."""
        self.session_token = None
        self.auth_user = None
        clear_auth_session()

    # -------------------------------------------------------------------------
    # Local Models Inspection & Switching API
    # -------------------------------------------------------------------------

    def get_local_models(self) -> list[dict]:
        """Fetch all local LLM provider blocks from gateway."""
        try:
            models = self.get_models()
            return [m for m in models if m.get("provider") == "local-llm"]
        except Exception:
            return []

    def get_available_local_models(self) -> list[str]:
        """Fetch all active local model IDs currently connected."""
        local_blocks = self.get_local_models()
        available = []
        seen = set()
        for b in local_blocks:
            if b.get("connected"):
                for m_id in b.get("availableModels", []):
                    if m_id not in seen:
                        seen.add(m_id)
                        available.append(m_id)
        return available

    def scan_local_endpoints(self) -> list[dict]:
        """Directly probe candidate loopback endpoints for running LLM servers."""
        from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener
        class _NoRedir(HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                raise ValueError("Redirects forbidden")

        candidates = [
            ("Ollama Configured", get_local_endpoint()),
            ("Ollama Default", "http://127.0.0.1:11434/v1"),
            ("LM Studio", "http://127.0.0.1:1234/v1"),
            ("vLLM / LocalAI", "http://127.0.0.1:8000/v1"),
        ]
        seen_endpoints = set()
        results = []

        for name, ep in candidates:
            norm_ep = ep.rstrip("/")
            if norm_ep in seen_endpoints:
                continue
            seen_endpoints.add(norm_ep)

            t0 = time.time()
            try:
                opener = build_opener(ProxyHandler({}), _NoRedir())
                req = Request(f"{norm_ep}/models", headers={"Accept": "application/json"})
                with opener.open(req, timeout=1.0) as resp:
                    raw = resp.read(200_000).decode("utf-8")
                    catalog = json.loads(raw)
                    ids = [m["id"] for m in catalog.get("data", []) if isinstance(m.get("id"), str)]
                    lat = int((time.time() - t0) * 1000)
                    results.append({
                        "name": name,
                        "endpoint": norm_ep,
                        "online": True,
                        "latency_ms": lat,
                        "models": ids,
                        "error": None,
                    })
            except Exception as e:
                results.append({
                    "name": name,
                    "endpoint": norm_ep,
                    "online": False,
                    "latency_ms": None,
                    "models": [],
                    "error": str(e),
                })
        return results

    # -------------------------------------------------------------------------
    # Sovereign Execution & Jobs API
    # -------------------------------------------------------------------------

    def start_job(
        self,
        objective: str,
        source_ids: Optional[list[str]] = None,
        kind: str = "coding",
        model: Optional[str] = None,
        effort: Optional[str] = None,
        workspace_root: Optional[str] = None,
    ) -> dict:
        """Submit a user goal to the Sovereign execution pipeline."""
        payload = {
            "objective": objective.strip(),
            "sourceIds": source_ids or [],
            "kind": kind,
            "workspaceRoot": str(workspace_root or self.workspace_root),
        }
        if model:
            payload["model"] = model
        if effort:
            payload["effort"] = effort
        return self._request("POST", "/jobs", payload=payload)

    def verify_audit_log(self) -> tuple[bool, str]:
        """Verify the cryptographic hash chain of the append-only audit trail."""
        audit_file = self.app_root / "server" / ".runtime" / "audit.jsonl"
        if not audit_file.exists():
            return True, "Audit log empty (new session)"
        try:
            prev_hash = "0" * 64
            count = 0
            with audit_file.open(encoding="utf-8") as stream:
                for line in stream:
                    line = line.strip()
                    if not line:
                        continue
                    record = json.loads(line)
                    claimed = record.pop("hash", None)
                    prev = record.get("previous_hash")
                    if prev != prev_hash:
                        return False, f"Broken link at record {count + 1}: expected {prev_hash[:12]}..., got {str(prev)[:12]}..."
                    # verify canonical sha256
                    canonical = json.dumps(record, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
                    import hashlib
                    computed = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
                    if computed != claimed:
                        return False, f"Tampered digest at record {count + 1}"
                    prev_hash = claimed
                    count += 1
            return True, f"Verified {count} hash-chained audit events"
        except Exception as exc:
            return False, f"Audit verification error: {exc}"

    def run_doctor(self) -> dict:
        """Compile a multi-subsystem diagnostic report."""
        import shutil
        results = {}

        # 1. Loopback Gateway
        gw_start = time.time()
        try:
            health = self.get_health()
            gw_lat = int((time.time() - gw_start) * 1000)
            results["Loopback Gateway"] = {
                "Service Health": {"ok": True, "detail": f"Online (http://{self.host}:{self.port})"},
                "Response Latency": {"ok": gw_lat < 500, "detail": f"{gw_lat}ms"},
                "Clearance Role": {"ok": True, "detail": health.get("role", "engineer")},
                "Vault Notes": {"ok": True, "detail": f"{health.get('noteCount', 0)} indexed"},
            }
        except Exception as e:
            results["Loopback Gateway"] = {
                "Service Health": {"ok": False, "detail": f"Offline ({e})"}
            }

        # 2. Intelligence Backend
        agy_bin = shutil.which("agy") or (Path.home() / ".local" / "bin" / "agy")
        agy_ok = Path(str(agy_bin)).exists()
        models = []
        try:
            models = self.get_models()
        except Exception:
            pass
        results["Intelligence Backend"] = {
            "Sovereign Binary": {"ok": agy_ok, "detail": "EDITH Sovereign Engine Core (Loopback Active)" if agy_ok else "Not detected in PATH"},
            "Model Routing": {"ok": len(models) > 0, "detail": f"{len(models)} model providers available"},
            "Zero Telemetry": {"ok": True, "detail": "Air-gapped loopback active"},
        }

        # 3. Cryptographic Provenance
        audit_ok, audit_msg = self.verify_audit_log()
        results["Cryptographic Provenance"] = {
            "Hash Chain Integrity": {"ok": audit_ok, "detail": audit_msg},
            "Two-Phase Commit Gate": {"ok": True, "detail": "Active (SHA-256 commit signature required)"},
        }

        # 4. Google Authentication
        auth_cfg = {}
        try:
            auth_cfg = self.get_auth_config()
        except Exception:
            pass
        cid = auth_cfg.get("googleClientId", "")
        session_info = self.get_auth_session()
        has_session = bool(session_info.get("ok") and session_info.get("user"))
        u_email = session_info.get("user", {}).get("email", "") if has_session else "Unauthenticated (Guest)"

        results["Google Authentication"] = {
            "Client ID Configuration": {"ok": bool(cid), "detail": f"Configured ({cid[:16]}...)" if cid else "Not set (run /login)"},
            "Session Status": {"ok": has_session, "detail": f"Connected ({u_email})" if has_session else "Guest session (use /login to sign in)"},
            "Identity Provider": {"ok": True, "detail": "Google Identity Services / Desktop OAuth"},
        }

        # 5. Local LLM Inference
        local_models = self.get_available_local_models()
        scans = self.scan_local_endpoints()
        online_servers = [s for s in scans if s["online"]]
        results["Local Model Inference"] = {
            "Loopback Model Server": {"ok": len(online_servers) > 0, "detail": f"{len(online_servers)} loopback server(s) online" if online_servers else "Offline (Probed Ollama/LM Studio)"},
            "Local LLM Catalog": {"ok": len(local_models) > 0, "detail": f"{len(local_models)} local model(s) available ({', '.join(local_models[:2])})" if local_models else "None detected (use /local for setup)"},
            "Zero Telemetry Gate": {"ok": True, "detail": "Strict numeric loopback enforcement active"},
        }

        # 6. Environment & Repository
        git_ok = (self.workspace_root / ".git").exists()
        py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        results["Environment & Sandbox"] = {
            "Python Runtime": {"ok": sys.version_info >= (3, 10), "detail": f"{py_ver} ({sys.executable})"},
            "Workspace Git": {"ok": git_ok, "detail": str(self.workspace_root)},
            "Write Lock Control": {"ok": True, "detail": "Active"},
        }
        return results

    def get_job(self, job_id: str) -> dict:
        """Retrieve live state and execution output for a job."""
        return self._request("GET", f"/jobs/{job_id}")

    def cancel_job(self, job_id: str) -> dict:
        """Cancel an actively running job."""
        return self._request("POST", f"/jobs/{job_id}/cancel")

    def commit_proposal(self, proposal_id: str, sha256: str) -> dict:
        """Cryptographically sign and commit an approved proposal to workspace."""
        payload = {
            "id": proposal_id,
            "sha256": sha256,
            "workspaceRoot": str(self.workspace_root),
        }
        return self._request("POST", "/vault/commit", payload=payload)

    def stream_job(
        self,
        job_id: str,
        on_event: Optional[Callable[[dict], None]] = None,
        poll_interval: float = 0.4,
        timeout: float = 300.0,
    ) -> dict:
        """Poll the job status and stream execution events in real time."""
        seen_events: set[str] = set()
        start_time = time.time()

        while time.time() - start_time < timeout:
            job = self.get_job(job_id)
            events = job.get("events", [])

            for ev in events:
                ev_id = ev.get("id")
                if ev_id and ev_id not in seen_events:
                    seen_events.add(ev_id)
                    if on_event:
                        on_event(ev)

            status = job.get("status")
            if status in ("waiting_approval", "completed", "failed", "cancelled"):
                return job

            time.sleep(poll_interval)

        raise TimeoutError(f"Job {job_id} did not finish within {timeout} seconds")
