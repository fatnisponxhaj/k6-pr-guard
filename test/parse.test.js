import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSummary, splitName, isEmptyRun, SummaryError } from '../src/parse.js';
import { load } from './helpers.js';

// Fixtures are real summaries recorded against examples/demo-server.js.
for (const run of ['baseline', 'regressed', 'broken']) {
  test(`${run}: both summary formats normalize to the same numbers`, () => {
    const a = load(`${run}.handle-summary.json`);
    const b = load(`${run}.summary-export.json`);
    assert.equal(a.format, 'handle-summary');
    assert.equal(b.format, 'summary-export');
    for (const name of ['http_req_duration', 'http_req_duration{scenario:browse}', 'http_req_failed', 'checks', 'http_reqs']) {
      const ma = a.metrics.get(name);
      const mb = b.metrics.get(name);
      assert.equal(ma.type, mb.type, name);
      for (const key of ['p(95)', 'p(99)', 'rate', 'count']) assert.equal(ma.values[key], mb.values[key], `${name} ${key}`);
      assert.deepEqual(ma.thresholds, mb.thresholds, `${name} thresholds`);
    }
  });
}

test('legacy export: threshold boolean means "failed"', () => {
  const t = load('broken.summary-export.json').metrics.get('http_req_failed').thresholds;
  assert.deepEqual(t, [{ expr: 'rate<0.05', ok: false }]);
  const ok = load('baseline.summary-export.json').metrics.get('http_req_failed').thresholds;
  assert.deepEqual(ok, [{ expr: 'rate<0.05', ok: true }]);
});

test('legacy export: duration trends are recognized as time', () => {
  const m = load('baseline.summary-export.json').metrics;
  assert.equal(m.get('http_req_duration').isTime, true);
  assert.equal(m.get('http_req_duration{scenario:checkout}').isTime, true);
});

test('splits tagged sub-metric names', () => {
  assert.deepEqual(splitName('http_req_duration{scenario:browse,method:GET}'), {
    base: 'http_req_duration',
    tags: { scenario: 'browse', method: 'GET' },
  });
  assert.deepEqual(splitName('checks'), { base: 'checks', tags: {} });
  // URL tags contain colons; only the first one separates key and value.
  assert.deepEqual(splitName('http_req_duration{url:http://x:1/a}').tags, { url: 'http://x:1/a' });
});

test('rejects input that is not a load test summary', () => {
  assert.throws(() => normalizeSummary(null), SummaryError);
  assert.throws(() => normalizeSummary({ foo: 1 }), SummaryError);
  assert.throws(() => normalizeSummary([]), SummaryError);
});

test('detects empty runs', () => {
  assert.equal(isEmptyRun(normalizeSummary({ metrics: {} })), true);
  assert.equal(isEmptyRun(normalizeSummary({ metrics: { http_reqs: { count: 0, rate: 0 } } })), true);
  assert.equal(isEmptyRun(load('baseline.summary-export.json')), false);
});

test('ignores junk metric entries instead of crashing', () => {
  const s = normalizeSummary({ metrics: { a: null, b: 'x', http_reqs: { count: 3, rate: 1 } } });
  assert.deepEqual([...s.metrics.keys()], ['http_reqs']);
});
