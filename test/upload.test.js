import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { normalizeSummary } from '../src/parse.js';
import { buildPoints, runContext, uploadRun } from '../src/upload.js';
import { startMockProApi } from './support/mock-pro-api.js';
import { fixturePath, load } from './helpers.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'p95guard-upload-'));
const find = (points, metric, stat) => points.find((p) => p.metric === metric && p.stat === stat);

test('points: p95/p99 first, then rates and counts, then other stats', () => {
  const summary = load('regressed.handle-summary.json');
  const { points, skipped } = buildPoints(summary, ['http_req_duration']);
  assert.equal(skipped, 0);
  assert.deepEqual(points.slice(0, 2).map((p) => `${p.metric} ${p.stat}`), ['http_req_duration p(95)', 'http_req_duration p(99)']);
  assert.equal(find(points, 'http_req_duration', 'p(95)').value, summary.metrics.get('http_req_duration').values['p(95)']);
  assert.ok(find(points, 'http_req_duration{scenario:checkout}', 'p(99)'));
  assert.equal(find(points, 'http_req_failed', 'rate').value, summary.metrics.get('http_req_failed').values.rate);
  assert.ok(find(points, 'checks', 'rate'));
  assert.ok(find(points, 'http_reqs', 'count'));
  assert.ok(find(points, 'http_req_duration', 'med'));
  assert.ok(!points.some((p) => p.metric.includes('expected_response')));
  const firstOther = points.findIndex((p) => p.stat === 'p(90)');
  assert.ok(points.slice(0, firstOther).every((p) => ['p(95)', 'p(99)', 'rate', 'count'].includes(p.stat)));
});

test('points stay inside the API limits and keep the most important numbers', () => {
  const metrics = { http_reqs: { type: 'counter', values: { count: 10, rate: 1 } } };
  for (let i = 0; i < 300; i++) {
    const name = `http_req_duration{url:https://example.test/${'x'.repeat(150)}/${i}}`;
    metrics[name] = { type: 'trend', contains: 'time', values: { avg: 1, med: 1, max: 2, min: 0, 'p(90)': 1, 'p(95)': 1, 'p(99)': 2 } };
  }
  const { points, skipped } = buildPoints(normalizeSummary({ metrics }), ['http_req_duration']);
  assert.ok(points.length <= 500);
  assert.ok(JSON.stringify(points).length <= 60 * 1024);
  assert.ok(skipped > 0);
  assert.ok(points.every((p) => p.stat === 'p(95)' || p.stat === 'p(99)'), 'only key stats fit');
});

test('points skip names the API would reject', () => {
  const metrics = {
    http_reqs: { type: 'counter', values: { count: 1, rate: 1 } },
    'http_req_duration{name:ünïcode}': { type: 'trend', contains: 'time', values: { 'p(95)': 1 } },
    http_req_duration: { type: 'trend', contains: 'time', values: { 'p(95)': 1 } },
  };
  const { points, skipped } = buildPoints(normalizeSummary({ metrics }), ['http_req_duration']);
  assert.equal(skipped, 1);
  assert.ok(find(points, 'http_req_duration', 'p(95)'));
});

test('context on push uses the pushed commit and branch', () => {
  const ctx = runContext({
    GITHUB_REPOSITORY: 'acme/api', GITHUB_REF_NAME: 'main', GITHUB_SHA: 'abc1234', GITHUB_EVENT_NAME: 'push',
    GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '42',
  });
  assert.deepEqual(ctx, { repo: 'acme/api', branch: 'main', sha: 'abc1234', pr: null, event: 'push', runUrl: 'https://github.com/acme/api/actions/runs/42' });
});

test('context on a pull request uses the head commit, not the merge commit', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'event.json'), JSON.stringify({ pull_request: { number: 7, head: { ref: 'feature/x', sha: 'def5678' } } }));
  const ctx = runContext({
    GITHUB_REPOSITORY: 'acme/api', GITHUB_REF_NAME: '7/merge', GITHUB_SHA: 'mergecommit', GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: join(dir, 'event.json'), GITHUB_SERVER_URL: 'http://ghes.local', GITHUB_RUN_ID: '1',
  });
  assert.equal(ctx.branch, 'feature/x');
  assert.equal(ctx.sha, 'def5678');
  assert.equal(ctx.pr, 7);
  assert.equal(ctx.runUrl, null, 'the API only accepts https run links');
});

test('uploadRun reports success and explains failures', async () => {
  const api = await startMockProApi({ expectedKey: 'k' });
  try {
    assert.deepEqual(await uploadRun({ apiUrl: `${api.url}/`, apiKey: 'k', payload: { a: 1 } }), { ok: true, message: 'uploaded to p95 Guard Pro' });
    assert.equal(api.requests[0].url, '/api/v1/runs');
    assert.equal(api.requests[0].contentType, 'application/json');
    assert.match((await uploadRun({ apiUrl: api.url, apiKey: 'wrong', payload: {} })).message, /API key was rejected/);
  } finally {
    await api.close();
  }

  const ended = await startMockProApi({ status: 402, error: 'The p95 Guard Pro trial for acme has ended.' });
  try {
    assert.deepEqual(await uploadRun({ apiUrl: ended.url, apiKey: 'k', payload: {} }), { ok: false, message: 'The p95 Guard Pro trial for acme has ended. (HTTP 402)' });
  } finally {
    await ended.close();
  }

  const slow = await startMockProApi({ delayMs: 500 });
  try {
    assert.match((await uploadRun({ apiUrl: slow.url, apiKey: 'test-key', payload: {}, timeoutMs: 100 })).message, /no answer .* within 0.1 s/);
  } finally {
    await slow.close();
  }

  const refused = await uploadRun({ apiUrl: 'http://127.0.0.1:9', apiKey: 'k', payload: {} });
  assert.equal(refused.ok, false);
});

function actionsEnv(dir, api, extra = {}) {
  writeFileSync(join(dir, 'event.json'), JSON.stringify({ pull_request: { number: 3, head: { ref: 'slow-change', sha: 'feedbeef' } } }));
  return {
    GITHUB_REPOSITORY: 'acme/api', GITHUB_SHA: 'mergecommit', GITHUB_REF_NAME: '3/merge', GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: join(dir, 'event.json'), GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '9',
    GITHUB_OUTPUT: join(dir, 'output'), P95GUARD_API_URL: api?.url, P95GUARD_API_KEY: 'test-key', ...extra,
  };
}

async function cli(argv, env) {
  let out = '';
  let err = '';
  const code = await main(argv, env, { write: (s) => (out += s) }, { write: (s) => (err += s) });
  return { code, out, err };
}

test('CLI --upload sends the run and keeps the verdict', async () => {
  const api = await startMockProApi();
  const dir = tmp();
  try {
    const r = await cli(['--current', fixturePath('regressed.handle-summary.json'), '--baseline', fixturePath('baseline.handle-summary.json'), '--name', 'api', '--upload', '--quiet'], actionsEnv(dir, api));
    assert.equal(r.code, 1, 'a regression still fails');
    assert.match(r.err, /uploaded to p95 Guard Pro \(\d+ numbers\)/);
    assert.match(readFileSync(join(dir, 'output'), 'utf8'), /uploaded=true/);
    const sent = api.requests[0];
    assert.equal(sent.authorization, 'Bearer test-key');
    assert.equal(sent.body.repo, 'acme/api');
    assert.equal(sent.body.sha, 'feedbeef');
    assert.equal(sent.body.branch, 'slow-change');
    assert.equal(sent.body.pr, 3);
    assert.equal(sent.body.test, 'api');
    assert.equal(sent.body.verdict, 'fail');
    assert.equal(sent.body.runUrl, 'https://github.com/acme/api/actions/runs/9');
    assert.ok(sent.body.points.length > 10);
  } finally {
    await api.close();
  }
});

test('CLI --upload problems are warnings, never failures', async () => {
  const pass = ['--current', fixturePath('baseline.handle-summary.json'), '--upload', '--quiet'];

  const noKey = await cli(pass, actionsEnv(tmp(), null, { P95GUARD_API_KEY: '' }));
  assert.equal(noKey.code, 0);
  assert.match(noKey.err, /::warning::.*needs the P95GUARD_API_KEY/);

  const notInActions = await cli(pass, { P95GUARD_API_KEY: 'k' });
  assert.equal(notInActions.code, 0);
  assert.match(notInActions.err, /needs GITHUB_REPOSITORY and GITHUB_SHA/);

  const ended = await startMockProApi({ status: 402, error: 'trial ended' });
  const dir = tmp();
  try {
    const r = await cli(pass, actionsEnv(dir, ended));
    assert.equal(r.code, 0);
    assert.match(r.err, /::warning::p95guard: upload to p95 Guard Pro failed: trial ended \(HTTP 402\)/);
    assert.match(readFileSync(join(dir, 'output'), 'utf8'), /uploaded=false/);
  } finally {
    await ended.close();
  }
});

test('without --upload nothing is sent, even with a key in the environment', async () => {
  const api = await startMockProApi();
  try {
    await cli(['--current', fixturePath('baseline.handle-summary.json'), '--quiet'], actionsEnv(tmp(), api));
    assert.equal(api.requests.length, 0);
  } finally {
    await api.close();
  }
});
