import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assets } from '../../../apps/agent-usage/server.mjs';
import { models, quotaResponse } from './quotaData.mjs';

const appRoot = fileURLToPath(new URL('../../../apps/agent-usage/', import.meta.url));

// Serves the real dashboard assets (same route table as the product server) with canned API data on a random port.
export async function startFixtureServer({ quota = quotaResponse() } = {}) {
  let current = quota;
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://127.0.0.1');
    const json = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (assets[pathname]) {
      const [file, type] = assets[pathname];
      response.writeHead(200, { 'Content-Type': type });
      response.end(await readFile(appRoot + file));
    } else if (pathname === '/api/quota' || pathname === '/api/settings') {
      if (request.method === 'PUT') {
        let body = '';
        for await (const chunk of request) body += chunk;
        current = { ...current, settings: { ...current.settings, ...JSON.parse(body) } };
      }
      json(200, current);
    } else if (pathname === '/api/models') {
      json(200, { models });
    } else {
      json(404, { error: 'Not found.' });
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    setQuota(next) { current = next; },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
