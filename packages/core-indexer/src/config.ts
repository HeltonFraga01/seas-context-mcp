import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as tomlStringify from '@iarna/toml';
import toml from 'toml';
import { z } from 'zod';
import type { ProjectConfig } from './types.js';

const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.git/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.seas-context/**',
  '**/.cache/**',
  '**/tmp/**',
  '**/.DS_Store'
];

const sourceSchema = z.object({
  type: z.enum(['local', 'github', 'web']),
  name: z.string(),
  path: z.string().optional(),
  url: z.string().optional(),
  owner: z.string().optional(),
  repo: z.string().optional(),
  read_enabled: z.boolean().optional(),
  write_enabled: z.boolean().optional()
});

const configSchema = z.object({
  project_id: z.string(),
  project_name: z.string(),
  project_root: z.string(),
  provider: z.string().default('generic'),
  include: z.object({ globs: z.array(z.string()) }),
  exclude: z.object({ globs: z.array(z.string()) }),
  indexing: z.object({
    max_file_bytes: z.number().int().positive().default(524288)
  }).default({ max_file_bytes: 524288 }),
  embeddings: z.object({
    provider: z.literal('openai').default('openai'),
    model: z.string().default('text-embedding-3-small'),
    enabled: z.boolean().default(true)
  }),
  risk_gate: z.object({
    auto_allow_low: z.boolean().default(true),
    auto_allow_medium: z.boolean().default(false),
    allow_high: z.boolean().default(false)
  }),
  sources: z.array(sourceSchema).default([]),
  web_allowlist: z.object({ domains: z.array(z.string()).default([]) }).default({ domains: [] })
});

export function loadConfig(configPath?: string): ProjectConfig {
  const resolved = resolve(configPath ?? process.cwd(), configPath ? '' : 'contextmcp.toml');
  if (!existsSync(resolved)) {
    throw new Error(`Config not found: ${resolved}`);
  }
  const raw = toml.parse(readFileSync(resolved, 'utf8'));
  const parsed = configSchema.parse(raw);
  return {
    ...parsed,
    exclude: {
      globs: Array.from(new Set([...DEFAULT_EXCLUDES, ...parsed.exclude.globs]))
    },
    project_root: resolve(dirname(resolved), parsed.project_root)
  };
}

export function saveConfig(configPath: string, config: ProjectConfig) {
  const payload = {
    ...config,
    project_root: config.project_root,
    sources: config.sources.map((source) => ({ ...source }))
  };
  writeFileSync(resolve(configPath), tomlStringify.stringify(payload), 'utf8');
}

export function createDefaultConfig(projectRoot: string, provider = 'generic'): ProjectConfig {
  return {
    project_id: 'project',
    project_name: 'Project',
    project_root: resolve(projectRoot),
    provider,
    include: { globs: ['**/*.{ts,tsx,js,jsx,md,json,yml,yaml,toml}'] },
    exclude: { globs: [...DEFAULT_EXCLUDES] },
    indexing: { max_file_bytes: 524288 },
    embeddings: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      enabled: true
    },
    risk_gate: {
      auto_allow_low: true,
      auto_allow_medium: false,
      allow_high: false
    },
    sources: [
      {
        type: 'local',
        name: 'repo',
        path: '.',
        read_enabled: true
      }
    ],
    web_allowlist: { domains: [] }
  };
}

export function ensureStateDir(projectRoot: string): string {
  const stateDir = resolve(projectRoot, '.seas-context');
  mkdirSync(stateDir, { recursive: true });
  return stateDir;
}
