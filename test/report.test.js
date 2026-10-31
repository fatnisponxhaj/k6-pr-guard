import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../src/compare.js';
import { renderMarkdown, markerFor, MARKER, NAME_PATTERN } from '../src/report.js';
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

test('named tests get their own marker and heading', () => {
  const md = renderMarkdown(compare(makeSummary(), null), { name: 'checkout-api' });
  assert.ok(md.startsWith('<!-- k6-pr-guard:checkout-api -->\n'));
  assert.match(md, /## ✅ k6 PR Guard · checkout-api: no performance regression/);
});

test('markers never match each other by substring', () => {
  const markers = [markerFor(undefined), markerFor('api'), markerFor('api-v2'), markerFor('ap')];
  for (const a of markers) for (const b of markers) if (a !== b) assert.ok(!a.includes(b), `${a} contains ${b}`);
  assert.equal(markerFor(''), MARKER);
});

test('baseline label says what was compared', () => {
  const s = makeSummary();
  const md = renderMarkdown(compare(s, s), { baselineLabel: 'the last good run on `main` (abc1234)' });
  assert.match(md, /Compared with the last good run on `main` \(abc1234\)\./);
});

test('name pattern rejects anything that could break the marker or cache key', () => {
  for (const ok of ['api', 'checkout-api', 'v2.load_test', 'A1']) assert.ok(NAME_PATTERN.test(ok), ok);
  for (const bad of ['', 'a b', 'x-->', 'a/b', 'a:b', '<!--', 'x'.repeat(65)]) assert.ok(!NAME_PATTERN.test(bad), bad);
});
