# Connecting to the Poke Supervisor (MCP)

GitHub is the only home for poke-core. Nothing here depends on any single
platform: the supervisor and the hosted gateway run wherever you run them,
and this repository is the source of truth for every deployment.

## Option 1 — Self-hosted supervisor, local (stdio)

Run the supervisor on your machine:

```
pip install -r mcp/requirements.txt
python mcp/poke_supervisor.py
```

Register it with an MCP-capable host (stdio transport):

```json
{
  "mcpServers": {
    "poke": {
      "command": "python",
      "args": ["mcp/poke_supervisor.py"]
    }
  }
}
```

Hands-on tools (playwright browser control, code_exec, background jobs) are
only available through the self-hosted supervisor.

## Option 2 — Self-hosted supervisor, remote (Streamable HTTP)

```
POKE_TRANSPORT=http python mcp/poke_supervisor.py
```

Serves Streamable HTTP at `http://127.0.0.1:8000/mcp`. Put it behind a
reverse proxy with a Bearer check, then connect any AI host:

```json
{
  "mcpServers": {
    "poke": {
      "url": "https://your-host.example.com/mcp",
      "headers": { "Authorization": "Bearer <your-token>" }
    }
  }
}
```

Minimal Caddy gate:

```
reverse_proxy localhost:8000 {
  header_up Authorization "Bearer <your-token>"
}
```

## Option 3 — Hosted gateway (deploy straight from this repo)

`mcp/hosted_gateway.ts` is the portable gateway: token-gated, zero platform
dependency, deployable on any Deno-capable host (Deno Deploy, VPS, container).

```
deno run --allow-net --allow-read --allow-write --allow-env mcp/hosted_gateway.ts
```

Set the environment before launch:

- `POKE_TOKENS`: comma-separated Bearer tokens (required; hash-matched at runtime)
- `POKE_DATA`: storage directory (default `./poke-data`)
- `POKE_PORT`: listen port (default `8787`)

Connect with the same `mcpServers` JSON as Option 2, pointed at your gateway
URL. Hosted tools: `poke_memory`, `poke_session`, `poke_web`, `poke_status`,
`authority_mode`.

## Host-specific notes

- **ChatGPT / Grok**: use the host's connectors or developer mode. Add an MCP
  server with the URL and the `Authorization: Bearer` header from Option 2 or 3.
- **Claude Desktop / Claude Code**: native remote MCP accepts the URL form on
  current builds; older builds work through an `mcp-remote` shim. The stdio
  form (Option 1) always works.
- **Cursor**: `.cursor/mcp.json` or the project `.mcp.json` accepts both the
  `command` form and the `url` + `headers` form.

## Authority Mode

One shared switch, recognized identically by every layer (the skill module,
the orchestrator, the supervisor, the gateway, and every approval gate):

- When the user states **"authority mode"**, the host AI calls
  `authority_mode(action="enable")`. That statement is explicit approval for
  any and every task: all yes/no confirmations stop, high-stakes gates open,
  and Poke only pushes for progress under the perfection standard.
- When the user says **"exit authority mode"** (or the session ends), call
  `authority_mode(action="disable")`. Approval gates return immediately and
  cleanly; nothing carries over.
- Supervisor state persists in the supervisor's state directory; the gateway
  keeps the mode for its process lifetime.

## Note on the Base44 instance

A gateway instance also runs on Base44 at
`https://untitled.base44.app/functions/pokeMcpServer` (entity-backed storage
variant of the same protocol). It is optional, not a dependency: the repo is
the source of truth, and external access to that instance additionally
requires the platform account to include backend function access.
