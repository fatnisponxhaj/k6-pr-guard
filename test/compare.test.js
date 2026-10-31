import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../src/compare.js';
import { load, makeSummary, subTrend } from './helpers.js';

const row = (result, metric, stat) => result.rows.find((r) => r.metric === metric && r.stat === stat);

test('real runs: same build passes against itself', () => {
  const s = load('baseline.handle-summary.json');
  const r = compare(s, s);
  assert.equal(r.verdict, 'pass');
  assert.ok(r.rows.every((x) => x.status === 'ok'));
});

test('real runs: slower server with errors fails', () => {
  const r = compare(load('regressed.handle-summary.json'), load('baseline.handle-summary.json'));
  assert.equal(r.verdict, 'fail');
  assert.equal(row(r, 'http_req_duration', 'p(95)').status, 'regressed');
  assert.equal(row(r, 'http_req_failed', 'rate').status, 'regressed');
});

test('real runs: k6 threshold failure fails even with same latency', () => {
  const r = compare(load('broken.summary-export.json'), load('baseline.summary-export.json'));
  assert.equal(r.verdict, 'fail');
  assert.deepEqual(r.failedThresholds, [{ metric: 'http_req_failed', expr: 'rate<0.05' }]);
  assert.equal(row(r, 'http_req_duration', 'p(95)').status, 'ok');
});

test('formats can be mixed between baseline and current', () => {
  const r = compare(load('baseline.handle-summary.json'), load('baseline.summary-export.json'));
  assert.equal(r.verdict, 'pass');
});

test('p95 within budget passes, over budget fails', () => {
  assert.equal(compare(makeSummary({ p95: 109 }), makeSummary({ p95: 100 })).verdict, 'pass');
  assert.equal(compare(makeSummary({ p95: 111 }), makeSummary({ p95: 100 })).verdict, 'fail');
  assert.equal(compare(makeSummary({ p95: 111 }), makeSummary({ p95: 100 }), { p95Pct: 20 }).verdict, 'pass');
});

test('warns ("worse") above half the budget without failing', () => {
  const r = compare(makeSummary({ p95: 107 }), makeSummary({ p95: 100 }));
  assert.equal(r.verdict, 'pass');
  assert.equal(row(r, 'http_req_duration', 'p(95)').status, 'worse');
});

test('tiny absolute changes are noise even when the percentage is large', () => {
  const r = compare(makeSummary({ p95: 3, p99: 4 }), makeSummary({ p95: 2, p99: 3 }));
  assert.equal(r.verdict, 'pass');
  assert.equal(row(r, 'http_req_duration', 'p(95)').status, 'ok');
  assert.equal(compare(makeSummary({ p95: 3, p99: 4 }), makeSummary({ p95: 2, p99: 3 }), { minDeltaMs: 0 }).verdict, 'fail');
});

test('a zero baseline does not divide by zero', () => {
  const r = compare(makeSummary({ p95: 50, p99: 50 }), makeSummary({ p95: 0, p99: 0 }));
  assert.equal(row(r, 'http_req_duration', 'p(95)').pct, Infinity);
  assert.equal(r.verdict, 'fail');
});

test('improvements are marked better', () => {
  const r = compare(makeSummary({ p95: 50, p99: 60 }), makeSummary({ p95: 100, p99: 150 }));
  assert.equal(row(r, 'http_req_duration', 'p(95)').status, 'better');
  assert.equal(r.verdict, 'pass');
});

test('error rate budget is in percentage points', () => {
  assert.equal(compare(makeSummary({ errorRate: 0.019 }), makeSummary({ errorRate: 0.01 })).verdict, 'pass');
  assert.equal(compare(makeSummary({ errorRate: 0.021 }), makeSummary({ errorRate: 0.01 })).verdict, 'fail');
  // Fewer errors is never a regression.
  assert.equal(row(compare(makeSummary({ errorRate: 0 }), makeSummary({ errorRate: 0.05 })), 'http_req_failed', 'rate').status, 'better');
});

test('a drop in passed checks fails', () => {
  const r = compare(makeSummary({ checks: 0.97 }), makeSummary({ checks: 1 }));
  assert.equal(row(r, 'checks', 'rate').status, 'regressed');
  assert.deepEqual(r.reasons, ['`checks` rate 100.00% → 97.00% (−3.00pp)']);
});

test('no baseline: only thresholds count', () => {
  const r = compare(makeSummary({ p95: 9999 }), null);
  assert.equal(r.verdict, 'pass');
  assert.equal(r.hasBaseline, false);
  assert.ok(r.rows.every((x) => x.status === 'new'));
  assert.match(r.notes.join('\n'), /No baseline yet/);
});

test('empty current run fails, unless allowed', () => {
  const r = compare(makeSummary({ reqs: 0 }), makeSummary());
  assert.equal(r.verdict, 'fail');
  assert.match(r.reasons[0], /no HTTP requests/);
  assert.equal(compare(makeSummary({ reqs: 0 }), makeSummary(), { failOnEmpty: false }).verdict, 'pass');
});

test('empty baseline is ignored', () => {
  const r = compare(makeSummary({ p95: 500 }), makeSummary({ reqs: 0, p95: 1 }));
  assert.equal(r.hasBaseline, false);
  assert.equal(r.verdict, 'pass');
  assert.match(r.notes.join('\n'), /baseline run was empty/);
});

test('renamed scenario: old one reported missing, new one has no baseline', () => {
  const baseline = makeSummary({ extra: { 'http_req_duration{scenario:checkout}': subTrend(200) } });
  const current = makeSummary({ extra: { 'http_req_duration{scenario:purchase}': subTrend(900) } });
  const r = compare(current, baseline);
  assert.equal(r.verdict, 'pass');
  const notes = r.notes.join('\n');
  assert.match(notes, /scenario:checkout\}` is in the baseline but not in this run/);
  assert.match(notes, /scenario:purchase\}` is new/);
  assert.equal(row(r, 'http_req_duration{scenario:purchase}', 'p(95)').status, 'new');
});

test('per-scenario regression fails even when the total is fine', () => {
  const baseline = makeSummary({ extra: { 'http_req_duration{scenario:checkout}': subTrend(200) } });
  const current = makeSummary({ extra: { 'http_req_duration{scenario:checkout}': subTrend(300) } });
  const r = compare(current, baseline);
  assert.equal(r.verdict, 'fail');
  assert.equal(row(r, 'http_req_duration', 'p(95)').status, 'ok');
  assert.equal(row(r, 'http_req_duration{scenario:checkout}', 'p(95)').status, 'regressed');
});

test("k6's own expected_response sub-metric is skipped", () => {
  const extra = { 'http_req_duration{expected_response:true}': subTrend(100) };
  const r = compare(makeSummary({ extra }), makeSummary({ extra }));
  assert.ok(!r.rows.some((x) => x.metric.includes('expected_response')));
});

test('missing p(99) is explained, not treated as a regression', () => {
  const r = compare(makeSummary({ p99: null }), makeSummary({ p99: null }));
  assert.equal(r.verdict, 'pass');
  assert.ok(!r.rows.some((x) => x.stat === 'p(99)'));
  assert.match(r.notes.join('\n'), /summaryTrendStats/);
});

test('changed thresholds are reported', () => {
  const baseline = makeSummary({ thresholds: { http_req_duration: { 'p(95)<500': { ok: true } } } });
  const current = makeSummary({ thresholds: { http_req_duration: { 'p(95)<800': { ok: true } } } });
  const r = compare(current, baseline);
  assert.match(r.notes.join('\n'), /Thresholds changed on `http_req_duration`: removed `p\(95\)<500`; added `p\(95\)<800`/);
});

test('failed thresholds can be ignored', () => {
  const s = makeSummary({ thresholds: { http_req_failed: { 'rate<0.01': { ok: false } } } });
  assert.equal(compare(s, null).verdict, 'fail');
  assert.equal(compare(s, null, { failOnThresholds: false }).verdict, 'pass');
});

test('very different test durations get a warning', () => {
  const r = compare(makeSummary({ durationMs: 60000 }), makeSummary({ durationMs: 10000 }));
  assert.match(r.notes.join('\n'), /Test duration changed/);
});

test('custom trend metrics can be compared', () => {
  const extra = (p95) => ({ api_latency: { type: 'trend', contains: 'time', values: { 'p(95)': p95, 'p(99)': p95 } } });
  const r = compare(makeSummary({ extra: extra(200) }), makeSummary({ extra: extra(100) }), { trendMetrics: ['api_latency'] });
  assert.equal(r.verdict, 'fail');
  assert.ok(r.rows.every((x) => x.metric !== 'http_req_duration'));
});

test('one failure reason per metric, p(95) and p(99) together', () => {
  const r = compare(load('regressed.handle-summary.json'), load('baseline.handle-summary.json'));
  const latency = r.reasons.filter((x) => x.startsWith('`http_req_duration`'));
  assert.equal(latency.length, 1);
  assert.match(latency[0], /^`http_req_duration` p\(95\) [\d.]+ ms → [\d.]+ ms \(\+[\d.]+%\), p\(99\) [\d.]+ ms → [\d.]+ ms \(\+[\d.]+%\)$/);
  assert.equal(r.regressions, 8); // rows, not reasons: 3 metrics × 2 stats + error rate + checks
  assert.equal(r.reasons.length, 5);
});

test('saving a baseline: passing run says it becomes the baseline', () => {
  const r = compare(makeSummary(), null, { savingBaseline: true });
  assert.equal(r.verdict, 'pass');
  assert.match(r.notes[0], /saved as the new baseline/);
  assert.doesNotMatch(r.notes.join('\n'), /No baseline yet/);
});

test('saving a baseline: failing run keeps the old one', () => {
  const s = makeSummary({ thresholds: { http_req_failed: { 'rate<0.01': { ok: false } } } });
  const r = compare(s, null, { savingBaseline: true });
  assert.equal(r.verdict, 'fail');
  assert.match(r.notes[0], /previous baseline is kept/);
});
