"""
End-to-end verification script for EDITH Sovereign Gateway:
Tests real queries (file edits and chat queries) through the live gateway.
"""

import subprocess
import time
import requests
import hashlib
from pathlib import Path

BASE_URL = "http://127.0.0.1:8766/api"
PROJECT_ROOT = Path("/home/lucifer/Projects/EDITH")

def main():
    print("--- 1. Checking Gateway Status ---")
    res = requests.get(f"{BASE_URL}/health")
    assert res.status_code == 200, f"Gateway health failed: {res.text}"
    health = res.json()
    print("Gateway Health:", health.get("status"), "Model:", health.get("agyModel"))

    print("\n--- 2. Testing Chat Query (No Edits Expected) ---")
    chat_req = {
        "objective": "Hello EDITH, can you introduce yourself and state your purpose?",
        "sourceIds": [],
        "kind": "coding"
    }
    chat_res = requests.post(f"{BASE_URL}/jobs", json=chat_req)
    assert chat_res.status_code == 202, f"Failed to start chat job: {chat_res.text}"
    chat_job_id = chat_res.json()["id"]
    print("Chat Job ID:", chat_job_id)

    # Poll until done
    for _ in range(120):
        time.sleep(1)
        j = requests.get(f"{BASE_URL}/jobs/{chat_job_id}").json()
        if j.get("status") in ("completed", "failed"):
            break
    print("Chat Job Final Status:", j.get("status"))
    assert j.get("status") == "completed", f"Chat job failed: {j}"
    assert j.get("proposal") is None, "Chat job should not have a file edit proposal"
    assert len(j.get("output", "")) > 10, "Chat output was empty"
    print("Chat Output Preview:", j.get("output", "")[:120].strip(), "...")

    print("\n--- 3. Testing Real Query with File Edit (Proposal & Commit Loop) ---")
    test_file_rel = "scripts/edith_query_test.txt"
    test_file_abs = PROJECT_ROOT / test_file_rel
    test_file_abs.write_text("INITIAL_STATE_123\n", encoding="utf-8")

    try:
        edit_req = {
            "objective": f"In {test_file_rel}, replace the content with 'EDITH_SOVEREIGN_SYSTEM_OPERATIONAL_2026'",
            "sourceIds": [test_file_rel],
            "kind": "coding"
        }
        edit_res = requests.post(f"{BASE_URL}/jobs", json=edit_req)
        assert edit_res.status_code == 202, f"Failed to start edit job: {edit_res.text}"
        edit_job_id = edit_res.json()["id"]
        print("Edit Job ID:", edit_job_id)

        # Poll until waiting_approval
        final_job = None
        for i in range(90):
            time.sleep(1)
            j = requests.get(f"{BASE_URL}/jobs/{edit_job_id}").json()
            status = j.get("status")
            events = j.get("events", [])
            last_event = events[-1]["label"] if events else "None"
            print(f"[{i+1}s] Status: {status} | Last Event: {last_event}")
            if status in ("waiting_approval", "completed", "failed"):
                final_job = j
                break

        assert final_job is not None, "Timed out waiting for edit job"
        print("Job Status:", final_job.get("status"))
        assert final_job.get("status") == "waiting_approval", f"Expected waiting_approval, got {final_job.get('status')}: {final_job}"
        
        proposal = final_job.get("proposal")
        assert proposal is not None, "Proposal is missing!"
        print("\n--- Proposal Received ---")
        print("Proposal ID:", proposal.get("id"))
        print("Action:", proposal.get("action"))
        print("Target File:", proposal.get("targetFile"))
        print("Summary:", proposal.get("summary"))
        print("SHA-256:", proposal.get("sha256"))
        print("Proposed Content:\n", proposal.get("content"))

        assert proposal.get("action") in ("modify_file", "create_file"), f"Unexpected action: {proposal.get('action')}"
        assert proposal.get("targetFile") == test_file_rel, f"Target file mismatch: {proposal.get('targetFile')}"
        assert "EDITH_SOVEREIGN_SYSTEM_OPERATIONAL_2026" in proposal.get("content"), "Expected content not found in proposal"

        # Verify cryptographic sha matches
        expected_sha = hashlib.sha256(proposal["content"].encode("utf-8")).hexdigest()
        assert proposal["sha256"] == expected_sha, f"SHA mismatch: {proposal['sha256']} != {expected_sha}"

        print("\n--- 4. Testing Two-Phase Commit Approval Gate ---")
        commit_res = requests.post(f"{BASE_URL}/vault/commit", json={
            "id": proposal["id"],
            "sha256": proposal["sha256"]
        })
        assert commit_res.status_code == 200, f"Commit failed: {commit_res.text}"
        receipt = commit_res.json()
        print("Commit Receipt:", receipt)
        assert receipt.get("status") == "written"

        # Verify on-disk mutation
        disk_content = test_file_abs.read_text(encoding="utf-8")
        assert "EDITH_SOVEREIGN_SYSTEM_OPERATIONAL_2026" in disk_content, f"File on disk not updated! Got: {disk_content}"
        print("✓ Disk file updated correctly!")

        # Verify job status transitioned to completed
        updated_job = requests.get(f"{BASE_URL}/jobs/{edit_job_id}").json()
        print("Job status after commit:", updated_job.get("status"))
        assert updated_job.get("status") == "completed", f"Job status after commit was {updated_job.get('status')}"

        # Verify audit trail
        audit_res = requests.get(f"{BASE_URL}/audit")
        audit_items = audit_res.json().get("audit", [])
        commits = [a for a in audit_items if a.get("action") == "workspace_file_commit"]
        assert len(commits) > 0, "No audit entry for commit!"
        print("✓ Audit ledger recorded commit:", commits[0].get("action"), commits[0].get("file"))

        print("\n==========================================")
        print("ALL REAL QUERY & EDIT TESTS PASSED 100%!")
        print("==========================================")
    finally:
        if test_file_abs.exists():
            test_file_abs.unlink()

if __name__ == "__main__":
    main()
