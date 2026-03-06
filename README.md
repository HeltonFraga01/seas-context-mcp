# SEAS Context MCP

SEAS Context MCP is a reusable project-context stack for local repositories and remote knowledge sources. It combines a local indexer, a stdio MCP server, a CLI, a local web console, and project-specific providers such as Córtexx.

## V1 Scope

- Local repository, docs, plans, skills, AGENTS and manifests
- GitHub repository read + issues/docs write under risk gate
- Web ingest under allowlist
- Query responses with `answer`, `evidence`, `confidence`, `freshness` and `sources`
- Official `cortexx` provider

## Workspace

- `packages/core-indexer` - indexing, storage, retrieval, governance
- `packages/mcp-server` - MCP stdio server
- `packages/cli` - project operations
- `packages/web` - local HTTP UI
- `packages/providers/cortexx` - Córtexx provider

## Quick Start

```bash
npm install
cp contextmcp.example.toml contextmcp.toml
npm run build
node packages/cli/dist/index.js ingest --config contextmcp.toml
node packages/mcp-server/dist/index.js
```

## CLI

```bash
context init --project-root /path/to/project --provider generic
context ingest --config contextmcp.toml
context watch --config contextmcp.toml
context query "onde está a arquitetura?"
context evidence "quais são os gaps?"
context map --config contextmcp.toml
context health --config contextmcp.toml
context source-add --type github --name origin --owner org --repo repo
context source-sync --config contextmcp.toml
context doctor --config contextmcp.toml
```

Optional environment:

```bash
export OPENAI_API_KEY=...
export GITHUB_TOKEN=...
```

## MCP Tools

- `project_register`
- `source_add`
- `source_sync`
- `source_status`
- `index_refresh`
- `index_refresh_status`
- `context_query`
- `evidence_query`
- `context_map`
- `context_health`
- `doc_publish`
- `github_issue_upsert`
- `provider_status`
- `provider_query`
- `provider_action`

## Web UI

```bash
npm run dev:web
# http://127.0.0.1:4317
```

The local console exposes:
- health and freshness
- source map
- provider status
- ad-hoc query
- one-click reindex

## Async Refresh

`index_refresh` is asynchronous.

- use `index_refresh` to enqueue a reindex
- use `index_refresh_status` to observe job state and refreshed health
- use `context_health` as the canonical health/freshness snapshot after completion

## Córtexx Provider

Provider `cortexx` adds:
- path-aware retrieval for architecture, specs, runbooks and roadmap
- default source expansion for `.context`, `.kiro` and repo-local artefacts
- domain entities: `roadmap_item`, `spec`, `skill`, `plan`, `runbook`, `agent`, `vertical`, `tenant_context`

Example profiles:
- [`examples/cortexx/contextmcp.toml`](/Users/heltonfraga/Documents/Develop/seas-context-mcp/examples/cortexx/contextmcp.toml): broad project ingest
- [`examples/cortexx/contextmcp.lean.toml`](/Users/heltonfraga/Documents/Develop/seas-context-mcp/examples/cortexx/contextmcp.lean.toml): operational profile for architecture, roadmap and runtime surfaces
- [`examples/integrations/mcp-servers.local.json`](/Users/heltonfraga/Documents/Develop/seas-context-mcp/examples/integrations/mcp-servers.local.json): ready-to-use JSON for this machine
- [`examples/integrations/mcp-servers.template.json`](/Users/heltonfraga/Documents/Develop/seas-context-mcp/examples/integrations/mcp-servers.template.json): generic JSON template for other IDEs/clients

## Risk Gate

Remote writes are intentionally narrow in V1:
- GitHub issues
- docs artefacts

Risk levels:
- `low`: auto-allow if policy permits
- `medium`: dry-run plus explicit approval
- `high`: blocked unless explicitly approved by policy

Every write records:
- actor
- provider
- reason
- target
- payload summary
- timestamp

Typical remote policies:
- `github_issue_upsert`: `low` or `medium`
- `doc_publish`: usually `medium`
- anything outside issues/docs: out of scope in V1

## Remote Sources

GitHub ingestion currently covers:
- repository metadata
- README
- open issues
- open pull requests
- releases

Web ingestion:
- only runs for allowlisted domains in `web_allowlist.domains`
- fails closed for non-allowlisted hosts
- uses bounded request timeout in the connector layer

## Notes

- Local state lives in `.seas-context/`
- Default embeddings provider is OpenAI via `OPENAI_API_KEY`
- If embeddings are unavailable, retrieval falls back to exact/heuristic ranking
- SQLite uses `FTS5` plus optional vector scoring
