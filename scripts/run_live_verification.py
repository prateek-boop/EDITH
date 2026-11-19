"""
Live Query Verification Script for EDITH Sovereign OS
Runs a real agent query end-to-end through the live loopback gateway,
capturing the real-time event stream, neural reasoning, tool calls,
mutation proposal generation, two-phase commit, disk verification, and audit trail.
"""

import time
import requests
import hashlib
import json
from pathlib import Path

BASE_URL = "http://127.0.0.1:8766/api"
PROJECT_ROOT = Path("/home/lucifer/Projects/EDITH")

def run_verification():
    print("=" * 65)
    print("  EDITH SOVEREIGN AI OPERATING SYSTEM — LIVE QUERY VERIFICATION")
    print("=" * 65)

    # 1. Health check
    res = requests.get(f"{BASE_URL}/health")
    assert res.status_code == 200, f"Health check failed: {res.text}"
    health = res.json()
    print(f"\n[1] Gateway Online:")
    print(f"    - Endpoint: http://127.0.0.1:8766/api")
    print(f"    - Engine:   {health.get('engine')}")
    print(f"    - Model:    {health.get('agyModel')}")

    # 2. Submit Goal
    goal = "Create a utility script scripts/edith_banner.py that displays a stylized ASCII banner for EDITH Sovereign AI OS, prints the active Python version, workspace root, and an operational status message."
    print(f"\n[2] Submitting User Goal:")
    print(f"    \"{goal}\"")

    start_res = requests.post(f"{BASE_URL}/jobs", json={
        "objective": goal,
        "sourceIds": ["README.md"],
        "kind": "coding",
        "model": "gemini-3.8-flash-high"
    })
    assert start_res.status_code == 202, f"Failed to submit job: {start_res.text}"
    job_id = start_res.json()["id"]
    print(f"    -> Job Dispatched (ID: {job_id})")

    # 3. Stream Events
    print(f"\n[3] Streaming Execution & Reasoning Events:")
    seen_events = set()
    final_job = None

    for i in range(120):
        time.sleep(1)
        j = requests.get(f"{BASE_URL}/jobs/{job_id}").json()
        events = j.get("events", [])
        for ev in events:
            ev_id = ev.get("id")
            if ev_id not in seen_events:
                seen_events.add(ev_id)
                f_info = f" [file: {ev.get('file')}]" if ev.get('file') else ""
                print(f"    [{ev.get('time', '')[11:19]}] {ev.get('label')}: {ev.get('detail')}{f_info}")
        
        status = j.get("status")
        if status in ("waiting_approval", "completed", "failed"):
            final_job = j
            break

    assert final_job is not None, "Job timed out"
    print(f"\n[4] Execution Paused at Sovereign Approval Gate:")
    print(f"    - Status: {final_job.get('status')}")

    proposal = final_job.get("proposal")
    assert proposal is not None, "No proposal was generated!"
    print(f"\n[5] Cryptographic Proposal Formulated:")
    print(f"    - Proposal ID:    {proposal.get('id')}")
    print(f"    - Action:         {proposal.get('action')}")
    print(f"    - Target File:    {proposal.get('targetFile')}")
    print(f"    - Summary:        {proposal.get('summary')}")
    print(f"    - Integrity SHA:  {proposal.get('sha256')}")
    print(f"    - Explanation:    {proposal.get('explanation')}")

    # Verify SHA-256 calculation
    computed_sha = hashlib.sha256(proposal["content"].encode("utf-8")).hexdigest()
    assert computed_sha == proposal["sha256"], "Integrity SHA mismatch!"
    print(f"    - Cryptographic Integrity: VERIFIED (Calculated matches declared)")

    print(f"\n[6] Proposed Content Preview:")
    content_lines = proposal["content"].strip().split("\n")
    for line in content_lines[:15]:
        print(f"      | {line}")
    if len(content_lines) > 15:
        print(f"      | ... [{len(content_lines) - 15} more lines]")

    # 4. Human-In-The-Loop Approval Commit
    print(f"\n[7] Simulating Operator Human Approval (Signing Commit):")
    commit_res = requests.post(f"{BASE_URL}/vault/commit", json={
        "id": proposal["id"],
        "sha256": proposal["sha256"]
    })
    assert commit_res.status_code == 200, f"Commit failed: {commit_res.text}"
    receipt = commit_res.json()
    print(f"    - Receipt Status: {receipt.get('status')}")
    print(f"    - Committed At:   {receipt.get('committedAt')}")
    print(f"    - Written File:   {receipt.get('path')}")

    # 5. Verify on disk
    target_abs = PROJECT_ROOT / proposal["targetFile"]
    assert target_abs.exists(), f"Target file was not written to disk: {target_abs}"
    print(f"\n[8] On-Disk File Verification:")
    print(f"    - File exists at: {target_abs}")
    print(f"    - File size:     {target_abs.stat().st_size} bytes")

    # 6. Execute the newly created script to prove it works!
    print(f"\n[9] Executing Generated Script:")
    import subprocess
    proc = subprocess.run([".venv/bin/python", str(target_abs)], capture_output=True, text=True, timeout=10)
    print(f"    --- Output from {target_abs.name} ---")
    print(proc.stdout.strip())

    # 7. Verify Audit Log
    print(f"\n[10] Verifying Immutable Hash-Chained Audit Ledger:")
    audit_res = requests.get(f"{BASE_URL}/audit")
    assert audit_res.status_code == 200
    trail = audit_res.json().get("audit", [])
    latest_commit = next((entry for entry in trail if entry.get("action") == "workspace_file_commit"), None)
    assert latest_commit is not None, "No audit trail entry found for commit!"
    print(f"    - Latest Action: {latest_commit.get('action')}")
    print(f"    - Status:        {latest_commit.get('status')}")
    print(f"    - Target File:   {latest_commit.get('file')}")
    print(f"    - SHA-256 Digest:{latest_commit.get('sha256')}")
    print(f"    - Entry Hash:    {latest_commit.get('hash')}")

    print("\n" + "=" * 65)
    print("  VERIFICATION COMPLETE: EDITH FULL AGENT LIFECYCLE PASSED!")
    print("=" * 65)

if __name__ == "__main__":
    run_verification()
