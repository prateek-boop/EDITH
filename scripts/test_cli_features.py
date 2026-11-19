"""
Verification test for EDITH CLI Google Authentication and Local Models switching.
"""
from __future__ import annotations

import http.server
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
EDITH_BIN = PROJECT_ROOT / "bin" / "edith"


class MockLocalLLMServer(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/models", "/v1/models"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            data = {"data": [{"id": "qwen2.5:7b"}, {"id": "llama3.2:3b"}]}
            self.wfile.write(json.dumps(data).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path in ("/chat/completions", "/v1/chat/completions"):
            size = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(size)) if size else {}
            req_model = body.get("model", "qwen2.5:7b")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            resp = {
                "model": req_model,
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": f"### Local Analysis Complete\nVerified by local model {req_model} on loopback.",
                    }
                }]
            }
            self.wfile.write(json.dumps(resp).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


def run_cli(*args: str) -> subprocess.CompletedProcess:
    cmd = [str(EDITH_BIN), "--plain"] + list(args)
    return subprocess.run(
        cmd,
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        timeout=30,
    )


def main():
    print("=================================================================")
    print("STEP 1: Testing Google Authentication in EDITH CLI")
    print("=================================================================")

    # 1.1 Ensure logout first
    res = run_cli("logout")
    print("Logout output:", res.stdout.strip())
    assert res.returncode == 0, f"Logout failed: {res.stderr}"

    # 1.2 Verify unauthenticated state
    res = run_cli("whoami")
    print("Whoami output (unauthenticated):\n", res.stdout.strip())
    assert "Unauthenticated" in res.stdout, "Expected unauthenticated status in whoami"

    # 1.3 Login with demo Google profile
    res = run_cli("login", "--demo")
    print("Login demo output:\n", res.stdout.strip())
    assert res.returncode == 0, f"Login failed: {res.stderr}"
    assert "developer@edith.dev" in res.stdout, "Expected developer@edith.dev in login output"

    # 1.4 Check whoami with active Google session
    res = run_cli("whoami")
    print("Whoami output (authenticated):\n", res.stdout.strip())
    assert "developer@edith.dev" in res.stdout, "Expected email in whoami"
    assert "Google Identity Services" in res.stdout, "Expected Google provider in whoami"

    # 1.5 Check status includes Google user
    res = run_cli("status")
    print("Status output:\n", res.stdout.strip())
    assert "developer@edith.dev" in res.stdout, "Expected email in status"

    # 1.6 Check doctor diagnostics include Google Authentication
    res = run_cli("doctor")
    assert "GOOGLE AUTHENTICATION" in res.stdout, "Expected GOOGLE AUTHENTICATION section in doctor"
    assert "developer@edith.dev" in res.stdout, "Expected session email in doctor"
    print("✔ Google Authentication diagnostics verified in edith doctor!")

    print("\n=================================================================")
    print("STEP 2: Testing Local Models Detection & Switching in EDITH CLI")
    print("=================================================================")

    # 2.1 Before starting mock local server: scan should report offline
    res = run_cli("local", "scan")
    print("Local scan (offline):\n", res.stdout.strip())
    assert "Offline" in res.stdout, "Expected offline status before starting server"

    # 2.2 Start Mock Local LLM server on 127.0.0.1:11434
    print("\n[Starting Mock Local LLM Server on 127.0.0.1:11434...]")
    httpd = http.server.HTTPServer(("127.0.0.1", 11434), MockLocalLLMServer)
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()

    try:
        # Restart gateway so it refreshes model cache
        run_cli("gateway", "restart")
        time.sleep(1)

        # 2.3 Local scan should now report online with models
        res = run_cli("local", "scan")
        print("Local scan (online):\n", res.stdout.strip())
        assert "Ollama" in res.stdout, "Expected Ollama in scan"
        assert "qwen2.5:7b" in res.stdout, "Expected qwen2.5:7b in scan"
        assert "llama3.2:3b" in res.stdout, "Expected llama3.2:3b in scan"
        print("✔ Local scan detected online local server and models!")

        # 2.4 edith models should list the local models under Local LLM Models
        res = run_cli("models")
        print("Models list:\n", res.stdout.strip())
        assert "Local LLM Models" in res.stdout, "Expected Local LLM Models section"
        assert "qwen2.5:7b" in res.stdout, "Expected qwen2.5:7b in models list"
        assert "llama3.2:3b" in res.stdout, "Expected llama3.2:3b in models list"
        print("✔ Local models displayed in edith models menu!")

        # 2.5 Switch to local model using edith local
        res = run_cli("local", "qwen2.5:7b")
        print("Local switch output:\n", res.stdout.strip())
        assert res.returncode == 0, f"Local switch failed: {res.stderr}"
        assert "qwen2.5:7b" in res.stdout, "Expected active model switched to qwen2.5:7b"
        print("✔ Switched active model to qwen2.5:7b via edith local!")

        # 2.6 Verify status reflects local model
        res = run_cli("status")
        print("Status output with local model:\n", res.stdout.strip())
        assert "qwen2.5:7b" in res.stdout, "Expected qwen2.5:7b in status"
        assert "[LOCAL]" in res.stdout, "Expected [LOCAL] badge in status"
        print("✔ Status confirms [LOCAL] engine active!")

        # 2.7 Execute single prompt with --local flag and auto-approve
        print("\nExecuting prompt with --local flag...")
        res = run_cli("-y", "--local", "Perform diagnostic check on local engine")
        print("Prompt execution output:\n", res.stdout.strip())
        assert res.returncode == 0, f"Execution failed: {res.stderr}"
        assert "Committed to workspace" in res.stdout or "Investigation" in res.stdout, "Expected proposal commit or result"
        print("✔ Non-interactive prompt executed successfully via local model!")

        # 2.8 Verify doctor shows Local Model Inference all healthy
        res = run_cli("doctor")
        assert "LOCAL MODEL INFERENCE" in res.stdout, "Expected LOCAL MODEL INFERENCE section in doctor"
        assert "1 loopback server(s) online" in res.stdout, "Expected online count in doctor"
        print("✔ Local Model Inference diagnostics verified in edith doctor!")

        # 2.9 Switch back to cloud / sovereign core
        res = run_cli("local", "off")
        print("Switch off output:\n", res.stdout.strip())
        assert "llama-3.2-3b-instruct" in res.stdout, "Expected switch back to llama-3.2-3b-instruct"
        print("✔ Switched back to Sovereign Core model!")

    finally:
        print("\n[Shutting down Mock Local LLM Server...]")
        httpd.shutdown()
        server_thread.join(timeout=2)
        # Restart gateway after shutdown
        run_cli("gateway", "restart")
        time.sleep(1)

    print("\n=================================================================")
    print("ALL TESTS PASSED SUCCESSFULLY! BOTH GOOGLE AUTH AND LOCAL MODELS")
    print("ARE FULLY INTEGRATED AND VERIFIED IN THE CLI VERSION OF EDITH.")
    print("=================================================================")


if __name__ == "__main__":
    main()
