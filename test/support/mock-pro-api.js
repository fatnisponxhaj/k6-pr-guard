// Stand-in for the p95 Guard Pro API, used by the tests and by CI.
// Accepts POST /api/v1/runs with the expected key and records every request.
//
// As a script: EXPECTED_KEY=... PORT=8788 LOG=pro-requests.jsonl node test/support/mock-pro-api.js

import http from 'node:http';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * @param {{ port?: number, expectedKey?: string, status?: number, error?: string, delayMs?: number, onRequest?: (r: object) => void }} options
 *   status/error force a response, e.g. 402 with the API's error text.
 */
export function startMockProApi({ port = 0, expectedKey = 'test-key', status, error, delayMs = 0, onRequest } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let json = null;
      try {
        json = body ? JSON.parse(body) : null;
      } catch {}
      const record = { method: req.method, url: req.url, authorization: req.headers.authorization ?? null, contentType: req.headers['content-type'] ?? null, body: json };
      requests.push(record);
      onRequest?.(record);

      let code = status;
      let payload = error ? { error } : null;
      if (!code) {
        const authorized = req.headers.authorization === `Bearer ${expectedKey}`;
        code = req.method === 'POST' && req.url === '/api/v1/runs' ? (authorized ? 201 : 401) : 404;
        payload = code === 201 ? { id: requests.length, createdAt: new Date().toISOString() } : { error: code === 401 ? 'invalid or missing API key' : 'not found' };
      }
      setTimeout(() => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload ?? {}));
      }, delayMs);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const log = process.env.LOG ?? 'pro-requests.jsonl';
  const api = await startMockProApi({
    port: Number(process.env.PORT ?? 8788),
    expectedKey: process.env.EXPECTED_KEY ?? 'test-key',
    onRequest: (r) => appendFileSync(log, `${JSON.stringify(r)}\n`),
  });
  console.log(`mock p95 Guard Pro API on ${api.url}, logging to ${log}`);
}
