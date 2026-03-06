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
  const hasProjectRootSource = sources.some((source) => source.type === 'local' && resolve(config.project_root, source.path ?? '.') === config.project_root);
  if (!hasProjectRootSource && !sources.find((source) => source.name === 'context-docs')) {
    sources.push(...buildCortexxSources(config.project_root).filter((candidate) => !sources.find((source) => source.name === candidate.name)));
  }
  return {
    ...config,
    provider: 'cortexx',
    sources
  };
}

export function enrichCortexxQuery(query: string): string {
  const normalized = query.toLowerCase();
  const entities = new Set<string>();
  const focusTerms = new Set<string>();
  let timeline = false;

  const entityMatchers: Array<[string, RegExp[]]> = [
    ['roadmap_item', [/\broadmap\b/, /\bbacklog\b/, /\btarefa\b/, /\btasks?\b/, /\bpenden/]],
    ['spec', [/\bspec\b/, /\brequirements?\b/, /\bdesign\b/, /\btasks\.md\b/]],
    ['skill', [/\bskill\b/, /\.kiro\/skills\b/, /\.codex\/skills\b/]],
    ['plan', [/\bplan\b/, /\bplano\b/, /\.context\/plans\b/]],
    ['runbook', [/\brunbook\b/, /\boperacional\b/, /\bincident\b/]],
    ['agent', [/\brick-b\b/, /\brick b\b/, /\bagent\b/, /\bagente\b/, /\bsuperadmin\b/, /\bbuilder\b/]],
    ['vertical', [/\bvertical\b/, /\brestaurant\b/, /\btickets\b/, /\bsignage\b/, /\bmarketplace\b/]],
    ['tenant_context', [/\btenant\b/, /\binbox\b/, /\bcrm\b/, /\bcontact\b/, /\bwhatsapp\b/, /\binstagram\b/]]
  ];

  for (const [entity, patterns] of entityMatchers) {
    if (patterns.some((pattern) => pattern.test(normalized))) entities.add(entity);
  }

  if (/\bmudou\b|\bchanged\b|\bhistory\b|\bhistoric\b|\btimeline\b|\bultima\b|\brecente\b|\bquando\b/.test(normalized)) {
    timeline = true;
  }

  if (/\barquitet/.test(normalized)) focusTerms.add('architecture');
  if (/\bruntime\b/.test(normalized)) focusTerms.add('runtime');
  if (/\bmem[oó]ria\b|\bmemory\b/.test(normalized)) focusTerms.add('memory');
  if (/\ba2a\b/.test(normalized)) focusTerms.add('a2a');
  if (/\bmcp\b/.test(normalized)) focusTerms.add('mcp');
  if (/\btenant factory\b|\btenant bootstrap\b|\bbootstrap de tenant\b|\btenant creation\b/.test(normalized)) focusTerms.add('tenant_factory');

  const hints = {
    provider: 'cortexx',
    entities: [...entities],
    timeline,
    focus_terms: [...focusTerms],
    preferred_sources: ['AGENTS.md', '.context/docs', '.kiro/specs', '.kiro/skills', 'roadmap', 'runbooks', 'architecture']
  };

  return `${query}\n[SEAS_CONTEXT_HINTS]${JSON.stringify(hints)}[/SEAS_CONTEXT_HINTS]`;
}
