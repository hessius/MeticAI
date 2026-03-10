#!/usr/bin/env python3
"""Profile generation benchmark script.

Usage:
    python3 benchmark_profile_gen.py [--approach 3|4] [--prompt A|B] [--run 1|2]

Runs a single profile generation request and records the result.
"""
import argparse
import json
import time
import httpx
import os
import sys
from datetime import datetime

BASE_URL = os.environ.get("METICAI_URL", "http://localhost:3550")

PROMPT_A = (
    "Light roast Ethiopian Yirgacheffe, bright citrus and floral notes. "
    "18g dose, 93°C, 1:2.5 ratio. "
    "I want a profile that highlights the acidity and clarity."
)

PROMPT_B = (
    "Dark roast Brazilian Santos, chocolatey and nutty. "
    "20g dose, 95°C, 1:2 ratio. "
    "Create a medium-length extraction that balances sweetness and body."
)

PROMPTS = {"A": PROMPT_A, "B": PROMPT_B}

RESULTS_FILE = os.path.join(os.path.dirname(__file__), "BENCHMARK_RESULTS.md")


def run_benchmark(approach: int, prompt_key: str, run_num: int) -> dict:
    """Execute a single benchmark run."""
    prompt_text = PROMPTS[prompt_key]
    
    # Build form data
    data = {"user_prefs": prompt_text}
    
    if approach == 3:
        data["detailed_knowledge"] = "true"
        approach_name = "SDK + Full Knowledge"
    elif approach == 4:
        data["detailed_knowledge"] = "false"
        approach_name = "SDK + Distilled"
    else:
        print(f"Approach {approach} not yet implemented in this script")
        sys.exit(1)
    
    print(f"\n{'='*60}")
    print(f"Approach {approach}: {approach_name}")
    print(f"Prompt {prompt_key}, Run {run_num}")
    print(f"{'='*60}")
    print(f"Prompt: {prompt_text[:80]}...")
    print(f"Sending request to {BASE_URL}/api/analyze_and_profile ...")
    
    start = time.monotonic()
    
    with httpx.Client(timeout=300) as client:
        response = client.post(
            f"{BASE_URL}/api/analyze_and_profile",
            data=data,
        )
    
    elapsed = time.monotonic() - start
    
    result = {
        "approach": approach,
        "approach_name": approach_name,
        "prompt": prompt_key,
        "run": run_num,
        "time_seconds": round(elapsed, 1),
        "http_status": response.status_code,
        "timestamp": datetime.now().isoformat(),
    }
    
    if response.status_code == 200:
        try:
            body = response.json()
            reply = body.get("reply", "")
            profile_name = body.get("profile_name", "N/A")
            
            # Fallback: extract profile name from reply text
            if profile_name == "N/A" and reply:
                import re
                m = re.search(r'\*\*Profile Created[:\s]*\*\*\s*(.+)', reply)
                if m:
                    profile_name = m.group(1).strip().rstrip("*")
                else:
                    # Try extracting from JSON "name" field
                    m2 = re.search(r'"name"\s*:\s*"([^"]+)"', reply)
                    if m2:
                        profile_name = m2.group(1)
            
            result["response_chars"] = len(reply)
            result["profile_name"] = profile_name
            result["valid"] = True
            result["uploaded"] = (
                body.get("profile_id") is not None
                or body.get("status") == "success"
                or "Profile Created" in reply
            )
            result["notes"] = profile_name
            
            print(f"\n✅ SUCCESS in {elapsed:.1f}s")
            print(f"   Profile: {profile_name}")
            print(f"   Response length: {len(reply)} chars")
            print(f"   Uploaded: {result['uploaded']}")
        except Exception as e:
            result["valid"] = False
            result["uploaded"] = False
            result["notes"] = f"JSON parse error: {e}"
            result["response_chars"] = len(response.text)
            print(f"\n⚠️ Response parse error: {e}")
    elif response.status_code == 409:
        result["valid"] = False
        result["uploaded"] = False
        result["notes"] = "409 Busy — concurrent request"
        result["response_chars"] = len(response.text)
        print(f"\n⚠️ 409 Busy — another generation in progress")
    else:
        result["valid"] = False
        result["uploaded"] = False
        result["response_chars"] = len(response.text)
        try:
            err = response.json()
            result["notes"] = f"HTTP {response.status_code}: {err.get('detail', str(err)[:100])}"
        except Exception:
            result["notes"] = f"HTTP {response.status_code}: {response.text[:100]}"
        print(f"\n❌ FAILED: HTTP {response.status_code}")
        print(f"   {result['notes']}")
    
    # Get prompt char count from server logs if available
    # For now estimate from the form data
    result["prompt_chars"] = len(prompt_text)
    
    return result


def get_prompt_char_count_from_logs(approach: int) -> int:
    """Try to get the actual prompt character count from container logs."""
    try:
        import subprocess
        logs = subprocess.check_output(
            ["docker", "logs", "--tail", "20", "meticai"],
            stderr=subprocess.STDOUT, text=True, timeout=5
        )
        for line in reversed(logs.split("\n")):
            if "prompt_length" in line:
                # Extract prompt_length from JSON log
                try:
                    log_data = json.loads(line)
                    return log_data.get("prompt_length", 0)
                except (json.JSONDecodeError, KeyError):
                    pass
    except Exception:
        pass
    return 0


def format_table_row(r: dict) -> str:
    """Format a result dict as a markdown table row."""
    valid = "Y" if r.get("valid") else "N"
    uploaded = "Y" if r.get("uploaded") else "N"
    return (
        f"| {r['run']} | {r['prompt']} | {r['time_seconds']} | "
        f"{r.get('prompt_chars', '?')} | {r.get('response_chars', '?')} | "
        f"{valid} | {uploaded} | {r.get('notes', '')} |"
    )


def main():
    parser = argparse.ArgumentParser(description="Profile generation benchmark")
    parser.add_argument("--approach", type=int, required=True, choices=[3, 4])
    parser.add_argument("--prompt", type=str, required=True, choices=["A", "B"])
    parser.add_argument("--run", type=int, required=True, choices=[1, 2])
    args = parser.parse_args()
    
    result = run_benchmark(args.approach, args.prompt, args.run)
    
    # Try to get actual prompt length from logs
    actual_prompt_len = get_prompt_char_count_from_logs(args.approach)
    if actual_prompt_len:
        result["prompt_chars"] = actual_prompt_len
    
    # Print the table row
    print(f"\nTable row:")
    print(format_table_row(result))
    
    # Save result to a JSON lines file for aggregation
    results_jsonl = os.path.join(os.path.dirname(__file__), "benchmark_results.jsonl")
    with open(results_jsonl, "a") as f:
        f.write(json.dumps(result) + "\n")
    
    print(f"\nResult saved to {results_jsonl}")
    return result


if __name__ == "__main__":
    main()
