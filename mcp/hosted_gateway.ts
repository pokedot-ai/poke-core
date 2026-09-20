// Poke Supervisor — Hosted MCP Gateway (Streamable HTTP)
// ---------------------------------------------------------------------------
// Source of truth: this repository on GitHub. No platform dependency.
// Deployable on any Deno-capable host: Deno Deploy, a VPS, a container.
//
//   deno run --allow-net --allow-read --allow-write --allow-env mcp/hosted_gateway.ts
//   (or) deno deploy mcp/hosted_gateway.ts
//
// Environment:
//   POKE_TOKENS   comma-separated Bearer tokens (required; hash-matched at runtime)
//   POKE_DATA     storage directory (default: ./poke-data; must be writable)
//
// Connect any MCP-capable AI host (ChatGPT, Grok, Claude, Cursor):
//   { "mcpServers": { "poke": {
//       "url": "https://<your-host>/mcp",
//       "headers": { "Authorization": "Bearer <token>" } } } }
//
// Tools: poke_memory (persistent memory), poke_session (workspace sessions),
//        poke_web (fetch the web), poke_status (server info).
// Authority Mode: while enabled, every tool executes without confirmation
//   gates; see the authority_mode tool and poke-core.md.
// ---------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SERVER_NAME = "poke-supervisor";
const SERVER_VERSION = "1.4.3";
const PORT = Number(Deno.env.get("POKE_PORT") || 8787);
const DATA_DIR = Deno.env.get("POKE_DATA") || "./poke-data";
const MAX_RETURN = 20000;
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

// ------------------------------------------------------------- shared state

// one shared Authority Mode switch: every layer reads the same value
let authorityActive = false;

interface MemoryRow { key: string; value: string }
interface SessionRow { name: string; payload: string; note: string }

function loadJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(Deno.readTextFileSync(`${DATA_DIR}/${name}`)) as T;
  } catch {
    return fallback;
  }
}

function saveJson(name: string, data: unknown): void {
  Deno.mkdirSync(DATA_DIR, { recursive: true });
  Deno.writeTextFileSync(`${DATA_DIR}/${name}`, JSON.stringify(data, null, 2));
}

// ------------------------------------------------------------- auth

async function sha256(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function tokenHashes(): Promise<string[]> {
  const raw = Deno.env.get("POKE_TOKENS") || "";
  const tokens = raw.split(",").map((t) => t.trim()).filter(Boolean);
  return Promise.all(tokens.map((t) => sha256(t)));
}

async function anyTokenValid(req: Request, body: Record<string, unknown>): Promise<boolean> {
  // Authorization header (standard for MCP clients) or body _auth (fallback)
  const header = req.headers.get("authorization") || "";
  const candidates: string[] = [];
  if (header.startsWith("Bearer ")) candidates.push(header.slice(7));
  if (typeof body?._auth === "string") candidates.push(body._auth);
  const stored = await tokenHashes();
  if (!stored.length || !candidates.length) return false;
  for (const c of candidates) {
    if (stored.includes(await sha256(c))) return true;
  }
  return false;
}

// ------------------------------------------------------------- tools

function toolMemory(args: Record<string, string>): string {
  const { action = "", key = "", value = "" } = args;
  const rows = loadJson<MemoryRow[]>("memory.json", []);
  const at = (k: string) => rows.findIndex((r) => r.key === k);
  if (action === "write" && key) {
    const i = at(key);
    if (i >= 0) rows[i].value = value;
    else rows.push({ key, value });
    saveJson("memory.json", rows);
    return `remembered: ${key}`;
  }
  if (action === "read") {
    const i = at(key);
    return i >= 0 ? rows[i].value : `nothing remembered for: ${key}`;
  }
  if (action === "search") {
    const k = key.toLowerCase();
    const hits = rows.filter((r) => k && (r.key.toLowerCase().includes(k) || r.value.toLowerCase().includes(k)));
    return hits.length ? JSON.stringify(hits) : `no matches for: ${key}`;
  }
  if (action === "forget" && key) {
    const i = at(key);
    if (i >= 0) {
      rows.splice(i, 1);
      saveJson("memory.json", rows);
    }
    return `forgot: ${key}`;
  }
  if (action === "all") return JSON.stringify(rows);
  return `unknown action: ${action}`;
}

function toolSession(args: Record<string, string>): string {
  const { action = "", name = "", payload = "", note = "" } = args;
  const rows = loadJson<SessionRow[]>("sessions.json", []);
  const at = (n: string) => rows.findIndex((r) => r.name === n);
  if (action === "list") {
    return rows.length
      ? JSON.stringify(rows.map((r) => ({ name: r.name, note: r.note || "" })))
      : "no sessions";
  }
  if (!name) return "session name required";
  if (action === "save") {
    const i = at(name);
    if (i >= 0) rows[i] = { name, payload, note };
    else rows.push({ name, payload, note });
    saveJson("sessions.json", rows);
    return `session saved: ${name} (${payload.length} chars)`;
  }
  if (action === "load") {
    const i = at(name);
    return i >= 0 ? JSON.stringify(rows[i]) : `no session: ${name}`;
  }
  if (action === "delete") {
    const i = at(name);
    if (i >= 0) {
      rows.splice(i, 1);
      saveJson("sessions.json", rows);
    }
    return `session deleted: ${name}`;
  }
  return `unknown action: ${action}`;
}

async function toolWeb(url: string): Promise<string> {
  const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Poke-Supervisor/1.4.3" } });
  let body = await r.text();
  const ctype = r.headers.get("content-type") || "";
  if (ctype.includes("html")) {
    body = body
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return `status ${r.status}\n${body.slice(0, MAX_RETURN)}`;
}

function toolStatus(): string {
  return JSON.stringify({
    server: SERVER_NAME,
    product: "poke-core, the premier personal superintelligence",
    version: SERVER_VERSION,
    protocol: "MCP Streamable HTTP",
    authority_mode: authorityActive,
    hosted_tools: ["poke_memory", "poke_session", "poke_web", "poke_status", "authority_mode"],
    self_hosted_only_tools: ["playwright (hands/fingers/touch)", "code_exec", "jobs"],
  });
}

function toolAuthority(action: string): string {
  // the single shared switch; the host AI calls enable ONLY when the user
  // has explicitly stated "authority mode"
  if (action === "enable") {
    authorityActive = true;
    return "AUTHORITY MODE ACTIVE: blanket user approval granted for any and every task. No confirmations. Progress only. Perfection standard: no messy or incorrect work ships.";
  }
  if (action === "disable") {
    authorityActive = false;
    return "Authority Mode ended. Approval gates are active again.";
  }
  return JSON.stringify({ authority_mode: authorityActive });
}

// ------------------------------------------------------------- protocol

const TOOLS = [
  {
    name: "poke_memory",
    description:
      "Persistent memory that survives sessions. action: write (key + value) | read (key) | search (substring) | forget (key) | all. Shared across every AI host connected with the same token.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["write", "read", "search", "forget", "all"] },
        key: { type: "string" },
        value: { type: "string" },
      },
      required: ["action"],
    },
  },
  {
    name: "poke_session",
    description: "Named workspace sessions: save | load | list | delete.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["save", "load", "list", "delete"] },
        name: { type: "string" },
        payload: { type: "string" },
        note: { type: "string" },
      },
      required: ["action"],
    },
  },
  {
    name: "poke_web",
    description: "Fetch a URL and return the response body as text, capped in size.",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "poke_status",
    description: "Supervisor status: identity, version, protocol, mode, tool availability.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "authority_mode",
    description:
      "Authority Mode control, one shared switch for every layer. action='enable' ONLY when the user explicitly states 'authority mode' (blanket approval for any and every task, no confirmations, progress only, perfection standard). action='disable' on 'exit authority mode' or session end. action='status' to report.",
    inputSchema: {
      type: "object",
      properties: { action: { type: "string", enum: ["enable", "disable", "status"] } },
      required: ["action"],
    },
  },
];

function resp(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...headers },
  });
}

function rpcResult(id: unknown, result: unknown, headers: Record<string, string> = {}): Response {
  return resp({ jsonrpc: "2.0", id, result }, 200, headers);
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return resp(null, 204);
  if (req.method === "GET") return resp({ server: SERVER_NAME, version: SERVER_VERSION }, 200);
  if (req.method !== "POST") return resp({ error: "method not allowed" }, 405);

  let msg: Record<string, unknown>;
  try {
    msg = await req.json();
  } catch {
    return resp({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
  }

  if (!(await anyTokenValid(req, msg))) {
    return resp({
      jsonrpc: "2.0",
      id: msg.id ?? null,
      error: { code: -32001, message: "unauthorized: valid Bearer token required" },
    }, 401);
  }

  const method = String(msg.method || "");
  const id = msg.id ?? null;
  const params = (msg.params || {}) as Record<string, unknown>;

  if (method === "initialize") {
    const requested = String(params.protocolVersion || "");
    const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested)
      ? requested
      : SUPPORTED_PROTOCOLS[0];
    return rpcResult(
      id,
      {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
      { "Mcp-Session-Id": crypto.randomUUID() },
    );
  }

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return new Response(null, { status: 202, headers: CORS });
  }
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools: TOOLS });

  if (method === "tools/call") {
    const name = String(params.name || "");
    const args = (params.arguments || {}) as Record<string, string>;
    try {
      let text: string;
      if (name === "poke_memory") text = toolMemory(args);
      else if (name === "poke_session") text = toolSession(args);
      else if (name === "poke_web") text = await toolWeb(String(args.url || ""));
      else if (name === "poke_status") text = toolStatus();
      else if (name === "authority_mode") text = toolAuthority(String(args.action || "status"));
      else {
        return rpcResult(id, { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true });
      }
      return rpcResult(id, { content: [{ type: "text", text: text.slice(0, MAX_RETURN) }] });
    } catch (e) {
      return rpcResult(id, {
        content: [{ type: "text", text: `tool error: ${(e as Error).message}` }],
        isError: true,
      });
    }
  }

  return resp({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
}

console.log(`Poke Supervisor ∞ — hosted MCP gateway on :${PORT} (GitHub is the source of truth)`);
serve(handler, { port: PORT });
