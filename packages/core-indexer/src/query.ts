import { embedTexts } from './embeddings.js';
import { ContextStore } from './store.js';
import type { EvidenceRecord, ProjectConfig, QueryIntent, QueryResponse } from './types.js';

function classifyIntent(query: string): QueryIntent {
  const q = query.toLowerCase();
  if (q.includes('mudou') || q.includes('changed') || q.includes('timeline')) return 'timeline_change';
  if (q.includes('arquitet') || q.includes('onde está') || q.includes('where is')) return 'architecture';
  if (q.includes('health') || q.includes('saúde') || q.includes('coverage')) return 'ops_context_health';
  if (q.includes('semântico') || q.includes('conceito') || q.includes('why') || q.includes('por que')) return 'semantic';
  return 'exact';
}

function inferOperationalFocus(query: string) {
  const q = normalizeToken(query);
  return {
    rickb: q.includes('rick-b') || q.includes('rick b') || q.includes('superadmin') || q.includes('control plane'),
    roadmap: q.includes('roadmap') || q.includes('penden') || q.includes('task') || q.includes('taref') || q.includes('backlog'),
    runtime: q.includes('runtime') || q.includes('agente') || q.includes('agent') || q.includes('memoria') || q.includes('memory')
  };
}

function summarize(query: string, evidence: QueryResponse['evidence']): string {
  if (!evidence.length) return `Nenhuma evidência relevante encontrada para: ${query}`;
  const lines = evidence.slice(0, 4).map((item, index) => `${index + 1}. ${item.path}: ${item.snippet.replace(/\s+/g, ' ').slice(0, 180)}`);
  return `Resumo baseado em evidências:\n${lines.join('\n')}`;
}

function normalizeToken(input: string) {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function scoreEvidence(intent: QueryIntent, item: EvidenceRecord, query: string): number {
  const source = `${item.path} ${item.title ?? ''}`.toLowerCase();
  const normalizedSource = normalizeToken(source);
  const normalizedQuery = normalizeToken(query);
  const queryTerms = normalizedQuery.split(/[^a-z0-9_]+/).filter((term) => term.length >= 3);
  const termMatches = queryTerms.reduce((sum, term) => sum + (normalizedSource.includes(term) ? 1 : 0), 0);
  const focus = inferOperationalFocus(query);

  let boost = termMatches * 0.08;

  if (intent === 'architecture') {
    if (normalizedSource.includes('/.context/docs/architecture.md')) boost += 3;
    if (normalizedSource.includes('/.context/docs/agents-architecture.md')) boost += 2.5;
    if (normalizedSource.includes('/.context/docs/project-overview.md')) boost += 2.2;
    if (normalizedSource.includes('/architecture.md')) boost += 2;
    if (normalizedSource.includes('agents-architecture')) boost += 1.5;
    if (normalizedSource.includes('project-overview')) boost += 1.2;
    if (normalizedSource.includes('data-flow')) boost += 1.1;
    if (normalizedSource.includes('memory-systems')) boost += 1.1;
    if (normalizedSource.includes('architecture')) boost += 0.8;
    if (normalizedSource.includes('/specs/')) boost += 0.3;
    if (normalizedSource.includes('agents.md')) boost += 0.25;
    if (normalizedSource.includes('/server/services/')) boost -= 0.15;
    if (normalizedSource.includes('/runbooks/')) boost -= 0.2;
    if (normalizedSource.includes('roadmap-open-backlog')) boost -= 0.45;
    if (normalizedSource.includes('vitest-report')) boost -= 0.4;
  }

  if (intent === 'timeline_change') {
    if (normalizedSource.includes('/runbooks/')) boost += 0.45;
    if (normalizedSource.includes('roadmap')) boost += 0.3;
    if (normalizedSource.includes('changelog')) boost += 0.3;
  }

  if (intent === 'ops_context_health') {
    if (normalizedSource.includes('runbook')) boost += 0.35;
    if (normalizedSource.includes('health')) boost += 0.35;
    if (normalizedSource.includes('observability')) boost += 0.25;
  }

  if (focus.rickb) {
    if (normalizedSource.includes('rick-b')) boost += 1.2;
    if (normalizedSource.includes('superadminchatservice')) boost += 1.1;
    if (normalizedSource.includes('superadminchatroutes')) boost += 1.1;
    if (normalizedSource.includes('rickbmcp')) boost += 1.1;
    if (normalizedSource.includes('cortex-100-wave1-rick-b')) boost += 1.4;
    if (normalizedSource.includes('builder-agent-explained')) boost += 0.45;
  }

  if (focus.roadmap) {
    if (normalizedSource.includes('roadmap')) boost += 1.1;
    if (normalizedSource.includes('/plans/')) boost += 0.6;
    if (normalizedSource.includes('/tasks.md')) boost += 0.65;
    if (normalizedSource.includes('read-models')) boost += 0.55;
    if (normalizedSource.includes('pending')) boost += 0.35;
  }

  if (focus.runtime) {
    if (normalizedSource.includes('runtime-contract')) boost += 1.25;
    if (normalizedSource.includes('agents-architecture')) boost += 0.95;
    if (normalizedSource.includes('memory-systems')) boost += 0.9;
    if (normalizedSource.includes('chatmessagehandler')) boost += 0.65;
    if (normalizedSource.includes('messageprocessor')) boost += 0.65;
    if (normalizedSource.includes('sessionmanager')) boost += 0.55;
    if (normalizedSource.includes('superadminchatservice')) boost += 0.45;
  }

  return item.score * 0.5 + item.freshness * 0.2 + item.confidence * 0.2 + boost;
}

export async function queryContext(config: ProjectConfig, query: string): Promise<QueryResponse> {
  const intent = classifyIntent(query);
  const store = new ContextStore(config.project_root);
  const exact = store.searchExact(config.project_id, query, 8);
  const focus = inferOperationalFocus(query);
  const pathHints = intent === 'architecture'
    ? store.searchByPathKeywords(config.project_id, ['/architecture.md', 'agents-architecture.md', 'project-overview.md', 'data-flow.md', 'memory-systems.md', 'AGENTS.md'], 12)
    : intent === 'timeline_change'
      ? store.searchByPathKeywords(config.project_id, ['roadmap', 'runbook', 'changelog', 'plan'], 8)
      : intent === 'ops_context_health'
        ? store.searchByPathKeywords(config.project_id, ['health', 'observability', 'runbook', 'incident'], 8)
        : [];
  const operationalHints = [
    ...(focus.rickb ? store.searchByPathKeywords(config.project_id, ['rick-b', 'superadmin', 'superadminchatservice', 'superadminchatroutes', 'rickbmcp', 'builder-agent-explained'], 12) : []),
    ...(focus.roadmap ? store.searchByPathKeywords(config.project_id, ['roadmap', 'tasks.md', 'plans', 'read-models', 'pending'], 12) : []),
    ...(focus.runtime ? store.searchByPathKeywords(config.project_id, ['runtime-contract', 'agents-architecture', 'memory-systems', 'chatmessagehandler', 'messageprocessor', 'sessionmanager'], 12) : [])
  ];
  const queryEmbedding = config.embeddings.enabled ? (await embedTexts([query], config.embeddings.model))[0] ?? null : null;
  const semantic = store.searchSemantic(config.project_id, queryEmbedding, 8);
  const combined = [...operationalHints, ...pathHints, ...exact, ...semantic]
    .filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((a, b) => scoreEvidence(intent, b, query) - scoreEvidence(intent, a, query))
    .slice(0, 8);

  const confidence = combined.length ? Number((combined.reduce((sum, item) => sum + item.confidence, 0) / combined.length).toFixed(2)) : 0;
  const freshness = combined.length ? Number((combined.reduce((sum, item) => sum + item.freshness, 0) / combined.length).toFixed(2)) : 0;

  return {
    intent,
    answer: summarize(query, combined),
    confidence,
    freshness,
    evidence: combined,
    sources: combined.map((item) => ({ path: item.path, source_type: item.source_type, url: item.url }))
  };
}
