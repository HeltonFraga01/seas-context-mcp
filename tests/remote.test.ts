import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../packages/core-indexer/src/index.ts';
import { fetchGithubSource, fetchWebSource } from '../packages/core-indexer/src/remote.ts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let root = '';
let configPath = '';
const originalFetch = global.fetch;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'seas-context-remote-'));
  writeFileSync(join(root, 'contextmcp.toml'), `project_id = "test"\nproject_name = "Test"\nproject_root = "."\nprovider = "generic"\n\n[include]\nglobs = ["**/*.md"]\n\n[exclude]\nglobs = ["node_modules/**", ".seas-context/**"]\n\n[embeddings]\nprovider = "openai"\nmodel = "text-embedding-3-small"\nenabled = false\n\n[risk_gate]\nauto_allow_low = true\nauto_allow_medium = false\nallow_high = false\n\n[[sources]]\ntype = "local"\nname = "repo"\npath = "."\n\n[web_allowlist]\ndomains = ["example.com"]\n`);
  configPath = join(root, 'contextmcp.toml');
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('remote connectors', () => {
  it('blocks web fetch outside allowlist', async () => {
    const config = loadConfig(configPath);
    await expect(fetchWebSource('https://not-allowed.example.org/page', config)).rejects.toThrow('Domain not allowlisted');
  });

  it('collects issues, pulls, readme and releases from GitHub source', async () => {
    global.fetch = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/readme')) {
        return new Response(JSON.stringify({ download_url: 'https://raw.githubusercontent.com/example/repo/main/README.md' }), { status: 200 });
      }
      if (url.includes('raw.githubusercontent.com')) {
        return new Response('# README\nRemote docs', { status: 200 });
      }
      if (url.endsWith('/issues?state=open&per_page=20')) {
        return new Response(JSON.stringify([{ number: 10, title: 'Issue A', body: 'Issue body' }, { number: 11, title: 'PR shadow', body: 'ignore', pull_request: { url: 'x' } }]), { status: 200 });
      }
      if (url.endsWith('/pulls?state=open&per_page=20')) {
        return new Response(JSON.stringify([{ number: 21, title: 'PR A', body: 'Pull body' }]), { status: 200 });
      }
      if (url.endsWith('/releases?per_page=10')) {
        return new Response(JSON.stringify([{ tag_name: 'v1.0.0', name: 'v1.0.0', body: 'Release notes' }]), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as any;

    const result = await fetchGithubSource({
      type: 'github',
      name: 'repo',
      owner: 'example',
      repo: 'repo'
    });

    expect(result.readme).toContain('Remote docs');
    expect(result.issues).toHaveLength(1);
    expect(result.pulls).toHaveLength(1);
    expect(result.releases).toHaveLength(1);
  });
});
