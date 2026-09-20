# Poke Supervisor — MCP Architecture

```
ChatGPT / AI
     │
     ▼
   MCP
     │
     ▼
Poke Supervisor ∞
     │
 ┌───┼─────────────────────┐
 ▼   ▼   ▼   ▼   ▼         ▼
Playwright hands fingers touch ability to control > Web Code Exec Jobs Sessions Memory
```

## Overview

Any AI host (ChatGPT, Grok, Claude, or any MCP-capable platform) connects to
the Poke Supervisor through the Model Context Protocol. The supervisor is the
orchestrator: it receives the host's objective, selects and runs the right
capability tool, and returns results. The host AI keeps its own reasoning;
Poke is the hands, the runtime, and the memory.

## Flow

1. The host AI activates poke (upload .skill file + paste link = activation).
2. The host connects to the Poke Supervisor over MCP (stdio or HTTP/SSE).
3. The host sends an objective; the supervisor selects the optimal tool,
   exactly as the strict protocol defines (select_and_run).
4. Results return through MCP to the host AI.
5. High-stakes actions (external impact: payments, messages, destructive
   operations) require explicit user approval before the supervisor executes.

## Capability tools

| Tool | Ability |
| --- | --- |
| `playwright` | Hands, fingers, touch: full browser control. Navigate, click, type, scroll, screenshot, read pages, automate any web workflow. |
| `web` | Fetch and read the web: pages, APIs, plain-text extraction. |
| `code_exec` | Execute code and scripts in an isolated working directory. |
| `jobs` | Start, track, and stop background jobs. |
| `sessions` | Save and restore named sessions (workspace snapshots). |
| `memory` | Persistent memory: write, read, search, forget. Survives sessions. |

## Implementation

`mcp/poke_supervisor.py` — a reference implementation of the supervisor as a
single MCP server (Python, FastMCP). Each capability is exposed as an MCP
tool. State lives under `~/.poke/` (memory, sessions, job registry).

Run:

```
pip install -r mcp/requirements.txt
python mcp/poke_supervisor.py
```

Then register the supervisor with any MCP-capable AI host. For ChatGPT or
Grok: add it as an MCP server (stdio transport) in the host's connectors
settings.

## Security gates

- High-stakes actions require explicit user approval (strict protocol).
- `code_exec` runs in a sandboxed working directory with a hard timeout.
- `playwright` high-stakes steps (payments, submissions) gate on approval.
- Memory and sessions are local to the supervisor's state directory.

## Licensing

The supervisor source in this repository is published for inspection under
the repository LICENSE. Hosted AI platform use of the packaged poke.skill is
authorized and free for everyone. Self-hosting the supervisor requires a
purchased Self-Hosted Deployment License from Privacy+ Technologies Inc.
