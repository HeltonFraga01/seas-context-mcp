#!/bin/zsh
set -euo pipefail
cd /Users/heltonfraga/Documents/Develop/seas-context-mcp

NODE_BIN="/opt/homebrew/Cellar/node@20/20.19.4/bin/node"
if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node)"
fi

exec "$NODE_BIN" packages/mcp-server/dist/index.js
