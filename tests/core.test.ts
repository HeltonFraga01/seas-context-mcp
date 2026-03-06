import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { ingestProject, loadConfig, queryContext, evaluateWriteAction } from '../packages/core-indexer/src/index.ts';

let root = '';
let configPath = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'seas-context-'));
  mkdirSync(join(root, '.context', 'docs'), { recursive: true });
  writeFileSync(join(root, 'AGENTS.md'), 'Agent rules for project context');
  writeFileSync(join(root, '.context', 'docs', 'architecture.md'), '# Architecture\nSystem architecture and data flow');
  writeFileSync(join(root, 'contextmcp.toml'), `project_id = "test"\nproject_name = "Test"\nproject_root = "."\nprovider = "generic"\n\n[include]\nglobs = ["**/*.md"]\n\n[exclude]\nglobs = ["node_modules/**", ".seas-context/**"]\n\n[embeddings]\nprovider = "openai"\nmodel = "text-embedding-3-small"\nenabled = false\n\n[risk_gate]\nauto_allow_low = true\nauto_allow_medium = false\nallow_high = false\n\n[[sources]]\ntype = "local"\nname = "repo"\npath = "."\n\n[web_allowlist]\ndomains = ["example.com"]\n`);
  configPath = join(root, 'contextmcp.toml');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('core indexer', () => {
  it('ingests local docs and returns evidence query', async () => {
    const config = loadConfig(configPath);
    const health = await ingestProject(config);
    expect(health.total_chunks).toBeGreaterThan(0);
    const result = await queryContext(config, 'where is architecture');
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('enforces risk gate for medium writes without approval', () => {
    const config = loadConfig(configPath);
    const decision = evaluateWriteAction(config, {
      action: 'doc_publish',
      risk_level: 'medium',
      target: 'docs/test.md',
      reason: 'publish report',
      dry_run: true,
      payload: {},
      evidence_ids: [],
      actor: 'tester',
      provider: 'generic'
    });
    expect(decision.allowed).toBe(false);
  });

  it('prioritizes canonical runtime docs for operational queries', async () => {
    writeFileSync(join(root, '.context', 'docs', 'cortex-100-wave1-rick-b-runtime-contract-2026-03-05.md'), '# Rick-B Runtime Contract\nCanonical runtime contract');
    writeFileSync(join(root, '.context', 'docs', 'memory-systems.md'), '# Memory Systems\nTripartite memory');
    const config = loadConfig(configPath);
    await ingestProject(config);
    const result = await queryContext(config, 'Rick-B runtime control plane e memória');
    expect(result.evidence[0]?.path).toContain('rick-b-runtime-contract');
  });
});
