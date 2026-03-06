import type { ProjectConfig, SourceDescriptor, WriteActionRequest } from './types.js';

const DEFAULT_REMOTE_TIMEOUT_MS = 15_000;

async function fetchJsonWithTimeout(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_REMOTE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    return resp;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function requireGithubToken() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required for GitHub operations');
  return token;
}

export async function fetchGithubSource(source: SourceDescriptor) {
  if (!source.owner || !source.repo) {
    throw new Error(`GitHub source ${source.name} requires owner/repo`);
  }
  const headers: Record<string, string> = {
    'User-Agent': 'seas-context-mcp',
    'Accept': 'application/vnd.github+json'
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const [repoResp, issuesResp, pullsResp, readmeResp, releasesResp] = await Promise.all([
    fetchJsonWithTimeout(`https://api.github.com/repos/${source.owner}/${source.repo}`, { headers }),
    fetchJsonWithTimeout(`https://api.github.com/repos/${source.owner}/${source.repo}/issues?state=open&per_page=20`, { headers }),
    fetchJsonWithTimeout(`https://api.github.com/repos/${source.owner}/${source.repo}/pulls?state=open&per_page=20`, { headers }),
    fetchJsonWithTimeout(`https://api.github.com/repos/${source.owner}/${source.repo}/readme`, { headers }),
    fetchJsonWithTimeout(`https://api.github.com/repos/${source.owner}/${source.repo}/releases?per_page=10`, { headers })
  ]);

  const repo = repoResp.ok ? await repoResp.json() : null;
  const issues = issuesResp.ok ? (await issuesResp.json()).filter((item: any) => !item.pull_request) : [];
  const pulls = pullsResp.ok ? await pullsResp.json() : [];
  const readmeMeta = readmeResp.ok ? await readmeResp.json() : null;
  const readme = readmeMeta?.download_url ? await fetchJsonWithTimeout(readmeMeta.download_url).then((resp) => resp.text()) : '';
  const releases = releasesResp.ok ? await releasesResp.json() : [];
  return { repo, issues, pulls, readme, releases };
}

export async function fetchWebSource(url: string, config: ProjectConfig) {
  const hostname = new URL(url).hostname;
  if (!config.web_allowlist.domains.includes(hostname)) {
    throw new Error(`Domain not allowlisted: ${hostname}`);
  }
  const resp = await fetchJsonWithTimeout(url, { headers: { 'User-Agent': 'seas-context-mcp' } });
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return resp.text();
}

export async function githubIssueUpsert(request: WriteActionRequest) {
  const token = requireGithubToken();
  const { owner, repo, title, body, number } = request.payload as Record<string, string | number>;
  if (!owner || !repo || !title || !body) {
    throw new Error('github_issue_upsert requires owner, repo, title and body');
  }
  const url = number
    ? `https://api.github.com/repos/${owner}/${repo}/issues/${number}`
    : `https://api.github.com/repos/${owner}/${repo}/issues`;
  const method = number ? 'PATCH' : 'POST';
  const resp = await fetchJsonWithTimeout(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'seas-context-mcp',
      Accept: 'application/vnd.github+json'
    },
    body: JSON.stringify({ title, body })
  });
  if (!resp.ok) throw new Error(`GitHub issue upsert failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

export async function githubDocPublish(request: WriteActionRequest) {
  const token = requireGithubToken();
  const { owner, repo, path, content, message, sha } = request.payload as Record<string, string>;
  if (!owner || !repo || !path || !content || !message) {
    throw new Error('doc_publish requires owner, repo, path, content and message');
  }
  const resp = await fetchJsonWithTimeout(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'seas-context-mcp',
      Accept: 'application/vnd.github+json'
    },
    body: JSON.stringify({ message, content: Buffer.from(content, 'utf8').toString('base64'), sha })
  });
  if (!resp.ok) throw new Error(`GitHub doc publish failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}
