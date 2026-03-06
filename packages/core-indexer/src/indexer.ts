import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { embedTexts } from './embeddings.js';
import { fetchGithubSource, fetchWebSource } from './remote.js';
import { ContextStore } from './store.js';
import type { ChunkRecord, ProjectConfig, SourceDescriptor } from './types.js';

function safeGitHead(projectRoot: string): string | undefined {
  try {
    return execFileSync('git', ['-C', projectRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

function chunkText(input: string, size = 1400, overlap = 200): string[] {
  const text = input.trim();
  if (!text) return [];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    chunks.push(text.slice(offset, offset + size));
    if (offset + size >= text.length) break;
    offset += size - overlap;
  }
  return chunks;
}

function inferScope(path: string): string {
  if (path.includes('/.context/')) return 'documentation';
  if (path.includes('/.kiro/')) return 'skills_specs';
  if (path.includes('/server/')) return 'backend';
  if (path.includes('/src/')) return 'frontend';
  return 'project';
}

async function buildChunksForText(config: ProjectConfig, source: SourceDescriptor, path: string, text: string, commitSha?: string): Promise<ChunkRecord[]> {
  const baseMeta = path.endsWith('.md') ? matter(text) : { data: {}, content: text };
  const frontmatterTitle = typeof (baseMeta.data as Record<string, unknown>).title === 'string'
    ? String((baseMeta.data as Record<string, unknown>).title)
    : relative(config.project_root, path);
  const chunks = chunkText(baseMeta.content);
  const embeddings = config.embeddings.enabled ? await embedTexts(chunks, config.embeddings.model) : [];
  return chunks.map((content, index) => ({
    id: crypto.createHash('sha1').update(`${config.project_id}:${source.name}:${path}:${index}`).digest('hex'),
    project_id: config.project_id,
    source_type: source.type,
    source_name: source.name,
    path,
    title: frontmatterTitle,
    content,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    commit_sha: commitSha,
    confidence: source.type === 'local' ? 0.95 : 0.75,
    scope: inferScope(path),
    metadata: { frontmatter: baseMeta.data, chunk_index: index },
    embedding: embeddings[index] ?? null
  }));
}

async function ingestLocal(config: ProjectConfig, store: ContextStore, source: SourceDescriptor) {
  const basePath = resolve(config.project_root, source.path ?? '.');
  const patterns = config.include.globs.map((glob) => resolve(basePath, glob));
  const ignore = config.exclude.globs.map((glob) => resolve(basePath, glob));
  const files = await fg(patterns, { ignore, dot: true, onlyFiles: true, unique: true });
  const commitSha = safeGitHead(config.project_root);
  const batch: ChunkRecord[] = [];
  const flush = () => {
    if (!batch.length) return;
    store.upsertChunks(batch.splice(0, batch.length));
  };
  for (const file of files) {
    const stats = statSync(file);
    if (stats.size > config.indexing.max_file_bytes) continue;
    const content = readFileSync(file, 'utf8');
    const chunks = await buildChunksForText(config, source, file, content, commitSha);
    batch.push(...chunks);
    if (batch.length >= 500) flush();
  }
  flush();
}

async function ingestGithub(config: ProjectConfig, store: ContextStore, source: SourceDescriptor) {
  const remote = await fetchGithubSource(source);
  const records: Array<{ path: string; content: string; title?: string }> = [];
  if (remote.readme) records.push({ path: `github://${source.owner}/${source.repo}/README.md`, content: remote.readme, title: 'README' });
  for (const issue of remote.issues ?? []) {
    records.push({ path: `github://${source.owner}/${source.repo}/issues/${issue.number}`, content: `${issue.title}\n\n${issue.body ?? ''}`, title: issue.title });
  }
  for (const release of remote.releases ?? []) {
    records.push({ path: `github://${source.owner}/${source.repo}/releases/${release.tag_name}`, content: `${release.name ?? release.tag_name}\n\n${release.body ?? ''}`, title: release.name ?? release.tag_name });
  }
  const batch: ChunkRecord[] = [];
  const flush = () => {
    if (!batch.length) return;
    store.upsertChunks(batch.splice(0, batch.length));
  };
  for (const record of records) {
    const chunks = await buildChunksForText(config, source, record.path, record.content);
    batch.push(...chunks);
    if (batch.length >= 500) flush();
  }
  flush();
}

async function ingestWeb(config: ProjectConfig, store: ContextStore, source: SourceDescriptor) {
  if (!source.url) return;
  const content = await fetchWebSource(source.url, config);
  const chunks = await buildChunksForText(config, source, source.url, content);
  store.upsertChunks(chunks);
}

export async function ingestProject(config: ProjectConfig) {
  const store = new ContextStore(config.project_root);
  store.resetProject(config.project_id);
  for (const source of config.sources) {
    if (source.type === 'local') await ingestLocal(config, store, source);
    if (source.type === 'github' && source.read_enabled !== false) await ingestGithub(config, store, source);
    if (source.type === 'web' && source.read_enabled !== false) await ingestWeb(config, store, source);
  }
  return store.health(config.project_id);
}
