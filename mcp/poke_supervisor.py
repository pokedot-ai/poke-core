"""
Poke Supervisor ∞ — MCP server (reference implementation).

Any AI host (ChatGPT, Grok, Claude, any MCP-capable platform) connects to
this supervisor over MCP. The supervisor exposes six capability tools:

    playwright  hands, fingers, touch: full browser control
    web         fetch and read the web
    code_exec   execute code in an isolated working directory
    jobs        background jobs: start, track, stop
    sessions    save and restore named workspace sessions
    memory      persistent memory: write, read, search, forget

Run:
    pip install -r mcp/requirements.txt
    python mcp/poke_supervisor.py

State lives under ~/.poke/ by default (override with POKE_HOME).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from mcp.server.fastmcp import FastMCP

POKE_HOME = Path(os.environ.get("POKE_HOME", Path.home() / ".poke"))
POKE_HOME.mkdir(parents=True, exist_ok=True)
WORKDIR = POKE_HOME / "workdir"
WORKDIR.mkdir(exist_ok=True)

MEMORY_FILE = POKE_HOME / "memory.json"
SESSIONS_DIR = POKE_HOME / "sessions"
SESSIONS_DIR.mkdir(exist_ok=True)

HIGH_STAKE_ACTIONS = {"submit", "pay", "purchase", "send", "delete", "publish", "post"}
APPROVED_THIS_RUN: set[str] = set()  # high-stakes actions approved by the user

mcp = FastMCP("poke-supervisor")


# ---------------------------------------------------------------- helpers

def _load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _save_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def _requires_approval(action: str) -> bool:
    low = action.lower()
    return any(h in low for h in HIGH_STAKE_ACTIONS) and low not in APPROVED_THIS_RUN


# ---------------------------------------------------------------- playwright

_PW_LOCK = threading.Lock()
_PW_BROWSER = None
_PW_PAGE = None
_PW_PATH = Path(POKE_HOME / "playwright")
_PW_PATH.mkdir(exist_ok=True)


def _get_page():
    global _PW_BROWSER, _PW_PAGE
    if _PW_PAGE is None:
        from playwright.sync_api import sync_playwright
        pw = sync_playwright().start()
        _PW_BROWSER = pw.chromium.launch(headless=True)
        _PW_PAGE = _PW_BROWSER.new_page()
    return _PW_PAGE


@mcp.tool()
def playwright(action: str, url: str = "", selector: str = "", text: str = "",
               wait_ms: int = 0) -> str:
    """Hands, fingers, touch: full browser control.

    action: navigate | click | type | press | scroll | screenshot | read | content
    - navigate: url required
    - click: selector required
    - type: selector + text
    - press: selector + text (key name, e.g. Enter)
    - screenshot: saves to ~/.poke/playwright and returns the path
    - read: returns visible page text
    """
    if _requires_approval(action):
        return (f"HIGH-STAKES ACTION: '{action}' requires explicit user approval. "
                "Confirm with the user, then call again with action suffixed '_approved'.")
    action = action.replace("_approved", "")
    with _PW_LOCK:
        page = _get_page()
        if action == "navigate":
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
        elif action == "click":
            page.click(selector, timeout=15000)
        elif action == "type":
            page.fill(selector, text, timeout=15000)
        elif action == "press":
            page.press(selector, text, timeout=15000)
        elif action == "scroll":
            page.mouse.wheel(0, int(text or 800))
        elif action == "screenshot":
            p = _PW_PATH / f"{uuid.uuid4().hex[:8]}.png"
            page.screenshot(path=str(p))
            return f"screenshot saved: {p}"
        elif action in ("read", "content"):
            return page.inner_text("body")[:20000]
        else:
            return f"unknown action: {action}"
        if wait_ms:
            page.wait_for_timeout(int(wait_ms))
        return f"ok: {action} done"


# ---------------------------------------------------------------- web

@mcp.tool()
def web(url: str) -> str:
    """Fetch a URL and return the response body (text, JSON, or HTML)."""
    import httpx
    with httpx.Client(follow_redirects=True, timeout=30) as c:
        r = c.get(url)
    body = r.text
    if "html" in r.headers.get("content-type", ""):
        body = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", body, flags=re.S | re.I)
        body = re.sub(r"<[^>]+>", " ", body)
        body = re.sub(r"\s+", " ", body).strip()
    return f"status {r.status_code}\n{body[:20000]}"


# ---------------------------------------------------------------- code exec

@mcp.tool()
def code_exec(language: str, code: str, filename: str = "", timeout_s: int = 60) -> str:
    """Execute code in the supervisor's isolated working directory.

    language: python | bash | node | ps1 (powershell). filename: optional
    target filename; defaults to main with the language's extension.
    Returns stdout, stderr, and exit code.
    """
    ext = {"python": "py", "bash": "sh", "node": "js", "ps1": "ps1"}[language]
    fname = filename or f"main.{ext}"
    path = WORKDIR / fname
    path.write_text(code)
    cmds = {
        "python": [sys.executable, str(path)],
        "bash": ["bash", str(path)],
        "node": ["node", str(path)],
        "ps1": ["pwsh", "-NoProfile", "-File", str(path)],
    }
    try:
        r = subprocess.run(cmds[language], capture_output=True, text=True,
                           timeout=timeout_s, cwd=str(WORKDIR))
        out = (r.stdout or "") + (("\n[stderr]\n" + r.stderr) if r.stderr.strip() else "")
        return f"exit {r.returncode}\n{out[:20000]}"
    except subprocess.TimeoutExpired:
        return f"timeout after {timeout_s}s"
    except FileNotFoundError:
        return f"runtime for '{language}' not available on this system"


# ---------------------------------------------------------------- jobs

_JOBS = _load_json(POKE_HOME / "jobs.json", {})
_JOBS_LOCK = threading.Lock()


@mcp.tool()
def jobs(action: str, job_id: str = "", command: str = "", language: str = "bash",
         timeout_s: int = 600) -> str:
    """Background jobs: start | status | list | stop.

    start: command + language (bash/python/node), returns job_id
    status: job_id -> state and captured output so far
    stop: job_id -> terminate
    """
    with _JOBS_LOCK:
        if action == "start":
            jid = uuid.uuid4().hex[:10]
            _JOBS[jid] = {"state": "running", "command": command,
                          "started": time.time(), "output": ""}
            _save_json(POKE_HOME / "jobs.json", _JOBS)

            def _run(jid=jid):
                path = WORKDIR / f"job-{jid}.{ 'py' if language=='python' else 'sh' if language=='bash' else 'js'}"
                path.write_text(command)
                cmd = {"python": [sys.executable, str(path)], "bash": ["bash", str(path)],
                       "node": ["node", str(path)]}.get(language)
                if not cmd:
                    _JOBS[jid].update(state="failed", output="unknown language")
                    return
                try:
                    r = subprocess.run(cmd, capture_output=True, text=True,
                                       timeout=timeout_s, cwd=str(WORKDIR))
                    _JOBS[jid].update(state="done", exit=r.returncode,
                                      output=(r.stdout + r.stderr)[:20000])
                except subprocess.TimeoutExpired:
                    _JOBS[jid].update(state="timeout")
                finally:
                    _save_json(POKE_HOME / "jobs.json", _JOBS)

            threading.Thread(target=_run, daemon=True).start()
            return f"job started: {jid}"
        if action == "status" and job_id in _JOBS:
            return json.dumps(_JOBS[job_id])
        if action == "list":
            return json.dumps({k: {"state": v["state"], "command": v["command"]}
                               for k, v in _JOBS.items()})
        if action == "stop" and job_id in _JOBS:
            _JOBS[job_id]["state"] = "stopped"
            _save_json(POKE_HOME / "jobs.json", _JOBS)
            return f"job {job_id} marked stopped (process kill is host-specific)"
    return f"no job / unknown action: {action} {job_id}"


# ---------------------------------------------------------------- sessions

@mcp.tool()
def sessions(action: str, name: str = "", note: str = "") -> str:
    """Named workspace sessions: save | load | list | delete.

    save: snapshot of the working directory + a note
    load: restore the snapshot into the working directory
    """
    safe = re.sub(r"[^a-z0-9_-]", "", name.lower())[:60]
    if not safe:
        return "session name required"
    p = SESSIONS_DIR / f"{safe}.json"
    if action == "save":
        files = {}
        for f in WORKDIR.rglob("*"):
            if f.is_file() and f.stat().st_size < 200_000:
                files[str(f.relative_to(WORKDIR))] = f.read_text(errors="replace")
        _save_json(p, {"note": note, "time": time.time(), "files": files})
        return f"session saved: {safe} ({len(files)} files)"
    if action == "load":
        if not p.exists():
            return f"no session: {safe}"
        data = _load_json(p, {})
        for rel, content in data.get("files", {}).items():
            f = WORKDIR / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(content)
        return f"session loaded: {safe} ({len(data.get('files', {}))} files) — {data.get('note','')}"
    if action == "list":
        return "\n".join(f.name[:-5] for f in SESSIONS_DIR.glob("*.json")) or "no sessions"
    if action == "delete" and p.exists():
        p.unlink()
        return f"session deleted: {safe}"
    return f"unknown action: {action}"


# ---------------------------------------------------------------- memory

@mcp.tool()
def memory(action: str, key: str = "", value: str = "") -> str:
    """Persistent memory that survives sessions: write | read | search | forget | all."""
    data = _load_json(MEMORY_FILE, {})
    if action == "write" and key:
        data[key] = {"value": value, "time": time.time()}
        _save_json(MEMORY_FILE, data)
        return f"remembered: {key}"
    if action == "read":
        return data.get(key, {}).get("value", f"nothing remembered for: {key}")
    if action == "search":
        k = key.lower()
        hits = {kk: vv["value"] for kk, vv in data.items() if k in kk.lower() or k in vv["value"].lower()}
        return json.dumps(hits) if hits else f"no matches for: {key}"
    if action == "forget" and key in data:
        del data[key]
        _save_json(MEMORY_FILE, data)
        return f"forgot: {key}"
    if action == "all":
        return json.dumps({kk: vv["value"] for kk, vv in data.items()})
    return f"unknown action: {action}"


if __name__ == "__main__":
    print("Poke Supervisor ∞ — MCP server running (stdio)", file=sys.stderr)
    mcp.run()
