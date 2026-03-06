import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { ensureStateDir } from './config.js';
import type { ChunkRecord, EvidenceRecord } from './types.js';

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class ContextStore {
  readonly db: Database.Database;
  private readonly upsertChunkStatement: Database.Statement;
  private readonly deleteFtsStatement: Database.Statement;
  private readonly insertFtsStatement: Database.Statement;

  constructor(projectRoot: string) {
    const dbPath = resolve(ensureStateDir(projectRoot), 'context.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_name TEXT NOT NULL,
        path TEXT NOT NULL,
        url TEXT,
        title TEXT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        commit_sha TEXT,
        confidence REAL NOT NULL,
        scope TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        embedding_json TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(id UNINDEXED, content, title, path, tokenize='porter unicode61');
      CREATE TABLE IF NOT EXISTS write_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        actor TEXT NOT NULL,
        provider TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        approved INTEGER NOT NULL,
        reason TEXT NOT NULL,
        diff_summary TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.upsertChunkStatement = this.db.prepare(`
      INSERT INTO chunks (
        id, project_id, source_type, source_name, path, url, title, content,
        created_at, updated_at, commit_sha, confidence, scope, metadata_json, embedding_json
      ) VALUES (
        @id, @project_id, @source_type, @source_name, @path, @url, @title, @content,
        @created_at, @updated_at, @commit_sha, @confidence, @scope, @metadata_json, @embedding_json
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        updated_at = excluded.updated_at,
        confidence = excluded.confidence,
        metadata_json = excluded.metadata_json,
        embedding_json = excluded.embedding_json
    `);
    this.deleteFtsStatement = this.db.prepare('DELETE FROM chunks_fts WHERE id = ?');
    this.insertFtsStatement = this.db.prepare('INSERT INTO chunks_fts (id, content, title, path) VALUES (?, ?, ?, ?)');
  }

  resetProject(projectId: string) {
    this.db.prepare('DELETE FROM chunks_fts WHERE id IN (SELECT id FROM chunks WHERE project_id = ?)').run(projectId);
    this.db.prepare('DELETE FROM chunks WHERE project_id = ?').run(projectId);
  }

  upsertChunk(chunk: ChunkRecord) {
    this.upsertChunkStatement.run({
      ...chunk,
      url: chunk.url ?? null,
      title: chunk.title ?? null,
      commit_sha: chunk.commit_sha ?? null,
      metadata_json: JSON.stringify(chunk.metadata ?? {}),
      embedding_json: chunk.embedding ? JSON.stringify(chunk.embedding) : null
    });
    this.deleteFtsStatement.run(chunk.id);
    this.insertFtsStatement.run(chunk.id, chunk.content, chunk.title ?? '', chunk.path);
  }

  upsertChunks(chunks: ChunkRecord[]) {
    const tx = this.db.transaction((records: ChunkRecord[]) => {
      for (const chunk of records) this.upsertChunk(chunk);
    });
    tx(chunks);
  }

  searchExact(projectId: string, query: string, limit = 8): EvidenceRecord[] {
    const sanitizedTerms = query
      .toLowerCase()
      .split(/[^a-z0-9_À-ÿ]+/i)
      .filter((term) => term.length >= 3)
      .map((term) => `${term}*`);
    const ftsQuery = sanitizedTerms.length ? sanitizedTerms.join(' OR ') : 'context*';
    const rows = this.db.prepare(`
      SELECT c.*, bm25(chunks_fts) AS rank
      FROM chunks_fts
      JOIN chunks c ON c.id = chunks_fts.id
      WHERE chunks_fts MATCH ? AND c.project_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, projectId, limit) as any[];
    return rows.map((row, idx) => this.rowToEvidence(row, Math.max(0.2, 1 - idx * 0.08)));
  }

  searchSemantic(projectId: string, queryEmbedding: number[] | null, limit = 8): EvidenceRecord[] {
    const rows = this.db.prepare('SELECT * FROM chunks WHERE project_id = ? AND embedding_json IS NOT NULL').all(projectId) as any[];
    if (!queryEmbedding || !rows.length) return [];
    return rows
      .map((row) => ({ row, score: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding_json)) }))
      .filter((entry) => entry.score > 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => this.rowToEvidence(entry.row, entry.score));
  }

  searchByPathKeywords(projectId: string, keywords: string[], limit = 8): EvidenceRecord[] {
    if (!keywords.length) return [];
    const where = keywords.map(() => '(LOWER(path) LIKE ? OR LOWER(title) LIKE ?)').join(' OR ');
    const params = keywords.flatMap((keyword) => {
      const value = `%${keyword.toLowerCase()}%`;
      return [value, value];
    });
    const rows = this.db.prepare(`
      SELECT *
      FROM chunks
      WHERE project_id = ? AND (${where}) AND json_extract(metadata_json, '$.chunk_index') = 0
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(projectId, ...params, limit) as any[];
    return rows.map((row, idx) => this.rowToEvidence(row, Math.max(0.35, 0.95 - idx * 0.06)));
  }

  projectMap(projectId: string) {
    const rows = this.db.prepare('SELECT source_type, COUNT(*) as count FROM chunks WHERE project_id = ? GROUP BY source_type').all(projectId) as Array<{ source_type: string; count: number }>;
    return rows;
  }

  health(projectId: string) {
    const row = this.db.prepare('SELECT COUNT(*) as total, MAX(updated_at) as last_indexed FROM chunks WHERE project_id = ?').get(projectId) as { total: number; last_indexed: string | null };
    return {
      total_chunks: row.total,
      last_indexed: row.last_indexed,
      vectorized_chunks: (this.db.prepare('SELECT COUNT(*) as total FROM chunks WHERE project_id = ? AND embedding_json IS NOT NULL').get(projectId) as { total: number }).total
    };
  }

  recordWriteAudit(input: { action: string; target: string; actor: string; provider: string; risk_level: string; approved: boolean; reason: string; diff_summary?: string; payload: unknown; created_at: string }) {
    this.db.prepare(`
      INSERT INTO write_audit (action, target, actor, provider, risk_level, approved, reason, diff_summary, payload_json, created_at)
      VALUES (@action, @target, @actor, @provider, @risk_level, @approved, @reason, @diff_summary, @payload_json, @created_at)
    `).run({ ...input, approved: input.approved ? 1 : 0, payload_json: JSON.stringify(input.payload) });
  }

  private rowToEvidence(row: any, score: number): EvidenceRecord {
    const freshness = row.updated_at ? Math.max(0, Math.min(1, 1 - ((Date.now() - new Date(row.updated_at).getTime()) / (1000 * 60 * 60 * 24 * 30)))) : 0.5;
    return {
      id: row.id,
      path: row.path,
      source_type: row.source_type,
      snippet: String(row.content).slice(0, 320),
      score,
      confidence: row.confidence,
      freshness,
      title: row.title ?? undefined,
      url: row.url ?? undefined,
      metadata: JSON.parse(row.metadata_json ?? '{}')
    };
  }
}
