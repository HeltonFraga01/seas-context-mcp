#!/bin/zsh
set -euo pipefail
cd /Users/heltonfraga/Documents/Develop/seas-context-mcp
exec node packages/mcp-server/dist/index.js
