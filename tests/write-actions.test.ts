import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextStore, evaluateWriteAction, githubDocPublish, githubIssueUpsert, loadConfig } from '../packages/core-indexer/src/index.ts';
import type { WriteActionRequest } from '../packages/core-indexer/src/types.ts';

let root = '';
let configPath = '';
const originalFetch = global.fetch;
const originalGithubToken = process.env.GITHUB_TOKEN;

function baseRequest(action: WriteActionRequest['action'], overrides: Partial<WriteActionRequest> = {}): WriteActionRequest {
  return {
    action,
    risk_level: 'medium',
    target: action === 'doc_publish' ? 'docs/test.md' : 'issues/1',
    reason: 'fixture write validation',
    approved: true,
    dry_run: false,
    payload: action === 'doc_publish'
      ? { owner: 'example', repo: 'repo', path: 'docs/test.md', content: '# Doc', message: 'docs: update' }
      : { owner: 'example', repo: 'repo', title: 'Issue title', body: 'Issue body' },
    evidence_ids: ['evidence-1'],
    actor: 'tester',
    provider: 'generic',
    ...overrides
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'seas-context-write-'));
  writeFileSync(join(root, 'contextmcp.toml'), `project_id = "test"\nproject_name = "Test"\nproject_root = "."\nprovider = "generic"\n\n[include]\nglobs = ["**/*.md"]\n\n[exclude]\nglobs = ["node_modules/**", ".seas-context/**"]\n\n[embeddings]\nprovider = "openai"\nmodel = "text-embedding-3-small"\nenabled = false\n\n[risk_gate]\nauto_allow_low = true\nauto_allow_medium = false\nallow_high = false\n\n[[sources]]\ntype = "local"\nname = "repo"\npath = "."\n\n[web_allowlist]\ndomains = ["example.com"]\n`);
  configPath = join(root, 'contextmcp.toml');
  process.env.GITHUB_TOKEN = 'test-token';
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalGithubToken;
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('write actions and risk gate', () => {
  it('blocks medium write without approval', () => {
    const config = loadConfig(configPath);
    const decision = evaluateWriteAction(config, baseRequest('github_issue_upsert', { approved: false }));
    expect(decision.allowed).toBe(false);
    expect(decision.requires_confirmation).toBe(true);
  });

  it('executes github_issue_upsert with token and expected payload', async () => {
    global.fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      const payload = JSON.parse(String(init?.body));
      expect(payload.title).toBe('Issue title');
      expect(payload.body).toBe('Issue body');
      return new Response(JSON.stringify({ number: 123, html_url: 'https://github.com/example/repo/issues/123' }), { status: 200 });
    }) as any;

    const result = await githubIssueUpsert(baseRequest('github_issue_upsert'));
    expect(result.number).toBe(123);
  });

  it('executes doc_publish with token and expected payload', async () => {
    global.fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.method).toBe('PUT');
      const payload = JSON.parse(String(init?.body));
      expect(payload.message).toBe('docs: update');
      expect(typeof payload.content).toBe('string');
      return new Response(JSON.stringify({ content: { path: 'docs/test.md' }, commit: { sha: 'abc123' } }), { status: 200 });
    }) as any;

    const result = await githubDocPublish(baseRequest('doc_publish'));
    expect(result.commit.sha).toBe('abc123');
  });

  it('records write audit after approved dry-run style execution', () => {
    const store = new ContextStore(root);
    store.recordWriteAudit({
      action: 'github_issue_upsert',
      target: 'issues/123',
      actor: 'tester',
      provider: 'generic',
      risk_level: 'medium',
      approved: true,
      reason: 'fixture audit',
      diff_summary: '{"dry_run":true}',
      payload: { owner: 'example', repo: 'repo', title: 'Issue title' },
      created_at: new Date().toISOString()
    });
    const row = store.db.prepare('SELECT action, target, actor, provider, risk_level, approved, reason FROM write_audit ORDER BY id DESC LIMIT 1').get() as any;
    expect(row.action).toBe('github_issue_upsert');
    expect(row.approved).toBe(1);
    expect(row.reason).toBe('fixture audit');
  });
});
