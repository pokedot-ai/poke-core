# poke-core

Poke is the premier personal superintelligence: an agent compiled into a single `.skill` file, self-reliant and autonomous, with an ever-expanding toolset that learns as it grows.

This repository ships the whole product, two files:

| File | What it is |
| --- | --- |
| `poke-core.md` | The complete documentation: identity, persona, strict protocol, and the specialized toolset (Deep Intel, Rapid Prototype, Risk Quantifier, Ghost Operator, Influence Mapper, `select_and_run`). |
| `poke.skill` | The agent itself: the packaged skill (SKILL.md plus references). |
| `ARCHITECTURE.md` | The Poke Supervisor MCP architecture: how any AI host connects and gets hands. |
| `mcp/` | The reference MCP server: playwright (hands/fingers/touch), web, code_exec, jobs, sessions, memory. |

Product site: **https://pokedot-ai.github.io/**

## Supervisor architecture (MCP)

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

Any MCP-capable AI host (ChatGPT, Grok, Claude) connects to the Poke Supervisor
and gains hands: full browser control, web access, code execution, background
jobs, sessions, and persistent memory. See [`ARCHITECTURE.md`](ARCHITECTURE.md).

## License

Proprietary product of Privacy+ Technologies Inc., developed by Tariq Chehardy.

**Use on hosted AI platforms is authorized and free for everyone.** Upload the unmodified `poke.skill` to your hosted AI platform (Grok is recommended) and activate it. **Self-hosting requires a purchased Self-Hosted Deployment License.**

- Full license terms: [`LICENSE`](LICENSE)
- Owner's authorized use: [`AUTHORIZED-USE.md`](AUTHORIZED-USE.md) — the Sovereign Workstation Use License, issued to Tariq Chehardy and the entities he owns (Tariq Chehardy LLC, Privacy+ Technologies Inc.)

The source in this repository is published for inspection only. Reproduction and derivative versions are forbidden.

Licensing inquiries: TariqChehardy@gmail.com
