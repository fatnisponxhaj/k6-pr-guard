// Tiny local HTTP server for trying p95 Guard without a real backend.
// DELAY_MS sets the base latency, JITTER_MS adds random spread, ERROR_RATE (0..1) returns 500s.
import http from 'node:http';

const port = Number(process.env.PORT ?? 3333);
const delay = Number(process.env.DELAY_MS ?? 20);
const jitter = Number(process.env.JITTER_MS ?? 10);
const errorRate = Number(process.env.ERROR_RATE ?? 0);

http
  .createServer((req, res) => {
    const wait = delay + Math.random() * jitter;
    setTimeout(() => {
      const fail = Math.random() < errorRate;
      res.writeHead(fail ? 500 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: !fail, path: req.url }));
    }, wait);
  })
  .listen(port, () => console.log(`demo server on http://localhost:${port} (delay ${delay}ms, errors ${errorRate})`));
