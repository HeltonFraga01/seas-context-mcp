import { resolve } from 'node:path';
import type { ProjectConfig, ProviderCapability, SourceDescriptor } from '@seas-context/core-indexer';

export const cortexxCapability: ProviderCapability = {
  name: 'cortexx',
  can_query: true,
  can_write: true,
  entities: ['roadmap_item', 'spec', 'skill', 'plan', 'runbook', 'agent', 'vertical', 'tenant_context']
};

export function buildCortexxSources(projectRoot: string): SourceDescriptor[] {
  return [
    { type: 'local', name: 'repo', path: projectRoot, read_enabled: true },
    { type: 'local', name: 'context-docs', path: resolve(projectRoot, '.context'), read_enabled: true },
    { type: 'local', name: 'kiro', path: resolve(projectRoot, '.kiro'), read_enabled: true }
  ];
}

export function patchCortexxConfig(config: ProjectConfig): ProjectConfig {
  const sources = [...config.sources];
  if (!sources.find((source) => source.name === 'context-docs')) {
    sources.push(...buildCortexxSources(config.project_root).filter((candidate) => !sources.find((source) => source.name === candidate.name)));
  }
  return {
    ...config,
    provider: 'cortexx',
    sources
  };
}

export function enrichCortexxQuery(query: string): string {
  return `${query}\n\nPrioritize AGENTS.md, .context/docs, .kiro/specs, .kiro/skills, roadmap, runbooks and architecture evidence.`;
}
