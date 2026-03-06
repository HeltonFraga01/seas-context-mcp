# Integration Examples

## Files

- `mcp-servers.local.json` - ready-to-use JSON for this machine
- `mcp-servers.template.json` - generic template with placeholders
- `codex.config.toml` - canonical Codex TOML example
- `kiro.mcp.json` - canonical Kiro JSON example

## Current local command

```json
{
  "command": "/Users/heltonfraga/Documents/Develop/seas-context-mcp/scripts/start-mcp.sh",
  "args": [],
  "env": {
    "SEAS_CONTEXT_CONFIG_PATH": "/Users/heltonfraga/Documents/Develop/seas-context-mcp/examples/cortexx/contextmcp.lean.toml"
  }
}
```

## Client Canonical Sources

- Codex: use `codex.config.toml` as canonical source and treat `~/.codex/mcp.toml` as compatibility mirror when needed.
- Kiro: use `kiro.mcp.json` or project-local `.kiro/settings/mcp.json`.
- Generic JSON clients: start from `mcp-servers.template.json` and replace `/ABS/PATH`.
