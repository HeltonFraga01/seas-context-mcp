#!/usr/bin/env node
import { resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  loadConfig,
  ingestProject,
  queryContext,
  ContextStore,
  evaluateWriteAction,
  githubDocPublish,
  githubIssueUpsert,
  createDefaultConfig,
  saveConfig,
  type ProjectConfig,
  type SourceDescriptor,
  type WriteActionRequest
} from '@seas-context/core-indexer';
import { cortexxCapability, enrichCortexxQuery, patchCortexxConfig } from '@seas-context/provider-cortexx';

function getCapability(provider: string) {
  return provider === 'cortexx'
    ? cortexxCapability
    : { name: 'generic', can_query: true, can_write: true, entities: ['project', 'source', 'chunk', 'evidence'] };
}

function getRequestedConfigPath(rawPath?: string) {
  return rawPath ?? process.env.SEAS_CONTEXT_CONFIG_PATH ?? 'contextmcp.toml';
}

function resolveProviderConfig(config: ReturnType<typeof loadConfig>) {
  return config.provider === 'cortexx' ? patchCortexxConfig(config) : config;
}

function loadResolvedConfig(configPath?: string) {
  const resolvedPath = resolve(getRequestedConfigPath(configPath));
  return {
    configPath: resolvedPath,
    config: resolveProviderConfig(loadConfig(resolvedPath))
  };
}

function addSource(config: ProjectConfig, source: SourceDescriptor) {
  config.sources = [...config.sources, source];
}

async function executeWrite(config: ProjectConfig, request: WriteActionRequest) {
  const decision = evaluateWriteAction(config, request);
  if (!decision.allowed) {
    return { decision, isError: true };
  }
  const fn = request.action === 'github_issue_upsert' ? githubIssueUpsert : githubDocPublish;
  const output = request.dry_run
    ? { dry_run: true, target: request.target, payload: request.payload }
    : await fn(request);
  const store = new ContextStore(config.project_root);
  store.recordWriteAudit({
    action: request.action,
    target: request.target,
    actor: request.actor,
    provider: request.provider,
    risk_level: request.risk_level,
    approved: Boolean(request.approved),
    reason: request.reason,
    diff_summary: JSON.stringify(output).slice(0, 500),
    payload: request.payload,
    created_at: new Date().toISOString()
  });
  return { decision, output, isError: false };
}

const server = new Server({ name: 'seas-context-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });

const toolDefs = [
  { name: 'project_register', description: 'Create a contextmcp.toml config for a project', inputSchema: { type: 'object', properties: { config_path: { type: 'string' }, project_root: { type: 'string' }, provider: { type: 'string' } }, required: ['project_root'] } },
  { name: 'source_add', description: 'Add a source to contextmcp.toml', inputSchema: { type: 'object', properties: { config_path: { type: 'string' }, source: { type: 'object' } }, required: ['source'] } },
  { name: 'source_sync', description: 'Refresh indexed sources', inputSchema: { type: 'object', properties: { config_path: { type: 'string' } } } },
  { name: 'source_status', description: 'List configured sources and index health', inputSchema: { type: 'object', properties: { config_path: { type: 'string' } } } },
  { name: 'index_refresh', description: 'Reindex configured sources', inputSchema: { type: 'object', properties: { config_path: { type: 'string' } } } },
  { name: 'context_query', description: 'Query project context', inputSchema: { type: 'object', properties: { query: { type: 'string' }, config_path: { type: 'string' } }, required: ['query'] } },
  { name: 'evidence_query', description: 'Query and return raw evidence', inputSchema: { type: 'object', properties: { query: { type: 'string' }, config_path: { type: 'string' } }, required: ['query'] } },
  { name: 'context_map', description: 'Show source distribution map', inputSchema: { type: 'object', properties: { config_path: { type: 'string' } } } },
  { name: 'context_health', description: 'Show health and freshness', inputSchema: { type: 'object', properties: { config_path: { type: 'string' } } } },
  { name: 'doc_publish', description: 'Publish docs artefact under risk gate', inputSchema: { type: 'object', properties: { request: { type: 'object' }, config_path: { type: 'string' } }, required: ['request'] } },
  { name: 'github_issue_upsert', description: 'Create/update GitHub issue under risk gate', inputSchema: { type: 'object', properties: { request: { type: 'object' }, config_path: { type: 'string' } }, required: ['request'] } },
  { name: 'provider_status', description: 'Show provider status and capabilities', inputSchema: { type: 'object', properties: { config_path: { type: 'string' } } } },
  { name: 'provider_query', description: 'Run provider-aware query expansion', inputSchema: { type: 'object', properties: { query: { type: 'string' }, config_path: { type: 'string' } }, required: ['query'] } },
  { name: 'provider_action', description: 'Run a provider-scoped write action under risk gate', inputSchema: { type: 'object', properties: { request: { type: 'object' }, config_path: { type: 'string' } }, required: ['request'] } }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefs }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments as any;

  try {
    if (name === 'project_register') {
      const configPath = resolve(getRequestedConfigPath(args?.config_path));
      const config = createDefaultConfig(args.project_root, args.provider ?? 'generic');
      saveConfig(configPath, config);
      return { content: [{ type: 'text', text: JSON.stringify({ created: configPath, project_root: config.project_root, provider: config.provider }, null, 2) }] };
    }

    const { configPath, config } = loadResolvedConfig(args?.config_path);

    if (name === 'source_add') {
      addSource(config, args.source as SourceDescriptor);
      saveConfig(configPath, config);
      return { content: [{ type: 'text', text: JSON.stringify({ updated: configPath, source: args.source }, null, 2) }] };
    }

    if (name === 'source_sync' || name === 'index_refresh') {
      return { content: [{ type: 'text', text: JSON.stringify(await ingestProject(config), null, 2) }] };
    }

    if (name === 'source_status') {
      const store = new ContextStore(config.project_root);
      return { content: [{ type: 'text', text: JSON.stringify({ sources: config.sources, health: store.health(config.project_id) }, null, 2) }] };
    }

    if (name === 'context_query' || name === 'evidence_query') {
      const result = await queryContext(config, args.query);
      return { content: [{ type: 'text', text: JSON.stringify(name === 'evidence_query' ? result.evidence : result, null, 2) }] };
    }

    if (name === 'provider_query') {
      const query = config.provider === 'cortexx' ? enrichCortexxQuery(args.query) : args.query;
      const result = await queryContext(config, query);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    if (name === 'context_map') {
      const store = new ContextStore(config.project_root);
      return { content: [{ type: 'text', text: JSON.stringify(store.projectMap(config.project_id), null, 2) }] };
    }

    if (name === 'context_health') {
      const store = new ContextStore(config.project_root);
      return { content: [{ type: 'text', text: JSON.stringify(store.health(config.project_id), null, 2) }] };
    }

    if (name === 'provider_status') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            provider: config.provider,
            capabilities: getCapability(config.provider)
          }, null, 2)
        }]
      };
    }

    if (name === 'github_issue_upsert' || name === 'doc_publish' || name === 'provider_action') {
      const payload = args.request as WriteActionRequest;
      const normalizedRequest = name === 'provider_action'
        ? payload
        : { ...payload, action: name as WriteActionRequest['action'] };
      const result = await executeWrite(config, normalizedRequest);
      return {
        content: [{ type: 'text', text: JSON.stringify(result.isError ? { decision: result.decision } : result, null, 2) }],
        isError: result.isError
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }, null, 2) }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
