#!/usr/bin/env python3
"""Test: Ask A.L.E.C. to edit its own code via the agent loop."""
import json, urllib.request, sys

msg = (
    "Use your self_edit tool to do these 3 steps:\n"
    "1. action=read_file path=frontend/index.html\n" 
    "2. action=edit_file path=frontend/index.html "
    "search=\"Hello, I'm A.L.E.C.\" "
    "replace=\"Hey, I'm A.L.E.C. — your autonomous AI\"\n"
    "3. action=commit_push message=\"self-edit: updated welcome heading\"\n"
)

data = json.dumps({
    "messages": [{"role": "user", "content": msg}],
    "max_tokens": 512,
}).encode()

req = urllib.request.Request(
    "http://localhost:8000/v1/chat/completions",
    data=data,
    headers={"Content-Type": "application/json"},
)

print("Sending self-edit request to agent... (may take 2-3 min)")
try:
    with urllib.request.urlopen(req, timeout=300) as resp:
        result = json.loads(resp.read())
        content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
        tools = result.get("tool_calls", [])
        latency = result.get("latency_ms", "?")
        print(f"\nTools used: {tools}")
        print(f"Latency: {latency}ms")
        print(f"\nResponse:\n{content[:600]}")
except Exception as e:
    print(f"Error: {e}")
