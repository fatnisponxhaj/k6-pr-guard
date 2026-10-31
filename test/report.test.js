import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../src/compare.js';
import { renderMarkdown, MARKER } from '../src/report.js';
import { load, makeSummary } from './helpers.js';

test('failing report has marker, reasons and table', () => {
  const md = renderMarkdown(compare(load('regressed.handle-summary.json'), load('baseline.handle-summary.json')), { runUrl: 'https://example.test/run/1' });
  assert.ok(md.startsWith(MARKER));
  assert.match(md, /## ❌ k6 PR Guard: performance regression/);
  assert.match(md, /\*\*Why it failed\*\*/);
  assert.match(md, /\| `http_req_duration` \| p\(95\) \| \d+\.\d ms \| \d+\.\d ms \| \+\d+\.\d ms \(\+\d+\.\d%\) \| 🔺 regressed \|/);
  assert.match(md, /\[Workflow run\]\(https:\/\/example\.test\/run\/1\)/);
});

test('passing report has no failure section', () => {
  const s = load('baseline.handle-summary.json');
  const md = renderMarkdown(compare(s, s), { title: 'Perf' });
  assert.match(md, /## ✅ Perf: no performance regression/);
  assert.doesNotMatch(md, /Why it failed/);
});

test('changes that round to zero show ±, never −0.0', () => {
  const md = renderMarkdown(compare(makeSummary({ p95: 100.01 }), makeSummary({ p95: 100.02 })));
  assert.match(md, /±0\.0 ms/);
  assert.doesNotMatch(md, /−0\.0 ms/);
});

test('seconds are used for slow endpoints', () => {
  const md = renderMarkdown(compare(makeSummary({ p95: 2500, p99: 3000 }), null));
  assert.match(md, /2\.50 s/);
});

test('pipes in tag values do not break the table', () => {
  const extra = { 'http_req_duration{name:a|b}': { type: 'trend', contains: 'time', values: { 'p(95)': 1, 'p(99)': 1 } } };
  const md = renderMarkdown(compare(makeSummary({ extra }), null));
  assert.match(md, /a\\\|b/);
});
