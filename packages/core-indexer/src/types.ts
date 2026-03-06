export type SourceType = 'local' | 'github' | 'web';
export type QueryIntent = 'exact' | 'semantic' | 'architecture' | 'timeline_change' | 'ops_context_health';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface SourceDescriptor {
  type: SourceType;
  name: string;
  path?: string;
  url?: string;
  owner?: string;
  repo?: string;
  read_enabled?: boolean;
  write_enabled?: boolean;
}

export interface ProjectConfig {
  project_id: string;
  project_name: string;
  project_root: string;
  provider: string;
  include: { globs: string[] };
  exclude: { globs: string[] };
  indexing: {
    max_file_bytes: number;
  };
  embeddings: {
    provider: 'openai';
    model: string;
    enabled: boolean;
  };
  risk_gate: {
    auto_allow_low: boolean;
    auto_allow_medium: boolean;
    allow_high: boolean;
  };
  sources: SourceDescriptor[];
  web_allowlist: { domains: string[] };
}

export interface ChunkRecord {
  id: string;
  project_id: string;
  source_type: SourceType;
  source_name: string;
  path: string;
  url?: string;
  title?: string;
  content: string;
  created_at: string;
  updated_at: string;
  commit_sha?: string;
  confidence: number;
  scope: string;
  metadata: Record<string, unknown>;
  embedding?: number[] | null;
}

export interface EvidenceRecord {
  id: string;
  path: string;
  source_type: SourceType;
  snippet: string;
  score: number;
  confidence: number;
  freshness: number;
  title?: string;
  url?: string;
  metadata: Record<string, unknown>;
}

export interface QueryResponse {
  intent: QueryIntent;
  answer: string;
  confidence: number;
  freshness: number;
  evidence: EvidenceRecord[];
  sources: Array<{ path: string; source_type: SourceType; url?: string }>;
}

export interface WriteActionRequest {
  action: 'github_issue_upsert' | 'doc_publish';
  risk_level: RiskLevel;
  target: string;
  reason: string;
  approved?: boolean;
  dry_run?: boolean;
  payload: Record<string, unknown>;
  evidence_ids: string[];
  actor: string;
  provider: string;
}

export interface WriteActionDecision {
  allowed: boolean;
  risk_level: RiskLevel;
  requires_confirmation: boolean;
  reason: string;
}

export interface ProviderCapability {
  name: string;
  can_query: boolean;
  can_write: boolean;
  entities: string[];
}
