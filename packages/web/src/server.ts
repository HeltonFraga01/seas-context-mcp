import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ingestProject, queryContext, ContextStore } from '@seas-context/core-indexer';
import { cortexxCapability, enrichCortexxQuery, patchCortexxConfig } from '@seas-context/provider-cortexx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = resolve(__dirname, '../public');
const port = Number(process.env.PORT ?? 4317);

function sendJson(res: any, status: number, payload: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const loaded = loadConfig(process.env.CONTEXT_CONFIG);
    const config = loaded.provider === 'cortexx' ? patchCortexxConfig(loaded) : loaded;
    if (url.pathname === '/api/health') {
      const store = new ContextStore(config.project_root);
      return sendJson(res, 200, store.health(config.project_id));
    }
    if (url.pathname === '/api/map') {
      const store = new ContextStore(config.project_root);
      return sendJson(res, 200, store.projectMap(config.project_id));
    }
    if (url.pathname === '/api/query') {
      const q = url.searchParams.get('q') ?? '';
      const effectiveQuery = config.provider === 'cortexx' ? enrichCortexxQuery(q) : q;
      return sendJson(res, 200, await queryContext(config, effectiveQuery));
    }
    if (url.pathname === '/api/ingest' && req.method === 'POST') {
      return sendJson(res, 200, await ingestProject(config));
    }
    if (url.pathname === '/api/provider') {
      return sendJson(res, 200, { provider: config.provider, capability: config.provider === 'cortexx' ? cortexxCapability : null });
    }
    if (url.pathname === '/app.js') {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      return res.end(readFileSync(resolve(publicDir, 'app.js')));
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(resolve(publicDir, 'index.html')));
  } catch (error) {
    sendJson(res, 500, { error: (error as Error).message });
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`SEAS Context Web listening on http://127.0.0.1:${port}`);
});
